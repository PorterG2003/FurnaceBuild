import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTopicHook,
  parseTopicHookContent,
  sanitizeHook,
  TOPIC_HOOK_FALLBACK,
} from './topicHookLlm.js';

describe('topicHookLlm', () => {
  it('accepts clean topic noun phrases including 2-word proper topics', () => {
    assert.equal(isValidTopicHook('estate and Medicaid planning'), true);
    assert.equal(isValidTopicHook('AI invoice management'), true);
    assert.equal(isValidTopicHook('Australian expat tax changes'), true);
    assert.equal(isValidTopicHook('Microsoft Copilot'), true);
    assert.equal(isValidTopicHook('Claude Code'), true);
    assert.equal(isValidTopicHook(TOPIC_HOOK_FALLBACK), true);
  });

  it('rejects format words, webinar words, and meta endings', () => {
    assert.equal(isValidTopicHook('Microsoft Copilot Masterclass'), false);
    assert.equal(isValidTopicHook('GRID trading masterclass'), false);
    assert.equal(isValidTopicHook('AI Invoice Management Workshop'), false);
    assert.equal(isValidTopicHook('AI credit analysis webinars'), false);
    assert.equal(isValidTopicHook('AI governance insights'), false);
    assert.equal(isValidTopicHook('wastewater treatment strategies'), false);
    assert.equal(isValidTopicHook('lead gen engine secrets'), false);
  });

  it('rejects leading gerunds, too-short hooks, and parse junk', () => {
    assert.equal(isValidTopicHook('becoming an EOS Implementer'), false);
    assert.equal(isValidTopicHook('finding your next investor'), false);
    assert.equal(isValidTopicHook('AI'), false);
    assert.equal(isValidTopicHook('{"topic_hook":"digital reach'), false);
    assert.equal(isValidTopicHook("NAIDOC Week 'Fifty Years of Deadly"), false);
  });

  it('sanitizes quotes and truncates long hooks', () => {
    assert.equal(sanitizeHook('"private credit India."'), 'private credit India');
    assert.equal(
      sanitizeHook('one two three four five six seven eight nine ten'),
      'one two three four five six seven',
    );
  });

  it('maps JSON parse failures and wrappers to fallback', () => {
    assert.equal(sanitizeHook('{"topic_hook":"digital reach'), TOPIC_HOOK_FALLBACK);
    assert.equal(
      parseTopicHookContent('{"topic_hook":"estate and Medicaid planning"}'),
      'estate and Medicaid planning',
    );
    assert.equal(
      parseTopicHookContent('Here you go: {"topic_hook":"AI invoice management"}'),
      'AI invoice management',
    );
  });
});
