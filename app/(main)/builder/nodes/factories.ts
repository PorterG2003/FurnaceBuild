import { Node } from '@xyflow/react';

/**
 * Generate a unique ID for nodes
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Factory functions to create nodes
 */

export function createEmailNode(
  position: { x: number; y: number },
  data?: {
    label?: string;
    subject?: string;
    template?: string;
    mailboxId?: string;
  }
): Node {
  return {
    id: generateId(),
    type: 'email',
    data: {
      label: data?.label || 'Send Email',
      subject: data?.subject || '',
      template: data?.template || '',
      mailboxId: data?.mailboxId || '',
    },
    position,
  };
}

export function createLeadSourceNode(
  position: { x: number; y: number },
  data?: {
    label?: string;
    source?: string;
    bucketId?: string;
  }
): Node {
  return {
    id: data?.bucketId || generateId(),
    type: 'leadSource',
    data: {
      label: data?.label || 'Lead Bucket',
      source: data?.source || '',
      bucketId: data?.bucketId || generateId(),
      isRequired: true, // Mark as required/non-removable
    },
    position,
    deletable: false, // Prevent deletion
  };
}

export function createWaitTimeNode(
  position: { x: number; y: number },
  data?: {
    label?: string;
    duration?: string;
    unit?: 'minutes' | 'hours' | 'days';
  }
): Node {
  return {
    id: generateId(),
    type: 'waitTime',
    data: {
      label: data?.label || 'Wait Time',
      duration: data?.duration || '',
      unit: data?.unit || 'hours',
    },
    position,
  };
}

export function createAICategorizerNode(
  position: { x: number; y: number },
  data?: {
    label?: string;
    categories?: string[];
  }
): Node {
  return {
    id: generateId(),
    type: 'aiCategorizer',
    data: {
      label: data?.label || 'AI Categorizer',
      categories: data?.categories || [],
    },
    position,
  };
}

// Default export for Expo Router
export default function FactoriesIndex() {
  return null;
}

export function createDataSenderNode(
  position: { x: number; y: number },
  data?: {
    label?: string;
    endpoint?: string;
    payload?: string;
  }
): Node {
  return {
    id: generateId(),
    type: 'dataSender',
    data: {
      label: data?.label || 'Data Sender',
      endpoint: data?.endpoint || '',
      payload: data?.payload || '',
    },
    position,
  };
}

