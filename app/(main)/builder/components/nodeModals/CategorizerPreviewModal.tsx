import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { getAccessToken } from '@/lib/services/auth-token';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import outputs from '@/amplify_outputs.json';

/**
 * Read-only preview of how the campaign's existing replies are (manual mode)
 * or would be (AI mode) categorized. AI predictions come from the
 * categorizerPreview Amplify function, which uses the exact prompt/model the
 * scheduler uses. Never writes categories.
 */

const PREVIEW_THREAD_LIMIT = 20;
const SNIPPET_MAX = 180;

function getCategorizerPreviewUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_CATEGORIZER_PREVIEW_URL?.trim();
  if (fromEnv) return fromEnv;
  const custom = (outputs as { custom?: { categorizerPreviewUrl?: string } }).custom;
  return custom?.categorizerPreviewUrl?.trim();
}

interface RepliedThreadRow {
  id: string;
  subject: string | null;
  category: string | null;
  lastInboundSubject: string | null;
  lastInboundSnippet: string;
  lastInboundBodyText: string | null;
  lastInboundReceivedAt: string | null;
}

interface Prediction {
  category?: string;
  returnDate?: string | null;
  error?: string;
}

function htmlToSnippet(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSnippet(bodyText: string | null, bodyHtml: string | null): string {
  const raw = (bodyText && bodyText.trim()) || (bodyHtml ? htmlToSnippet(bodyHtml) : '');
  const oneLine = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > SNIPPET_MAX ? `${oneLine.slice(0, SNIPPET_MAX)}…` : oneLine;
}

function CategoryBadge({ category, hint }: { category: string; hint?: string | null }) {
  const color = getCategoryColor(category) ?? '#6B7280';
  return (
    <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: 160 }}>
      <View
        style={{
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderWidth: 1,
          borderColor: color,
          backgroundColor: `${color}22`,
        }}
      >
        <Text className="text-xs font-instrument-medium" style={{ color }}>
          {category}
        </Text>
      </View>
      {hint ? (
        <Text className="text-[10px] font-instrument text-gray-500 mt-1 text-right">{hint}</Text>
      ) : null}
    </View>
  );
}

export interface CategorizerPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  campaignId: string;
  /** Current state of the modal's AI toggle (may be unsaved). */
  useAi: boolean;
}

export function CategorizerPreviewModal({
  visible,
  onClose,
  campaignId,
  useAi,
}: CategorizerPreviewModalProps) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobileLayout = windowWidth < LAYOUT_BREAKPOINT;

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [threads, setThreads] = useState<RepliedThreadRow[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [predicting, setPredicting] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setThreads([]);
      setPredictions({});
      setPredictError(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      const { data: threadRows, error: threadsError } = await supabase
        .from('email_threads')
        .select('id, subject, category, last_message_at')
        .eq('campaign_id', campaignId)
        .eq('has_reply', true)
        .order('last_message_at', { ascending: false })
        .limit(PREVIEW_THREAD_LIMIT);

      if (cancelled) return;
      if (threadsError) {
        setLoadError(threadsError.message);
        setLoading(false);
        return;
      }

      const rows = threadRows ?? [];
      if (rows.length === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }

      const { data: messageRows, error: messagesError } = await supabase
        .from('email_messages')
        .select('thread_id, subject, body_text, body_html, received_at')
        .in('thread_id', rows.map((t) => t.id))
        .eq('direction', 'received')
        .order('received_at', { ascending: false });

      if (cancelled) return;
      if (messagesError) {
        setLoadError(messagesError.message);
        setLoading(false);
        return;
      }

      const latestByThread = new Map<string, NonNullable<typeof messageRows>[number]>();
      for (const m of messageRows ?? []) {
        if (m.thread_id && !latestByThread.has(m.thread_id)) {
          latestByThread.set(m.thread_id, m);
        }
      }

      setThreads(
        rows.map((t) => {
          const latest = latestByThread.get(t.id);
          return {
            id: t.id,
            subject: t.subject,
            category: t.category,
            lastInboundSubject: latest?.subject ?? null,
            lastInboundSnippet: toSnippet(latest?.body_text ?? null, latest?.body_html ?? null),
            lastInboundBodyText:
              latest?.body_text ?? (latest?.body_html ? htmlToSnippet(latest.body_html) : null),
            lastInboundReceivedAt: latest?.received_at ?? null,
          };
        }),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, campaignId]);

  const runAiPreview = useCallback(async () => {
    const url = getCategorizerPreviewUrl();
    if (!url) {
      setPredictError('Categorizer preview is not configured. Deploy the Amplify backend first.');
      return;
    }
    const replies = threads.filter((t) => t.lastInboundBodyText || t.lastInboundSubject);
    if (replies.length === 0) return;

    setPredicting(true);
    setPredictError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setPredictError('You must be signed in to run the preview.');
        return;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId,
          replies: replies.map((t) => ({
            threadId: t.id,
            subject: t.lastInboundSubject ?? t.subject,
            bodyText: t.lastInboundBodyText,
            receivedAt: t.lastInboundReceivedAt,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        predictions?: Array<{ threadId: string; category?: string; returnDate?: string | null; error?: string }>;
        error?: string;
      };
      if (!res.ok) {
        setPredictError(body.error || `Preview failed (HTTP ${res.status})`);
        return;
      }
      const next: Record<string, Prediction> = {};
      for (const p of body.predictions ?? []) {
        next[p.threadId] = { category: p.category, returnDate: p.returnDate, error: p.error };
      }
      setPredictions(next);
    } catch (err) {
      setPredictError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPredicting(false);
    }
  }, [threads, campaignId]);

  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
      <Button variant="secondary" onPress={onClose}>
        Close
      </Button>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Categorizer preview"
      description={
        useAi
          ? 'How the AI would categorize this campaign\u2019s existing replies with the current model. Nothing is saved.'
          : 'Current categories on this campaign\u2019s replied threads (set manually or by auto-reply detection).'
      }
      footer={footer}
      maxWidth="2xl"
      maxHeight={typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.85) : 700}
    >
      <View style={{ flex: 1, minHeight: isMobileLayout ? 320 : 0, gap: 12 }}>
        {useAi ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <Button onPress={() => void runAiPreview()} disabled={predicting || threads.length === 0}>
              {predicting ? 'Classifying…' : 'Run preview'}
            </Button>
            {predictError ? (
              <Text className="text-xs font-instrument text-red-400 flex-1" numberOfLines={2}>
                {predictError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator>
          {loading ? (
            <Text className="text-gray-500 text-sm font-instrument">Loading replies…</Text>
          ) : loadError ? (
            <Text className="text-red-400 text-sm font-instrument">{loadError}</Text>
          ) : threads.length === 0 ? (
            <Text className="text-gray-500 text-sm font-instrument">
              No replies yet. Once leads reply to this campaign, they&apos;ll show up here so you can
              check how they&apos;d be categorized.
            </Text>
          ) : (
            threads.map((t) => {
              const prediction = useAi ? predictions[t.id] : undefined;
              const category = useAi
                ? prediction?.category ?? null
                : t.category;
              const isAutoReply = category === 'Auto Reply';
              const hint = isAutoReply
                ? prediction?.returnDate
                  ? `Won\u2019t branch — resumes after ${prediction.returnDate}`
                  : 'Won\u2019t branch — waits for a real reply'
                : null;
              return (
                <View
                  key={t.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#2A2A2A',
                    backgroundColor: '#161616',
                    marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text className="text-white font-instrument-medium text-sm" numberOfLines={1}>
                      {t.lastInboundSubject || t.subject || '(no subject)'}
                    </Text>
                    <Text className="text-gray-500 font-instrument text-xs mt-1" numberOfLines={3}>
                      {t.lastInboundSnippet || '(no reply text)'}
                    </Text>
                  </View>
                  {category ? (
                    <CategoryBadge category={category} hint={hint} />
                  ) : prediction?.error ? (
                    <Text className="text-xs font-instrument text-red-400" style={{ maxWidth: 140 }}>
                      {prediction.error}
                    </Text>
                  ) : (
                    <Text className="text-xs font-instrument text-gray-500">
                      {useAi ? 'Not classified yet' : 'Uncategorized'}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </BaseModal>
  );
}

export default CategorizerPreviewModal;
