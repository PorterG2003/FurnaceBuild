import { extractVariableKeys, STANDARD_MERGE_FIELD_KEYS } from '../../email/index.js';
import { normalizeCustomFieldKey } from '../../leads/csv-dedupe.js';
import type { CampaignFlowData, CampaignFlowNode } from './types';

export type FieldSyncResult = {
  declared_custom_added: string[];
  declared_standard_added: string[];
};

const STANDARD_FIELD_KEYS = new Set<string>(STANDARD_MERGE_FIELD_KEYS);

function collectCopyTexts(flowData: CampaignFlowData): string[] {
  const texts: string[] = [];
  for (const node of flowData.nodes) {
    if (node.type === 'email') {
      const variants = Array.isArray(node.data?.variants) ? node.data.variants : [];
      for (const variant of variants) {
        if (typeof variant?.subject === 'string') texts.push(variant.subject);
        if (typeof variant?.template === 'string') texts.push(variant.template);
        if (typeof variant?.body_html === 'string') texts.push(variant.body_html);
      }
      if (typeof node.data?.subject === 'string') texts.push(node.data.subject);
      if (typeof node.data?.template === 'string') texts.push(node.data.template);
    }
    if (node.type === 'dataSender') {
      if (typeof node.data?.payload === 'string') {
        texts.push(node.data.payload);
      } else if (node.data?.payload_template && typeof node.data.payload_template === 'object') {
        texts.push(JSON.stringify(node.data.payload_template));
      }
    }
  }
  return texts;
}

function mergeUniqueKeys(existing: string[], added: string[]): { merged: string[]; addedOnly: string[] } {
  const merged = [...existing];
  const addedOnly: string[] = [];
  for (const key of added) {
    if (!merged.includes(key)) {
      merged.push(key);
      addedOnly.push(key);
    }
  }
  return { merged, addedOnly };
}

export function syncFields(flowData: CampaignFlowData): {
  flow: CampaignFlowData;
  field_sync: FieldSyncResult;
} {
  const variableKeys = extractVariableKeys(...collectCopyTexts(flowData));
  const discoveredCustom: string[] = [];
  const discoveredStandard: string[] = [];

  for (const key of variableKeys) {
    if (key.startsWith('custom.')) {
      const normalized = normalizeCustomFieldKey(key.slice('custom.'.length));
      if (normalized) discoveredCustom.push(normalized);
      continue;
    }
    if (STANDARD_FIELD_KEYS.has(key)) {
      discoveredStandard.push(key);
    }
  }

  const leadSourceIndex = flowData.nodes.findIndex((node) => node.type === 'leadSource');
  if (leadSourceIndex === -1) {
    return {
      flow: flowData,
      field_sync: {
        declared_custom_added: [],
        declared_standard_added: [],
      },
    };
  }

  const leadSource = flowData.nodes[leadSourceIndex] as CampaignFlowNode;
  const existingCustom = Array.isArray(leadSource.data?.customFieldKeys)
    ? leadSource.data.customFieldKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const mappedStandardFieldKeys = leadSource.data?.mappedStandardFieldKeys;
  const hasExplicitStandard = Array.isArray(mappedStandardFieldKeys);
  const existingStandard = hasExplicitStandard
    ? mappedStandardFieldKeys.filter((key): key is string => typeof key === 'string')
    : [];

  const customMerge = mergeUniqueKeys(existingCustom, discoveredCustom);
  const standardMerge = hasExplicitStandard
    ? mergeUniqueKeys(existingStandard, discoveredStandard)
    : { merged: [], addedOnly: [] };

  const nodes = flowData.nodes.map((node, index) => {
    if (index !== leadSourceIndex) return node;
    const data: Record<string, unknown> = {
      ...node.data,
      customFieldKeys: customMerge.merged,
    };
    if (hasExplicitStandard) {
      data.mappedStandardFieldKeys = standardMerge.merged;
    }
    return {
      ...node,
      data,
    } as CampaignFlowNode;
  });

  return {
    flow: { ...flowData, nodes },
    field_sync: {
      declared_custom_added: customMerge.addedOnly,
      declared_standard_added: standardMerge.addedOnly,
    },
  };
}
