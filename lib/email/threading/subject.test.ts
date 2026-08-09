import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildForwardDefaultSubject,
  buildReplyDefaultSubject,
  containsUnresolvedTemplate,
  isNoSubjectPlaceholder,
  resolveDeliveredSubject,
} from './subject.js';

const lead = { id: 'lead-1', email: 'lead@example.com', first_name: 'Casey' };

describe('containsUnresolvedTemplate', () => {
  it('detects flat spintax', () => {
    assert.equal(containsUnresolvedTemplate('{A|B}'), true);
    assert.equal(containsUnresolvedTemplate('Hey {A|B} there'), true);
  });

  it('detects mustache variables', () => {
    assert.equal(containsUnresolvedTemplate('Hello {{first_name}}'), true);
  });

  it('detects spintax with nested mustache, which flat patterns miss', () => {
    assert.equal(
      containsUnresolvedTemplate('{Hello {{first_name}}|Hi {{first_name}}}'),
      true,
    );
  });

  it('accepts fully rendered subjects', () => {
    assert.equal(containsUnresolvedTemplate('Hello Casey'), false);
    assert.equal(containsUnresolvedTemplate(''), false);
    assert.equal(containsUnresolvedTemplate(null), false);
    assert.equal(containsUnresolvedTemplate('Re: Quick question'), false);
  });

  it('does not flag braces without alternation', () => {
    assert.equal(containsUnresolvedTemplate('Budget {2026}'), false);
  });
});

describe('isNoSubjectPlaceholder', () => {
  it('matches the placeholder in any casing or spacing', () => {
    assert.equal(isNoSubjectPlaceholder('(No subject)'), true);
    assert.equal(isNoSubjectPlaceholder('(no subject)'), true);
    assert.equal(isNoSubjectPlaceholder('  (No  subject)  '), true);
  });

  it('does not match real subjects', () => {
    assert.equal(isNoSubjectPlaceholder('No subject changes'), false);
    assert.equal(isNoSubjectPlaceholder(''), false);
  });
});

describe('resolveDeliveredSubject', () => {
  it('prefers the sent event subject', () => {
    assert.equal(
      resolveDeliveredSubject({
        eventSentSubject: 'From event',
        messageDataSentSubject: 'From job',
        nodeConfigSubject: '{A|B}',
        lead,
      }),
      'From event',
    );
  });

  it('falls back to message_data.sent_subject when the event is missing', () => {
    assert.equal(
      resolveDeliveredSubject({
        eventSentSubject: null,
        messageDataSentSubject: 'From job',
        nodeConfigSubject: '{A|B}',
        lead,
      }),
      'From job',
    );
  });

  it('never returns raw spintax, rendering deterministically instead', () => {
    const subject = resolveDeliveredSubject({
      nodeConfigSubject: '{Hello {{first_name}}|Hi {{first_name}}}',
      lead,
    });
    assert.equal(containsUnresolvedTemplate(subject), false);
    assert.match(subject, /^(Hello|Hi) Casey$/);
  });

  it('is deterministic across calls for the same template and lead', () => {
    const template = '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}';
    const a = resolveDeliveredSubject({ nodeConfigSubject: template, lead });
    const b = resolveDeliveredSubject({ nodeConfigSubject: template, lead });
    assert.equal(a, b);
  });

  it('skips recorded values that are themselves raw templates', () => {
    const subject = resolveDeliveredSubject({
      messageDataSubject: '{Hello {{first_name}}|Hi {{first_name}}}',
      nodeConfigSubject: '{Hello {{first_name}}|Hi {{first_name}}}',
      lead,
    });
    assert.equal(containsUnresolvedTemplate(subject), false);
  });

  it('skips the placeholder and returns empty for an empty-subject send', () => {
    assert.equal(
      resolveDeliveredSubject({ messageDataSubject: '(No subject)', nodeConfigSubject: '' }),
      '',
    );
    assert.equal(resolveDeliveredSubject({ nodeConfigSubject: '' }), '');
  });

  it('resolves spintax without a lead, since no merge values are needed', () => {
    assert.equal(resolveDeliveredSubject({ nodeConfigSubject: '{A|B}' }), 'A');
  });

  it('salvages readable text from a template truncated mid-spintax', () => {
    assert.equal(
      resolveDeliveredSubject({ nodeConfigSubject: '{Web traffic|Web visits|Anonymous' }),
      'Web traffic',
    );
    assert.equal(
      resolveDeliveredSubject({ nodeConfigSubject: 'Re: {Web traffic|Web visits' }),
      'Re: Web traffic',
    );
  });

  it('renders missing merge values as empty without leaving stray spacing', () => {
    assert.equal(
      resolveDeliveredSubject({ nodeConfigSubject: '{Hello {{first_name}}|Hi {{first_name}}}' }),
      'Hello',
    );
  });
});

describe('composer defaults', () => {
  it('prefers the parent message subject over a stale thread subject', () => {
    assert.equal(
      buildReplyDefaultSubject({
        parentMessageSubject: 'Rendered subject Casey',
        threadSubject: '{Hello {{first_name}}|Hi {{first_name}}}',
      }),
      'Re: Rendered subject Casey',
    );
  });

  it('renders a raw thread subject rather than showing spintax', () => {
    const subject = buildReplyDefaultSubject({
      parentMessageSubject: null,
      threadSubject: '{Hello {{first_name}}|Hi {{first_name}}}',
      lead,
    });
    assert.equal(containsUnresolvedTemplate(subject), false);
    assert.match(subject, /^Re: (Hello|Hi) Casey$/);
  });

  it('does not double-prefix an existing Re: or Fwd:', () => {
    assert.equal(buildReplyDefaultSubject({ parentMessageSubject: 'Re: Hello' }), 'Re: Hello');
    assert.equal(buildReplyDefaultSubject({ parentMessageSubject: 'RE: Hello' }), 'RE: Hello');
    assert.equal(buildForwardDefaultSubject({ parentMessageSubject: 'Fwd: Hello' }), 'Fwd: Hello');
    assert.equal(buildForwardDefaultSubject({ parentMessageSubject: 'Fw: Hello' }), 'Fw: Hello');
  });

  it('prefixes a forward', () => {
    assert.equal(buildForwardDefaultSubject({ parentMessageSubject: 'Hello' }), 'Fwd: Hello');
  });

  it('returns empty for an empty-subject thread so the UI shows a placeholder', () => {
    assert.equal(buildReplyDefaultSubject({ parentMessageSubject: '', threadSubject: '' }), '');
    assert.equal(
      buildReplyDefaultSubject({ parentMessageSubject: '(No subject)', threadSubject: null }),
      '',
    );
  });
});
