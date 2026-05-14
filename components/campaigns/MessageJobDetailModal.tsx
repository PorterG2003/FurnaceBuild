import type { ReactNode } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { format } from 'date-fns';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { MessageJob, MessageJobSummary } from './ScheduleTab';

function isFullDiagnosticsJob(job: MessageJob | MessageJobSummary): job is MessageJob {
  return 'message_data' in job;
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM d, yyyy h:mm:ss a');
  } catch {
    return iso;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function statusAccent(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'sent':
      return { fg: '#10b981', bg: '#10b98120' };
    case 'queued':
      return { fg: '#3b82f6', bg: '#3b82f620' };
    case 'reserved':
    case 'sending':
      return { fg: '#f59e0b', bg: '#f59e0b20' };
    case 'deferred':
      return { fg: '#a855f7', bg: '#a855f720' };
    case 'failed':
      return { fg: '#ef4444', bg: '#ef444420' };
    case 'cancelled':
    case 'blocked':
      return { fg: '#9ca3af', bg: '#6b728020' };
    default:
      return { fg: '#9ca3af', bg: '#6b728020' };
  }
}

function statusLabel(status: string): string {
  if (status === 'blocked') return 'Blocked';
  if (status === 'queued') return 'Queued';
  if (status === 'deferred') return 'Deferred';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.replace(/_/g, ' ');
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="mb-4 rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
      <View className="mb-3 border-b border-[#2A2A2A] pb-3">
        <Text className="font-instrument-semibold text-base text-white">{title}</Text>
        {subtitle ? (
          <Text className="mt-0.5 font-instrument text-xs text-gray-500">{subtitle}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <View className="mb-3 last:mb-0">
      <Text className="font-instrument text-[11px] uppercase tracking-wide text-gray-500">{label}</Text>
      <Text
        className={`mt-0.5 break-all font-instrument ${emphasize ? 'text-base text-white' : muted ? 'text-xs text-gray-500' : 'text-sm text-gray-200'}`}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

function IdGrid({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View className="gap-2">
      {rows.map(({ label, value }) => (
        <View key={label} className="flex-row gap-2">
          <Text className="w-[118px] shrink-0 pt-0.5 font-instrument text-[11px] text-gray-600">{label}</Text>
          <Text className="min-w-0 flex-1 break-all font-instrument text-xs leading-5 text-gray-400" selectable>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function JsonBlock({ title, json }: { title: string; json: string }) {
  return (
    <View className="mt-1">
      <Text className="mb-2 font-instrument text-[11px] uppercase tracking-wide text-gray-500">{title}</Text>
      <View className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] p-3">
        <ScrollView
          style={{ maxHeight: 200 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text className="break-all font-instrument text-xs leading-5 text-gray-300" selectable>
            {json}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

interface MessageJobDetailModalProps {
  visible: boolean;
  onClose: () => void;
  job: MessageJob | MessageJobSummary | null;
  variant: 'summary' | 'full';
}

export function MessageJobDetailModal({
  visible,
  onClose,
  job,
  variant,
}: MessageJobDetailModalProps) {
  const subtitle = job?.lead
    ? [job.lead.email, job.lead.name].filter(Boolean).join(' · ')
    : undefined;

  const accent = job ? statusAccent(job.status) : null;
  const fullJob = job && variant === 'full' && isFullDiagnosticsJob(job) ? job : null;
  const summaryReason = job ? formatReason(job.status_reason) : null;
  const showIssueSection = !!(
    job &&
    (job.error_message || job.status === 'failed' || job.status === 'blocked')
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={variant === 'full' ? 'Email job details' : 'Scheduled email'}
      description={subtitle}
      maxWidth="3xl"
      maxHeight={620}
    >
      {!job ? (
        <Text className="font-instrument text-sm text-gray-400">No job selected.</Text>
      ) : variant === 'summary' ? (
        <View>
          <Text className="mb-4 font-instrument text-xs text-gray-500">
            Snapshot from your schedule — refresh the tab to update.
          </Text>

          <Section title="Lead & mailbox" subtitle="Who this send is for">
            {job.lead?.email ? (
              <Field label="Lead" value={job.lead.email} emphasize />
            ) : (
              <Field label="Lead" value="Unknown" muted />
            )}
            {job.lead?.name ? <Field label="Name" value={job.lead.name} /> : null}
            <Field label="From mailbox" value={job.mailbox?.email_address ?? '—'} />
            {job.node?.node_type ? (
              <Field label="Step type" value={job.node.node_type} />
            ) : null}
          </Section>

          <Section title="Status" subtitle="Delivery state">
            <View className="mb-1 flex-row flex-wrap items-center gap-2">
              <View className="rounded-md px-2.5 py-1" style={{ backgroundColor: accent!.bg }}>
                <Text className="font-instrument-semibold text-sm uppercase" style={{ color: accent!.fg }}>
                  {statusLabel(job.status)}
                </Text>
              </View>
              {summaryReason ? (
                <Text className="min-w-0 flex-1 font-instrument text-sm text-gray-300" selectable>
                  {summaryReason}
                </Text>
              ) : null}
            </View>
          </Section>

          <Section title="Timing" subtitle="When this send is set to go out">
            <Field label="Scheduled send" value={formatTs(job.scheduled_at)} emphasize />
            <Field label="Reserved" value={formatTs(job.reserved_at)} />
            <Field label="Sent" value={formatTs(job.sent_at)} />
          </Section>

          <Section title="Slot" subtitle="Sending window for this campaign">
            <Field label="Retries attempted" value={String(job.retry_count ?? 0)} />
            {job.interval ? (
              <>
                <Field label="Interval window" value={formatTs(job.interval.interval_time)} />
                <Field label="Interval status" value={job.interval.status} />
              </>
            ) : (
              <Field label="Interval" value="None assigned" muted />
            )}
          </Section>

          {showIssueSection ? (
            <Section title="Problem" subtitle="What went wrong">
              {job.error_message ? (
                <View className="rounded-lg border border-red-900/35 bg-red-950/25 p-3">
                  <Text className="mb-1 font-instrument text-[11px] uppercase tracking-wide text-red-400/90">
                    Details
                  </Text>
                  <Text className="font-instrument text-sm leading-5 text-red-200/95" selectable>
                    {job.error_message}
                  </Text>
                </View>
              ) : (
                <Text className="font-instrument text-sm text-gray-500">
                  {summaryReason
                    ? `Reason: ${summaryReason}`
                    : 'No message stored — contact support if this job looks wrong.'}
                </Text>
              )}
            </Section>
          ) : null}
        </View>
      ) : fullJob ? (
        <View>
          <Text className="mb-4 font-instrument text-xs text-gray-500">
            Dev diagnostics — snapshot from the schedule list. Refresh the tab to update.
          </Text>

          {/* Who / where */}
          <Section title="Lead & routing" subtitle="Mailbox and flow context">
            {fullJob.lead?.email ? (
              <Field label="Lead" value={fullJob.lead.email} emphasize />
            ) : (
              <Field label="Lead" value="Unknown" muted />
            )}
            {fullJob.lead?.name ? <Field label="Name" value={fullJob.lead.name} /> : null}
            <Field label="Mailbox" value={fullJob.mailbox?.email_address ?? '—'} />
            <Field label="Node type" value={fullJob.node?.node_type || '—'} />
            <Field label="Message type" value={fullJob.message_type} />
          </Section>

          {/* Status */}
          <Section title="Status" subtitle="Current pipeline state">
            <View className="mb-3 flex-row flex-wrap items-center gap-2">
              <View className="rounded-md px-2.5 py-1" style={{ backgroundColor: accent!.bg }}>
                <Text className="font-instrument-semibold text-sm uppercase" style={{ color: accent!.fg }}>
                  {statusLabel(fullJob.status)}
                </Text>
              </View>
              {fullJob.status_reason ? (
                <Text className="min-w-0 flex-1 font-instrument text-sm text-gray-300" selectable>
                  {formatReason(fullJob.status_reason)}
                </Text>
              ) : null}
            </View>
          </Section>

          {/* Timeline */}
          <Section title="Timeline" subtitle="Send scheduling and record times">
            <Field label="Scheduled send" value={formatTs(fullJob.scheduled_at)} emphasize />
            <Field label="Reserved" value={formatTs(fullJob.reserved_at)} />
            <Field label="Sent" value={formatTs(fullJob.sent_at)} />
            <View className="mt-2 border-t border-[#2A2A2A] pt-3">
              <Field label="Row created" value={formatTs(fullJob.created_at)} muted />
              <Field label="Row updated" value={formatTs(fullJob.updated_at)} muted />
            </View>
          </Section>

          {/* Throttle & interval */}
          <Section title="Throttle & slot" subtitle="Mailbox limits and interval assignment">
            <Field
              label="Retries"
              value={`${fullJob.retry_count ?? 0} of ${fullJob.max_retries ?? '—'} max`}
            />
            <Field label="Send wait reason" value={fullJob.send_wait_reason ?? '—'} />
            <Field
              label="Throttle bypass next attempt"
              value={fullJob.throttle_bypass_next_attempt ? 'Yes' : 'No'}
            />
            {fullJob.interval ? (
              <>
                <View className="my-2 border-t border-[#2A2A2A]" />
                <Field label="Interval window" value={formatTs(fullJob.interval.interval_time)} />
                <Field label="Interval slot" value={fullJob.interval.status} />
              </>
            ) : (
              <Field label="Interval" value="None assigned" muted />
            )}
          </Section>

          {/* Failures / blocks */}
          {showIssueSection ? (
            <Section title="Failure details" subtitle="Provider or system error text">
              {fullJob.error_message ? (
                <View className="rounded-lg border border-red-900/35 bg-red-950/25 p-3">
                  <Text className="mb-1 font-instrument text-[11px] uppercase tracking-wide text-red-400/90">
                    Error message
                  </Text>
                  <Text className="font-instrument text-sm leading-5 text-red-200/95" selectable>
                    {fullJob.error_message}
                  </Text>
                </View>
              ) : (
                <Text className="font-instrument text-sm text-gray-500">
                  No error message on this row — see Status for the reason code.
                </Text>
              )}
            </Section>
          ) : null}

          {/* Payload */}
          <Section title="Payload" subtitle="Raw message and node configuration">
            <JsonBlock title="message_data" json={safeJson(fullJob.message_data)} />
            <JsonBlock title="node_data" json={safeJson(fullJob.node?.node_data)} />
          </Section>

          {/* IDs */}
          <Section title="Reference IDs" subtitle="For support and cross-system lookups">
            <IdGrid
              rows={[
                { label: 'Job', value: fullJob.id },
                { label: 'Enrollment', value: fullJob.enrollment_id },
                { label: 'Campaign', value: fullJob.campaign_id },
                { label: 'Lead', value: fullJob.lead_id },
                { label: 'Mailbox', value: fullJob.mailbox_id ?? '—' },
                { label: 'Node', value: fullJob.node_id ?? '—' },
                { label: 'Interval', value: fullJob.interval_id ?? '—' },
                { label: 'Variant', value: fullJob.variant_id ?? '—' },
                { label: 'Account', value: fullJob.account_id },
                {
                  label: 'Flow ver.',
                  value: fullJob.flow_version_number != null ? String(fullJob.flow_version_number) : '—',
                },
                { label: 'Provider msg', value: fullJob.provider_message_id ?? '—' },
                { label: 'SQS', value: fullJob.sqs_message_id ?? '—' },
              ]}
            />
          </Section>
        </View>
      ) : (
        <Text className="font-instrument text-sm text-gray-400">Unable to load diagnostics for this row.</Text>
      )}
    </BaseModal>
  );
}
