// Herramientas de administración. Son funciones internas: no se pueden llamar desde la web,
// solo desde la terminal (`npx convex run`) o el dashboard de Convex.
import { internalMutation } from './_generated/server';
import { boardRanking, dailyRanking, minigameRanking } from './rankings';

const BATCH = 500;

// Borra TODOS los datos: jugadores, marcas, intentos del Diario y minijuegos, y vacía los
// rankings. No se puede deshacer (haz antes `npx convex export`).
//   npx convex run admin:resetAll          → desarrollo
//   npx convex run admin:resetAll --prod   → producción
// Devuelve cuántos documentos borró; si `more` es true quedaban más: se vuelve a ejecutar.
export const resetAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const deleted = { players: 0, scores: 0, dailyAttempts: 0, minigameScores: 0 };
    let more = false;
    for (const table of ['players', 'scores', 'dailyAttempts', 'minigameScores'] as const) {
      const rows = await ctx.db.query(table).take(BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted[table] = rows.length;
      if (rows.length === BATCH) more = true;
    }
    // Los rankings se vacían enteros (no documento a documento)
    await boardRanking.clearAll(ctx);
    await dailyRanking.clearAll(ctx);
    await minigameRanking.clearAll(ctx);
    return { deleted, more };
  },
});
