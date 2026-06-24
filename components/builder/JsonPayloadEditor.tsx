import { useMemo, useRef, useState } from 'react';
import { Text, type TextInput as TextInputType } from 'react-native';
import { MergeTagVariablePicker } from '@/components/builder/MergeTagVariablePicker';
import { CodeEditorShell } from '@/components/ui/forms/CodeEditorShell';
import {
  extractMalformedVariables,
  extractVariableKeys,
  type LeadVariable,
} from '@/lib/email/index';
import { insertTextAtSelection } from '@/lib/editor/insertTextAtSelection';
import { JsonSyntaxLayer } from '@/lib/editor/jsonSyntaxHighlight';

export interface JsonPayloadEditorProps {
  value: string;
  onChange: (value: string) => void;
  variables: LeadVariable[];
  minHeight: number;
  jsonError?: string | null;
}

export function JsonPayloadEditor({
  value,
  onChange,
  variables,
  minHeight,
  jsonError = null,
}: JsonPayloadEditorProps) {
  const inputRef = useRef<TextInputType>(null);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });

  const validKeys = useMemo(
    () => new Set(variables.map((v) => v.token.replace(/^\{\{|\}\}$/g, ''))),
    [variables]
  );
  const variableKeys = useMemo(() => extractVariableKeys(value), [value]);
  const unknownKeys = useMemo(
    () => variableKeys.filter((k) => !validKeys.has(k)),
    [variableKeys, validKeys]
  );
  const malformedVars = useMemo(() => extractMalformedVariables(value), [value]);

  const handleSelectVariable = (token: string) => {
    const next = insertTextAtSelection(value, selection, token);
    onChange(next.text);
    setSelection(next.selection);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const footer = jsonError ? (
    <Text className="text-xs text-red-300 mt-2">{jsonError}</Text>
  ) : malformedVars.length > 0 ? (
    <Text className="text-xs text-amber-300 mt-2">
      Malformed variable syntax: {malformedVars.join(', ')}
    </Text>
  ) : unknownKeys.length > 0 ? (
    <Text className="text-xs text-amber-300 mt-2">
      Unknown variables: {unknownKeys.map((k) => `{{${k}}}`).join(', ')}
    </Text>
  ) : (
    <Text className="text-xs text-gray-500 mt-2">
      Use Variables to insert merge tags at the cursor. Tags must be inside JSON string values.
    </Text>
  );

  return (
    <CodeEditorShell
      value={value}
      onChange={onChange}
      minHeight={minHeight}
      syntaxLayer={<JsonSyntaxLayer value={value} />}
      headerTitle="JSON Payload"
      headerRight={
        <>
          <Text
            className={`text-xs font-instrument ${jsonError ? 'text-red-300' : 'text-emerald-300'}`}
          >
            {jsonError ? 'Invalid JSON' : 'Valid JSON'}
          </Text>
          <MergeTagVariablePicker variables={variables} onSelect={handleSelectVariable} />
        </>
      }
      footer={footer}
      selection={selection}
      onSelectionChange={setSelection}
      inputRef={inputRef}
    />
  );
}
