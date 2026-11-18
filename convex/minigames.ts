// Clasificación de los minijuegos de escribir en modo ranked (banderas, mapa y capitales).
// La configuración es fija (todos los continentes, solo estados, todos los países) y la marca
// es el tiempo en completarlos todos: menos tiempo = mejor puesto.
import { query, mutation } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { minigame } from './schema';
import { upsertPlayer } from './players';
import { minigameRanking } from './rankings';

// Países de una partida ranked: los estados con bandera/capital/contorno (hoy 196–198).
// El margen deja sitio a cambios en la lista de países sin tener que tocar el servidor.
const MIN_TOTAL = 180;
const MAX_TOTAL = 210;
// Nadie reconoce y escribe un nombre en menos de esto (frena envíos inventados evidentes)
const MIN_MS_PER_ANSWER = 700;

// Ranking de un minijuego (reactivo), del más rápido al más lento
export const top = query({
  args: { game: minigame, limit: v.optional(v.number()) },
  handler: async (ctx, { game, limit }) => {
    const rows = await ctx.db
      .query('minigameScores')
      .withIndex('by_game_and_timeMs', (q) => q.eq('game', game))
      .take(Math.max(1, Math.min(limit ?? 20, 100)));
    return rows.map(({ _id, name, timeMs, total, skips, country }) => ({ _id, name, timeMs, total, skips, country }));
  },
});

// Envía una partida ranked completada. Solo se guarda si mejora el tiempo del jugador.
// Devuelve si mejoró, su puesto actual y cuántos jugadores hay en la tabla.
export const submit = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    game: minigame,
    timeMs: v.number(),
    total: v.number(),
    skips: v.number(),
    country: v.union(v.string(), v.null()), // ISO alfa-2 del jugador, para su bandera
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.total) || args.total < MIN_TOTAL || args.total > MAX_TOTAL) {
      throw new ConvexError('Partida no válida');
    }
    if (
      !Number.isFinite(args.timeMs) ||
      args.timeMs < args.total * MIN_MS_PER_ANSWER ||
      args.timeMs > 12 * 3600e3
    ) {
      throw new ConvexError('Tiempo no válido');
    }
    if (!Number.isInteger(args.skips) || args.skips < 0 || args.skips > 100000) {
      throw new ConvexError('Saltos no válidos');
    }

    const player = await upsertPlayer(ctx, args.token, args.name);
    const timeMs = Math.round(args.timeMs);
    const country = args.country && /^[A-Z]{2}$/.test(args.country) ? args.country : null;
    const existing = await ctx.db
      .query('minigameScores')
      .withIndex('by_player_and_game', (q) => q.eq('playerId', player._id).eq('game', args.game))
      .unique();

    const row = { name: player.name, timeMs, total: args.total, skips: args.skips, country };
    let improved = false;
    let best = existing;
    if (!existing) {
      const id = await ctx.db.insert('minigameScores', { playerId: player._id, game: args.game, ...row });
      best = (await ctx.db.get(id))!;
      await minigameRanking.insert(ctx, best);
      improved = true;
    } else if (timeMs < existing.timeMs) {
      await ctx.db.patch(existing._id, row);
      best = (await ctx.db.get(existing._id))!;
      await minigameRanking.replace(ctx, existing, best);
      improved = true;
    }

    const position = (await minigameRanking.indexOfDoc(ctx, best!)) + 1;
    const total = await minigameRanking.count(ctx, { namespace: args.game });
    return { improved, position, total, bestMs: best!.timeMs };
  },
});
