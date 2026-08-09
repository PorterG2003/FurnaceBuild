/**
 * Email utilities: body parsing (strip quoted replies, signatures, HTML).
 */
export {
  stripHtml,
  parseEmailBody,
  getDisplayBody,
  type ParseEmailBodyOptions,
  type ParsedEmailBody,
} from './parse-body.js';

export {
  sanitizeEmailBody,
  hasResidualEncodingArtifacts,
  type SanitizeEmailBodyOptions,
} from './sanitize-body.js';

export {
  stripScriptsFromEmailHtml,
  stripUnresolvableCidImages,
  sanitizeEmailHtmlForForwardEmbed,
  plainTextEmailBodyToForwardHtml,
} from './forward-embed.js';
export {
  normalizeEmailHtmlForDarkMode,
  MAILBOX_RENDER_BACKGROUND,
  MAILBOX_RENDER_TEXT_COLOR,
  MAILBOX_RENDER_LINK_COLOR,
} from './normalize-render-html.js';

export { mergeTemplate, extractVariableKeys, extractMalformedVariables, hasMissingValues, type LeadLike } from './mergeTemplate.js';
export { processSpintax, type ProcessSpintaxOptions } from './processSpintax.js';
export { getLeadVariables, STANDARD_MERGE_FIELD_KEYS, type LeadVariable } from './leadVariables.js';
export { stripSignatureStyles } from './strip-signature-styles.js';
export {
  canonicalizeEmailContentForSave,
  canonicalizeEmailHtml,
  convertHtmlToRichTextSeed,
  extractBodyFragmentFromHtml,
  isFullHtmlDocument,
  mergeHtmlEmailWithSignature,
  seedHtmlModeFromRichText,
  type CanonicalEmailSaveInput,
  type CanonicalEmailSaveResult,
  type CanonicalizeEmailHtmlOptions,
  type CanonicalizeEmailHtmlResult,
  type EmailEditorMode,
  type EmailHtmlDocumentKind,
} from './emailHtmlMode.js';

export {
  buildCampaignEmailContent,
  hasMeaningfulEmailBody,
  htmlToFragment,
  mergeInboxComposeHtml,
  selectCampaignBodySource,
  type BuildCampaignEmailContentConfig,
  type BuildCampaignEmailContentResult,
  type BuildCampaignEmailContentOptions,
  type MergeInboxComposeHtmlResult,
} from './buildCampaignEmailContent.js';

export {
  isThreadContinuingSubject,
  normalizeStoredEmailSubject,
  resolveCampaignFollowUpSubject,
  type ResolveCampaignFollowUpSubjectParams,
} from './followUpSubject.js';

export {
  DEFAULT_MESSAGE_ID_DOMAIN,
  DEFAULT_REFERENCES_MAX_BYTES,
  buildReferencesFromAncestorIds,
  buildReplyThreadingHeaders,
  buildStableSubmittedMessageId,
  capReferenceChain,
  formatMessageId,
  formatReferencesHeader,
  normalizeMessageId,
  normalizeThreadTopic,
  parseMessageIds,
  pickWireMessageId,
  type BuildReplyThreadingHeadersInput,
  type ReplyThreadingHeaders,
} from './threadHeaders.js';

export {
  NO_SUBJECT_DISPLAY,
  buildForwardDefaultSubject,
  buildReplyDefaultSubject,
  buildThreadTimeline,
  buildTimelineFromRows,
  containsUnresolvedTemplate,
  isNoSubjectPlaceholder,
  newestEpochEntries,
  resolveDeliveredSubject,
  resolveOutboundThreading,
  sentJobToTimelineInput,
  threadMessageToTimelineInput,
  type BuildTimelineFromRowsInput,
  type ComposerSubjectInput,
  type OutboundThreadingContext,
  type ResolveDeliveredSubjectInput,
  type ResolveOutboundThreadingInput,
  type SentJobRow,
  type ThreadMessageDirection,
  type ThreadMessageRow,
  type ThreadTimelineEntry,
  type ThreadTimelineInput,
  type ThreadingDecision,
} from './threading/index.js';

export {
  generateEmailVariantId,
  labelForVariantIndex,
  normalizeLegacyEmailNodeData,
  sortVariantsForRoundRobin,
  activeVariantsSorted,
  LEGACY_EMAIL_VARIANT_ID,
  type EmailNodeVariant,
} from './emailNodeVariants.js';
