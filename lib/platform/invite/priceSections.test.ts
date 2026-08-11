import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvitePriceSections, formatInvitePriceAmount } from './priceSections';
import { buildPlatformInvitePreviewQuote } from './preview';
import type { PlatformInviteProrationMode } from '@/lib/billing/proration';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { PlatformContractViewData } from '../contract/types';

const baseData: PlatformContractViewData = {
  invitationId: 'preview',
  status: 'draft',
  inviteeEmail: 'prospect@example.com',
  proposedAccountName: 'Preview Workspace',
  monthlyRetainerCents: 180_000,
  currency: 'usd',
  proposalSnapshot: {},
  agreementType: 'platform_agreement',
  termsSnapshotMarkdown: '# Terms',
};

function buildSections(options: {
  prorationMode: PlatformInviteProrationMode;
  paymentRoute: PlatformPaymentRoute;
  startedAt: Date;
  monthlyRetainerCents?: number;
}) {
  const quote = buildPlatformInvitePreviewQuote(
    {
      ...baseData,
      monthlyRetainerCents: options.monthlyRetainerCents ?? baseData.monthlyRetainerCents,
      prorationMode: options.prorationMode,
    },
    options.paymentRoute,
    { startedAt: options.startedAt },
  );

  return {
    quote,
    sections: buildInvitePriceSections({
      quote,
      routeLabel: options.paymentRoute === 'card' ? 'Card' : 'ACH',
      recurringAnchorLabel: 'Sep 1, 2026',
    }),
  };
}

function sectionText(sections: ReturnType<typeof buildSections>['sections']): string {
  return sections
    .flatMap((section) => [section.title, ...section.rows.map((row) => row.label)])
    .join(' | ');
}

test('every section lists line items that sum exactly to its total, for all accept days and routes', () => {
  const modes: PlatformInviteProrationMode[] = ['second_month', 'first_month'];
  const routes: PlatformPaymentRoute[] = ['card', 'ach'];
  // August has 31 days, so this covers every possible day-of-month including the boundaries.
  const acceptDays = Array.from({ length: 31 }, (_, index) => index + 1);

  for (const prorationMode of modes) {
    for (const paymentRoute of routes) {
      for (const day of acceptDays) {
        const startedAt = new Date(
          `2026-08-${String(day).padStart(2, '0')}T18:00:00.000Z`,
        );
        const { sections } = buildSections({ prorationMode, paymentRoute, startedAt });
        const context = `${prorationMode}/${paymentRoute}/Aug ${day}`;

        assert.ok(sections.length > 0, `expected sections for ${context}`);

        for (const section of sections) {
          const totals = section.rows.filter((row) => row.role === 'total');
          assert.equal(totals.length, 1, `expected exactly one total in ${section.title} (${context})`);

          const lineItemSum = section.rows
            .filter((row) => row.role === 'line_item')
            .reduce((sum, row) => sum + row.amountCents, 0);

          assert.equal(
            lineItemSum,
            totals[0].amountCents,
            `line items must sum to the total in ${section.title} (${context})`,
          );
        }
      }
    }
  }
});

test('row labels stay unique within a section so the breakdown renders without key collisions', () => {
  const modes: PlatformInviteProrationMode[] = ['second_month', 'first_month'];

  for (const prorationMode of modes) {
    for (const paymentRoute of ['card', 'ach'] as PlatformPaymentRoute[]) {
      const { sections } = buildSections({
        prorationMode,
        paymentRoute,
        startedAt: new Date('2026-08-15T18:00:00.000Z'),
      });

      for (const section of sections) {
        const labels = section.rows.map((row) => row.label);
        assert.equal(
          new Set(labels).size,
          labels.length,
          `duplicate labels in ${section.title} (${prorationMode}/${paymentRoute})`,
        );
      }
    }
  }
});

test('first_month labels the due-today charge with its day coverage', () => {
  const { sections } = buildSections({
    prorationMode: 'first_month',
    paymentRoute: 'ach',
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  const dueToday = sections[0];
  assert.equal(dueToday.title, 'Due today');
  assert.equal(dueToday.rows[0].label, 'Partial month (17 of 31 days)');
  assert.equal(dueToday.rows[0].amountCents, 98_710);
  assert.equal(dueToday.rows.at(-1)?.label, 'Total due today');
  assert.equal(dueToday.rows.at(-1)?.amountCents, 98_710);
});

test('first_month collapses the recurring block because the first invoice is a normal month', () => {
  const { sections } = buildSections({
    prorationMode: 'first_month',
    paymentRoute: 'ach',
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  assert.equal(sections.length, 2);
  assert.equal(sections[1].title, 'Monthly, starting Sep 1, 2026');
  assert.equal(sections[1].rows.at(-1)?.amountCents, 180_000);
  assert.ok(!sectionText(sections).includes('Credit'));
});

test('second_month shows a separate credited first invoice ahead of the ongoing amount', () => {
  const { sections } = buildSections({
    prorationMode: 'second_month',
    paymentRoute: 'ach',
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  assert.equal(sections.length, 3);
  assert.equal(sections[0].rows[0].label, 'Monthly retainer');
  assert.equal(sections[0].rows[0].amountCents, 180_000);
  assert.equal(sections[1].title, 'First invoice on Sep 1, 2026');

  const creditRow = sections[1].rows.find((row) => row.label === 'Credit for days already paid');
  assert.equal(creditRow?.amountCents, -84_000);
  assert.equal(sections[1].rows.at(-1)?.amountCents, 96_000);
  assert.equal(sections[2].title, 'Ongoing monthly');
  assert.equal(sections[2].rows.at(-1)?.amountCents, 180_000);
});

test('accepting on the 1st MST never mentions proration or credits in either mode', () => {
  for (const prorationMode of ['second_month', 'first_month'] as PlatformInviteProrationMode[]) {
    for (const paymentRoute of ['card', 'ach'] as PlatformPaymentRoute[]) {
      const { sections } = buildSections({
        prorationMode,
        paymentRoute,
        // 07:00Z is midnight MST on the 1st.
        startedAt: new Date('2026-08-01T18:00:00.000Z'),
      });
      const text = sectionText(sections);
      const context = `${prorationMode}/${paymentRoute}`;

      assert.ok(!text.includes('Partial month'), `unexpected proration wording for ${context}`);
      assert.ok(!text.includes('Credit'), `unexpected credit wording for ${context}`);
      assert.equal(sections.length, 2, `expected a collapsed recurring block for ${context}`);
      assert.equal(sections[0].rows[0].label, 'Monthly retainer');
    }
  }
});

test('the ACH breakdown always labels its subtotal even when no fee row exists', () => {
  for (const prorationMode of ['second_month', 'first_month'] as PlatformInviteProrationMode[]) {
    const { sections } = buildSections({
      prorationMode,
      paymentRoute: 'ach',
      startedAt: new Date('2026-08-15T18:00:00.000Z'),
    });

    for (const section of sections) {
      const lineItems = section.rows.filter((row) => row.role === 'line_item');
      assert.ok(
        lineItems.length > 0,
        `${section.title} needs a labeled subtotal row (${prorationMode})`,
      );
      assert.ok(!section.rows.some((row) => row.label.includes('processing fee')));
    }
  }
});

test('card fee rows appear in every section that charges one', () => {
  const { sections } = buildSections({
    prorationMode: 'second_month',
    paymentRoute: 'card',
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  for (const section of sections) {
    assert.ok(
      section.rows.some((row) => row.label === 'Card processing fee'),
      `${section.title} should show the card fee`,
    );
  }
});

test('a late-month first_month accept on a small retainer quotes the clamped Stripe minimum', () => {
  const { quote, sections } = buildSections({
    prorationMode: 'first_month',
    paymentRoute: 'ach',
    startedAt: new Date('2026-01-31T18:00:00.000Z'),
    monthlyRetainerCents: 1_000,
  });

  assert.equal(quote.subtotalCents, 50);
  assert.equal(sections[0].rows[0].label, 'Partial month (1 of 31 days)');
  assert.equal(sections[0].rows.at(-1)?.amountCents, 50);
});

test('formatInvitePriceAmount renders credits as negative amounts', () => {
  const format = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  assert.equal(formatInvitePriceAmount(84_000, format), '$840.00');
  assert.equal(formatInvitePriceAmount(-84_000, format), '-$840.00');
  assert.equal(formatInvitePriceAmount(0, format), '$0.00');
});
