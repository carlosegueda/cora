// Base de datos de CORA en Convex
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const mode = v.union(v.literal('clasico'), v.literal('supervivencia'));
export const difficulty = v.union(
  v.literal('facil'),
  v.literal('normal'),
  v.literal('dificil'),
  v.literal('hardcore')
);

export default defineSchema({
  // Jugador identificado por un token secreto que guarda su navegador (sin cuentas ni contraseñas)
  players: defineTable({
    name: v.string(),
    token: v.string(),
  }).index('by_token', ['token']),

  // Jugar y Supervivencia: mejor marca de cada jugador en cada tabla (modo + dificultad)
  scores: defineTable({
    playerId: v.id('players'),
    name: v.string(),
    mode,
    difficulty,
    score: v.number(),
    total: v.number(),
    timeMs: v.number(),
    fails: v.optional(v.number()),
    country: v.optional(v.union(v.string(), v.null())), // país del jugador (ISO alfa-2), según su IP
    // Orden del ranking en un solo número: más aciertos primero; a igualdad, menos tiempo
    rank: v.number(),
  })
    .index('by_mode_and_difficulty_and_rank', ['mode', 'difficulty', 'rank'])
    .index('by_player_and_mode_and_difficulty', ['playerId', 'mode', 'difficulty']),

  // Reto diario (Jugar): un intento por jugador y día (UTC). Se crea al empezar, así abandonar
  // también gasta el intento; al terminar se guardan puntos, aciertos, tiempo y orden.
  dailyAttempts: defineTable({
    day: v.string(), // 'AAAA-MM-DD' en UTC
    playerId: v.id('players'),
    name: v.string(),
    country: v.union(v.string(), v.null()), // país del jugador (ISO alfa-2), según su IP
    startedAt: v.number(),
    finished: v.boolean(),
    score: v.optional(v.number()), // aciertos (0–10)
    points: v.optional(v.number()), // puntos (0–10 000): cercanía, aciertos y rapidez
    timeMs: v.optional(v.number()),
    rank: v.optional(v.number()),
  })
    .index('by_day_and_player', ['day', 'playerId'])
    .index('by_day_and_finished_and_rank', ['day', 'finished', 'rank']),
});
