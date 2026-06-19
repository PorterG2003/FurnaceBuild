import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDeferredThreadAction,
  resolveFinalizeSteps,
  shouldAutoCloseConversationForAction,
  getThreadActionSuccessMessage,
} from './threadActionDefinitions';

test('replace_lead is deferred and finalizes only from smart handling', () => {
  assert.equal(isDeferredThreadAction('replace_lead'), true);

  assert.deepEqual(resolveFinalizeSteps('replace_lead', 'smart_handling', 'complete'), {
    closeConversation: true,
    dismissSmartHandling: true,
    refresh: true,
    setCategoryOnComplete: null,
  });

  assert.deepEqual(resolveFinalizeSteps('replace_lead', 'message_menu', 'complete'), {
    closeConversation: false,
    dismissSmartHandling: false,
    refresh: true,
    setCategoryOnComplete: null,
  });
});

test('mark_ooo_custom finalize relies on the shared OOO save path', () => {
  assert.equal(isDeferredThreadAction('mark_ooo_custom'), true);

  assert.deepEqual(resolveFinalizeSteps('mark_ooo_custom', 'smart_handling', 'complete'), {
    closeConversation: true,
    dismissSmartHandling: true,
    refresh: true,
    setCategoryOnComplete: null,
  });

  assert.deepEqual(resolveFinalizeSteps('mark_ooo_custom', 'message_menu', 'complete'), {
    closeConversation: false,
    dismissSmartHandling: false,
    refresh: true,
    setCategoryOnComplete: null,
  });
});

test('mark_out_of_office menu action only refreshes', () => {
  assert.equal(isDeferredThreadAction('mark_out_of_office'), true);
  assert.deepEqual(resolveFinalizeSteps('mark_out_of_office', 'message_menu', 'complete'), {
    closeConversation: false,
    dismissSmartHandling: false,
    refresh: true,
    setCategoryOnComplete: null,
  });
});

test('immediate OOO actions auto-close from smart handling', () => {
  assert.equal(shouldAutoCloseConversationForAction('mark_ooo_dated'), true);
  assert.deepEqual(resolveFinalizeSteps('mark_ooo_dated', 'smart_handling'), {
    closeConversation: true,
    dismissSmartHandling: true,
    refresh: false,
    setCategoryOnComplete: null,
  });
  assert.deepEqual(resolveFinalizeSteps('mark_ooo_dated', 'message_menu'), {
    closeConversation: false,
    dismissSmartHandling: false,
    refresh: false,
    setCategoryOnComplete: null,
  });
});

test('reply_only dismisses smart handling without closing', () => {
  assert.equal(shouldAutoCloseConversationForAction('reply_only'), false);
  assert.deepEqual(resolveFinalizeSteps('reply_only', 'smart_handling'), {
    closeConversation: false,
    dismissSmartHandling: true,
    refresh: false,
    setCategoryOnComplete: null,
  });
});

test('getThreadActionSuccessMessage returns opening copy for deferred actions', () => {
  assert.equal(getThreadActionSuccessMessage('replace_lead', 'opening'), 'Opening replace lead');
  assert.equal(getThreadActionSuccessMessage('mark_ooo_custom', 'opening'), 'Opening out of office');
});
