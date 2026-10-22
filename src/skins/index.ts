import { ARENA } from './arena';
import { BLOCK_WORLD } from './blockWorld';
import { EMBER } from './ember';
import type { Skin } from './types';

export type { Skin, GeometryMode, WaterMode, TreeShape, TreeStyle, CloudStyle } from './types';

/** Menu order. Arena first: it is the default. */
export const SKINS: Skin[] = [ARENA, EMBER, BLOCK_WORLD];
export const DEFAULT_SKIN: Skin = ARENA;

export function skinById(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
}

const STORAGE_KEY = 'kanda:skin';

export function loadSavedSkin(): Skin {
  try {
    return skinById(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SKIN;
  }
}

export function saveSkin(skin: Skin) {
  try {
    localStorage.setItem(STORAGE_KEY, skin.id);
  } catch {
    /* private mode - the choice just is not remembered */
  }
}
