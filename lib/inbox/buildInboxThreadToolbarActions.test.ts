import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInboxThreadToolbarActions,
  getInboxThreadToolbarPriority,
  INBOX_THREAD_TOOLBAR_ORDER,
} from './buildInboxThreadToolbarActions';

const noop = () => {};

test('buildInboxThreadToolbarActions returns ordered eligible actions', () => {
  const actions = buildInboxThreadToolbarActions({
    showCloseConversationButton: true,
    onCloseConversation: noop,
    showBlockButton: true,
    onBlock: noop,
    showOutOfOfficeButton: true,
    onMarkOutOfOffice: noop,
    showReplaceLeadButton: true,
    onReplaceLead: noop,
    onOpenTagsPanel: noop,
    tagCount: 3,
  });

  assert.deepEqual(
    actions.map((action) => action.key),
    ['close', 'block', 'ooo', 'replace', 'tags'],
  );
  assert.equal(actions.at(-1)?.label, 'Tags (3)');
});

test('buildInboxThreadToolbarActions swaps open for close when thread is closed', () => {
  const actions = buildInboxThreadToolbarActions({
    showOpenConversationButton: true,
    onOpenConversation: noop,
    showCloseConversationButton: false,
    onOpenTagsPanel: noop,
  });

  assert.deepEqual(
    actions.map((action) => action.key),
    ['open', 'tags'],
  );
  assert.equal(actions[0]?.label, 'Open conversation');
});

test('toolbar priority follows the shared toolbar order', () => {
  const priorities = INBOX_THREAD_TOOLBAR_ORDER.map((key) => getInboxThreadToolbarPriority(key));

  assert.deepEqual(priorities, [0, 0, 2, 3, 4, 5]);
});
