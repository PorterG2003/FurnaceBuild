// Export all node modals
export { EmailNodeModal } from './EmailNodeModal';
export { LeadSourceNodeModal } from './LeadSourceNodeModal';
export { WaitTimeNodeModal } from './WaitTimeNodeModal';
export { AICategorizerNodeModal } from './AICategorizerNodeModal';
export { DataSenderNodeModal } from './DataSenderNodeModal';

// Import for registry
import { EmailNodeModal } from './EmailNodeModal';
import { LeadSourceNodeModal } from './LeadSourceNodeModal';
import { WaitTimeNodeModal } from './WaitTimeNodeModal';
import { AICategorizerNodeModal } from './AICategorizerNodeModal';
import { DataSenderNodeModal } from './DataSenderNodeModal';

// Modal registry mapping node types to their modal components
export const nodeModalRegistry: Record<string, React.ComponentType<any>> = {
  email: EmailNodeModal,
  leadSource: LeadSourceNodeModal,
  waitTime: WaitTimeNodeModal,
  aiCategorizer: AICategorizerNodeModal,
  dataSender: DataSenderNodeModal,
};

// Default export for Expo Router
export default function NodeModalsIndex() {
  return null;
}

