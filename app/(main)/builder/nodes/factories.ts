import { Node } from '@xyflow/react';
import { generateEmailVariantId, labelForVariantIndex } from '@/lib/email/emailNodeVariants';

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
  const variantId = generateEmailVariantId();
  return {
    id: generateId(),
    type: 'email',
    data: {
      label: data?.label || 'Send Email',
      mailboxId: data?.mailboxId || '',
      variants: [
        {
          id: variantId,
          label: labelForVariantIndex(0),
          subject: data?.subject || '',
          template: data?.template || '',
          body_html: undefined,
          body_text: undefined,
          isActive: true,
          order: 0,
        },
      ],
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
    endpoint_url?: string;
    payload?: string;
    payload_template?: Record<string, unknown>;
    on_failure?: 'continue' | 'stop';
  }
): Node {
  const endpoint = data?.endpoint_url || data?.endpoint || '';
  return {
    id: generateId(),
    type: 'dataSender',
    data: {
      label: data?.label || 'Data Sender',
      endpoint,
      endpoint_url: endpoint,
      payload: data?.payload || '',
      payload_template: data?.payload_template || {},
      on_failure: data?.on_failure || 'continue',
    },
    position,
  };
}

