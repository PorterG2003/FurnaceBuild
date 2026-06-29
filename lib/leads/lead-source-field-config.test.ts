import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLeadSourceFieldConfig } from './lead-source-field-config';

test('buildLeadSourceFieldConfig unions existing keys with new custom columns using normalized unique keys', () => {
  const result = buildLeadSourceFieldConfig({
    existingCustomFieldKeys: ['Industry', ' Title '],
    existingMappedStandardFieldKeys: ['email'],
    newCustomFieldColumns: ['Title', 'Company Size'],
    fieldMappings: { email: 'Email' },
    hasActiveCsvMapping: true,
  });

  assert.deepEqual(result.customFieldKeys, ['Industry', 'Title', 'Company Size']);
  assert.deepEqual(result.mappedStandardFieldKeys, ['email']);
});

test('buildLeadSourceFieldConfig drops invalid or blank custom field names', () => {
  const result = buildLeadSourceFieldConfig({
    existingCustomFieldKeys: ['Good Key', 'Bad { Key'],
    newCustomFieldColumns: ['  ', 'Also } Bad', 'Valid'],
    fieldMappings: { email: 'Email' },
    hasActiveCsvMapping: true,
  });

  assert.deepEqual(result.customFieldKeys, ['Good Key', 'Valid']);
});

test('buildLeadSourceFieldConfig preserves mapped standard keys when there is no active CSV session', () => {
  const result = buildLeadSourceFieldConfig({
    existingCustomFieldKeys: ['Industry'],
    existingMappedStandardFieldKeys: ['email', 'first_name'],
    newCustomFieldColumns: [],
    fieldMappings: { email: '', first_name: '' },
    hasActiveCsvMapping: false,
  });

  assert.deepEqual(result.mappedStandardFieldKeys, ['email', 'first_name']);
});

test('buildLeadSourceFieldConfig derives mapped standard keys from current field mappings during import', () => {
  const result = buildLeadSourceFieldConfig({
    existingCustomFieldKeys: [],
    existingMappedStandardFieldKeys: ['email'],
    newCustomFieldColumns: [],
    fieldMappings: {
      email: 'Email',
      first_name: 'First Name',
      last_name: '',
    },
    hasActiveCsvMapping: true,
  });

  assert.deepEqual(result.mappedStandardFieldKeys, ['email', 'first_name']);
});
