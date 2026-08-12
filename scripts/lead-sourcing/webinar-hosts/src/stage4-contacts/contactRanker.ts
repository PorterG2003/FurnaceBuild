import type { ApolloPerson } from '../stage3-enrich/apolloClient.js';
import type { ContactTiersConfig } from '../lib/config.js';
import { pickContactSlots, type ContactSlot, type TierCandidate } from './contactTier.js';

export type { ContactSlot };

export function rankContacts(
  people: ApolloPerson[],
  limit: number,
  contactTiers: ContactTiersConfig,
  options: { posterId?: string; posterTitle?: string } = {},
): { people: ApolloPerson[]; slots: ContactSlot[] } {
  const withEmail = people.filter((person) => person.email?.includes('@'));
  const candidates: TierCandidate[] = withEmail.map((person) => ({
    id: person.id,
    title: person.title,
    has_email: true,
  }));

  const slots = pickContactSlots(candidates, limit, contactTiers, {
    posterId: options.posterId,
    posterTitle: options.posterTitle,
  });

  const byId = new Map(withEmail.filter((p) => p.id).map((p) => [p.id!, p]));
  const ordered = slots.map((slot) => byId.get(slot.id)).filter(Boolean) as ApolloPerson[];

  return { people: ordered, slots };
}
