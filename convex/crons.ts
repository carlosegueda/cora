// Tareas programadas
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Desafío: borra las salas abandonadas (un día sin actividad)
crons.interval('borrar salas de desafio abandonadas', { hours: 24 }, internal.challenge.cleanup, {});

export default crons;
