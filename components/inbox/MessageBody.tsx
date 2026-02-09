import React from 'react';
import { Text, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

/** Strip script tags from HTML for safe rendering. */
function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
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

  if (hasHtml && Platform.OS === 'web') {
    const safe = stripScripts(rawHtml!);
    const wrapped = `<div>${safe}</div>`;
    return React.createElement('div', {
      className: 'message-body-html',
      dangerouslySetInnerHTML: { __html: wrapped },
    });
  }

  if (hasHtml && Platform.OS !== 'web') {
    const safe = stripScripts(rawHtml!);
    const wrapped = `
      <!DOCTYPE html>
      <html>
        <head><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
        <body style="margin:0;padding:0;color:#D1D5DB;font-size:14px;line-height:1.6;background:transparent;">
          <div>${safe}</div>
          <style>img{max-width:100%;height:auto;border-radius:8px;display:block;margin:0.5em 0;}a{color:#F3440D;}</style>
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

  return (
    <Text className="text-gray-300 font-instrument text-sm leading-6 text-left">
      {displayText || '(No content)'}
    </Text>
  );
}
