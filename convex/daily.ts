// Reto diario (Jugar): 10 estados, los mismos para todos, distintos cada día (UTC); un intento
// por jugador y día. Cada país vale hasta 1000 puntos (cercanía del clic al país, ponderada por
// su tamaño, más rapidez); la tabla del día se ordena por puntos y, a igualdad, por menos tiempo.
// Los puntos los calcula el cliente (necesita los contornos de los países); el servidor
// comprueba que estén dentro de lo posible.
import { query, mutation } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { DAILY_COUNTRIES } from './dailyCountries';
import { findPlayer, upsertPlayer } from './players';
import { dailyRanking } from './rankings';
import { dailyRound } from './schema';

const DAY_MS = 86_400_000;
const PER_DAY = 10;
const MAX_POINTS_PER_COUNTRY = 1000;
const MIN_MS_PER_ANSWER = 300; // nadie responde un país en menos de esto
const CLOCK_SLACK_MS = 5000; // margen entre el reloj del jugador y el del servidor

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isDayKey = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);
// Más puntos primero; a igualdad, menos tiempo
const rankOf = (points: number, timeMs: number) => points * 1e9 - timeMs;

// Generador pseudoaleatorio determinista (mulberry32): mismo número de partida → misma secuencia
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Los 10 países de un día. Se baraja la lista de estados una vez por "ciclo" de 19 días y cada
// día toma un tramo de 10, así no se repite ningún país dentro de un mismo ciclo.
export function countriesForDay(day: string): string[] {
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  const daysPerCycle = Math.floor(DAILY_COUNTRIES.length / PER_DAY);
  const cycle = Math.floor(dayNumber / daysPerCycle);
  const slot = dayNumber - cycle * daysPerCycle;
  const order = [...DAILY_COUNTRIES];
  const random = mulberry32(cycle * 2654435761 + 12345);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(slot * PER_DAY, slot * PER_DAY + PER_DAY);
}

// Empieza el intento de hoy. Si el jugador ya jugó (o empezó y abandonó) hoy, no deja repetir
// y devuelve su resultado. Si no, crea el intento y devuelve los 10 países del día.
export const start = mutation({
  args: { token: v.string(), name: v.string(), country: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const day = dayKey(Date.now());
    const player = await upsertPlayer(ctx, args.token, args.name);
    const existing = await ctx.db
      .query('dailyAttempts')
      .withIndex('by_day_and_player', (q) => q.eq('day', day).eq('playerId', player._id))
      .unique();

    if (existing) {
      if (!existing.finished) return { status: 'played' as const, day, finished: false as const };
      const position = (await dailyRanking.indexOfDoc(ctx, existing)) + 1;
      const total = await dailyRanking.count(ctx, { namespace: day });
      return {
        status: 'played' as const,
        day,
        finished: true as const,
        score: existing.score ?? 0,
        points: existing.points ?? 0,
        timeMs: existing.timeMs ?? 0,
        position,
        total,
        // Para repasar el intento: los países del día y qué pasó con cada uno
        countries: countriesForDay(day),
        rounds: existing.rounds ?? null,
      };
    }

    const country = args.country && /^[A-Z]{2}$/.test(args.country) ? args.country : null;
    const attemptId = await ctx.db.insert('dailyAttempts', {
      day,
      playerId: player._id,
      name: player.name,
      country,
      startedAt: Date.now(),
      finished: false,
    });
    return { status: 'started' as const, day, attemptId, countries: countriesForDay(day) };
  },
});

// Termina el intento: guarda puntos, aciertos y tiempo y devuelve el puesto en la tabla del día
export const finish = mutation({
  args: {
    token: v.string(),
    attemptId: v.id('dailyAttempts'),
    score: v.number(),
    points: v.number(),
    timeMs: v.number(),
    rounds: v.optional(v.array(dailyRound)), // detalle país a país, para repasarlo después
  },
  handler: async (ctx, args) => {
    const player = await findPlayer(ctx, args.token);
    const attempt = await ctx.db.get(args.attemptId);
    if (!player || !attempt || attempt.playerId !== player._id) throw new ConvexError('Intento no válido');
    if (attempt.finished) throw new ConvexError('Este intento ya terminó');
    if (!Number.isInteger(args.score) || args.score < 0 || args.score > PER_DAY) {
      throw new ConvexError('Puntuación no válida');
    }
    if (!Number.isInteger(args.points) || args.points < 0 || args.points > PER_DAY * MAX_POINTS_PER_COUNTRY) {
      throw new ConvexError('Puntos no válidos');
    }
    // El tiempo del jugador no cuenta las pausas, así que puede ser menor que el del servidor,
    // pero nunca mayor (más un margen), ni más rápido de lo humanamente posible
    const elapsed = Date.now() - attempt.startedAt;
    if (
      !Number.isFinite(args.timeMs) ||
      args.timeMs < PER_DAY * MIN_MS_PER_ANSWER ||
      args.timeMs > elapsed + CLOCK_SLACK_MS
    ) {
      throw new ConvexError('Tiempo no válido');
    }

    // El detalle tiene que cuadrar con el resultado: los países del día, sin repetir, y la
    // suma de sus puntos y aciertos igual a los totales
    const rounds = args.rounds;
    if (rounds) {
      const expected = new Set(countriesForDay(attempt.day));
      const seen = new Set(rounds.map((r) => r.iso3));
      const valid =
        rounds.length <= PER_DAY &&
        seen.size === rounds.length &&
        rounds.every(
          (r) =>
            expected.has(r.iso3) &&
            Number.isInteger(r.points) &&
            r.points >= 0 &&
            r.points <= MAX_POINTS_PER_COUNTRY &&
            (r.distanceKm === null || (Number.isFinite(r.distanceKm) && r.distanceKm >= 0)) &&
            (r.clicked === null || r.clicked.length <= 8)
        ) &&
        rounds.reduce((sum, r) => sum + r.points, 0) === args.points &&
        rounds.filter((r) => r.correct).length === args.score;
      if (!valid) throw new ConvexError('Detalle no válido');
    }

    const timeMs = Math.round(args.timeMs);
    await ctx.db.patch(attempt._id, {
      ...(rounds ? { rounds } : {}),
      finished: true,
      score: args.score,
      points: args.points,
      timeMs,
      rank: rankOf(args.points, timeMs),
    });
    const done = (await ctx.db.get(attempt._id))!;
    await dailyRanking.insert(ctx, done);
    const position = (await dailyRanking.indexOfDoc(ctx, done)) + 1;
    const total = await dailyRanking.count(ctx, { namespace: attempt.day });
    return { day: attempt.day, position, total };
  },
});

// Primer día con algún intento (null si nadie ha jugado nunca): hasta ahí llega el histórico
export const firstDay = query({
  args: {},
  handler: async (ctx) => {
    const first = await ctx.db.query('dailyAttempts').withIndex('by_day_and_player').first();
    return first?.day ?? null;
  },
});

// Tabla de un día (el cliente pasa el día: las consultas no leen el reloj).
// limit 5 para el resumen del menú; hasta 500 para "Ver todo".
export const top = query({
  args: { day: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { day, limit }) => {
    if (!isDayKey(day)) throw new ConvexError('Día no válido');
    const rows = await ctx.db
      .query('dailyAttempts')
      .withIndex('by_day_and_finished_and_rank', (q) => q.eq('day', day).eq('finished', true))
      .order('desc')
      .take(Math.min(limit ?? 5, 500));
    return rows.map(({ _id, name, country, score, points, timeMs }) => ({
      _id,
      name,
      country,
      score: score ?? 0,
      points: points ?? 0,
      timeMs: timeMs ?? 0,
    }));
  },
});
