// Clasificación de Jugar y Supervivencia
import { query, mutation } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { mode, difficulty } from './schema';
import { upsertPlayer } from './players';
import { boardRanking } from './rankings';

const rankOf = (score: number, timeMs: number) => score * 1e9 - timeMs;

// Máximo de países de una partida (el total de la dificultad más grande)
const MAX_TOTAL = 242;
// Nadie encuentra un país en menos de esto (frena envíos inventados evidentes)
const MIN_MS_PER_HIT = 700;

// Ranking de una tabla (reactivo: los clientes suscritos reciben los cambios al momento)
export const top = query({
  args: { mode, difficulty, limit: v.optional(v.number()) },
  handler: async (ctx, { mode, difficulty, limit }) => {
    const rows = await ctx.db
      .query('scores')
      .withIndex('by_mode_and_difficulty_and_rank', (q) => q.eq('mode', mode).eq('difficulty', difficulty))
      .order('desc')
      .take(Math.min(limit ?? 20, 100));
    return rows.map(({ _id, name, score, total, timeMs, fails, country }) => ({
      _id,
      name,
      score,
      total,
      timeMs,
      fails: fails ?? null,
      country: country ?? null,
    }));
  },
});

// Envía una partida terminada. Solo se guarda si mejora la marca del jugador en esa tabla.
// En Jugar solo cuentan las partidas completas (todos los países acertados).
// Devuelve si mejoró, el puesto actual del jugador y cuántos hay en la tabla.
export const submit = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    mode,
    difficulty,
    score: v.number(),
    total: v.number(),
    timeMs: v.number(),
    fails: v.optional(v.number()),
    country: v.optional(v.union(v.string(), v.null())), // ISO alfa-2 del jugador, para su bandera
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.score) ||
      !Number.isInteger(args.total) ||
      args.score < 1 ||
      args.score > args.total ||
      args.total > MAX_TOTAL ||
      (args.mode === 'clasico' && args.score !== args.total)
    ) {
      throw new ConvexError('Puntuación no válida');
    }
    if (!Number.isFinite(args.timeMs) || args.timeMs < args.score * MIN_MS_PER_HIT || args.timeMs > 12 * 3600e3) {
      throw new ConvexError('Tiempo no válido');
    }
    const fails = args.fails ?? 0;
    if (!Number.isInteger(fails) || fails < 0 || fails > 10000) throw new ConvexError('Fallos no válidos');

    const player = await upsertPlayer(ctx, args.token, args.name);
    const timeMs = Math.round(args.timeMs);
    const rank = rankOf(args.score, timeMs);
    const existing = await ctx.db
      .query('scores')
      .withIndex('by_player_and_mode_and_difficulty', (q) =>
        q.eq('playerId', player._id).eq('mode', args.mode).eq('difficulty', args.difficulty)
      )
      .unique();

    const country = args.country && /^[A-Z]{2}$/.test(args.country) ? args.country : null;
    const row = { name: player.name, score: args.score, total: args.total, timeMs, fails, rank, country };
    let improved = false;
    let best = existing;
    if (!existing) {
      const id = await ctx.db.insert('scores', { playerId: player._id, mode: args.mode, difficulty: args.difficulty, ...row });
      best = (await ctx.db.get(id))!;
      await boardRanking.insert(ctx, best);
      improved = true;
    } else if (rank > existing.rank) {
      await ctx.db.patch(existing._id, row);
      best = (await ctx.db.get(existing._id))!;
      await boardRanking.replace(ctx, existing, best);
      improved = true;
    } else if (!existing.country && country) {
      // Marca sin país (de antes de guardarlo): se le añade aunque no mejore
      await ctx.db.patch(existing._id, { country });
    }

    const namespace = `${args.mode}:${args.difficulty}`;
    const position = (await boardRanking.indexOfDoc(ctx, best!)) + 1;
    const total = await boardRanking.count(ctx, { namespace });
    return { improved, position, total };
  },
});
