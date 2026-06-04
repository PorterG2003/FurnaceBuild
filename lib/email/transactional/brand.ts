/** Matches `Logo` / `PlatformInviteLogoBar` wordmark sizing on dark backgrounds. */
export const FURNACE_EMAIL_LOGO_MAX_WIDTH_PX = 220;

/** Wordmark aspect ratio from `Logo_Color.svg` viewBox (1584 × 396). */
export const FURNACE_EMAIL_LOGO_ASPECT_RATIO = 1584 / 396;

const DEFAULT_EMAIL_APP_ORIGIN = 'https://build.getfurnace.io';

/** White wordmark for dark email shells — same variant as invite / auth flows. */
export const FURNACE_EMAIL_LOGO_PATH = '/Logo_White.png';

export function resolveFurnaceEmailAppOrigin(): string {
  const origin =
    process.env.WEB_APP_ORIGIN?.trim() ||
    process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim() ||
    DEFAULT_EMAIL_APP_ORIGIN;
  return origin.replace(/\/$/, '');
}

export function resolveFurnaceEmailLogoUrl(origin?: string): string {
  const base = (origin ?? resolveFurnaceEmailAppOrigin()).replace(/\/$/, '');
  return `${base}${FURNACE_EMAIL_LOGO_PATH}`;
}

export function buildFurnaceEmailLogoHtml(logoUrl: string): string {
  const width = FURNACE_EMAIL_LOGO_MAX_WIDTH_PX;
  const height = Math.round(width / FURNACE_EMAIL_LOGO_ASPECT_RATIO);
  return `<img src="${logoUrl}" alt="Furnace" width="${width}" height="${height}" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:${width}px;width:100%;height:auto;" />`;
}
