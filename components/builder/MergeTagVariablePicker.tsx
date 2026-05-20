import { useMemo, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { Select } from '@/components/ui/forms';
import type { LeadVariable } from '@/lib/email/leadVariables';

export interface MergeTagVariablePickerProps {
  variables: LeadVariable[];
  onSelect: (token: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  listMaxHeight?: number;
  dropdownMinWidth?: number;
}

/**
 * Searchable merge-tag picker used by email and data-sender builder editors.
 * Callers own insertion semantics (append, caret insert, rich editor, etc.).
 */
export function MergeTagVariablePicker({
  variables,
  onSelect,
  placeholder = 'Variables',
  searchPlaceholder = 'Search variables…',
  listMaxHeight = 320,
  dropdownMinWidth = 260,
}: MergeTagVariablePickerProps) {
  const [variableSearch, setVariableSearch] = useState('');

  const filteredVariables = useMemo(() => {
    if (!variableSearch.trim()) return variables;
    const q = variableSearch.trim().toLowerCase();
    return variables.filter(
      (v) =>
        v.token.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
    );
  }, [variables, variableSearch]);

  return (
    <Select<LeadVariable>
      items={filteredVariables}
      getItemId={(v) => v.token}
      getItemLabel={(v) => ({ primary: v.token, secondary: v.description })}
      value={null}
      onChange={(_id, item) => {
        if (item) onSelect(item.token);
      }}
      searchable
      onSearchChange={setVariableSearch}
      searchValue={variableSearch}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={(hasSearch) => (hasSearch ? 'No matching variables.' : 'No variables.')}
      listMaxHeight={listMaxHeight}
      noMargin
      size="compact"
      dropdownMinWidth={dropdownMinWidth}
      renderTrigger={({ open, onPress }) => (
        <TouchableOpacity
          onPress={onPress}
          style={{
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: open ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.16)',
            backgroundColor: open ? 'rgba(243,68,13,0.2)' : 'rgba(255,255,255,0.08)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CodeBracketIcon size={18} color={open ? '#F3440D' : '#FFFFFF'} />
        </TouchableOpacity>
      )}
    />
  );
}
