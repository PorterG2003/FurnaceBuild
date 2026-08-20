import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('all sanctioned flow save wrappers kick copy parsing after successful writes', () => {
  const browserWrites = source(
    '../supabase/services/campaigns/campaigns.ts',
  );
  const serviceWrites = source(
    '../supabase/services/campaigns/update-campaign-flow-with-client.ts',
  );

  assert.match(
    browserWrites,
    /createCampaign[\s\S]*kickCopyParseFromClient\(accountId\)/,
  );
  assert.match(
    browserWrites,
    /updateCampaign[\s\S]*hasOwnProperty\.call\(updates, 'flow_data'\)[\s\S]*kickCopyParseFromClient/,
  );
  assert.match(
    browserWrites,
    /updateCampaignFlowData[\s\S]*kickCopyParseFromClient\(result\.campaign\.account_id\)/,
  );
  assert.match(
    serviceWrites,
    /updateCampaignFlowDataWithClient[\s\S]*await kickCopyParseFromServer\(accountId\)/,
  );
  assert.doesNotMatch(
    serviceWrites,
    /from ['"]\.\/campaigns['"]/,
    'Client API must not typecheck browser kickCopyParse via campaigns.ts',
  );
  assert.doesNotMatch(serviceWrites, /kickCopyParseFromClient/);
});

test('copy parser infrastructure remains demand-driven with no schedule', () => {
  const backend = source('../../amplify/backend.ts');
  const resource = source('../../amplify/functions/copyStructureParse/resource.ts');
  const parserBlock = backend.slice(
    backend.indexOf('// Copy structure parser:'),
    backend.indexOf('// Google Places API'),
  );

  assert.match(parserBlock, /reservedConcurrentExecutions = 1/);
  assert.doesNotMatch(parserBlock, /\bschedule\s*:/i);
  assert.doesNotMatch(resource, /\bschedule\s*:/i);
});
