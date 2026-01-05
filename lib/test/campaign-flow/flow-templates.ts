import type { FlowTemplate } from './types';

/**
 * Create a flow template structure compatible with React Flow
 * Returns nodes and edges for the given template type
 */
export function createFlowTemplate(template: FlowTemplate): {
  nodes: any[];
  edges: any[];
} {
  switch (template) {
    case 'simple-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: { label: 'Email 1', subject: 'Welcome Email', body: 'Welcome to our campaign!' },
          },
        ],
        edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
      };

    case 'email-wait-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: { label: 'Email 1', subject: 'First Email', body: 'First email in sequence' },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: { label: 'Wait 2 Min', duration: 120 },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 600, y: 0 },
            data: { label: 'Email 2 (Test)', subject: 'Follow-up Email', body: 'Follow-up email' },
          },
        ],
        edges: [
          { id: 'e1', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3', source: 'waitTime-1', target: 'email-2' },
        ],
      };

    case 'email-wait-wait-email':
      return {
        nodes: [
          {
            id: 'leadSource-1',
            type: 'leadSource',
            position: { x: 0, y: 0 },
            data: { label: 'Lead Source' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 200, y: 0 },
            data: { label: 'Email 1', subject: 'First Email', body: 'First email in sequence' },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: { label: 'Wait 3 Min', duration: 180 },
          },
          {
            id: 'waitTime-2',
            type: 'waitTime',
            position: { x: 600, y: 0 },
            data: { label: 'Wait 2 Min', duration: 120 },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 800, y: 0 },
            data: { label: 'Email 2 (Test)', subject: 'Follow-up Email', body: 'Follow-up email' },
          },
        ],
        edges: [
          { id: 'e1', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3', source: 'waitTime-1', target: 'waitTime-2' },
          { id: 'e4', source: 'waitTime-2', target: 'email-2' },
        ],
      };

    default:
      throw new Error(`Unknown flow template: ${template}`);
  }
}

