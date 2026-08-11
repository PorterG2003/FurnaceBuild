import assert from 'node:assert/strict';
import test from 'node:test';
import { applyProrationModeToTermsMarkdown, getAgreementTemplateMarkdown } from './terms';

const SECOND_MONTH_PLATFORM_CLAUSE =
  'If your account activates mid-month, your second invoice will be prorated to cover the remainder of that calendar month. Standard monthly billing begins the following month.';
const FIRST_MONTH_PLATFORM_CLAUSE =
  'If your account activates mid-month, your first invoice is prorated to cover the remainder of that calendar month. Standard monthly billing begins on the 1st of the following month.';

test('the stock platform agreement describes second-month proration', () => {
  const markdown = getAgreementTemplateMarkdown('platform_agreement');
  assert.ok(markdown.includes(SECOND_MONTH_PLATFORM_CLAUSE));
});

test('switching to first_month rewrites the platform proration clause', () => {
  const result = applyProrationModeToTermsMarkdown(
    getAgreementTemplateMarkdown('platform_agreement'),
    'first_month',
  );

  assert.equal(result.applied, true);
  assert.ok(result.markdown.includes(FIRST_MONTH_PLATFORM_CLAUSE));
  assert.ok(!result.markdown.includes(SECOND_MONTH_PLATFORM_CLAUSE));
});

test('switching back to second_month restores the original platform clause', () => {
  const original = getAgreementTemplateMarkdown('platform_agreement');
  const swapped = applyProrationModeToTermsMarkdown(original, 'first_month');
  const restored = applyProrationModeToTermsMarkdown(swapped.markdown, 'second_month');

  assert.equal(restored.applied, true);
  assert.equal(restored.markdown, original);
});

test('the managed services agreement clause swaps in both directions', () => {
  const original = getAgreementTemplateMarkdown('managed_services_agreement');
  const swapped = applyProrationModeToTermsMarkdown(original, 'first_month');

  assert.equal(swapped.applied, true);
  assert.notEqual(swapped.markdown, original);
  assert.ok(swapped.markdown.includes('prorated to cover the remainder of the current calendar month'));
  assert.ok(swapped.markdown.includes('{{monthly_fee}}'));

  const restored = applyProrationModeToTermsMarkdown(swapped.markdown, 'second_month');
  assert.equal(restored.markdown, original);
});

test('re-applying the mode already present is a no-op that still reports success', () => {
  const original = getAgreementTemplateMarkdown('platform_agreement');
  const result = applyProrationModeToTermsMarkdown(original, 'second_month');

  assert.equal(result.applied, true);
  assert.equal(result.markdown, original);
});

test('a hand-edited agreement is left untouched and reported as unmatched', () => {
  const edited = '# Custom agreement\n\nBilling is negotiated separately.';
  const result = applyProrationModeToTermsMarkdown(edited, 'first_month');

  assert.equal(result.applied, false);
  assert.equal(result.markdown, edited);
});
