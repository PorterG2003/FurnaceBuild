import {
  enrichPeopleByIds,
  enrichPersonByName,
  type ApolloClientOptions,
  type ApolloPerson,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { enrichPersonWithWaterfallEmail } from './apolloWaterfall.js';
import {
  extractHeadlineOrgWithLlm,
  isWeakOrganizationHint,
  type LlmHeadlineOrgOptions,
} from './llmHeadlineOrg.js';
import { acceptPatternResult, guessEmailPatterns } from './patternGuess.js';
import { verifyEmailWithMillionVerifier, type MillionVerifierOptions } from './millionVerifier.js';
import { parseHeadlineHints, parseReactorName } from './nameParse.js';
import { createSchoolDomainResolver } from './resolveSchoolDomain.js';
import { isLikelySchoolDomain, normalizeDomain } from './schoolDomainQuality.js';
import type { TempWebhookInbox } from './tempWebhook.js';
import type { EnrichedUniqueRow, RetryPass } from './types.js';
import { isUsablePersonMatch } from './enrichPerson.js';

function hasEmail(person: ApolloPerson | null | undefined): boolean {
  return Boolean(person?.email?.includes('@'));
}

function applyPerson(
  row: EnrichedUniqueRow,
  person: ApolloPerson,
  matchMethod: EnrichedUniqueRow['match_method'],
  retryPass: RetryPass,
): EnrichedUniqueRow {
  const orgDomain = person.organization?.primary_domain
    ? normalizeDomain(person.organization.primary_domain)
    : '';
  const keepDomain =
    orgDomain && isLikelySchoolDomain(orgDomain, person.organization?.name || row.company_name)
      ? orgDomain
      : row.company_domain;

  return {
    ...row,
    email: person.email?.includes('@') ? person.email : '',
    first_name: person.first_name || row.first_name,
    last_name: person.last_name || row.last_name,
    title: person.title || row.title,
    company_name: person.organization?.name || row.company_name,
    company_domain: keepDomain || row.company_domain,
    apollo_person_id: person.id || row.apollo_person_id,
    enrichment_status: hasEmail(person) ? 'email_found' : 'matched_no_email',
    match_method: matchMethod,
    error: '',
    retry_pass: retryPass,
  };
}

async function revealIfNeeded(
  person: ApolloPerson,
  options: ApolloClientOptions,
): Promise<ApolloPerson> {
  if (hasEmail(person) || !person.id) return person;
  const enriched = await enrichPeopleByIds([person.id], options, person.organization?.id);
  return enriched[0] ?? person;
}

/**
 * Seed company_name / company_domain (and email when present) from an already-matched Apollo person id.
 */
async function seedFromApolloPerson(
  row: EnrichedUniqueRow,
  options: ApolloClientOptions,
): Promise<EnrichedUniqueRow> {
  if (!row.apollo_person_id?.trim()) return row;
  if (
    row.company_domain &&
    isLikelySchoolDomain(row.company_domain, row.company_name) &&
    row.email.includes('@')
  ) {
    return row;
  }

  try {
    const people = await enrichPeopleByIds([row.apollo_person_id], options);
    const person = people[0];
    if (!person) return row;

    const domain = person.organization?.primary_domain
      ? normalizeDomain(person.organization.primary_domain)
      : '';
    const orgName = person.organization?.name?.trim() || row.company_name;
    const next = { ...row };
    if (orgName) next.company_name = orgName;
    if (domain && isLikelySchoolDomain(domain, orgName || row.reactor_headline)) {
      next.company_domain = domain;
    }
    if (person.first_name && !next.first_name) next.first_name = person.first_name;
    if (person.last_name && !next.last_name) next.last_name = person.last_name;
    if (person.title && !next.title) next.title = person.title;
    if (person.email?.includes('@') && !next.email.includes('@')) {
      next.email = person.email;
      next.enrichment_status = 'email_found';
      next.match_method = 'domain_rematch';
      next.retry_pass = 'pass2_domain';
    }
    return next;
  } catch {
    return row;
  }
}

export type RetryNoEmailContext = {
  apolloOptions: ApolloClientOptions;
  mvOptions: MillionVerifierOptions;
  resolveDomain: ReturnType<typeof createSchoolDomainResolver>;
  /** When set, waterfall email runs after domain rematch. */
  waterfallInbox?: TempWebhookInbox;
  /** Skip domain rematch + pattern/MV (waterfall pass only). */
  waterfallOnly?: boolean;
  /** OpenRouter LLM headline→org extraction when regex parse misses. */
  llmOptions?: LlmHeadlineOrgOptions;
};

export type RetryNoEmailResult = {
  row: EnrichedUniqueRow;
  pass: RetryPass;
  changed: boolean;
};

/**
 * Domain-first retry for matched_no_email rows:
 * 1) Seed org/domain from Apollo person id
 * 2) Parse headline org (regex); LLM fallback when missing
 * 3) Resolve domain (Apollo org + Serper + quality)
 * 4) Name rematch with domain (sync reveal)
 * 5) Waterfall with domain (temp webhook) when enabled
 * 6) Pattern guess + MillionVerifier
 */
export async function retryNoEmailRow(
  input: EnrichedUniqueRow,
  ctx: RetryNoEmailContext,
): Promise<RetryNoEmailResult> {
  let row: EnrichedUniqueRow = { ...input, retry_pass: input.retry_pass ?? 'unchanged' };
  const parsed = parseReactorName(row.reactor_name || `${row.first_name} ${row.last_name}`);
  let hints = parseHeadlineHints(row.reactor_headline);
  const firstName = row.first_name || parsed.firstName;
  const lastName = row.last_name || parsed.lastName;

  // --- Seed from matched Apollo person ---
  row = await seedFromApolloPerson(row, ctx.apolloOptions);
  if (row.enrichment_status === 'email_found' && row.email.includes('@')) {
    return { row, pass: 'pass2_domain', changed: true };
  }

  // --- LLM org extract when regex missed or returned a weak org ---
  const needsLlmOrg =
    Boolean(ctx.llmOptions) &&
    !(row.company_domain && isLikelySchoolDomain(row.company_domain, row.company_name)) &&
    Boolean(row.reactor_headline?.trim()) &&
    isWeakOrganizationHint(hints.organizationName);

  if (needsLlmOrg && ctx.llmOptions) {
    try {
      const llmHints = await extractHeadlineOrgWithLlm(row.reactor_headline, ctx.llmOptions);
      if (llmHints.organizationName && !isWeakOrganizationHint(llmHints.organizationName)) {
        hints = {
          title: llmHints.title || hints.title,
          organizationName: llmHints.organizationName,
        };
      } else if (llmHints.title && !hints.title) {
        hints = { ...hints, title: llmHints.title };
      }
    } catch {
      // Continue with regex hints
    }
  }

  if (ctx.waterfallOnly) {
    // Waterfall-only: skip domain resolve / rematch / MV
    if (firstName && lastName && ctx.waterfallInbox) {
      try {
        const waterfall = await enrichPersonWithWaterfallEmail(
          {
            firstName,
            lastName,
            organizationName: hints.organizationName || row.company_name || undefined,
            title: hints.title || row.title || undefined,
            domain: row.company_domain || undefined,
          },
          ctx.waterfallInbox,
          ctx.apolloOptions,
        );
        if (waterfall.person && (waterfall.email || isUsablePersonMatch(waterfall.person))) {
          const person = waterfall.email
            ? { ...waterfall.person, email: waterfall.email }
            : waterfall.person;
          row = applyPerson(row, person, 'waterfall', 'pass1_waterfall');
          if (row.enrichment_status === 'email_found') {
            return { row, pass: 'pass1_waterfall', changed: true };
          }
        }
      } catch {
        // fall through
      }
    }
    return {
      row: {
        ...row,
        enrichment_status: row.email.includes('@') ? 'email_found' : 'matched_no_email',
        error: '',
        retry_pass: row.email.includes('@') ? 'pass1_waterfall' : 'unchanged',
      },
      pass: row.email.includes('@') ? 'pass1_waterfall' : 'unchanged',
      changed: row.email.includes('@'),
    };
  }

  // --- Resolve domain from headline org ---
  let orgHint = hints.organizationName || row.company_name;
  try {
    if (orgHint) {
      const resolved = await ctx.resolveDomain(orgHint);
      if (resolved) {
        row = {
          ...row,
          company_domain: resolved.domain || row.company_domain,
          company_name: resolved.organizationName || row.company_name,
        };
      }
    }
  } catch {
    // Continue without resolved domain
  }

  // Second LLM chance: regex org failed to resolve, try LLM for a better org name
  if (
    ctx.llmOptions &&
    !row.company_domain &&
    row.reactor_headline?.trim() &&
    !needsLlmOrg
  ) {
    try {
      const llmHints = await extractHeadlineOrgWithLlm(row.reactor_headline, ctx.llmOptions);
      if (
        llmHints.organizationName &&
        llmHints.organizationName.toLowerCase() !== (orgHint || '').toLowerCase()
      ) {
        hints = {
          title: llmHints.title || hints.title,
          organizationName: llmHints.organizationName,
        };
        orgHint = llmHints.organizationName;
        const resolved = await ctx.resolveDomain(orgHint);
        if (resolved) {
          row = {
            ...row,
            company_domain: resolved.domain || row.company_domain,
            company_name: resolved.organizationName || row.company_name,
          };
        }
      }
    } catch {
      // ignore
    }
  }

  const domain = row.company_domain || undefined;
  const companyName = row.company_name || orgHint || undefined;

  // --- Rematch with domain (cheap sync path) ---
  if (firstName && lastName && (domain || companyName || orgHint)) {
    try {
      let person = await enrichPersonByName(
        {
          firstName,
          lastName,
          organizationName: companyName || orgHint || undefined,
          title: hints.title || row.title || undefined,
          domain,
        },
        ctx.apolloOptions,
      );
      if (isUsablePersonMatch(person) && person) {
        person = await revealIfNeeded(person, ctx.apolloOptions);
        row = applyPerson(row, person, 'domain_rematch', 'pass2_domain');
        if (domain && !row.company_domain) row.company_domain = domain;
        if (companyName && !row.company_name) row.company_name = companyName;
        if (row.enrichment_status === 'email_found') {
          return { row, pass: 'pass2_domain', changed: true };
        }
      }
    } catch {
      // Continue to waterfall
    }
  }

  // --- Waterfall with domain ---
  if (firstName && lastName && ctx.waterfallInbox) {
    try {
      const waterfall = await enrichPersonWithWaterfallEmail(
        {
          firstName,
          lastName,
          organizationName: companyName || orgHint || undefined,
          title: hints.title || row.title || undefined,
          domain: row.company_domain || domain,
        },
        ctx.waterfallInbox,
        ctx.apolloOptions,
      );
      if (waterfall.person && (waterfall.email || isUsablePersonMatch(waterfall.person))) {
        const person = waterfall.email
          ? { ...waterfall.person, email: waterfall.email }
          : waterfall.person;
        row = applyPerson(row, person, 'waterfall', 'pass1_waterfall');
        if (row.enrichment_status === 'email_found') {
          return { row, pass: 'pass1_waterfall', changed: true };
        }
      }
    } catch {
      // Continue to pattern pass
    }
  }

  // --- Pattern guess + MillionVerifier ---
  if (row.company_domain && firstName && lastName) {
    try {
      const guesses = guessEmailPatterns(firstName, lastName, row.company_domain);
      for (const guess of guesses) {
        const verified = await verifyEmailWithMillionVerifier(guess.email, ctx.mvOptions);
        if (acceptPatternResult(guess.pattern, verified.result)) {
          row = {
            ...row,
            email: guess.email,
            first_name: firstName,
            last_name: lastName,
            enrichment_status: 'email_found',
            match_method: 'pattern_mv',
            error: '',
            retry_pass: 'pass3_pattern_mv',
          };
          return { row, pass: 'pass3_pattern_mv', changed: true };
        }
      }
    } catch (err) {
      row = {
        ...row,
        enrichment_status: 'error',
        error: err instanceof Error ? err.message : String(err),
        retry_pass: 'pass3_pattern_mv',
      };
      return { row, pass: 'pass3_pattern_mv', changed: true };
    }
  }

  return {
    row: {
      ...row,
      enrichment_status: row.email.includes('@') ? 'email_found' : 'matched_no_email',
      error: '',
      retry_pass: 'unchanged',
    },
    pass: 'unchanged',
    changed:
      row.company_domain !== input.company_domain ||
      row.company_name !== input.company_name ||
      row.apollo_person_id !== input.apollo_person_id,
  };
}
