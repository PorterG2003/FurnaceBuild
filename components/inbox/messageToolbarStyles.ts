import {
  OPEN_CONVERSATION_ACTION_BG,
  OPEN_CONVERSATION_ACTION_BORDER,
  OPEN_CONVERSATION_ACTION_TEXT,
  OPEN_CONVERSATION_COLOR,
} from './inboxConstants';

export type MessageToolbarActionTone = 'default' | 'destructive' | 'open' | 'ooo' | 'replace';

export const MESSAGE_TOOLBAR_INLINE_ACTION_WIDTH = 152;

const TONE_STYLES: Record<
  MessageToolbarActionTone,
  {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    iconColor: string;
  }
> = {
  default: {
    backgroundColor: '#FFFFFF0D',
    borderColor: '#FFFFFF4D',
    textColor: '#FFFFFF',
    iconColor: '#9CA3AF',
  },
  destructive: {
    backgroundColor: 'rgba(185, 28, 28, 0.15)',
    borderColor: 'rgba(185, 28, 28, 0.5)',
    textColor: '#FCA5A5',
    iconColor: '#F87171',
  },
  open: {
    backgroundColor: OPEN_CONVERSATION_ACTION_BG,
    borderColor: OPEN_CONVERSATION_ACTION_BORDER,
    textColor: OPEN_CONVERSATION_ACTION_TEXT,
    iconColor: OPEN_CONVERSATION_COLOR,
  },
  ooo: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
    textColor: '#BFDBFE',
    iconColor: '#93C5FD',
  },
  replace: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
    textColor: '#FDBA74',
    iconColor: '#FDBA74',
  },
};

export function getMessageToolbarToneColors(tone: MessageToolbarActionTone = 'default') {
  return TONE_STYLES[tone];
}
