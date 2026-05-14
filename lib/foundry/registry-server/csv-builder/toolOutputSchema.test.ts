import assert from 'node:assert';
import { describe, it } from 'node:test';
import { extractCsvBuilderToolOutputValue, getCsvBuilderSelectedOutputs } from './toolOutputSchema.js';

describe('csv builder tool output schema', () => {
  it('extracts industries_served from website verification results', () => {
    const value = extractCsvBuilderToolOutputValue('website_verification', 'industries_served', {
      industries_served: 'Home services, Roofing',
    });

    assert.equal(value, 'Home services, Roofing');
  });

  it('includes industries_served only when explicitly selected', () => {
    const selected = getCsvBuilderSelectedOutputs('website_verification', ['band', 'industries_served']);

    assert.deepEqual(
      selected.map((output) => output.key),
      ['band', 'industries_served'],
    );
  });
});
