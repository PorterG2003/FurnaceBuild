import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessageHeaderDisplay } from './messageHeaderDisplay';

const baseMessage = {
  from_name: 'Ada Lovelace',
  from_email: 'ada@example.com',
  to_name: 'Porter',
  to_email: 'porter@example.com',
  to_emails: ['porter@example.com'] as string[] | null,
  cc: null as string[] | null,
};

test('buildMessageHeaderDisplay renders labeled From and To for received mail', () => {
  const display = buildMessageHeaderDisplay({ message: baseMessage });
  assert.equal(display.fromDisplay, 'Ada Lovelace <ada@example.com>');
  assert.equal(display.toDisplay, 'Porter <porter@example.com>');
  assert.equal(display.ccDisplay, null);
  assert.equal(display.pendingSecondaryLabel, null);
  assert.equal(
    display.accessibilityLabel,
    'From: Ada Lovelace <ada@example.com>. To: Porter <porter@example.com>',
  );
});

test('buildMessageHeaderDisplay includes Cc when present', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      cc: ['cc@example.com', '  '],
    },
  });
  assert.equal(display.ccDisplay, 'cc@example.com');
  assert.match(display.accessibilityLabel, /Cc: cc@example.com$/);
});

test('buildMessageHeaderDisplay keeps non-address campaign pending status', () => {
  const display = buildMessageHeaderDisplay({
    message: baseMessage,
    pendingSecondaryLabel: 'Priority Campaign',
  });
  assert.equal(display.pendingSecondaryLabel, 'Priority Campaign');
  assert.equal(display.fromDisplay, 'Ada Lovelace <ada@example.com>');
});

test('buildMessageHeaderDisplay does not invent a subtitle from from_email', () => {
  const display = buildMessageHeaderDisplay({
    message: baseMessage,
    pendingSecondaryLabel: null,
  });
  assert.equal(display.pendingSecondaryLabel, null);
});

test('buildMessageHeaderDisplay falls back to to_email for legacy rows', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      to_emails: null,
      to_name: null,
    },
  });
  assert.equal(display.toDisplay, 'porter@example.com');
});

test('buildMessageHeaderDisplay shows multi-To as emails only', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      to_emails: ['porter@example.com', 'other@example.com'],
    },
  });
  assert.equal(display.toDisplay, 'porter@example.com, other@example.com');
});

test('simple single To collapses by default with to summary', () => {
  const display = buildMessageHeaderDisplay({ message: baseMessage });
  assert.equal(display.isComplexRouting, false);
  assert.equal(display.defaultExpanded, false);
  assert.equal(display.summaryLine, 'to Porter <porter@example.com>');
});

test('legacy to_emails null still collapses when single To and no Cc', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      to_emails: null,
      to_name: null,
      cc: null,
    },
  });
  assert.equal(display.defaultExpanded, false);
  assert.equal(display.summaryLine, 'to porter@example.com');
});

test('multi To defaults expanded and summary lists addresses', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      to_emails: ['porter@example.com', 'other@example.com'],
    },
  });
  assert.equal(display.defaultExpanded, true);
  assert.equal(display.isComplexRouting, true);
  assert.equal(display.summaryLine, 'to porter@example.com, other@example.com');
});

test('Cc present defaults expanded and summary includes Cc count', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      cc: ['cc@example.com', 'CC@example.com', '  '],
    },
  });
  assert.equal(display.defaultExpanded, true);
  assert.equal(display.summaryLine, 'to Porter <porter@example.com> · Cc 1');
});

test('multi To with Cc includes both in summary', () => {
  const display = buildMessageHeaderDisplay({
    message: {
      ...baseMessage,
      to_emails: ['porter@example.com', 'other@example.com'],
      cc: ['a@example.com', 'b@example.com'],
    },
  });
  assert.equal(display.defaultExpanded, true);
  assert.equal(
    display.summaryLine,
    'to porter@example.com, other@example.com · Cc 2',
  );
});
