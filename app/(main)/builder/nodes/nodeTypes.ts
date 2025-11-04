import { EmailNode } from './EmailNode';
import { LeadSourceNode } from './LeadSourceNode';
import { WaitTimeNode } from './WaitTimeNode';
import { AICategorizerNode } from './AICategorizerNode';
import { DataSenderNode } from './DataSenderNode';
import {
  EnvelopeIcon,
  ArchiveBoxIcon,
  ClockIcon,
  SparklesIcon,
  PaperAirplaneIcon,
} from 'react-native-heroicons/outline';

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

/**
 * Icon components for each node type
 */
export const nodeIcons = {
  email: EnvelopeIcon,
  leadSource: ArchiveBoxIcon,
  waitTime: ClockIcon,
  aiCategorizer: SparklesIcon,
  dataSender: PaperAirplaneIcon,
};

/**
 * Node type metadata for UI display
 */
export const nodeTypeMetadata = {
  email: {
    label: 'Send Email',
    category: 'actions',
    description: 'Send an email to recipients',
  },
  leadSource: {
    label: 'Lead Bucket',
    category: 'triggers',
    description: 'Captures leads from a source',
  },
  waitTime: {
    label: 'Wait Time',
    category: 'actions',
    description: 'Wait for a specified duration',
  },
  aiCategorizer: {
    label: 'AI Categorizer',
    category: 'logic',
    description: 'Categorize content using AI',
  },
  dataSender: {
    label: 'Data Sender',
    category: 'actions',
    description: 'Send data to an external endpoint',
  },
};

