// Desafío: salas de 2 a 10 jugadores, por turnos ("papa caliente").
//
//  - Se crea una sala y se invita con su código. El anfitrión elige el juego (países en el
//    mapa, banderas o capitales) y empieza.
//  - Cada jugador tiene un reloj que empieza en 30 s y solo corre durante su turno. En cada
//    turno le toca un país al azar: si acierta, +5 s; si falla, −3 s; si no responde a tiempo,
//    −5 s. En los tres casos pasa el turno al siguiente.
//  - El tiempo para responder empieza en 10 s y baja 1 s en cada ronda, hasta 3 s.
//  - Quien se queda sin tiempo queda eliminado y solo mira. Gana el último en pie.
//
// El reloj lo lleva el servidor (la hora de inicio de cada turno y un aviso programado para
// cuando se acaba). Si la respuesta es correcta lo decide el cliente, que es quien tiene los
// contornos y los nombres de los países, igual que en el Diario.
import { mutation, query, internalMutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { ConvexError, v } from 'convex/values';
import { DAILY_COUNTRIES } from './dailyCountries';
import { FLAG_COUNTRIES, CAPITAL_COUNTRIES } from './challengeCountries';
import { findPlayer, upsertPlayer } from './players';
import { challengeGame } from './schema';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const START_MS = 30_000; // reloj inicial de cada jugador
const BONUS_MS = 5_000; // acierto
const WRONG_MS = 3_000; // fallo
const IDLE_MS = 5_000; // no responder
const TURN_LIMIT_MS = 10_000; // lo máximo que dura un turno al principio de la partida…
const TURN_LIMIT_STEP_MS = 1_000; // … y lo que se acorta en cada ronda (una vuelta completa)
const TURN_LIMIT_MIN_MS = 3_000; // … hasta este mínimo
const COUNTDOWN_MS = 4_000; // 3, 2, 1 antes del primer turno
const REVEAL_OK_MS = 1_500; // pausa para ver un acierto antes del siguiente turno
const REVEAL_FAIL_MS = 2_800; // … y un fallo (la cámara viaja al país correcto)
const TIMEOUT_GRACE_MS = 500; // margen para una respuesta que llega justo al límite
const ROOM_TTL_MS = 24 * 3_600_000; // las salas sin actividad se borran al día

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O, que se confunden con 1 y 0
const CODE_LENGTH = 5;

type Room = Doc<'rooms'>;
type RoomPlayer = Room['players'][number];
type Outcome = 'correct' | 'wrong' | 'timeout' | 'left';

const normalizeCode = (code: string) => code.trim().toUpperCase().slice(0, CODE_LENGTH);
const cleanCountry = (country: string | null) => (country && /^[A-Z]{2}$/.test(country) ? country : null);

async function roomByCode(ctx: QueryCtx | MutationCtx, code: string): Promise<Room | null> {
  return await ctx.db
    .query('rooms')
    .withIndex('by_code', (q) => q.eq('code', normalizeCode(code)))
    .unique();
}

async function requireRoom(ctx: MutationCtx, code: string): Promise<Room> {
  const room = await roomByCode(ctx, code);
  if (!room) throw new ConvexError('ROOM_NOT_FOUND');
  return room;
}

const poolOf = (game: Room['game']) =>
  game === 'capitals' ? CAPITAL_COUNTRIES : game === 'flags' ? FLAG_COUNTRIES : DAILY_COUNTRIES;

// País al azar que aún no haya salido en la partida (cuando se agotan, vuelven a salir todos)
function pickCountry(room: Room, used: string[]) {
  const pool = poolOf(room.game);
  const seen = new Set(used);
  let available = pool.filter((iso3) => !seen.has(iso3));
  if (!available.length) {
    available = [...pool];
    used = [];
  }
  const iso3 = available[Math.floor(Math.random() * available.length)];
  return { iso3, used: [...used, iso3] };
}

// Empieza el turno de `playerId`: le toca un país, su reloj corre desde `startsAt` y se programa
// el aviso de "se acabó el tiempo" (que no hace nada si para entonces ya respondió)
async function beginTurn(
  ctx: MutationCtx,
  room: Room,
  players: RoomPlayer[],
  playerId: Id<'players'>,
  startsAt: number,
  patch: Partial<Room> = {}
) {
  const player = players.find((p) => p.playerId === playerId)!;
  const { iso3, used } = pickCountry(room, patch.used ?? room.used);
  const turn = room.turn + 1;
  // Cada ronda (una vuelta de todos los jugadores que empezaron) hay menos tiempo para responder
  const round = Math.floor((turn - (patch.startTurn ?? room.startTurn ?? turn)) / players.length);
  const turnLimit = Math.max(TURN_LIMIT_MIN_MS, TURN_LIMIT_MS - round * TURN_LIMIT_STEP_MS);
  const limitMs = Math.min(player.timeMs, turnLimit);
  await ctx.db.patch(room._id, {
    ...patch,
    players,
    used,
    turn,
    current: { playerId, iso3, startsAt, limitMs },
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAt(startsAt + limitMs + TIMEOUT_GRACE_MS, internal.challenge.timeout, {
    roomId: room._id,
    turn,
  });
}

// Cierra el turno en curso con su resultado: ajusta el reloj del jugador, lo elimina si se
// quedó sin tiempo y pasa el turno (o termina la partida si solo queda uno)
async function resolveTurn(ctx: MutationCtx, room: Room, outcome: Outcome, clicked: string | null) {
  const now = Date.now();
  const current = room.current!;
  const players = room.players.map((p) => ({ ...p }));
  const index = players.findIndex((p) => p.playerId === current.playerId);
  const player = players[index];
  const elapsed = Math.min(Math.max(now - current.startsAt, 0), current.limitMs);

  if (outcome === 'correct') player.timeMs = player.timeMs - elapsed + BONUS_MS;
  else if (outcome === 'wrong') player.timeMs = player.timeMs - elapsed - WRONG_MS;
  else if (outcome === 'timeout') player.timeMs = player.timeMs - current.limitMs - IDLE_MS;
  else player.timeMs = 0;
  player.timeMs = Math.max(0, Math.round(player.timeMs));

  const eliminated = player.timeMs <= 0;
  if (eliminated) {
    player.place = players.filter((p) => p.alive).length; // el puesto en el que queda
    player.alive = false;
    if (outcome === 'left') player.left = true;
  }
  const last = { turn: room.turn, playerId: player.playerId, iso3: current.iso3, outcome, clicked, eliminated };
  await finishOrContinue(ctx, room, players, index, last, outcome === 'correct' ? REVEAL_OK_MS : REVEAL_FAIL_MS);
}

// Si solo queda un jugador, gana; si no, le toca al siguiente que siga en pie
async function finishOrContinue(
  ctx: MutationCtx,
  room: Room,
  players: RoomPlayer[],
  fromIndex: number,
  last: Room['last'],
  revealMs: number
) {
  const alive = players.filter((p) => p.alive);
  if (alive.length <= 1) {
    if (alive[0]) alive[0].place = 1;
    await ctx.db.patch(room._id, {
      players,
      last,
      status: 'finished',
      current: undefined,
      winnerId: alive[0]?.playerId,
      updatedAt: Date.now(),
    });
    return;
  }
  let next = fromIndex;
  do next = (next + 1) % players.length;
  while (!players[next].alive);
  await beginTurn(ctx, room, players, players[next].playerId, Date.now() + revealMs, { last });
}

// Hora del servidor, para que cada cliente calcule el desfase con su reloj
export const clock = mutation({
  args: {},
  handler: async () => Date.now(),
});

// Crea una sala y mete en ella a quien la crea (el anfitrión). Devuelve el código.
export const create = mutation({
  args: { token: v.string(), name: v.string(), country: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const player = await upsertPlayer(ctx, args.token, args.name);
    let code = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      if (!(await roomByCode(ctx, code))) break;
      code = '';
    }
    if (!code) throw new ConvexError('TRY_AGAIN');
    await ctx.db.insert('rooms', {
      code,
      hostId: player._id,
      game: 'map',
      status: 'lobby',
      players: [
        { playerId: player._id, name: player.name, country: cleanCountry(args.country), timeMs: START_MS, alive: true },
      ],
      turn: 0,
      used: [],
      updatedAt: Date.now(),
    });
    return { code };
  },
});

// Entra en una sala. Si la partida ya empezó (o está llena), entra solo a mirar.
export const join = mutation({
  args: { token: v.string(), name: v.string(), country: v.union(v.string(), v.null()), code: v.string() },
  handler: async (ctx, args) => {
    const player = await upsertPlayer(ctx, args.token, args.name);
    const room = await requireRoom(ctx, args.code);
    const existing = room.players.find((p) => p.playerId === player._id);
    if (existing) {
      // Ya estaba (recargó la página o cambió de nombre)
      if (existing.name !== player.name) {
        const players = room.players.map((p) => (p.playerId === player._id ? { ...p, name: player.name } : p));
        await ctx.db.patch(room._id, { players, updatedAt: Date.now() });
      }
      return { code: room.code, spectator: false };
    }
    if (room.status !== 'lobby') return { code: room.code, spectator: true };
    if (room.players.length >= MAX_PLAYERS) throw new ConvexError('ROOM_FULL');
    await ctx.db.patch(room._id, {
      players: [
        ...room.players,
        { playerId: player._id, name: player.name, country: cleanCountry(args.country), timeMs: START_MS, alive: true },
      ],
      updatedAt: Date.now(),
    });
    return { code: room.code, spectator: false };
  },
});

// El anfitrión elige a qué se juega (en la sala de espera)
export const setGame = mutation({
  args: { token: v.string(), code: v.string(), game: challengeGame },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await requireRoom(ctx, args.code);
    if (!player || room.hostId !== player._id) throw new ConvexError('NOT_HOST');
    if (room.status !== 'lobby') return null;
    // Las sugerencias que pedían justo este juego ya están atendidas
    const players = room.players.map((p) => (p.suggest === args.game ? { ...p, suggest: undefined } : p));
    await ctx.db.patch(room._id, { game: args.game, players, updatedAt: Date.now() });
    return null;
  },
});

// Cambia un dato propio de un jugador en la sala de espera
async function patchOwnPlayer(ctx: MutationCtx, token: string, code: string, change: Partial<RoomPlayer>) {
  const player = await findPlayer(ctx, token);
  const room = await roomByCode(ctx, code);
  if (!player || !room || room.status !== 'lobby') return;
  if (!room.players.some((p) => p.playerId === player._id)) return;
  const players = room.players.map((p) => (p.playerId === player._id ? { ...p, ...change } : p));
  await ctx.db.patch(room._id, { players, updatedAt: Date.now() });
}

// "Listo": el anfitrión solo puede empezar cuando todos los demás lo han pulsado
export const setReady = mutation({
  args: { token: v.string(), code: v.string(), ready: v.boolean() },
  handler: async (ctx, args) => {
    await patchOwnPlayer(ctx, args.token, args.code, { ready: args.ready });
    return null;
  },
});

// Un jugador le propone un juego al anfitrión (null = retira la propuesta)
export const suggest = mutation({
  args: { token: v.string(), code: v.string(), game: v.union(challengeGame, v.null()) },
  handler: async (ctx, args) => {
    await patchOwnPlayer(ctx, args.token, args.code, { suggest: args.game ?? undefined });
    return null;
  },
});

// El anfitrión empieza la partida: se sortea el orden y arranca el primer turno tras el 3, 2, 1
export const start = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await requireRoom(ctx, args.code);
    if (!player || room.hostId !== player._id) throw new ConvexError('NOT_HOST');
    if (room.status !== 'lobby') return null;
    if (room.players.length < MIN_PLAYERS) throw new ConvexError('NEED_PLAYERS');
    if (room.players.some((p) => p.playerId !== room.hostId && !p.ready)) throw new ConvexError('NOT_READY');
    const players: RoomPlayer[] = room.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      country: p.country,
      timeMs: START_MS,
      alive: true,
    }));
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    await beginTurn(ctx, room, players, players[0].playerId, Date.now() + COUNTDOWN_MS, {
      status: 'playing',
      startTurn: room.turn + 1,
      used: [],
      last: undefined,
      winnerId: undefined,
    });
    return null;
  },
});

// Respuesta del jugador al que le toca. `turn` descarta respuestas que llegan tarde (cuando el
// turno ya se resolvió, por él mismo o porque se le acabó el tiempo).
export const answer = mutation({
  args: {
    token: v.string(),
    code: v.string(),
    turn: v.number(),
    correct: v.boolean(),
    clicked: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await roomByCode(ctx, args.code);
    if (!player || !room || room.status !== 'playing' || room.turn !== args.turn) return null;
    if (room.current?.playerId !== player._id) return null;
    const clicked = args.clicked && /^[A-Z0-9]{3}$/.test(args.clicked) ? args.clicked : null;
    await resolveTurn(ctx, room, args.correct ? 'correct' : 'wrong', clicked);
    return null;
  },
});

// Aviso programado: al jugador del turno `turn` se le acabó el tiempo sin responder
export const timeout = internalMutation({
  args: { roomId: v.id('rooms'), turn: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || room.status !== 'playing' || room.turn !== args.turn || !room.current) return null;
    await resolveTurn(ctx, room, 'timeout', null);
    return null;
  },
});

// Salir de la sala. En la sala de espera se le quita; en partida queda eliminado.
// Si se va el anfitrión, lo hereda el siguiente; si no queda nadie, se borra la sala.
export const leave = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await roomByCode(ctx, args.code);
    if (!player || !room) return null;
    const index = room.players.findIndex((p) => p.playerId === player._id);
    if (index === -1) return null;

    if (room.status === 'playing' && room.players[index].alive) {
      const heir = room.players.find((p) => p.alive && p.playerId !== player._id);
      const withHost = room.hostId === player._id && heir ? { ...room, hostId: heir.playerId } : room;
      if (withHost !== room) await ctx.db.patch(room._id, { hostId: withHost.hostId });
      if (room.current?.playerId === player._id) {
        await resolveTurn(ctx, withHost, 'left', null);
      } else {
        // No era su turno: queda eliminado y el turno en curso sigue como estaba
        const players = room.players.map((p) => ({ ...p }));
        players[index].place = players.filter((p) => p.alive).length;
        players[index].alive = false;
        players[index].timeMs = 0;
        players[index].left = true;
        const alive = players.filter((p) => p.alive);
        if (alive.length <= 1) {
          if (alive[0]) alive[0].place = 1;
          await ctx.db.patch(room._id, {
            players,
            status: 'finished',
            current: undefined,
            winnerId: alive[0]?.playerId,
            updatedAt: Date.now(),
          });
        } else {
          await ctx.db.patch(room._id, { players, updatedAt: Date.now() });
        }
      }
      return null;
    }

    // Sala de espera, partida terminada o ya eliminado
    if (room.status === 'playing') {
      const players = room.players.map((p) => (p.playerId === player._id ? { ...p, left: true } : p));
      await ctx.db.patch(room._id, { players, updatedAt: Date.now() });
      return null;
    }
    const players = room.players.filter((p) => p.playerId !== player._id);
    if (!players.length) {
      await deleteLive(ctx, room.code);
      await ctx.db.delete(room._id);
      return null;
    }
    await ctx.db.patch(room._id, {
      players,
      hostId: room.hostId === player._id ? players[0].playerId : room.hostId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Tras la partida, el anfitrión devuelve a todos a la sala de espera para jugar otra
export const backToLobby = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await requireRoom(ctx, args.code);
    if (!player || room.hostId !== player._id) throw new ConvexError('NOT_HOST');
    if (room.status !== 'finished') return null;
    const players: RoomPlayer[] = room.players
      .filter((p) => !p.left)
      .map((p) => ({ playerId: p.playerId, name: p.name, country: p.country, timeMs: START_MS, alive: true }));
    await ctx.db.patch(room._id, {
      players,
      status: 'lobby',
      current: undefined,
      last: undefined,
      winnerId: undefined,
      used: [],
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Estado de la sala (a esto se suscribe cada jugador). `you`: el jugador que pregunta, si está
// en la sala (null = solo mira). Devuelve null si la sala no existe.
export const room = query({
  args: { code: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const found = await roomByCode(ctx, args.code);
    if (!found) return null;
    let you: Id<'players'> | null = null;
    const token = args.token;
    if (token && token.length >= 16 && token.length <= 64) {
      const player = await ctx.db
        .query('players')
        .withIndex('by_token', (q) => q.eq('token', token))
        .unique();
      if (player && found.players.some((p) => p.playerId === player._id)) you = player._id;
    }
    return {
      code: found.code,
      status: found.status,
      game: found.game,
      hostId: found.hostId,
      players: found.players,
      turn: found.turn,
      current: found.current ?? null,
      last: found.last ?? null,
      winnerId: found.winnerId ?? null,
      you,
    };
  },
});

// En directo: lo que va escribiendo, o hacia dónde mira en el globo, el jugador al que le toca.
// Lo envía su navegador varias veces por segundo durante su turno.
export const live = mutation({
  args: {
    token: v.string(),
    code: v.string(),
    turn: v.number(),
    text: v.string(),
    view: v.optional(v.object({ lon: v.number(), lat: v.number(), alt: v.number() })),
  },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const room = await roomByCode(ctx, args.code);
    if (!player || !room || room.status !== 'playing' || room.turn !== args.turn) return null;
    if (room.current?.playerId !== player._id) return null;
    const doc = { code: room.code, turn: args.turn, playerId: player._id, text: args.text.slice(0, 60), view: args.view };
    const existing = await ctx.db
      .query('roomLive')
      .withIndex('by_code', (q) => q.eq('code', room.code))
      .unique();
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert('roomLive', doc);
    return null;
  },
});

// A esto se suscriben los demás jugadores para verlo (null si aún no hay nada)
export const watchLive = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query('roomLive')
      .withIndex('by_code', (q) => q.eq('code', normalizeCode(args.code)))
      .unique();
    return doc ? { turn: doc.turn, playerId: doc.playerId, text: doc.text, view: doc.view ?? null } : null;
  },
});

async function deleteLive(ctx: MutationCtx, code: string) {
  const doc = await ctx.db
    .query('roomLive')
    .withIndex('by_code', (q) => q.eq('code', code))
    .unique();
  if (doc) await ctx.db.delete(doc._id);
}

// Limpieza diaria (cron): borra las salas que llevan un día sin actividad
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('rooms')
      .withIndex('by_updatedAt', (q) => q.lt('updatedAt', Date.now() - ROOM_TTL_MS))
      .take(100);
    for (const room of stale) {
      await deleteLive(ctx, room.code);
      await ctx.db.delete(room._id);
    }
    return null;
  },
});
