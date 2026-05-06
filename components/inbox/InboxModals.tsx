import React from 'react';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { EmailThread } from '@/lib/supabase/types';
import type { Mailbox, Campaign } from '@/lib/supabase/types';
import { ConfirmDeleteModal } from '@/components/ui/modals';
import { BlockSenderModal } from './BlockSenderModal';
import { CreateTagModal } from './CreateTagModal';
import { InboxFilterDropdown } from './InboxFilterDropdown';
import { InboxMessageActionsSheet } from './InboxMessageActionsSheet';
import { InboxThreadInfoSheet } from './InboxThreadInfoSheet';
import { TagsPanelModal } from './TagsPanelModal';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';

export interface InboxModalsFiltersProps {
  filterMenuOpen: boolean;
  setFilterMenuOpen: (open: boolean) => void;
  filterAnchorLayout: { x: number; y: number; w: number; h: number } | null;
  unreadOnlyFilter: boolean;
  setUnreadOnlyFilter: (v: boolean) => void;
  datePreset: '7d' | '30d' | null;
  setDatePreset: (v: '7d' | '30d' | null) => void;
  mailboxFilterId: string | null;
  setMailboxFilterId: (id: string | null) => void;
  campaignFilterId: string | null;
  setCampaignFilterId: (id: string | null) => void;
  categoryFilter: string | null;
  setCategoryFilter: (v: string | null) => void;
  tagFilterIds: string[];
  setTagFilterIds: (ids: string[]) => void;
  includeOutOfOfficeFilter: boolean;
  setIncludeOutOfOfficeFilter: (v: boolean) => void;
  mailboxes: Mailbox[];
  campaigns: Campaign[];
  accountTags: ThreadTag[];
  onClearAllFilters: () => void;
  filterPresentation: 'dropdown' | 'sheet';
  filterSheetMaxHeight: number;
}

export interface InboxModalsVisibilityProps {
  blockModalVisible: boolean;
  setBlockModalVisible: (v: boolean) => void;
  tagsPanelVisible: boolean;
  setTagsPanelVisible: (v: boolean) => void;
  showMessageActionsSheet: boolean;
  setShowMessageActionsSheet: (v: boolean) => void;
  createTagModalVisible: boolean;
  setCreateTagModalVisible: (v: boolean) => void;
  blockedRecipientConfirm: { mode: 'reply' | 'forward'; onConfirm: () => void } | null;
  setBlockedRecipientConfirm: (v: { mode: 'reply' | 'forward'; onConfirm: () => void } | null) => void;
  infoSheetVisible: boolean;
  setInfoSheetVisible: (v: boolean) => void;
}

export interface InboxModalsActionsProps {
  accountId: string | null;
  selectedThreadProspectEmails: string[];
  onBlocked: () => void;
  selectedThreadId: string | null;
  threadTagsMap: Record<string, ThreadTag[]>;
  selectedThread: EmailThread | null;
  campaignName: string | null;
  replacementSummary: LeadReplacementSummary | null;
  onSetCategory: (cat: string | null) => Promise<void>;
  onTagCreated: (tag: ThreadTag) => void;
  onAddTag: (tag: ThreadTag) => Promise<void>;
  onRemoveTag: (tag: ThreadTag) => Promise<void>;
  onUpdateTag: (tag: ThreadTag) => void;
  onDeleteTag: (tag: ThreadTag) => void;
  onMarkOutOfOffice?: () => void;
  onReplaceLead?: () => void;
  onMessageActionsSheetAfterClose?: () => void;
}

export interface InboxModalsProps {
  filters: InboxModalsFiltersProps;
  visibility: InboxModalsVisibilityProps;
  actions: InboxModalsActionsProps;
}

export function InboxModals({ filters, visibility, actions }: InboxModalsProps) {
  const {
    filterMenuOpen,
    setFilterMenuOpen,
    filterAnchorLayout,
    unreadOnlyFilter,
    setUnreadOnlyFilter,
    datePreset,
    setDatePreset,
    mailboxFilterId,
    setMailboxFilterId,
    campaignFilterId,
    setCampaignFilterId,
    categoryFilter,
    setCategoryFilter,
    tagFilterIds,
    setTagFilterIds,
    includeOutOfOfficeFilter,
    setIncludeOutOfOfficeFilter,
    mailboxes,
    campaigns,
    accountTags,
    onClearAllFilters,
    filterPresentation,
    filterSheetMaxHeight,
  } = filters;

  const {
    blockModalVisible,
    setBlockModalVisible,
    tagsPanelVisible,
    setTagsPanelVisible,
    showMessageActionsSheet,
    setShowMessageActionsSheet,
    createTagModalVisible,
    setCreateTagModalVisible,
    blockedRecipientConfirm,
    setBlockedRecipientConfirm,
    infoSheetVisible,
    setInfoSheetVisible,
  } = visibility;

  const {
    accountId,
    selectedThreadProspectEmails,
    onBlocked,
    selectedThreadId,
    threadTagsMap,
    selectedThread,
    campaignName,
    replacementSummary,
    onSetCategory,
    onTagCreated,
    onAddTag,
    onRemoveTag,
    onUpdateTag,
    onDeleteTag,
    onMarkOutOfOffice,
    onReplaceLead,
    onMessageActionsSheetAfterClose,
  } = actions;

  return (
    <>
      <InboxFilterDropdown
        visible={filterMenuOpen}
        onClose={() => setFilterMenuOpen(false)}
        presentation={filterPresentation}
        sheetMaxHeight={filterSheetMaxHeight}
        anchorLayout={filterAnchorLayout}
        unreadOnlyFilter={unreadOnlyFilter}
        onUnreadOnlyFilterChange={setUnreadOnlyFilter}
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        mailboxFilterId={mailboxFilterId}
        onMailboxFilterIdChange={setMailboxFilterId}
        campaignFilterId={campaignFilterId}
        onCampaignFilterIdChange={setCampaignFilterId}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        tagFilterIds={tagFilterIds}
        onTagFilterIdsChange={setTagFilterIds}
        includeOutOfOfficeFilter={includeOutOfOfficeFilter}
        onIncludeOutOfOfficeFilterChange={setIncludeOutOfOfficeFilter}
        mailboxes={mailboxes}
        campaigns={campaigns}
        accountTags={accountTags}
        onClearAll={onClearAllFilters}
      />

      {accountId && (
        <BlockSenderModal
          visible={blockModalVisible}
          onClose={() => setBlockModalVisible(false)}
          participantEmails={selectedThreadProspectEmails}
          accountId={accountId}
          onBlocked={onBlocked}
        />
      )}

      {accountId && selectedThreadId && (
        <TagsPanelModal
          visible={tagsPanelVisible}
          onClose={() => setTagsPanelVisible(false)}
          threadTags={threadTagsMap[selectedThreadId] ?? []}
          accountTags={accountTags}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onUpdateTag={onUpdateTag}
          onDeleteTag={onDeleteTag}
          onCreateTag={() => {
            setTagsPanelVisible(false);
            setCreateTagModalVisible(true);
          }}
        />
      )}

      <InboxMessageActionsSheet
        visible={showMessageActionsSheet}
        onClose={() => setShowMessageActionsSheet(false)}
        accountId={accountId}
        selectedThreadId={selectedThreadId}
        selectedThread={selectedThread}
        threadTagsMap={threadTagsMap}
        selectedThreadProspectEmails={selectedThreadProspectEmails}
        campaignName={campaignName}
        replacementSummary={replacementSummary}
        onBlock={() => setBlockModalVisible(true)}
        onMarkOutOfOffice={onMarkOutOfOffice}
        onReplaceLead={onReplaceLead}
        onTags={() => setTagsPanelVisible(true)}
        onShowInfo={() => setInfoSheetVisible(true)}
        onSetCategory={onSetCategory}
        onAfterClose={onMessageActionsSheetAfterClose}
      />

      <InboxThreadInfoSheet
        visible={infoSheetVisible}
        onClose={() => setInfoSheetVisible(false)}
        campaignName={campaignName}
        replacementSummary={replacementSummary}
      />

      {accountId && (
        <CreateTagModal
          visible={createTagModalVisible}
          onClose={() => setCreateTagModalVisible(false)}
          accountId={accountId}
          onCreated={onTagCreated}
        />
      )}

      {blockedRecipientConfirm && (
        <ConfirmDeleteModal
          visible={!!blockedRecipientConfirm}
          onClose={() => setBlockedRecipientConfirm(null)}
          onConfirm={async () => {
            blockedRecipientConfirm.onConfirm();
            setBlockedRecipientConfirm(null);
          }}
          title="Send to blocked address?"
          description="This lead has been blocked. No automatic emails will be sent to them, but you can send messages to them manually without unblocking if you wish. Confirm to proceed."
          confirmLabel="Send anyway"
          cancelLabel="Cancel"
          requireConfirmation={false}
        />
      )}
    </>
  );
}
