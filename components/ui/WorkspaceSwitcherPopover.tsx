import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import type { RefObject } from 'react';
import type { AccountMembership } from '@/lib/supabase/services/accounts';
import { useOpenConversationCounts } from '@/contexts/OpenConversationCountsContext';
import { CountBadge } from '@/components/ui/CountBadge';
import { PopupPortal } from '@/components/ui/PopupPortal';

const LIST_MAX_HEIGHT = 280;
const PANEL_BODY_MAX = 460;
/** Match PopupPortal EDGE_PAD so the floating panel never overflows the viewport. */
const POPUP_EDGE_PAD = 8;
/** Approximate height of switcher chrome outside the list (title + search + paddings). */
const SWITCHER_CHROME_HEIGHT = 120;
const POPUP_MIN_WIDTH = 280;

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
  const { countsByAccountId } = useOpenConversationCounts();
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
              {(countsByAccountId[currentEntry.account.id] ?? 0) > 0 ? (
                <View style={{ marginLeft: 8, flexShrink: 0 }}>
                  <CountBadge
                    count={countsByAccountId[currentEntry.account.id] ?? 0}
                    size="nav"
                    variant="solid"
                  />
                </View>
              ) : null}
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
                {(countsByAccountId[m.account.id] ?? 0) > 0 ? (
                  <View style={{ marginLeft: 8, flexShrink: 0 }}>
                    <CountBadge count={countsByAccountId[m.account.id] ?? 0} size="nav" variant="solid" />
                  </View>
                ) : null}
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
  /**
   * When true, render the list in a floating PopupPortal instead of an inline
   * panel (used when the navbar is too short to fit the inline panel).
   */
  renderAsPopup?: boolean;
  /**
   * Max height available for the inline panel body (nav spacer minus open margins).
   * When provided, caps the inline panel so Settings/Sign Out stay visible.
   */
  availableInlineHeight?: number;
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
  renderAsPopup = false,
  availableInlineHeight,
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
  const isWeb = Platform.OS === 'web';
  const [triggerHovered, setTriggerHovered] = useState(false);

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
  const panelMaxHeight = useMemo(() => {
    if (availableInlineHeight != null && availableInlineHeight > 0) {
      return Math.min(PANEL_BODY_MAX, availableInlineHeight);
    }
    // Fallback when parent has not measured spacer yet
    return Math.min(PANEL_BODY_MAX, Math.max(200, windowHeight * 0.4));
  }, [availableInlineHeight, windowHeight]);
  const popupMaxHeight = useMemo(
    () => Math.max(200, windowHeight - POPUP_EDGE_PAD * 2),
    [windowHeight],
  );
  const popupListMaxHeight = useMemo(
    () => Math.max(120, popupMaxHeight - SWITCHER_CHROME_HEIGHT),
    [popupMaxHeight],
  );
  const inlineListMaxHeight = useMemo(
    () => Math.max(80, panelMaxHeight - SWITCHER_CHROME_HEIGHT),
    [panelMaxHeight],
  );

  const switcherContent = (
    <WorkspaceSwitcherContent
      memberships={memberships}
      currentAccountId={currentAccountId}
      onChange={handleSelect}
      listMaxHeight={renderAsPopup ? popupListMaxHeight : inlineListMaxHeight}
      searchInputRef={searchInputRef}
    />
  );

  return (
    <View ref={containerRef} style={{ width: '100%' }} collapsable={isWeb ? undefined : false}>
      <Pressable
        ref={triggerRef}
        onPress={handleToggle}
        onHoverIn={isWeb ? () => setTriggerHovered(true) : undefined}
        onHoverOut={isWeb ? () => setTriggerHovered(false) : undefined}
        className={`flex-row items-center rounded-lg h-9 ${isExpanded ? 'px-2' : 'px-0 justify-center'}`}
        style={{
          backgroundColor:
            isWeb && triggerHovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        }}
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

      {renderAsPopup ? (
        <PopupPortal
          anchorRef={triggerRef}
          open={open}
          onClose={handleClose}
          placement="right-start"
          gap={8}
          sameWidth={false}
        >
          <View
            style={{
              minWidth: POPUP_MIN_WIDTH,
              maxHeight: popupMaxHeight,
              backgroundColor: '#1A1A1A',
              borderWidth: 1,
              borderColor: '#2A2A2A',
              borderRadius: 12,
              overflow: 'hidden',
              ...(Platform.OS === 'web'
                ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
                : {
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: 0.35,
                    shadowRadius: 16,
                    elevation: 12,
                  }),
            }}
          >
            {switcherContent}
          </View>
        </PopupPortal>
      ) : (
        open && (
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
              {switcherContent}
            </View>
            <View style={{ marginTop: 12 }}>
              <View className="h-px bg-[#2A2A2A]" />
            </View>
          </>
        )
      )}
    </View>
  );
}
