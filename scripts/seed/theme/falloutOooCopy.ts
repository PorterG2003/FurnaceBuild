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
    mailboxDisplayName: 'Piper Wright - Publick Desk',
    mailboxLocalBase: 'publick-desk',
    leadName: 'Sole Survivor',
    firstName: 'Sole',
    lastName: 'Survivor',
    companyName: 'Sanctuary Supply Co.',
    subject: 'Re: Water chip barter route',
    sentBody:
      'Howdy {{name}} - checking if your caravan still needs a steady water chip route through the Commonwealth.',
    receivedBody:
      'Thanks for the note. The route still looks good on our side, so send over the next step when you can.',
  },
  {
    key: 'ooo_only',
    mailboxDisplayName: 'Codsworth - Concierge Wire',
    mailboxLocalBase: 'concierge-wire',
    leadName: 'Moira Brown',
    firstName: 'Moira',
    lastName: 'Brown',
    companyName: 'Craterside Research',
    subject: 'Re: Vault 81 clinic barter',
    sentBody:
      'Hello {{name}} - sharing a fake dev-only note about clinic barter terms from our Vault-Tec partnership team.',
    receivedBody:
      'Out of office from the Capital Wasteland field lab. I will return on 2026-05-12 after inventory checks.',
  },
  {
    key: 'ooo_future',
    mailboxDisplayName: 'Cass - Mojave Trade Post',
    mailboxLocalBase: 'mojave-trade',
    leadName: 'Lone Wanderer',
    firstName: 'Lone',
    lastName: 'Wanderer',
    companyName: 'Megaton Mutual Aid',
    subject: 'Re: Nuka delivery relay',
    sentBody:
      'Hi {{name}} - following up on the Mojave relay plan for those dev-only Nuka shipments we talked about.',
    receivedBody:
      'I am out of office and will return on 2026-05-20 after a caravan run near Vault 101. Please reconnect then.',
  },
  {
    key: 'ooo_due',
    mailboxDisplayName: 'Preston Garvey - Minute Desk',
    mailboxLocalBase: 'minute-desk',
    leadName: 'Courier Six',
    firstName: 'Courier',
    lastName: 'Six',
    companyName: 'Mojave Express (test)',
    subject: 'Re: Ranger station resupply',
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
