import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFieldsComplete, parseClassify } from './classify.js';

test('parseClassify requires what_they_sell and category', () => {
  const empty = parseClassify(
    JSON.stringify({ b2b_type: 'b2b', what_they_sell: '', category: '', target_audience: 'buyers' }),
  );
  assert.equal(classifyFieldsComplete(empty), false);

  const filled = parseClassify(
    JSON.stringify({
      b2b_type: 'b2b',
      what_they_sell: 'Jobsite software for contractors',
      category: 'construction tech',
      target_audience: 'construction companies',
      primary_buyer: 'business',
      customer_geo: 'us',
    }),
  );
  assert.equal(classifyFieldsComplete(filled), true);
  assert.equal(filled.what_they_sell, 'Jobsite software for contractors');
  assert.equal(filled.category, 'construction tech');

  const withGeo = parseClassify(
    JSON.stringify({
      b2b_type: 'hybrid',
      what_they_sell: "Men's performance wear",
      category: 'Apparel',
      primary_buyer: 'consumer',
      customer_geo: 'us',
    }),
  );
  assert.equal(classifyFieldsComplete(withGeo), true);
  assert.equal(withGeo.primary_buyer, 'consumer');
  assert.equal(withGeo.customer_geo, 'us');
});
