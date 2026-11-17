// Rankings con @convex-dev/aggregate: dan el puesto de una marca y el total de una tabla en
// O(log n). Se actualizan en la misma mutación que cada escritura en scores / dailyAttempts.
import { TableAggregate } from '@convex-dev/aggregate';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';

// Jugar y Supervivencia: una tabla por modo + dificultad; mejor marca = rank más alto
export const boardRanking = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'scores';
}>(components.boardRanking, {
  namespace: (doc) => `${doc.mode}:${doc.difficulty}`,
  sortKey: (doc) => -doc.rank, // orden ascendente del agregado = de mejor a peor
});

// Diario: una tabla por día; solo entran los intentos terminados
export const dailyRanking = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'dailyAttempts';
}>(components.dailyRanking, {
  namespace: (doc) => doc.day,
  sortKey: (doc) => -(doc.rank ?? 0),
});
