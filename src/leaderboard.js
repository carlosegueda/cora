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
export async function submitScore({ mode, difficulty, score, total, timeMs }) {
  const name = getPlayerName();
  if (!client || name.length < 2 || score === 0) return null;
  try {
    return await client.mutation(api.scores.submit, {
      token: playerToken(),
      name,
      mode,
      difficulty,
      score,
      total,
      timeMs: Math.round(timeMs),
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
