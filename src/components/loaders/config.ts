import { LOADER_IDS, type LoaderId } from './registry'

export const ACTIVE_LOADERS: LoaderId[] = LOADER_IDS

/**
 * A RANDOM figure per navigation, not a round-robin.
 *
 * The cursor version looked fixed in practice: each tab link mounts its own
 * overlay once and keeps whatever it drew, so a given tab showed the same
 * figure every single time. Twenty shapes are worth nothing if the tab you
 * use most only ever shows one of them.
 */
export function nextLoader(): LoaderId {
  return ACTIVE_LOADERS[Math.floor(Math.random() * ACTIVE_LOADERS.length)]
}
