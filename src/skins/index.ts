import type { Skin } from './types';
import { KANDA_SKIN } from './kanda';

export type { Skin, ElevationBand } from './types';
export { KANDA_SKIN } from './kanda';

// Every skin the app knows about. Add a pack here and it is selectable; the
// "skin packs" feature in the backlog is a menu over this list, not a rewrite.
export const SKINS: Skin[] = [KANDA_SKIN];

export const DEFAULT_SKIN: Skin = KANDA_SKIN;

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
}
