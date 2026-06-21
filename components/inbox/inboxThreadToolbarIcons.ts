import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  TagIcon,
} from 'react-native-heroicons/outline';
import type { InboxThreadToolbarIconKey } from '@/lib/inbox';
import type { MessageToolbarMenuIcon } from './MessageToolbarActionButton';

export const INBOX_THREAD_TOOLBAR_ICON_MAP: Record<InboxThreadToolbarIconKey, MessageToolbarMenuIcon> = {
  arrowPath: ArrowPathIcon,
  calendarDays: CalendarDaysIcon,
  checkCircle: CheckCircleIcon,
  noSymbol: NoSymbolIcon,
  tag: TagIcon,
};
