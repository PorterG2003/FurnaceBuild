import type { Json } from '../../../../lib/supabase/types/database';
import { smokeEmailVariants, smokeFlowNodeLabels } from '../../theme/falloutCopy';

export function buildSmokeFlowData(variantA: string, variantB: string): Json {
  const labels = smokeFlowNodeLabels();
  const v = smokeEmailVariants();
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: labels.leadSource },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 200, y: 0 },
        data: {
          label: labels.email,
          variants: [
            {
              id: variantA,
              label: v.labelA,
              subject: v.subjectA,
              template: v.templateA,
              isActive: true,
              order: 0,
            },
            {
              id: variantB,
              label: v.labelB,
              subject: v.subjectB,
              template: v.templateB,
              isActive: true,
              order: 1,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  } as unknown as Json;
}

export function smokeSchedule(): Json {
  return {
    timezone: 'UTC',
    start_hour: 0,
    start_minute: 0,
    end_hour: 23,
    end_minute: 59,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
  } as unknown as Json;
}
