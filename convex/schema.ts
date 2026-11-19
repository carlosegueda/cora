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

// Desafío (salas de 2 a 10 jugadores): a qué se juega
export const challengeGame = v.union(v.literal('map'), v.literal('flags'), v.literal('capitals'));

// Desafío: un jugador dentro de una sala
export const challengePlayer = v.object({
  playerId: v.id('players'),
  name: v.string(),
  country: v.union(v.string(), v.null()), // país del jugador (ISO alfa-2), para su bandera
  timeMs: v.number(), // segundos que le quedan en su reloj (en ms)
  alive: v.boolean(), // false = eliminado (solo mira)
  place: v.optional(v.number()), // puesto final (1 = ganador), al ser eliminado o ganar
  left: v.optional(v.boolean()), // se fue de la sala durante la partida
  ready: v.optional(v.boolean()), // sala de espera: ya pulsó "Listo"
  suggest: v.optional(challengeGame), // sala de espera: juego que le propone al anfitrión
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

  // Desafío: una sala. Todo su estado va en un solo documento (como mucho 10 jugadores), así
  // cada jugador se suscribe a una sola consulta y los turnos se resuelven de forma atómica.
  rooms: defineTable({
    code: v.string(), // código para invitar (5 letras)
    hostId: v.id('players'), // quien elige el juego y empieza
    game: challengeGame,
    status: v.union(v.literal('lobby'), v.literal('playing'), v.literal('finished')),
    players: v.array(challengePlayer), // en orden de turno
    turn: v.number(), // número de turno (sube en cada uno; descarta respuestas y avisos viejos)
    // Turno en curso: a quién le toca, qué país, cuándo empieza a correr su reloj (hora del
    // servidor) y cuánto dura como mucho
    current: v.optional(
      v.object({ playerId: v.id('players'), iso3: v.string(), startsAt: v.number(), limitMs: v.number() })
    ),
    // Qué pasó en el turno anterior (para enseñárselo a todos)
    last: v.optional(
      v.object({
        turn: v.number(),
        playerId: v.id('players'),
        iso3: v.string(),
        outcome: v.union(v.literal('correct'), v.literal('wrong'), v.literal('timeout'), v.literal('left')),
        clicked: v.union(v.string(), v.null()), // país donde hizo clic (solo en el de países)
        eliminated: v.boolean(),
      })
    ),
    used: v.array(v.string()), // países que ya salieron (no se repiten hasta agotarlos)
    winnerId: v.optional(v.id('players')),
    updatedAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_updatedAt', ['updatedAt']),

  // Desafío: lo que hace en directo el jugador al que le toca (lo que va escribiendo o hacia
  // dónde mira en el globo), para que lo vean los demás. Cambia varias veces por segundo, por
  // eso va en su propia tabla y no en el documento de la sala.
  roomLive: defineTable({
    code: v.string(),
    turn: v.number(),
    playerId: v.id('players'),
    text: v.string(), // banderas / capitales: lo escrito hasta ahora
    // países: punto del globo que tiene en el centro y altura de la cámara (en radios terrestres)
    view: v.optional(v.object({ lon: v.number(), lat: v.number(), alt: v.number() })),
  }).index('by_code', ['code']),

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
