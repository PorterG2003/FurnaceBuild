import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { ChevronDownIcon, MagnifyingGlassIcon, CheckIcon } from 'react-native-heroicons/outline';
import type { RefObject } from 'react';
import type { AccountMembership } from '@/lib/supabase/services/accounts';

const LIST_MAX_HEIGHT = 280;
/** Reserve space for nav chrome above/below the panel (logo, nav items, trigger, Settings, Sign out). */
const PANEL_VERTICAL_RESERVE = 280;
const PANEL_BODY_MAX = 460;

function roleLabel(role: string): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'member') return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Shared content for workspace switcher: search, Current, Other workspaces. Used in nav popover and mobile sheet. */
export interface WorkspaceSwitcherContentProps {
  memberships: AccountMembership[];
  currentAccountId: string | null;
  onChange: (accountId: string) => void;
  listMaxHeight?: number;
  /** Optional ref for the search input (e.g. for focus when open in popover). */
  searchInputRef?: React.RefObject<TextInput | null>;
}

export function WorkspaceSwitcherContent({
  memberships,
  currentAccountId,
  onChange,
  listMaxHeight = LIST_MAX_HEIGHT,
  searchInputRef,
}: WorkspaceSwitcherContentProps) {
  const [search, setSearch] = useState('');
  const filteredMemberships = useMemo(() => {
    if (!search.trim()) return memberships;
    const q = search.trim().toLowerCase();
    return memberships.filter((m) => (m.account.name ?? '').toLowerCase().includes(q));
  }, [memberships, search]);
  const currentEntry = useMemo(
    () => memberships.find((m) => m.account.id === currentAccountId) ?? null,
    [memberships, currentAccountId],
  );
  const otherEntries = useMemo(
    () => filteredMemberships.filter((m) => m.account.id !== currentAccountId),
    [filteredMemberships, currentAccountId],
  );
  const hasSearch = search.trim().length > 0;

  return (
    <View style={{ padding: 10 }}>
      <Text
        className="text-gray-400 font-instrument-medium text-xs mb-2"
        style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
      >
        Switch workspace
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#FFFFFF0D',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#FFFFFF4D',
          paddingHorizontal: 10,
          paddingVertical: 8,
          marginBottom: 8,
        }}
      >
        <MagnifyingGlassIcon size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          ref={searchInputRef}
          value={search}
          onChangeText={setSearch}
          placeholder="Search workspaces…"
          placeholderTextColor="#666"
          style={{
            flex: 1,
            color: '#FFFFFF',
            fontSize: 14,
            fontFamily: 'Instrument Sans, system-ui, sans-serif',
            paddingVertical: 0,
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
        />
      </View>
      <ScrollView
        style={{ maxHeight: listMaxHeight }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {currentEntry && (
          <View style={{ marginBottom: 8 }}>
            <Text
              className="text-gray-400 font-instrument-medium text-xs mb-2"
              style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
            >
              Current
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 12,
                marginBottom: 6,
                backgroundColor: 'rgba(243, 68, 13, 0.14)',
                borderWidth: 1,
                borderColor: 'rgba(243, 68, 13, 0.4)',
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  className="text-white font-instrument-medium text-sm"
                  style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                  numberOfLines={1}
                >
                  {currentEntry.account.name ?? 'Unnamed'}
                </Text>
                <Text
                  className="text-gray-400 font-instrument text-xs mt-0.5"
                  style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                >
                  {roleLabel(currentEntry.membership.role)}
                </Text>
              </View>
              <CheckIcon size={18} color="#f85102" style={{ marginLeft: 8 }} />
            </View>
          </View>
        )}
        <View>
          <Text
            className="text-gray-400 font-instrument-medium text-xs mb-2"
            style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
          >
            Other workspaces
          </Text>
          {otherEntries.length === 0 ? (
            <Text
              className="text-gray-500 font-instrument text-sm py-4"
              style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
            >
              {hasSearch ? 'No matching workspaces.' : 'No other workspaces.'}
            </Text>
          ) : (
            otherEntries.map((m) => (
              <Pressable
                key={m.account.id}
                onPress={() => onChange(m.account.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  marginBottom: 6,
                  backgroundColor: '#121212',
                  borderWidth: 1,
                  borderColor: '#2A2A2A',
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    className="text-white font-instrument-medium text-sm"
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                    numberOfLines={1}
                  >
                    {m.account.name ?? 'Unnamed'}
                  </Text>
                  <Text
                    className="text-gray-400 font-instrument text-xs mt-0.5"
                    style={{ fontFamily: 'Instrument Sans, system-ui, sans-serif' }}
                  >
                    {roleLabel(m.membership.role)}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export interface WorkspaceSwitcherPopoverProps {
  memberships: AccountMembership[];
  currentAccountId: string | null;
  onChange: (accountId: string) => void;
  /** Controlled: when provided with open, the parent controls open state (e.g. for click-outside). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Ref for the switcher container (trigger + panel); parent uses for click-outside. */
  containerRef?: RefObject<View | null>;
  /** When false, trigger shows only chevron (collapsed nav). */
  isExpanded?: boolean;
  /** Current workspace name for trigger label when expanded. */
  currentWorkspaceName?: string | null;
}

export function WorkspaceSwitcherPopover({
  memberships,
  currentAccountId,
  onChange,
  open: controlledOpen,
  onOpenChange,
  containerRef,
  isExpanded = true,
  currentWorkspaceName,
}: WorkspaceSwitcherPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );
  const searchInputRef = useRef<TextInput>(null);
  const triggerRef = useRef<View>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (typeof document !== 'undefined') {
      const trigger = triggerRef.current as unknown as HTMLElement | null;
      setTimeout(() => trigger?.focus?.(), 0);
    }
  }, [setOpen]);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  const handleToggle = useCallback(() => {
    if (open) handleClose();
    else handleOpen();
  }, [open, handleOpen, handleClose]);

  const handleSelect = useCallback(
    (accountId: string) => {
      onChange(accountId);
    },
    [onChange],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  const { height: windowHeight } = useWindowDimensions();
  const panelMaxHeight = useMemo(
    () => Math.min(PANEL_BODY_MAX, Math.max(200, windowHeight - PANEL_VERTICAL_RESERVE)),
    [windowHeight],
  );

  return (
    <View ref={containerRef} style={{ width: '100%' }} collapsable={false}>
      <Pressable
        ref={triggerRef}
        onPress={handleToggle}
        className={`flex-row items-center rounded-lg border border-[#3A3A3A] py-2 ${isExpanded ? 'px-2' : 'px-0 justify-center'}`}
      >
        {isExpanded ? (
          <>
            <Text
              className="text-gray-300 font-instrument text-sm flex-1"
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {currentWorkspaceName ?? 'Unnamed'}
            </Text>
            <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
              <ChevronDownIcon size={16} color="#9CA3AF" />
            </View>
          </>
        ) : (
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <ChevronDownIcon size={18} color="#9CA3AF" />
          </View>
        )}
      </Pressable>

      {open && (
        <>
          <View
            style={{
              width: '100%',
              maxHeight: panelMaxHeight,
              marginTop: 12,
              backgroundColor: 'transparent',
              overflow: 'hidden',
            }}
          >
            <WorkspaceSwitcherContent
              memberships={memberships}
              currentAccountId={currentAccountId}
              onChange={handleSelect}
              listMaxHeight={panelMaxHeight - 120}
              searchInputRef={searchInputRef}
            />
          </View>
          <View style={{ marginTop: 12 }}>
            <View className="h-px bg-[#2A2A2A]" />
          </View>
        </>
      )}
    </View>
  );
}
