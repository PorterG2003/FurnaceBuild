import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColumnLayout,
  isColumnAlreadyAdded,
  columnLayoutKey,
  MAX_COLUMN_LAYOUT_COLUMNS,
} from './parseColumnLayout';
import { DEFAULT_SAVED_LIST_COLUMNS } from './defaults';
import type { LeadsColumnDef } from './types';

test('parseColumnLayout returns defaults for empty input', () => {
  assert.deepEqual(parseColumnLayout([]), DEFAULT_SAVED_LIST_COLUMNS);
  assert.deepEqual(parseColumnLayout(null), DEFAULT_SAVED_LIST_COLUMNS);
});

test('parseColumnLayout round-trips valid columns', () => {
  const layout: LeadsColumnDef[] = [
    {
      id: 'membership-camp-1-company_name',
      sourceType: 'membership',
      sourceLabel: 'Campaign',
      fieldKey: 'company_name',
      label: 'Company',
      visible: true,
      campaignId: 'camp-1',
      campaignName: 'Atlas',
      width: 180,
    },
  ];
  const parsed = parseColumnLayout(layout);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.fieldKey, 'company_name');
  assert.equal(parsed[0]?.campaignId, 'camp-1');
  assert.equal(parsed[0]?.sourceLabel, 'Campaign');
});

test('parseColumnLayout strips invalid source types and membership without campaign', () => {
  const parsed = parseColumnLayout([
    {
      id: 'bad-filter',
      sourceType: 'filter_meta',
      sourceLabel: 'Filter metadata',
      fieldKey: 'active_filters',
      label: 'Active filters',
      visible: true,
    },
    {
      id: 'bad-membership',
      sourceType: 'membership',
      sourceLabel: 'Campaign',
      fieldKey: 'title',
      label: 'Title',
      visible: true,
    },
  ]);
  assert.deepEqual(parsed, DEFAULT_SAVED_LIST_COLUMNS);
});

test('parseColumnLayout enforces max column count', () => {
  const many = Array.from({ length: MAX_COLUMN_LAYOUT_COLUMNS + 5 }, (_, index) => ({
    id: `person-field-${index}`,
    sourceType: 'person' as const,
    sourceLabel: 'Lead',
    fieldKey: 'email',
    label: `Email ${index}`,
    visible: true,
  }));
  assert.equal(parseColumnLayout(many).length, MAX_COLUMN_LAYOUT_COLUMNS);
});

test('isColumnAlreadyAdded matches source field and campaign', () => {
  const existing: LeadsColumnDef[] = [
    {
      id: 'membership-camp-1-company_name',
      sourceType: 'membership',
      sourceLabel: 'Campaign',
      fieldKey: 'company_name',
      label: 'Company',
      visible: true,
      campaignId: 'camp-1',
    },
  ];
  assert.equal(
    isColumnAlreadyAdded(existing, {
      sourceType: 'membership',
      fieldKey: 'company_name',
      campaignId: 'camp-1',
    }),
    true,
  );
  assert.equal(
    isColumnAlreadyAdded(existing, {
      sourceType: 'membership',
      fieldKey: 'company_name',
      campaignId: 'camp-2',
    }),
    false,
  );
  assert.equal(columnLayoutKey(existing[0]!), 'membership:camp-1:company_name');
});

test('isColumnAlreadyAdded dedupes cross-group candidates independently', () => {
  const existing: LeadsColumnDef[] = [
    {
      id: 'person-email',
      sourceType: 'person',
      sourceLabel: 'Lead',
      fieldKey: 'email',
      label: 'Email',
      visible: true,
    },
    {
      id: 'rollup-campaign_count',
      sourceType: 'rollup',
      sourceLabel: 'Summary',
      fieldKey: 'campaign_count',
      label: 'Campaign count',
      visible: true,
    },
  ];

  assert.equal(
    isColumnAlreadyAdded(existing, { sourceType: 'person', fieldKey: 'email', campaignId: null }),
    true,
  );
  assert.equal(
    isColumnAlreadyAdded(existing, { sourceType: 'person', fieldKey: 'first_name', campaignId: null }),
    false,
  );
  assert.equal(
    isColumnAlreadyAdded(existing, { sourceType: 'rollup', fieldKey: 'campaign_count', campaignId: null }),
    true,
  );
  assert.equal(
    isColumnAlreadyAdded(existing, { sourceType: 'membership', fieldKey: 'title', campaignId: 'camp-1' }),
    false,
  );
});
