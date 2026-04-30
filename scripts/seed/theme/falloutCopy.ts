/**
 * Fallout-inspired fictional copy for seed data only (no real PII).
 */

import { campaignIdShort } from '../constants/campaignSmoke';

export function smokeCampaignName(slice: string): string {
  return `seed-campaign-smoke | Vault-Tec Outreach ${slice}`;
}

export function smokeMailboxDisplayName(which: 1 | 2): string {
  return which === 1 ? 'Curie — Relay 7' : 'Nick Valentine — Diamond Desk';
}

export function smokeMailboxLocalPart(which: 1 | 2, slice: string): string {
  const tag = which === 1 ? 'vault-relay' : 'detective-desk';
  return `${tag}-${slice}`;
}

/** Person + company strings for leads (email local-part is unique per campaign). */
export function smokeLeadPersonaWithSlice(campaignId: string, index: 0 | 1) {
  const slice = campaignIdShort(campaignId);
  if (index === 0) {
    return {
      emailLocal: `lone-wanderer-${slice}`,
      name: 'Lone Wanderer',
      first_name: 'Lone',
      last_name: 'Wanderer',
      company_name: 'Megaton Mutual Aid',
    };
  }
  return {
    emailLocal: `courier-six-${slice}`,
    name: 'Courier Six',
    first_name: 'Courier',
    last_name: 'Six',
    company_name: 'Mojave Express (test)',
  };
}

export function smokeFlowNodeLabels(): { leadSource: string; email: string } {
  return {
    leadSource: 'Vault 101 Lead Tap',
    email: 'Nuka-Cola Welcome Series',
  };
}

export function smokeEmailVariants(): {
  labelA: string;
  labelB: string;
  subjectA: string;
  subjectB: string;
  templateA: string;
  templateB: string;
} {
  return {
    labelA: 'Blue Sunset',
    labelB: 'Quantum Crisp',
    subjectA: 'SPECIAL: A vault suit that fits, {{name}}',
    subjectB: 'RE: Your caps balance is looking sunny, {{name}}',
    templateA: 'Howdy {{name}} — welcome to the wasteland tour. Reply YES if you want a Pip-Boy sticker (not real).',
    templateB: 'Hey {{name}} — second wave from the Mojave desk. This is fake seed mail for dev only.',
  };
}
