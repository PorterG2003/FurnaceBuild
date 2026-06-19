import type { SmartHandlingActionId, SmartHandlingActionOption } from './smartHandling';

export {
  getSmartHandlingActionSuccessMessage,
  shouldAutoCloseConversationForAction,
  SMART_HANDLING_DISMISS_SUCCESS_MESSAGE,
} from './threadActionDefinitions';

export type { ThreadActionId, ThreadActionSource } from './threadActionDefinitions';

/** @deprecated Import from threadActionDefinitions directly. */
export type { SmartHandlingActionId, SmartHandlingActionOption };
