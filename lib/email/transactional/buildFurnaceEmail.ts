import {
  buildFurnaceEmailLogoHtml,
  resolveFurnaceEmailLogoUrl,
} from './brand.js';

export const FURNACE_EMAIL_BRAND = {
  /** App shell / hero background */
  outerBg: '#121212',
  /** Elevated card surface (matches modals and invite panels) */
  cardBg: '#1A1A1A',
  cardBorder: '#2A2A2A',
  cardRadiusPx: 16,
  textPrimary: '#ffffff',
  /** gray-300 */
  textBody: '#D1D5DB',
  /** gray-400 */
  textMuted: '#9CA3AF',
  textFooter: '#6B7280',
  accent: '#F3440D',
  accentBorder: 'rgba(248, 81, 2, 0.30)',
  tableBorder: '#2A2A2A',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

export type FurnaceEmailOptions = {
  title: string;
  /** HTML paragraphs / lists / tables inside the dark card */
  bodyHtml: string;
  cta?: { label: string; href: string };
  /** Large OTP display (reauth template) */
  otpToken?: string;
  disclaimer?: string;
  pageTitle?: string;
  /** Override wordmark image URL (defaults to hosted Logo_White.png). */
  logoUrl?: string;
};

export type FurnaceEmailTextOptions = {
  title: string;
  bodyText: string;
  cta?: { label: string; href: string };
  disclaimer?: string;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBodyParagraph(text: string): string {
  return `<p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: ${FURNACE_EMAIL_BRAND.textBody};">${text}</p>`;
}

export function buildSectionHeading(text: string): string {
  return `<p style="margin:24px 0 12px 0; font-size: 16px; font-weight: 600; color: ${FURNACE_EMAIL_BRAND.textPrimary};">${text}</p>`;
}

export function buildDataTable(rows: Array<[string, string]>): string {
  const cell = (content: string, header: boolean) =>
    `<td style="padding:10px 12px; border:1px solid ${FURNACE_EMAIL_BRAND.tableBorder}; vertical-align:top;${header ? ` font-weight:600; color:${FURNACE_EMAIL_BRAND.textPrimary};` : ` color:${FURNACE_EMAIL_BRAND.textBody};`}">${content}</td>`;

  const body = rows
    .map(([label, value]) => `<tr>${cell(escapeHtml(label), true)}${cell(escapeHtml(value), false)}</tr>`)
    .join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:0 0 16px 0;">${body}</table>`;
}

export function buildEmailCtaBlock(cta: { label: string; href: string }): string {
  const b = FURNACE_EMAIL_BRAND;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
                <tr>
                  <td align="center" bgcolor="${b.accent}" style="border-radius:${b.cardRadiusPx}px; border:1px solid ${b.accentBorder};">
                    <a href="${escapeHtml(cta.href)}" target="_blank" style="display:block; width:100%; padding:16px 24px; font-size:16px; font-weight:600; line-height:1.25; color:${b.textPrimary}; text-decoration:none; text-align:center; border-radius:${b.cardRadiusPx}px; box-sizing:border-box;">${escapeHtml(cta.label)}</a>
                  </td>
                </tr>
              </table>`;
}

export function buildFurnaceEmail(options: FurnaceEmailOptions): string {
  const { title, bodyHtml, cta, otpToken, disclaimer, pageTitle, logoUrl } = options;
  const b = FURNACE_EMAIL_BRAND;
  const wordmarkHtml = buildFurnaceEmailLogoHtml(logoUrl ?? resolveFurnaceEmailLogoUrl());

  const ctaBlock = cta ? buildEmailCtaBlock(cta) : '';

  const otpBlock = otpToken
    ? `<p style="margin:0 0 20px 0; font-size: 15px; line-height: 1.5; color: ${b.textBody};">Use this code to continue:</p>
              <p style="margin:0; font-size: 28px; font-weight: 600; letter-spacing: 0.2em; color: ${b.accent};">${escapeHtml(otpToken)}</p>`
    : '';

  const disclaimerBlock = disclaimer
    ? `<p style="margin: ${otpToken ? '20px' : '24px'} 0 0 0; font-size: 13px; line-height: 1.5; color: ${b.textMuted};">${escapeHtml(disclaimer)}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle ?? title)}</title>
</head>
<body style="margin:0; padding:0; background-color:${b.outerBg}; font-family: ${b.fontFamily};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${b.outerBg};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 440px;">
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              ${wordmarkHtml}
            </td>
          </tr>
          <tr>
            <td style="background-color: ${b.cardBg}; border-radius: ${b.cardRadiusPx}px; padding: 32px 28px; border: 1px solid ${b.cardBorder};">
              <h1 style="margin:0 0 16px 0; font-size: 24px; font-weight: 600; line-height: 1.25; color: ${b.textPrimary};">${escapeHtml(title)}</h1>
              ${bodyHtml}
              ${otpBlock}
              ${ctaBlock}
              ${disclaimerBlock}
            </td>
          </tr>
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin:0; font-size: 12px; color: ${b.textFooter};">Furnace · Build</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildFurnaceEmailText(options: FurnaceEmailTextOptions): string {
  const lines = [options.title, '', options.bodyText];
  if (options.cta) {
    lines.push('', `${options.cta.label}: ${options.cta.href}`);
  }
  if (options.disclaimer) {
    lines.push('', options.disclaimer);
  }
  return lines.join('\n').trim();
}
