import {
  buildReferencesFromAncestorIds,
  resolveCampaignFollowUpSubject,
  type LeadLike,
  type OutboundThreadingContext,
  type ThreadTimelineEntry,
} from '../../../lib/email/dist/index.js';

/**
 * What the pre-resolver rule would have produced for a send.
 *
 * The legacy rule looked only at prior *outbound* jobs and always inherited the
 * oldest send's subject, which is why priority replies parented the last outbound
 * instead of the triggering inbound and why a new subject still dragged the old
 * thread's References along. Reproducing it lets the rollout measure exactly how
 * often and where the new resolver changes real behavior.
 */
export function describeLegacyThreadingDivergence(params: {
  timeline: ThreadTimelineEntry[];
  renderedSubject: string;
  lead: LeadLike;
  resolved: OutboundThreadingContext;
}): { subject?: { legacy: string; resolved: string }; inReplyTo?: { legacy: string | null; resolved: string | null } } | null {
  const priorOutbound = params.timeline.filter((entry) => entry.direction === 'sent');
  const legacyHeaders = buildReferencesFromAncestorIds(
    priorOutbound.map((entry) => entry.wireMessageId),
  );

  const oldest = priorOutbound[0] ?? null;
  const legacySubject = oldest
    ? resolveCampaignFollowUpSubject({
        currentSubject: params.renderedSubject,
        firstSentSubject: oldest.deliveredSubject,
        firstSubjectTemplate: oldest.subjectTemplate ?? '',
        lead: params.lead,
      })
    : params.renderedSubject;

  const legacyInReplyTo = legacyHeaders?.inReplyTo ?? null;

  const divergence: {
    subject?: { legacy: string; resolved: string };
    inReplyTo?: { legacy: string | null; resolved: string | null };
  } = {};

  if (legacySubject !== params.resolved.subject) {
    divergence.subject = { legacy: legacySubject, resolved: params.resolved.subject };
  }
  if (legacyInReplyTo !== params.resolved.inReplyTo) {
    divergence.inReplyTo = { legacy: legacyInReplyTo, resolved: params.resolved.inReplyTo };
  }

  return divergence.subject || divergence.inReplyTo ? divergence : null;
}
