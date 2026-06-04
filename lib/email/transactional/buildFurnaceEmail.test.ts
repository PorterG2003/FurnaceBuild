import assert from 'node:assert/strict';
import {
  buildFurnaceEmail,
  buildFurnaceEmailText,
  escapeHtml,
  FURNACE_EMAIL_BRAND,
} from './buildFurnaceEmail.js';

function run(): void {
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');

  const html = buildFurnaceEmail({
    title: 'Confirm your email',
    bodyHtml:
      '<p style="margin:0 0 24px 0; font-size: 15px; line-height: 1.5; color: #a3a3a3;">Thanks for signing up.</p>',
    cta: { label: 'Confirm email', href: 'https://example.com/confirm' },
    disclaimer: 'If you did not create an account, ignore this email.',
    pageTitle: 'Confirm your email',
  });

  assert(html.includes('role="presentation"'));
  assert(html.includes(FURNACE_EMAIL_BRAND.outerBg));
  assert(html.includes(FURNACE_EMAIL_BRAND.cardBg));
  assert(html.includes(FURNACE_EMAIL_BRAND.accent));
  assert(html.includes('Furnace · Build'));
  assert(html.includes('Logo_White.png'));
  assert(html.includes('alt="Furnace"'));
  assert(!html.includes('letter-spacing: -0.02em;">Furnace</span>'));
  assert(html.includes('display:block; width:100%'));
  assert(html.includes('text-align:center'));
  assert(html.includes('https://example.com/confirm'));
  assert(!html.includes('min-height:100vh'));
  assert(!html.includes('linear-gradient'));
  assert(!html.includes('#f33203'));

  const otpHtml = buildFurnaceEmail({
    title: 'Verification code',
    bodyHtml: '',
    otpToken: '847291',
    disclaimer: 'This code expires soon.',
  });
  assert(otpHtml.includes('847291'));
  assert(otpHtml.includes('letter-spacing: 0.2em'));

  const text = buildFurnaceEmailText({
    title: 'You are invited',
    bodyText: 'Alex invited you.',
    cta: { label: 'Accept', href: 'https://example.com/accept' },
    disclaimer: 'Ignore if unexpected.',
  });
  assert(text.includes('You are invited'));
  assert(text.includes('Accept: https://example.com/accept'));

  console.log('buildFurnaceEmail tests passed.');
}

run();
