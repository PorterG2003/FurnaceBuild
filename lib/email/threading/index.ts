export type {
  OutboundThreadingContext,
  ThreadMessageDirection,
  ThreadTimelineEntry,
  ThreadTimelineInput,
  ThreadingDecision,
} from './types.js';

export { buildThreadTimeline, newestEpochEntries } from './timeline.js';

export {
  buildTimelineFromRows,
  sentJobToTimelineInput,
  threadMessageToTimelineInput,
  type BuildTimelineFromRowsInput,
  type SentJobRow,
  type ThreadMessageRow,
} from './fromRows.js';

export {
  resolveOutboundThreading,
  type ResolveOutboundThreadingInput,
} from './resolveOutboundThreading.js';

export {
  NO_SUBJECT_DISPLAY,
  buildForwardDefaultSubject,
  buildReplyDefaultSubject,
  containsUnresolvedTemplate,
  isNoSubjectPlaceholder,
  resolveDeliveredSubject,
  type ComposerSubjectInput,
  type ResolveDeliveredSubjectInput,
} from './subject.js';
