/**
 * Shared outcome assertions for email threading contracts.
 * See docs/engineering/email-threading-test-contract.md
 */
import assert from 'node:assert/strict';
import { normalizeMessageId, parseMessageIds } from '../../email/threadHeaders.js';

/** True when a subject still looks like unresolved spintax / merge template. */
export function looksLikeUnresolvedTemplate(subject: string | null | undefined): boolean {
  const s = String(subject ?? '');
  if (!s) return false;
  // Spintax: {A|B} or {A | B}
  if (/\{[^{}\n]*\|[^{}\n]*\}/.test(s)) return true;
  // Unmerged variables: {{first_name}}
  if (/\{\{[^{}\n]+\}\}/.test(s)) return true;
  return false;
}

export function assertNoUnresolvedTemplate(
  subject: string | null | undefined,
  label = 'subject',
): void {
  assert.equal(
    looksLikeUnresolvedTemplate(subject),
    false,
    `${label} must not contain unresolved spintax/merge syntax; got ${JSON.stringify(subject)}`,
  );
}

/** Normalize for equality checks (strip brackets, lowercase). */
export function nid(id: string | null | undefined): string | null {
  return normalizeMessageId(id);
}

export function assertImmediateParent(
  actualInReplyTo: string | null | undefined,
  expectedParentMessageId: string | null | undefined,
  label = 'In-Reply-To',
): void {
  const actual = nid(actualInReplyTo);
  const expected = nid(expectedParentMessageId);
  assert.equal(
    actual,
    expected,
    `${label}: expected parent ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

export function assertNoThreadingHeaders(
  inReplyTo: string | null | undefined,
  references: string | null | undefined,
  label = 'new-thread send',
): void {
  assert.equal(
    nid(inReplyTo),
    null,
    `${label}: In-Reply-To must be null for a new thread`,
  );
  const refs = parseMessageIds(references ?? null);
  assert.equal(refs.length, 0, `${label}: References must be empty for a new thread`);
}

export function assertCumulativeReferences(
  references: string | null | undefined,
  expectedOrderedIds: Array<string | null | undefined>,
  label = 'References',
): void {
  const actual = parseMessageIds(references ?? null);
  const expected = expectedOrderedIds
    .map((id) => nid(id))
    .filter((id): id is string => Boolean(id));
  assert.deepEqual(
    actual,
    expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

export function assertReferencesContainParentAncestry(
  references: string | null | undefined,
  parentMessageId: string | null | undefined,
  parentReferences: string | null | undefined,
  label = 'References',
): void {
  const actual = parseMessageIds(references ?? null);
  const parent = nid(parentMessageId);
  assert.ok(parent, `${label}: parent Message-ID required`);
  const ancestry = parseMessageIds(parentReferences ?? null);
  const expectedTail = [...ancestry.filter((id) => id !== parent), parent!];
  for (const id of expectedTail) {
    assert.ok(
      actual.includes(id),
      `${label}: missing ${id} (got ${JSON.stringify(actual)})`,
    );
  }
  assert.equal(
    actual[actual.length - 1],
    parent,
    `${label}: last entry must be immediate parent ${parent}`,
  );
}

export type CapturedSmtpSend = {
  jobId?: string;
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  submittedMessageId?: string | null;
  providerMessageId?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
};

export function assertSubjectParity(
  surfaces: Array<{ label: string; subject: string | null | undefined }>,
  expected: string,
): void {
  for (const surface of surfaces) {
    assert.equal(
      String(surface.subject ?? ''),
      expected,
      `${surface.label} subject must equal ${JSON.stringify(expected)}; got ${JSON.stringify(surface.subject)}`,
    );
    assertNoUnresolvedTemplate(surface.subject, surface.label);
  }
}

/**
 * Strip tags / collapse whitespace for semantic HTML↔text comparison.
 * Not a full HTML parser — sufficient for campaign HTML snippets in tests.
 */
export function normalizeForSemanticCompare(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r\n/g, '\n')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function assertMimeSemanticParity(
  bodyText: string | null | undefined,
  bodyHtml: string | null | undefined,
  label = 'MIME body',
): void {
  const text = normalizeForSemanticCompare(bodyText);
  const html = normalizeForSemanticCompare(bodyHtml);
  assert.equal(
    html,
    text,
    `${label}: text/plain and text/html must be semantically equal\n text=${JSON.stringify(text)}\n html=${JSON.stringify(html)}`,
  );
}

export function assertPersistenceParity(params: {
  smtp?: CapturedSmtpSend | null;
  eventData?: Record<string, unknown> | null;
  jobMessageData?: Record<string, unknown> | null;
  emailMessage?: {
    subject?: string | null;
    in_reply_to?: string | null;
    message_references?: string | null;
    message_id?: string | null;
    body_text?: string | null;
    body_html?: string | null;
  } | null;
  expectedSubject: string;
}): void {
  const { expectedSubject } = params;
  if (params.smtp) {
    assert.equal(params.smtp.subject, expectedSubject, 'SMTP subject');
    assertNoUnresolvedTemplate(params.smtp.subject, 'SMTP subject');
  }
  if (params.eventData) {
    assert.equal(params.eventData.sent_subject, expectedSubject, 'event sent_subject');
  }
  if (params.jobMessageData) {
    assert.equal(params.jobMessageData.sent_subject, expectedSubject, 'job sent_subject');
  }
  if (params.emailMessage) {
    assert.equal(params.emailMessage.subject, expectedSubject, 'email_messages.subject');
  }

  if (params.smtp && params.emailMessage) {
    assertImmediateParent(
      params.emailMessage.in_reply_to,
      params.smtp.inReplyTo,
      'email_messages.in_reply_to vs SMTP',
    );
  }
  if (params.smtp && params.jobMessageData?.in_reply_to != null) {
    assertImmediateParent(
      String(params.jobMessageData.in_reply_to),
      params.smtp.inReplyTo,
      'job in_reply_to vs SMTP',
    );
  }
}

/** UI placeholder must never appear as stored/wire subject. */
export function assertNotUiPlaceholder(subject: string | null | undefined, label = 'subject'): void {
  const trimmed = String(subject ?? '').trim().toLowerCase();
  assert.notEqual(
    trimmed,
    '(no subject)',
    `${label} must not persist the UI placeholder "(No subject)"`,
  );
}
