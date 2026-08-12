import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostAnalysisFromContent } from './postAnalyzer.js';

describe('postAnalyzer', () => {
  it('parses json content from llm response', () => {
    const parsed = parsePostAnalysisFromContent(
      'Here is the data: {"webinar_topic":"Demand Gen","webinar_date_mention":"March 1","target_audience":"Marketers"}',
    );
    assert.equal(parsed.webinar_topic, 'Demand Gen');
    assert.equal(parsed.target_audience, 'Marketers');
  });
});
