import React from 'react';
import { Text, View } from 'react-native';

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    const text = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return (
        <Text key={`${keyPrefix}-${index}`} className="font-instrument-semibold text-gray-100">
          {boldMatch[1]}
        </Text>
      );
    }

    return (
      <Text key={`${keyPrefix}-${index}`} className="font-instrument text-gray-300">
        {part}
      </Text>
    );
  });
}

export function PlatformTermsMarkdown({
  markdown,
}: {
  markdown: string;
}) {
  const blocks = parseMarkdown(markdown);

  return (
    <View className="gap-4">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className =
            block.level === 1
              ? 'text-2xl font-instrument-semibold text-white'
              : block.level === 2
                ? 'text-lg font-instrument-semibold text-white'
                : 'text-base font-instrument-semibold text-white';
          return (
            <Text key={`heading-${index}`} className={className}>
              {block.text}
            </Text>
          );
        }

        if (block.type === 'list') {
          return (
            <View key={`list-${index}`} className="gap-2">
              {block.items.map((item, itemIndex) => (
                <View key={`list-item-${index}-${itemIndex}`} className="flex-row items-start gap-3">
                  <Text className="pt-0.5 font-instrument text-gray-400">{'\u2022'}</Text>
                  <Text className="flex-1 text-sm leading-6 text-gray-300">
                    {renderInline(item, `list-${index}-${itemIndex}`)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }

        return (
          <Text key={`paragraph-${index}`} className="text-sm leading-6 text-gray-300">
            {renderInline(block.text, `paragraph-${index}`)}
          </Text>
        );
      })}
    </View>
  );
}
