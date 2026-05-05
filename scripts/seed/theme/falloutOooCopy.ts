import type { OooInboxCaseKey } from '../constants/oooMixedInbox';
import { oooCampaignIdShort } from '../constants/oooMixedInbox';

export type OooSeedCaseCopy = {
  key: OooInboxCaseKey;
  mailboxDisplayName: string;
  mailboxLocalBase: string;
  leadName: string;
  firstName: string;
  lastName: string;
  companyName: string;
  subject: string;
  sentBody: string;
  receivedBody: string;
};

export const OOO_CASE_COPY: OooSeedCaseCopy[] = [
  {
    key: 'normal',
    mailboxDisplayName: 'Piper Wright - Publick Desk [NORMAL]',
    mailboxLocalBase: 'publick-desk',
    leadName: 'Sole Survivor',
    firstName: 'Sole',
    lastName: 'Survivor',
    companyName: 'Sanctuary Supply Co.',
    subject: '[NORMAL] Re: Water chip barter route',
    sentBody:
      'Howdy {{name}} - checking if your caravan still needs a steady water chip route through the Commonwealth.',
    receivedBody:
      'Thanks for the note. The route still looks good on our side, so send over the next step when you can.',
  },
  {
    key: 'ooo_only',
    mailboxDisplayName: 'Codsworth - Concierge Wire [OOO ONLY]',
    mailboxLocalBase: 'concierge-wire',
    leadName: 'Moira Brown',
    firstName: 'Moira',
    lastName: 'Brown',
    companyName: 'Craterside Research',
    subject: '[OOO ONLY — manual resume] Re: Vault 81 clinic barter',
    sentBody:
      'Hello {{name}} - sharing a fake dev-only note about clinic barter terms from our Vault-Tec partnership team.',
    receivedBody:
      'Out of office from the Capital Wasteland field lab. I will return on 2026-05-12 after inventory checks.',
  },
  {
    key: 'ooo_future',
    mailboxDisplayName: 'Cass - Mojave Trade Post [RESUME LATER]',
    mailboxLocalBase: 'mojave-trade',
    leadName: 'Lone Wanderer',
    firstName: 'Lone',
    lastName: 'Wanderer',
    companyName: 'Megaton Mutual Aid',
    subject: '[RESUME LATER — future date] Re: Nuka delivery relay',
    sentBody:
      'Hi {{name}} - following up on the Mojave relay plan for those dev-only Nuka shipments we talked about.',
    receivedBody:
      'I am out of office and will return on 2026-05-20 after a caravan run near Vault 101. Please reconnect then.',
  },
  {
    key: 'ooo_due',
    mailboxDisplayName: 'Preston Garvey - Minute Desk [RESUME NOW]',
    mailboxLocalBase: 'minute-desk',
    leadName: 'Courier Six',
    firstName: 'Courier',
    lastName: 'Six',
    companyName: 'Mojave Express (test)',
    subject: '[RESUME NOW — due / instant] Re: Ranger station resupply',
    sentBody:
      'Hey {{name}} - one more fake seed follow-up on the ranger station resupply route before we archive the request.',
    receivedBody:
      'Back on 05/01/2026. I am away from the Mojave outpost until then, so send the note again when I return.',
  },
];

export function oooCampaignName(campaignId: string): string {
  return `seed-ooo-mixed-inbox | Wasteland OOO Drill ${oooCampaignIdShort(campaignId)}`;
}

export function oooMailboxEmailLocalPart(campaignId: string, base: string): string {
  return `${base}-${oooCampaignIdShort(campaignId)}`;
}

export function oooLeadEmailLocalPart(campaignId: string, key: OooInboxCaseKey): string {
  return `${key.replace(/_/g, '-')}-${oooCampaignIdShort(campaignId)}`;
}

export function oooLeadPersona(
  campaignId: string,
  key: OooInboxCaseKey,
  index: number
): {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  companyName: string;
} {
  const slice = oooCampaignIdShort(campaignId);
  const label = String(index).padStart(2, '0');

  if (key === 'normal') {
    return {
      email: `settler-beacon-${label}-${slice}@furnace.test`,
      name: `Settler Beacon ${label} [NORMAL]`,
      firstName: 'Settler',
      lastName: `Beacon ${label}`,
      companyName: `Commonwealth Water Guild ${label} [NORMAL]`,
    };
  }
  if (key === 'ooo_only') {
    return {
      email: `vault-clerk-${label}-${slice}@furnace.test`,
      name: `Vault Clerk ${label} [OOO ONLY]`,
      firstName: 'Vault',
      lastName: `Clerk ${label}`,
      companyName: `Atrium Research Desk ${label} [OOO ONLY]`,
    };
  }
  if (key === 'ooo_future') {
    return {
      email: `caravan-watch-${label}-${slice}@furnace.test`,
      name: `Caravan Watch ${label} [RESUME LATER]`,
      firstName: 'Caravan',
      lastName: `Watch ${label}`,
      companyName: `Mojave Relay Office ${label} [RESUME LATER]`,
    };
  }
  return {
    email: `ranger-relay-${label}-${slice}@furnace.test`,
    name: `Ranger Relay ${label} [RESUME NOW]`,
    firstName: 'Ranger',
    lastName: `Relay ${label}`,
    companyName: `Outpost Dispatch ${label} [RESUME NOW]`,
  };
}

export function oooReceivedBodyForIndex(
  key: OooInboxCaseKey,
  index: number
): string {
  const copy = OOO_CASE_COPY.find((entry) => entry.key === key)!;
  if (key === 'normal') {
    return `[NORMAL ${String(index).padStart(2, '0')}] ${copy.receivedBody} We can review the route in batch ${index}.`;
  }
  if (key === 'ooo_only') {
    return `[OOO ONLY ${String(index).padStart(2, '0')}] Out of office from lab rotation ${index}. I will return on 2026-05-${String(
      10 + ((index - 1) % 8)
    ).padStart(2, '0')} after inventory checks.`;
  }
  if (key === 'ooo_future') {
    return `[RESUME LATER ${String(index).padStart(2, '0')}] I am out of office and will return on 2026-05-${String(
      18 + ((index - 1) % 5)
    ).padStart(2, '0')} after a caravan run near Vault 101. Please reconnect then.`;
  }
  return `[RESUME NOW ${String(index).padStart(2, '0')}] Back on 05/${String(1 + ((index - 1) % 5)).padStart(
    2,
    '0'
  )}/2026. I am away from the Mojave outpost until then, so send the note again when I return.`;
}
