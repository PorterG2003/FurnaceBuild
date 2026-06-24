import { Text } from 'react-native';
import {
  CODE_EDITOR_DEFAULT_TEXT_COLOR,
  CODE_EDITOR_TEXT_STYLE,
} from './codeEditorStyles';
import { tokenizeJsonSyntax } from './jsonSyntaxTokens';

export { getJsonTokenColor, tokenizeJsonSyntax, type JsonSyntaxPart } from './jsonSyntaxTokens';

export function JsonSyntaxLayer({ value }: { value: string }) {
  const parts = tokenizeJsonSyntax(value);

  return (
    <Text
      style={{
        color: CODE_EDITOR_DEFAULT_TEXT_COLOR,
        ...CODE_EDITOR_TEXT_STYLE,
      }}
    >
      {parts.map((part, index) => (
        <Text key={`${index}-${part.text.slice(0, 12)}`} style={{ color: part.color }}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}
