// Utilidades compartidas: validación de nombre y token, y alta/renombrado del jugador
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { ConvexError } from 'convex/values';

export function cleanName(raw: string): string {
  const name = raw.trim();
  if (name.length < 2 || name.length > 20) throw new ConvexError('El nombre debe tener entre 2 y 20 caracteres');
  return name;
}

function checkToken(token: string) {
  if (token.length < 16 || token.length > 64) throw new ConvexError('Jugador no válido');
}

// Busca al jugador por su token; lo crea si no existe y actualiza su nombre si cambió
// (también en sus marcas de Jugar/Supervivencia y de los minijuegos: una por tabla)
export async function upsertPlayer(ctx: MutationCtx, token: string, rawName: string): Promise<Doc<'players'>> {
  checkToken(token);
  const name = cleanName(rawName);
  const player = await ctx.db
    .query('players')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique();
  if (!player) {
    const id = await ctx.db.insert('players', { name, token });
    return (await ctx.db.get(id))!;
  }
  if (player.name !== name) {
    await ctx.db.patch(player._id, { name });
    const own = await ctx.db
      .query('scores')
      .withIndex('by_player_and_mode_and_difficulty', (q) => q.eq('playerId', player._id))
      .take(20);
    for (const row of own) await ctx.db.patch(row._id, { name });
    const ownMinigames = await ctx.db
      .query('minigameScores')
      .withIndex('by_player_and_game', (q) => q.eq('playerId', player._id))
      .take(10);
    for (const row of ownMinigames) await ctx.db.patch(row._id, { name });
  }
  return { ...player, name };
}

// Jugador por token, sin crearlo (null si no existe)
export async function findPlayer(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<'players'> | null> {
  checkToken(token);
  return await ctx.db
    .query('players')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique();
}
