import { EmailNode } from './EmailNode';
import { LeadSourceNode } from './LeadSourceNode';
import { WaitTimeNode } from './WaitTimeNode';
import { AICategorizerNode } from './AICategorizerNode';
import { DataSenderNode } from './DataSenderNode';

// Re-export metadata for backward compatibility
export { nodeIcons, nodeTypeMetadata } from './nodeMetadata';

/**
 * Registry of all available node types
 * Maps node type names to their React components
 */
export const nodeTypes = {
  email: EmailNode,
  leadSource: LeadSourceNode,
  waitTime: WaitTimeNode,
  aiCategorizer: AICategorizerNode,
  dataSender: DataSenderNode,
};

// Default export for Expo Router
export default function NodeTypesIndex() {
  return null;
}

