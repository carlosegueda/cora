// Conexión con Convex para la clasificación online.
// La URL la escribe `npx convex dev` en .env.local (VITE_CONVEX_URL). Sin ella, el juego
// funciona igual y la clasificación aparece como no disponible.
import { ConvexClient } from 'convex/browser';
// `anyApi` es lo mismo que exporta convex/_generated/api.js (en JavaScript no hacen falta los
// tipos). Así el juego compila aunque todavía no se haya ejecutado `npx convex dev`.
import { anyApi as api } from 'convex/server';

const url = import.meta.env.VITE_CONVEX_URL;
const client = url ? new ConvexClient(url) : null;

export const leaderboardAvailable = Boolean(client);
if (!client) {
  console.warn('CORA: VITE_CONVEX_URL no está definida en este build; la clasificación online está desactivada.');
}

const TOKEN_KEY = 'cora-player-token';
const NAME_KEY = 'cora-player-name';

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // sin almacenamiento: dura mientras la página esté abierta
    }
  },
};

// Identidad del jugador: un token aleatorio y secreto guardado en el navegador
let memoryToken = null;
function playerToken() {
  let token = storage.get(TOKEN_KEY) ?? memoryToken;
  if (!token) {
    token = crypto.randomUUID();
    memoryToken = token;
    storage.set(TOKEN_KEY, token);
  }
  return token;
}

export const getPlayerName = () => storage.get(NAME_KEY) ?? '';
export const setPlayerName = (name) => storage.set(NAME_KEY, name.trim().slice(0, 20));

// Envía una partida. Devuelve { improved, position } o null si no se envió.
export async function submitScore({ mode, difficulty, score, total, timeMs, fails }) {
  const name = getPlayerName();
  if (!client || name.length < 2 || score === 0) return null;
  try {
    const country = await getPlayerCountry();
    return await client.mutation(api.scores.submit, {
      token: playerToken(),
      country,
      name,
      mode,
      difficulty,
      score,
      total,
      timeMs: Math.round(timeMs),
      ...(fails != null ? { fails } : {}),
    });
  } catch (err) {
    console.warn('No se pudo enviar la puntuación:', err);
    return null;
  }
}

// Se suscribe a una tabla: onChange(filas) al cargar y cada vez que cambie.
// Devuelve una función para dejar de escuchar.
export function watchLeaderboard(mode, difficulty, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.scores.top, { mode, difficulty, limit: 20 }, onChange, (err) => {
    console.warn('No se pudo cargar la clasificación:', err);
    onChange(null);
  });
}

// --- Minijuegos (ranked) -------------------------------------------------------------
// Envía una partida ranked completada. Devuelve { improved, position, total, bestMs } o null.
export async function submitMinigame({ game, timeMs, total, skips }) {
  const name = getPlayerName();
  if (!client || name.length < 2) return null;
  try {
    const country = await getPlayerCountry();
    return await client.mutation(api.minigames.submit, {
      token: playerToken(),
      name,
      country,
      game,
      timeMs: Math.round(timeMs),
      total,
      skips,
    });
  } catch (err) {
    console.warn('No se pudo enviar el tiempo:', err);
    return null;
  }
}

// Se suscribe a la tabla de un minijuego: onChange(filas) al cargar y en cada cambio
export function watchMinigame(game, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.minigames.top, { game, limit: 20 }, onChange, (err) => {
    console.warn('No se pudo cargar la clasificación:', err);
    onChange(null);
  });
}

// --- Desafío (salas multijugador) -------------------------------------------------------
// Llama a una mutación de convex/challenge.ts con el token del jugador. Lanza si falla
// (el error del servidor trae un código en `err.data`: ROOM_NOT_FOUND, ROOM_FULL…).
export async function challengeCall(fn, args = {}) {
  if (!client) throw new Error('sin conexión');
  return await client.mutation(api.challenge[fn], { token: playerToken(), ...args });
}

// Se suscribe a una sala: onChange(sala) al cargar y en cada cambio (null si no existe;
// undefined si falla la conexión)
export function watchChallengeRoom(code, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.challenge.room, { code, token: playerToken() }, onChange, (err) => {
    console.warn('No se pudo cargar la sala:', err);
    onChange(undefined);
  });
}

// Se suscribe a lo que hace en directo el jugador al que le toca (lo que escribe o hacia dónde
// mira en el globo): onChange({ turn, playerId, text, view }) o null
export function watchChallengeLive(code, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.challenge.watchLive, { code }, onChange, () => {});
}

// Desfase entre el reloj del servidor y el de este dispositivo (ms). Se mide tres veces y se
// queda con la más rápida, que es la que menos error de red tiene.
export async function serverClockOffset() {
  if (!client) return 0;
  let best = null;
  for (let i = 0; i < 3; i++) {
    const sent = Date.now();
    const server = await client.mutation(api.challenge.clock, {});
    const received = Date.now();
    if (!best || received - sent < best.trip) best = { trip: received - sent, offset: server - (sent + received) / 2 };
  }
  return best.offset;
}

// --- Modo Diario ---------------------------------------------------------------------
// El día del Diario es el mismo para todo el mundo y cambia a las 00:00 de UTC−6 (06:00 UTC).
// Debe coincidir con RESET_OFFSET_MS de convex/daily.ts
export const DAILY_RESET_OFFSET_MS = 6 * 3_600_000;
export const dailyDay = (ms = Date.now()) => new Date(ms - DAILY_RESET_OFFSET_MS).toISOString().slice(0, 10);

// País del jugador (código ISO de 2 letras) para su bandera en la tabla del Diario.
// En producción lo da /api/country (Vercel lo sabe por la IP). En local esa función no existe:
// se usa la región del idioma del navegador (es-MX → MX), si la tiene.
let countryPromise = null;
export function getPlayerCountry() {
  countryPromise ??= (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('/api/country', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
        const { country } = await res.json();
        if (country) return country;
      }
    } catch {
      // sin función de país (desarrollo local) o sin conexión
    }
    const region = (navigator.languages ?? [navigator.language])
      .map((tag) => tag?.split('-')[1]?.toUpperCase())
      .find((r) => r && /^[A-Z]{2}$/.test(r));
    return region ?? null;
  })();
  return countryPromise;
}

// Empieza el intento de hoy. Devuelve { status: 'started', attemptId, countries, day } o
// { status: 'played', ... } si ya jugó hoy, o { status: 'error' } si no se pudo.
export async function startDaily() {
  const name = getPlayerName();
  if (!client || name.length < 2) return { status: 'error' };
  try {
    const country = await getPlayerCountry();
    return await client.mutation(api.daily.start, { token: playerToken(), name, country });
  } catch (err) {
    console.warn('No se pudo empezar el Diario:', err);
    return { status: 'error' };
  }
}

// Termina el intento. Devuelve { position, total, day } o null si no se pudo guardar.
export async function finishDaily(attemptId, score, points, timeMs, rounds) {
  if (!client) return null;
  try {
    return await client.mutation(api.daily.finish, {
      token: playerToken(),
      attemptId,
      score,
      points: Math.round(points),
      timeMs: Math.round(timeMs),
      rounds,
    });
  } catch (err) {
    console.warn('No se pudo guardar el Diario:', err);
    return null;
  }
}

// Se suscribe a si este jugador ya gastó su intento de ese día: onChange(true | false)
export function watchDailyPlayed(day, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.daily.played, { token: playerToken(), day }, onChange, (err) => {
    console.warn('No se pudo comprobar el intento del Diario:', err);
    onChange(false);
  });
}

// Primer día con partidas del Diario ('AAAA-MM-DD'), o null si no hay o no se pudo cargar
export async function fetchDailyFirstDay() {
  if (!client) return null;
  try {
    return await client.query(api.daily.firstDay, {});
  } catch (err) {
    console.warn('No se pudo cargar el histórico del Diario:', err);
    return null;
  }
}

// Se suscribe a la tabla de un día: onChange(filas) al cargar y en cada cambio (null si falla)
export function watchDaily(day, limit, onChange) {
  if (!client) return () => {};
  return client.onUpdate(api.daily.top, { day, limit }, onChange, (err) => {
    console.warn('No se pudo cargar la tabla del Diario:', err);
    onChange(null);
  });
}
