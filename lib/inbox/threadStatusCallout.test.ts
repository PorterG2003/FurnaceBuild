import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThreadStatusCallout } from './threadStatusCallout';

test('pending manual classification merges pipeline categorizing hint into one loading callout', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'pending',
    category: null,
    categorySource: null,
    handlingMetadata: { mode: 'manual' },
    pipelineState: {
      active: true,
      phase: 'categorizing',
      label: 'Awaiting categorization - an automated reply may send after you categorize.',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'loading',
    mode: 'manual',
    tone: 'default',
    title: 'Smart handling',
    message: 'Classifying the latest reply. An automated campaign reply may send once classification completes.',
    secondaryMessage: null,
    loading: true,
    dismissible: true,
  });
});

test('complete manual interested classification keeps primary message and adds scenario pipeline secondary', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: null,
    categorySource: null,
    handlingMetadata: {
      mode: 'manual',
      category: 'Interested',
      primary_message: 'This looks interested.',
      primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
      alternatives: [{ action: 'mark_interested', label: 'Interested only' }],
    },
    pipelineState: {
      active: true,
      phase: 'categorizing',
      label: 'Awaiting categorization - an automated reply may send after you categorize.',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'manual_actions',
    mode: 'manual',
    tone: 'default',
    title: 'Suggested next step',
    message: 'This looks interested.',
    secondaryMessage: 'Your selection determines whether the campaign sends its automated follow-up.',
    loading: false,
    primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
    alternatives: [{ action: 'mark_interested', label: 'Interested only' }],
    dismissible: true,
  });
});

test('complete manual OOO classification uses OOO-specific pipeline secondary copy', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: null,
    categorySource: null,
    handlingMetadata: {
      mode: 'manual',
      category: 'Auto Reply',
      return_date: '2026-06-28',
      primary_message: 'Lead may be out of office until 2026-06-28.',
      primary: { action: 'mark_ooo_dated', label: 'Mark OOO until 2026-06-28' },
      alternatives: [
        { action: 'mark_ooo_instant', label: 'Mark OOO + resume instantly' },
        { action: 'mark_ooo_custom', label: 'Choose return date' },
      ],
    },
    pipelineState: {
      active: true,
      phase: 'categorizing',
      label: 'Awaiting categorization - an automated reply may send after you categorize.',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'manual_actions',
    mode: 'manual',
    tone: 'default',
    title: 'Suggested next step',
    message: 'Lead may be out of office until 2026-06-28.',
    secondaryMessage: null,
    loading: false,
    primary: { action: 'mark_ooo_dated', label: 'Mark OOO until 2026-06-28' },
    alternatives: [
      { action: 'mark_ooo_instant', label: 'Mark OOO + resume instantly' },
      { action: 'mark_ooo_custom', label: 'Choose return date' },
    ],
    dismissible: true,
  });
});

test('complete AI classification uses primary message and preparing secondary message', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: 'Interested',
    categorySource: 'ai',
    handlingMetadata: {
      mode: 'ai',
      primary_message: 'AI categorized this reply as Interested.',
    },
    pipelineState: {
      active: true,
      phase: 'arming_reply',
      label: 'Automated reply preparing...',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'ai_info',
    mode: 'ai',
    tone: 'default',
    title: 'AI classification',
    message: 'AI categorized this reply as Interested.',
    secondaryMessage: "The campaign's automated follow-up is being prepared.",
    loading: false,
    dismissible: true,
  });
});

test('wrong-contact manual message keeps primary copy and adds replace-lead pipeline secondary', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: null,
    categorySource: null,
    handlingMetadata: {
      mode: 'manual',
      category: 'Interested',
      header_mismatch: true,
      primary_message: 'This reply came from a different contact. Consider replacing the lead.',
      primary: { action: 'replace_lead', label: 'Replace + forward with message' },
      alternatives: [{ action: 'mark_interested_reply', label: 'Interested + reply' }],
      suggested_referral: {
        email: null,
        name: null,
        reason: 'wrong_contact',
      },
    },
    pipelineState: {
      active: true,
      phase: 'categorizing',
      label: 'Awaiting categorization - an automated reply may send after you categorize.',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'manual_actions',
    mode: 'manual',
    tone: 'action',
    title: 'Suggested next step',
    message: 'This reply came from a different contact. Consider replacing the lead.',
    secondaryMessage: 'The campaign may email the wrong contact until the lead is replaced.',
    loading: false,
    primary: { action: 'replace_lead', label: 'Replace + forward with message' },
    alternatives: [{ action: 'mark_interested_reply', label: 'Interested + reply' }],
    dismissible: true,
  });
});

test('dismissed smart handling falls back to pipeline-only callout while pipeline is still active', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: null,
    categorySource: null,
    handlingMetadata: {
      mode: 'manual',
      primary_message: 'Suggested next step for this reply.',
    },
    pipelineState: {
      active: true,
      phase: 'categorizing',
      label: 'Awaiting categorization - an automated reply may send after you categorize.',
    },
    dismissedForCurrentView: true,
  });

  assert.deepEqual(result, {
    kind: 'pipeline_only',
    mode: 'ai',
    tone: 'pipeline',
    title: 'Automated reply in progress',
    message: 'Awaiting categorization - an automated reply may send after you categorize.',
    loading: false,
    dismissible: false,
  });
});

test('closed conversation with active pipeline still shows pipeline-only fallback', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'closed',
    classificationStatus: 'complete',
    category: 'Interested',
    categorySource: 'ai',
    handlingMetadata: {
      mode: 'ai',
      primary_message: 'AI categorized this reply as Interested.',
    },
    pipelineState: {
      active: true,
      phase: 'arming_reply',
      label: 'Automated reply preparing...',
    },
    dismissedForCurrentView: false,
  });

  assert.deepEqual(result, {
    kind: 'pipeline_only',
    mode: 'ai',
    tone: 'pipeline',
    title: 'Automated reply in progress',
    message: 'Automated reply preparing...',
    loading: false,
    dismissible: false,
  });
});

test('complete manual not interested classification uses warning tone', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: 'complete',
    category: null,
    categorySource: null,
    handlingMetadata: {
      mode: 'manual',
      category: 'Not Interested',
      primary_message: 'This reply looks not interested.',
      primary: { action: 'mark_not_interested', label: 'Mark not interested' },
      alternatives: [{ action: 'block_sender', label: 'Block sender' }],
    },
    pipelineState: null,
    dismissedForCurrentView: false,
  });

  assert.equal(result?.tone, 'warning');
});

test('returns null when neither smart handling nor pipeline state is eligible', () => {
  const result = resolveThreadStatusCallout({
    conversationStatus: 'open',
    classificationStatus: null,
    category: null,
    categorySource: null,
    handlingMetadata: null,
    pipelineState: null,
    dismissedForCurrentView: false,
  });

  assert.equal(result, null);
});
