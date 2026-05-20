const DAY_MS = 24 * 60 * 60 * 1000;

export const API_KEY_EXPIRY_PRESET_IDS = ['never', '30d', '90d', '1y'] as const;

export type ApiKeyExpiryPresetId = (typeof API_KEY_EXPIRY_PRESET_IDS)[number];

export const API_KEY_EXPIRY_PRESETS: readonly {
  id: ApiKeyExpiryPresetId;
  label: string;
}[] = [
  { id: 'never', label: 'Never expires' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '1y', label: '1 year' },
] as const;

export const DEFAULT_API_KEY_EXPIRY_PRESET: ApiKeyExpiryPresetId = 'never';

export function expiresAtFromApiKeyExpiryPreset(
  presetId: ApiKeyExpiryPresetId,
  from: Date = new Date()
): string | null {
  switch (presetId) {
    case 'never':
      return null;
    case '30d':
      return new Date(from.getTime() + 30 * DAY_MS).toISOString();
    case '90d':
      return new Date(from.getTime() + 90 * DAY_MS).toISOString();
    case '1y':
      return new Date(from.getTime() + 365 * DAY_MS).toISOString();
    default: {
      const _exhaustive: never = presetId;
      return _exhaustive;
    }
  }
}
