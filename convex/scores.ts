// Funciones de servidor de la clasificación
import { query, mutation } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { mode, difficulty } from './schema';

const rankOf = (score: number, timeMs: number) => score * 1e9 - timeMs;

// Máximo de países por partida: 10 en el modo clásico; en supervivencia, el total de la dificultad
const MAX_TOTAL = { clasico: 10, supervivencia: 242 } as const;
// Nadie encuentra un país en menos de esto (frena envíos inventados evidentes)
const MIN_MS_PER_HIT = 700;

// Ranking de una tabla. Las consultas de Convex son reactivas: los clientes suscritos
// reciben la lista nueva en cuanto alguien entra o mejora.
export const top = query({
  args: { mode, difficulty, limit: v.optional(v.number()) },
  handler: async (ctx, { mode, difficulty, limit }) => {
    const rows = await ctx.db
      .query('scores')
      .withIndex('by_board', (q) => q.eq('mode', mode).eq('difficulty', difficulty))
      .order('desc')
      .take(Math.min(limit ?? 20, 100));
    return rows.map(({ _id, name, score, total, timeMs }) => ({ _id, name, score, total, timeMs }));
  },
});

// Envía el resultado de una partida. Solo se guarda si mejora la marca del jugador en esa
// tabla. Devuelve si mejoró y el puesto actual del jugador en la tabla.
export const submit = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    mode,
    difficulty,
    score: v.number(),
    total: v.number(),
    timeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 2 || name.length > 20) {
      throw new ConvexError('El nombre debe tener entre 2 y 20 caracteres');
    }
    if (args.token.length < 16 || args.token.length > 64) throw new ConvexError('Jugador no válido');
    if (
      !Number.isInteger(args.score) ||
      !Number.isInteger(args.total) ||
      args.score < 1 ||
      args.score > args.total ||
      args.total > MAX_TOTAL[args.mode]
    ) {
      throw new ConvexError('Puntuación no válida');
    }
    if (!Number.isFinite(args.timeMs) || args.timeMs < args.score * MIN_MS_PER_HIT || args.timeMs > 6 * 3600e3) {
      throw new ConvexError('Tiempo no válido');
    }

    // Jugador: se crea la primera vez; si cambia de nombre, se actualiza en todas sus marcas
    let player = await ctx.db
      .query('players')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!player) {
      const id = await ctx.db.insert('players', { name, token: args.token });
      player = (await ctx.db.get(id))!;
    } else if (player.name !== name) {
      await ctx.db.patch(player._id, { name });
      const own = await ctx.db
        .query('scores')
        .withIndex('by_player_board', (q) => q.eq('playerId', player!._id))
        .collect();
      for (const row of own) await ctx.db.patch(row._id, { name });
    }

    const timeMs = Math.round(args.timeMs);
    const rank = rankOf(args.score, timeMs);
    const existing = await ctx.db
      .query('scores')
      .withIndex('by_player_board', (q) =>
        q.eq('playerId', player!._id).eq('mode', args.mode).eq('difficulty', args.difficulty)
      )
      .unique();

    let improved = false;
    const row = { name, score: args.score, total: args.total, timeMs, rank };
    if (!existing) {
      await ctx.db.insert('scores', { playerId: player._id, mode: args.mode, difficulty: args.difficulty, ...row });
      improved = true;
    } else if (rank > existing.rank) {
      await ctx.db.patch(existing._id, row);
      improved = true;
    }

    // Puesto del jugador: cuántas marcas de la tabla son mejores que la suya, + 1
    const bestRank = improved ? rank : existing!.rank;
    const better = await ctx.db
      .query('scores')
      .withIndex('by_board', (q) => q.eq('mode', args.mode).eq('difficulty', args.difficulty).gt('rank', bestRank))
      .take(1000);
    return { improved, position: better.length + 1 };
  },
});
