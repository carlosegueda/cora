// Componentes de Convex de la app. Dos agregados (rankings) que dan el puesto de una marca
// en O(log n) sin recorrer la tabla: uno para las tablas de Jugar/Supervivencia y otro para el Diario.
import { defineApp } from 'convex/server';
import aggregate from '@convex-dev/aggregate/convex.config';

const app = defineApp();
app.use(aggregate, { name: 'boardRanking' });
app.use(aggregate, { name: 'dailyRanking' });
export default app;
