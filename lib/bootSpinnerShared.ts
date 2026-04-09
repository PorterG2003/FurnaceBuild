/** Single source of truth for boot SVG spinner — keep `public/index.html` in sync (search: boot-spinner-shared). */
export const BOOT_SPINNER_SIZE = 36;
export const BOOT_SPINNER_R = 15;
export const BOOT_SPINNER_STROKE = 3;

const R = BOOT_SPINNER_R;
/** ~90° accent arc + gap (full ring circumference = 2πR). */
export const BOOT_SPINNER_STROKE_DASHARRAY = `${(Math.PI * R) / 2} ${2 * Math.PI * R - (Math.PI * R) / 2}`;
