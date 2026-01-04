import type { FlowTemplate } from './types';

/**
 * Creates flow data structure for different templates
 * 
 * NOTE: These are simplified test templates for testing the scheduler worker.
 * Production flows are created via the flow builder UI and may have different structures.
 * The database trigger `sync_campaign_nodes()` will automatically sync these to the `nodes` table.
 */
export function createFlowTemplate(template: FlowTemplate): { nodes: any[]; edges: any[] } {
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
            data: {
              label: 'Initial Email',
              subject: 'Welcome to Our Campaign',
              body: 'Hello {{name}},\n\nWelcome to our campaign!',
            },
          },
        ],
        edges: [{ id: 'e1-2', source: 'leadSource-1', target: 'email-1' }],
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
            data: {
              label: 'Initial Email',
              subject: 'Welcome Email',
              body: 'Hello {{name}},\n\nThis is the first email.',
            },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: {
              label: 'Wait 2 Minutes (Test)',
              duration: 2,
              unit: 'minutes',
              wait_duration_seconds: 120, // 2 minutes in seconds (for testing)
            },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 600, y: 0 },
            data: {
              label: 'Follow-up Email',
              subject: 'Follow-up Email',
              body: 'Hello {{name}},\n\nThis is a follow-up email after 2 minutes.',
            },
          },
        ],
        edges: [
          { id: 'e1-2', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2-3', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3-4', source: 'waitTime-1', target: 'email-2' },
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
            data: {
              label: 'Email 1',
              subject: 'First Email',
              body: 'Hello {{name}},\n\nFirst email.',
            },
          },
          {
            id: 'waitTime-1',
            type: 'waitTime',
            position: { x: 400, y: 0 },
            data: {
              label: 'Wait 3 Minutes (Test)',
              duration: 3,
              unit: 'minutes',
              wait_duration_seconds: 180, // 3 minutes in seconds (for testing)
            },
          },
          {
            id: 'waitTime-2',
            type: 'waitTime',
            position: { x: 600, y: 0 },
            data: {
              label: 'Wait 2 Minutes (Test)',
              duration: 2,
              unit: 'minutes',
              wait_duration_seconds: 120, // 2 minutes in seconds (for testing)
            },
          },
          {
            id: 'email-2',
            type: 'email',
            position: { x: 800, y: 0 },
            data: {
              label: 'Final Email',
              subject: 'Final Email',
              body: 'Hello {{name}},\n\nThis is the final email after multiple waits.',
            },
          },
        ],
        edges: [
          { id: 'e1-2', source: 'leadSource-1', target: 'email-1' },
          { id: 'e2-3', source: 'email-1', target: 'waitTime-1' },
          { id: 'e3-4', source: 'waitTime-1', target: 'waitTime-2' },
          { id: 'e4-5', source: 'waitTime-2', target: 'email-2' },
        ],
      };

    default:
      return { nodes: [], edges: [] };
  }
}

