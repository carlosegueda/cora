// Componentes de Convex de la app. Tres agregados (rankings) que dan el puesto de una marca
// en O(log n) sin recorrer la tabla: uno para las tablas de Jugar/Supervivencia otro para el Diario
// y otro para los minijuegos en modo ranked.
import { defineApp } from 'convex/server';
import aggregate from '@convex-dev/aggregate/convex.config';

const app = defineApp();
app.use(aggregate, { name: 'boardRanking' });
app.use(aggregate, { name: 'dailyRanking' });
app.use(aggregate, { name: 'minigameRanking' });
export default app;
