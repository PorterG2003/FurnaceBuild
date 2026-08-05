import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logParseDiagnostics,
  shouldSampleMessage,
  evaluateSuspiciousSender,
  type ParseDiagnosticsInput,
} from './parse-diagnostics.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function captureConsole() {
  const logs: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
  return {
    logs,
    warns,
    restore() {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

function withSampleRate(rate: string, fn: () => void): void {
  const orig = process.env.INBOX_PARSE_DEBUG_SAMPLE_RATE;
  process.env.INBOX_PARSE_DEBUG_SAMPLE_RATE = rate;
  try {
    fn();
  } finally {
    if (orig === undefined) {
      delete process.env.INBOX_PARSE_DEBUG_SAMPLE_RATE;
    } else {
      process.env.INBOX_PARSE_DEBUG_SAMPLE_RATE = orig;
    }
  }
}

function normalInput(overrides?: Partial<ParseDiagnosticsInput>): ParseDiagnosticsInput {
  return {
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    imapUid: 1,
    subject: 'Hello World',
    fromAddress: 'person@example.com',
    messageId: '<abc@example.com>',
    inReplyTo: null,
    referencesRaw: null,
    referencesTokenCount: 0,
    returnPath: null,
    replyTo: undefined,
    sender: undefined,
    ...overrides,
  };
}

function suspiciousInput(): ParseDiagnosticsInput {
  return normalInput({
    fromAddress: 'routing=abc@mail.gmail.com',
    messageId: '<routing=abc@mail.gmail.com>',
  });
}

// ─── suspicious-only logging ─────────────────────────────────────────────────

test('logParseDiagnostics suppresses non-suspicious when rate=0', () => {
  const cap = captureConsole();
  withSampleRate('0', () => {
    logParseDiagnostics(normalInput());
  });
  cap.restore();
  assert.equal(cap.logs.length, 0, 'no log for non-suspicious at rate=0');
  assert.equal(cap.warns.length, 0, 'no warn for non-suspicious at rate=0');
});

test('logParseDiagnostics always warns for suspicious regardless of rate', () => {
  const cap = captureConsole();
  withSampleRate('0', () => {
    logParseDiagnostics(suspiciousInput());
  });
  cap.restore();
  assert.equal(cap.warns.length, 1, 'suspicious must warn even at rate=0');
  assert.equal(cap.logs.length, 0, 'suspicious uses warn not log');
});

test('logParseDiagnostics logs non-suspicious when rate=1', () => {
  const cap = captureConsole();
  withSampleRate('1', () => {
    logParseDiagnostics(normalInput());
  });
  cap.restore();
  assert.equal(cap.logs.length, 1, 'non-suspicious logs at rate=1');
  assert.equal(cap.warns.length, 0, 'non-suspicious uses log not warn');
});

test('logParseDiagnostics suspicious warn contains inbox_parse tag', () => {
  const cap = captureConsole();
  withSampleRate('0', () => {
    logParseDiagnostics(suspiciousInput());
  });
  cap.restore();
  assert.ok(cap.warns[0]?.includes('inbox_parse'), 'warn line has inbox_parse tag');
});

test('logParseDiagnostics does not include mailboxEmail in output', () => {
  const cap = captureConsole();
  withSampleRate('1', () => {
    logParseDiagnostics(normalInput({ mailboxEmail: 'secret@furnacemail.com' }));
  });
  withSampleRate('0', () => {
    logParseDiagnostics(suspiciousInput());
  });
  cap.restore();

  for (const line of [...cap.logs, ...cap.warns]) {
    assert.ok(
      !line.includes('secret@furnacemail.com'),
      `mailboxEmail must not appear in logged output: ${line}`,
    );
  }
});

// ─── sampling determinism ────────────────────────────────────────────────────

test('shouldSampleMessage is deterministic for same messageId and rate', () => {
  withSampleRate('0.5', () => {
    const first = shouldSampleMessage('<test-id@example.com>');
    const second = shouldSampleMessage('<test-id@example.com>');
    assert.equal(first, second, 'same ID must produce same decision');
  });
});

test('shouldSampleMessage returns false when rate=0', () => {
  withSampleRate('0', () => {
    assert.equal(shouldSampleMessage('<test-id@example.com>'), false);
    assert.equal(shouldSampleMessage(null), false);
  });
});

test('shouldSampleMessage returns true when rate=1', () => {
  withSampleRate('1', () => {
    assert.equal(shouldSampleMessage('<test-id@example.com>'), true);
    assert.equal(shouldSampleMessage(null), true);
  });
});

// ─── evaluateSuspiciousSender ────────────────────────────────────────────────

test('evaluateSuspiciousSender flags from_domain_is_mail_gmail_com', () => {
  const { suspicious, reasons } = evaluateSuspiciousSender({
    fromAddress: 'something@mail.gmail.com',
    messageId: '<abc@other.com>',
  });
  assert.ok(suspicious);
  assert.ok(reasons.includes('from_domain_is_mail_gmail_com'));
});

test('evaluateSuspiciousSender clean address is not suspicious', () => {
  const { suspicious } = evaluateSuspiciousSender({
    fromAddress: 'person@example.com',
    messageId: '<hello@example.com>',
  });
  assert.equal(suspicious, false);
});
