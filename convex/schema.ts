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

// Minijuegos de escribir (modo ranked)
export const minigame = v.union(v.literal('flags'), v.literal('map'), v.literal('capitals'));

// Diario: lo que pasó con cada país del intento (para poder repasarlo después)
export const dailyRound = v.object({
  iso3: v.string(), // país que había que encontrar
  correct: v.boolean(),
  points: v.number(), // 0–1000
  distanceKm: v.union(v.number(), v.null()), // del clic al país (0 si acertó; null si no hubo clic)
  clicked: v.union(v.string(), v.null()), // ISO3 del país donde hizo clic (null = mar o ninguno)
});

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

  // Reto diario (Jugar): un intento por jugador y día (cambia a las 00:00 de UTC−6). Se crea al empezar, así abandonar
  // también gasta el intento; al terminar se guardan puntos, aciertos, tiempo y orden.
  dailyAttempts: defineTable({
    day: v.string(), // 'AAAA-MM-DD' (día del Diario, en UTC−6)
    playerId: v.id('players'),
    name: v.string(),
    country: v.union(v.string(), v.null()), // país del jugador (ISO alfa-2), según su IP
    startedAt: v.number(),
    finished: v.boolean(),
    score: v.optional(v.number()), // aciertos (0–5; 0–10 hasta el 2026-11-17)
    points: v.optional(v.number()), // puntos (0–5000; antes 0–10 000): cercanía, aciertos y rapidez
    timeMs: v.optional(v.number()),
    rank: v.optional(v.number()),
    rounds: v.optional(v.array(dailyRound)), // detalle país a país (intentos antiguos no lo tienen)
  })
    .index('by_day_and_player', ['day', 'playerId'])
    .index('by_day_and_finished_and_rank', ['day', 'finished', 'rank']),

  // Minijuegos en modo ranked (todos los continentes, solo estados, todos los países): mejor
  // tiempo de cada jugador en cada minijuego. Menos tiempo = mejor puesto.
  minigameScores: defineTable({
    playerId: v.id('players'),
    name: v.string(),
    game: minigame,
    timeMs: v.number(),
    total: v.number(), // países de la partida
    skips: v.number(),
    country: v.union(v.string(), v.null()), // país del jugador (ISO alfa-2), según su IP
  })
    .index('by_game_and_timeMs', ['game', 'timeMs'])
    .index('by_player_and_game', ['playerId', 'game']),
});
