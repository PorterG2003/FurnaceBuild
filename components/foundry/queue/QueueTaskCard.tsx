import { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { postReviewTaskResolve } from '@/lib/foundry/registry-client';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';
import { reviewTaskTitle } from './queueLabels';
import { SourceLinkReviewQueueSection } from './SourceLinkReviewQueueSection';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payloadCompanyId(payload: Record<string, unknown>): string | null {
  const c = payload.company_id;
  return typeof c === 'string' && UUID_RE.test(c) ? c : null;
}

function payloadStateEntityId(payload: Record<string, unknown>): string | null {
  const c = payload.state_entity_id;
  return typeof c === 'string' && c.length > 0 ? c : null;
}

function taskWhyLine(taskType: string): string {
  switch (taskType) {
    case 'source_link_review':
      return 'We could not safely pick a company for this row—choose the right company so the rest of the pipeline can trust the link.';
    case 'entity_match_review':
      return 'Registry name and company name did not line up clearly—promote if it is the same business, or reject to try again.';
    case 'company_dedupe':
      return 'We may have more than one record for the same business—an operator should merge or pick the canonical one.';
    case 'parse_failure':
      return 'Something could not be read automatically—fix or override so this row is not stuck.';
    default:
      return 'This task needs a manual review before the batch can be considered complete.';
  }
}

export function QueueTaskCard({
  task,
  onResolved,
  onError,
}: {
  task: ReviewTaskRow;
  onResolved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const p = task.payload ?? {};
  const hintCompanyId = payloadCompanyId(p);
  const hintEntityId = payloadStateEntityId(p);

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
      <Text className="text-white font-instrument-semibold text-sm">{reviewTaskTitle(task.task_type)}</Text>
      <Text className="text-gray-500 font-instrument text-xs mt-1 leading-5">{taskWhyLine(task.task_type)}</Text>
      <Text className="text-gray-500 font-instrument text-xs mt-1">
        {task.entity_type} · {task.id}
      </Text>
      <Text className="text-gray-600 font-mono text-[10px] mt-1">Status: {task.status}</Text>

      {hintCompanyId ? (
        <Button
          variant="link"
          size="xs"
          className="self-start px-0 mt-2"
          onPress={() => router.push(`/foundry/companies/${hintCompanyId}`)}
        >
          Open company
        </Button>
      ) : null}

      {task.task_type === 'source_link_review' ? (
        <SourceLinkReviewQueueSection task={task} onResolved={onResolved} onError={onError} />
      ) : null}

      {task.task_type === 'entity_match_review' ? (
        <View className="mt-2">
          {hintEntityId ? (
            <Text className="text-gray-500 font-instrument text-[10px] mb-2">State entity hint: {hintEntityId}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                onError('');
                try {
                  await postReviewTaskResolve(task.id, {
                    chosen_match_action: 'promote',
                    resolution: { via: 'foundry_ui' },
                  });
                  onResolved('Promoted');
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Promote
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                onError('');
                try {
                  await postReviewTaskResolve(task.id, {
                    chosen_match_action: 'reject',
                    resolution: { via: 'foundry_ui' },
                  });
                  onResolved('Rejected');
                } catch (e) {
                  onError(e instanceof Error ? e.message : 'Failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reject match
            </Button>
          </View>
        </View>
      ) : null}

      {task.task_type !== 'source_link_review' && task.task_type !== 'entity_match_review' ? (
        <Text className="text-gray-500 font-instrument text-xs mt-2">No actions in UI for this task type yet.</Text>
      ) : null}
    </View>
  );
}
