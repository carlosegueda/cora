/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as challenge from "../challenge.js";
import type * as challengeCountries from "../challengeCountries.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as dailyCountries from "../dailyCountries.js";
import type * as minigames from "../minigames.js";
import type * as players from "../players.js";
import type * as rankings from "../rankings.js";
import type * as scores from "../scores.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  challenge: typeof challenge;
  challengeCountries: typeof challengeCountries;
  crons: typeof crons;
  daily: typeof daily;
  dailyCountries: typeof dailyCountries;
  minigames: typeof minigames;
  players: typeof players;
  rankings: typeof rankings;
  scores: typeof scores;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  boardRanking: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"boardRanking">;
  dailyRanking: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"dailyRanking">;
  minigameRanking: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"minigameRanking">;
};
