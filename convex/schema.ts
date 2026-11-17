// Base de datos de CORA en Convex: jugadores y mejores puntuaciones por tabla (modo + dificultad)
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

  // Mejor puntuación de cada jugador en cada tabla
  scores: defineTable({
    playerId: v.id('players'),
    name: v.string(),
    mode,
    difficulty,
    score: v.number(),
    total: v.number(),
    timeMs: v.number(),
    // Orden del ranking en un solo número: más aciertos primero; a igualdad, menos tiempo
    rank: v.number(),
  })
    .index('by_board', ['mode', 'difficulty', 'rank'])
    .index('by_player_board', ['playerId', 'mode', 'difficulty']),
});
