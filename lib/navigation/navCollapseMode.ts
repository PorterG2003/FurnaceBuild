import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Desktop sidebar behavior preference.
 * - `auto`: icon-only rail that expands on hover, collapses on leave (default).
 * - `expanded`: pinned open at full width; hover has no effect.
 * - `collapsed`: pinned to the icon-only rail; hover does not expand it.
 */
export type NavCollapseMode = 'auto' | 'expanded' | 'collapsed';

export const DEFAULT_NAV_COLLAPSE_MODE: NavCollapseMode = 'auto';

const STORAGE_KEY = 'furnace:nav-collapse-mode';
const VALID_MODES: readonly NavCollapseMode[] = ['auto', 'expanded', 'collapsed'];

/**
 * In-memory cache so the mode is applied synchronously across NavBar remounts
 * (route changes remount the sidebar) without a flash back to the default.
 */
let cachedMode: NavCollapseMode | null = null;

function isNavCollapseMode(value: unknown): value is NavCollapseMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

/** Synchronous read of the last known mode; `null` until first load resolves. */
export function getCachedNavCollapseMode(): NavCollapseMode | null {
  return cachedMode;
}

export async function loadNavCollapseMode(): Promise<NavCollapseMode> {
  if (cachedMode) return cachedMode;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (isNavCollapseMode(raw)) {
      cachedMode = raw;
      return cachedMode;
    }
  } catch {
    // Preference load is best-effort; fall back to the default.
  }
  cachedMode = DEFAULT_NAV_COLLAPSE_MODE;
  return cachedMode;
}

export async function saveNavCollapseMode(mode: NavCollapseMode): Promise<void> {
  cachedMode = mode;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Preference persistence is best-effort.
  }
}
