import React, { useMemo, useState } from 'react';
import { Text, View, Platform, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { EllipsisHorizontalIcon } from 'react-native-heroicons/outline';
import {
  sanitizeEmailBody,
  hasResidualEncodingArtifacts,
  normalizeEmailHtmlForDarkMode,
  MAILBOX_RENDER_TEXT_COLOR,
  MAILBOX_RENDER_LINK_COLOR,
} from '@/lib/email/index';

/** Strip script tags from HTML for safe rendering. */
function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

function stripHtmlForHeuristics(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
}

function stripUnresolvableCidImages(html: string): { html: string; removedCount: number } {
  const cidImgPattern = /<img\b[^>]*\bsrc\s*=\s*['"]?cid:[^'">\s]+['"]?[^>]*>/gi;
  const matches = html.match(cidImgPattern) ?? [];
  if (matches.length === 0) return { html, removedCount: 0 };
  return {
    html: html.replace(cidImgPattern, ''),
    removedCount: matches.length,
  };
}

function ExpandThreadButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="self-start mt-2 min-w-6 px-2 py-1 items-center justify-center rounded-full"
      style={{ backgroundColor: 'rgba(107, 114, 128, 0.18)' }}
      accessibilityRole="button"
      accessibilityLabel="Show full message thread"
    >
      <EllipsisHorizontalIcon size={13} color="#D1D5DB" />
    </Pressable>
  );
}

/** Renders message body as plain text or HTML (with images) when body_html is present. */
export function MessageBody({
  bodyHtml,
  bodyText,
  displayText,
}: {
  bodyHtml?: string | null;
  bodyText?: string | null;
  displayText: string;
}) {
  const rawHtml = bodyHtml ?? null;
  const hasHtml = !!rawHtml && rawHtml.trim().length > 0;
  const [showFullThread, setShowFullThread] = useState(false);
  const cleanDisplayText = sanitizeEmailBody(displayText, { format: 'text' });
  const fullTextSource = bodyText ?? bodyHtml ?? '';
  const fullText = sanitizeEmailBody(fullTextSource, { format: bodyText ? 'text' : 'html' });
  const safeHtml = hasHtml
    ? stripScripts(
        sanitizeEmailBody(
          sanitizeEmailBody(rawHtml!, { format: 'html' }),
          { format: 'html' }
        )
      )
    : '';
  const hasMeaningfulHtmlMarkup =
    hasHtml && /<(table|img|a|blockquote|ul|ol|li|p|div|span|style|br|h[1-6])\b/i.test(safeHtml);
  const htmlTextOnly = hasHtml ? stripHtmlForHeuristics(safeHtml) : '';
  const shouldFallbackToText =
    hasHtml &&
    !hasMeaningfulHtmlMarkup &&
    hasResidualEncodingArtifacts(htmlTextOnly) &&
    cleanDisplayText.length > 0;
  const safeHtmlForRender = normalizeEmailHtmlForDarkMode(stripUnresolvableCidImages(safeHtml).html);
  const hasCollapsedThread = useMemo(() => {
    if (!fullText) return false;
    if (fullText.length <= cleanDisplayText.length) return false;
    if (!cleanDisplayText) return false;
    return fullText.includes('On ') || fullText.includes('\n>') || fullText.includes('wrote:');
  }, [fullText, cleanDisplayText]);
  const shouldShowCollapsedHtmlPreview =
    hasHtml &&
    !shouldFallbackToText &&
    hasCollapsedThread &&
    !showFullThread;

  if (hasHtml && !shouldFallbackToText && Platform.OS === 'web') {
    if (shouldShowCollapsedHtmlPreview) {
      return (
        <View>
          <Text className="text-gray-300 font-instrument text-sm leading-6 text-left">
            {cleanDisplayText || '(No content)'}
          </Text>
          <ExpandThreadButton onPress={() => setShowFullThread(true)} />
        </View>
      );
    }
    const wrapped = `<div>${safeHtmlForRender}</div>`;
    return React.createElement('div', {
      className: 'message-body-html',
      dangerouslySetInnerHTML: { __html: wrapped },
    });
  }

  if (hasHtml && !shouldFallbackToText && Platform.OS !== 'web') {
    if (shouldShowCollapsedHtmlPreview) {
      return (
        <View>
          <Text className="text-gray-300 font-instrument text-sm leading-6 text-left">
            {cleanDisplayText || '(No content)'}
          </Text>
          <ExpandThreadButton onPress={() => setShowFullThread(true)} />
        </View>
      );
    }
    const wrapped = `
      <!DOCTYPE html>
      <html>
        <head><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
        <body style="margin:0;padding:0;color:${MAILBOX_RENDER_TEXT_COLOR};font-size:14px;line-height:1.6;background:transparent;">
          <div>${safeHtmlForRender}</div>
          <style>img{max-width:100%;height:auto;border-radius:8px;display:block;margin:0.5em 0;}a,a *{color:${MAILBOX_RENDER_LINK_COLOR} !important;}body,body *{background-color:transparent !important;}</style>
        </body>
      </html>
    `;
    return (
      <WebView
        source={{ html: wrapped }}
        scrollEnabled={false}
        style={{ minHeight: 40, backgroundColor: 'transparent' }}
        originWhitelist={['*']}
      />
    );
  }

  const textToRender = showFullThread && hasCollapsedThread ? fullText : cleanDisplayText;

  return (
    <View>
      <Text className="text-gray-300 font-instrument text-sm leading-6 text-left">
        {textToRender || '(No content)'}
      </Text>
      {hasCollapsedThread && !showFullThread ? (
        <ExpandThreadButton onPress={() => setShowFullThread(true)} />
      ) : null}
    </View>
  );
}
