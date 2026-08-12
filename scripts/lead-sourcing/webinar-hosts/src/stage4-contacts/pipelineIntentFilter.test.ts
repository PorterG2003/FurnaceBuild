import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePipelineIntent } from './pipelineIntentFilter.js';

describe('pipelineIntentFilter', () => {
  it('passes product webinar with registration CTA', () => {
    const decision = evaluatePipelineIntent(
      'Last call: Register for our webinar tomorrow featuring our platform for demand generation.',
    );
    assert.equal(decision.pass, true);
    assert.equal(decision.reason, 'pipeline_plausible');
  });

  it('passes SharePoint onboarding product post (not internal HR)', () => {
    const decision = evaluatePipelineIntent(
      'Join us live — New Employee Onboarding Solution for SharePoint. Register now to see the demo.',
    );
    assert.equal(decision.pass, true);
  });

  it('rejects internal all-hands', () => {
    const decision = evaluatePipelineIntent('Join our all-hands town hall this Friday for all employees.');
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'pipeline_internal_only');
  });

  it('rejects recruiting-only post', () => {
    const decision = evaluatePipelineIntent("We're hiring! Join our career fair webinar to learn about open positions.");
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'pipeline_recruiting_only');
  });

  it('passes empty post text (fail open)', () => {
    const decision = evaluatePipelineIntent('');
    assert.equal(decision.pass, true);
    assert.equal(decision.reason, 'no_post_text');
  });
});
