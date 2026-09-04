import React from 'react';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { InboxThreadSortBy } from '@/lib/supabase/services/inbox';
import type { EmailThread } from '@/lib/supabase/types';
import type { Mailbox, Campaign, BlockListEntry } from '@/lib/supabase/types';
import { ConfirmDeleteModal, ConfirmModal } from '@/components/ui/modals';
import { BlockSenderModal } from './BlockSenderModal';
import { InboxFilterDropdown } from './InboxFilterDropdown';
import { InboxMessageActionsSheet } from './InboxMessageActionsSheet';
import { InboxThreadInfoSheet } from './InboxThreadInfoSheet';
import { TagsPanelModal } from './TagsPanelModal';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ReplyDuplicateConfirmState } from '@/hooks/useInboxComposer';

export interface InboxModalsFiltersProps {
  filterMenuOpen: boolean;
  setFilterMenuOpen: (open: boolean) => void;
  filterAnchorLayout: { x: number; y: number; w: number; h: number } | null;
  unreadOnlyFilter: boolean;
  setUnreadOnlyFilter: (v: boolean) => void;
  sortBy: InboxThreadSortBy;
  setSortBy: (v: InboxThreadSortBy) => void;
  datePreset: '7d' | '30d' | null;
  setDatePreset: (v: '7d' | '30d' | null) => void;
  mailboxFilterId: string | null;
  setMailboxFilterId: (id: string | null) => void;
  campaignFilterId: string | null;
  setCampaignFilterId: (id: string | null) => void;
  categoryFilter: string[];
  setCategoryFilter: (v: string[]) => void;
  conversationStatusFilter: 'open' | 'closed' | 'all';
  setConversationStatusFilter: (v: 'open' | 'closed' | 'all') => void;
  tagFilterIds: string[];
  setTagFilterIds: (ids: string[]) => void;
  campaignTagFilterIds: string[];
  setCampaignTagFilterIds: (ids: string[]) => void;
  mailboxes: Mailbox[];
  campaigns: Campaign[];
  accountTags: ThreadTag[];
  accountCampaignTags: CampaignTag[];
  onClearAllFilters: () => void;
  isOnSavedDefault: boolean;
  onSaveAsDefault: () => void;
  onRemoveSavedDefault: () => void;
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
  blockedRecipientConfirm: { mode: 'reply' | 'forward'; onConfirm: () => void } | null;
  setBlockedRecipientConfirm: (v: { mode: 'reply' | 'forward'; onConfirm: () => void } | null) => void;
  replyDuplicateConfirm: ReplyDuplicateConfirmState;
  setReplyDuplicateConfirm: (v: ReplyDuplicateConfirmState) => void;
  infoSheetVisible: boolean;
  setInfoSheetVisible: (v: boolean) => void;
}

export interface InboxModalsActionsProps {
  accountId: string | null;
  selectedThreadProspectEmails: string[];
  blockList: BlockListEntry[];
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
  onCloseConversation?: () => void;
  onOpenConversation?: () => void;
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
    sortBy,
    setSortBy,
    datePreset,
    setDatePreset,
    mailboxFilterId,
    setMailboxFilterId,
    campaignFilterId,
    setCampaignFilterId,
    categoryFilter,
    setCategoryFilter,
    conversationStatusFilter,
    setConversationStatusFilter,
    tagFilterIds,
    setTagFilterIds,
    campaignTagFilterIds,
    setCampaignTagFilterIds,
    mailboxes,
    campaigns,
    accountTags,
    accountCampaignTags,
    onClearAllFilters,
    isOnSavedDefault,
    onSaveAsDefault,
    onRemoveSavedDefault,
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
    blockedRecipientConfirm,
    setBlockedRecipientConfirm,
    replyDuplicateConfirm,
    setReplyDuplicateConfirm,
    infoSheetVisible,
    setInfoSheetVisible,
  } = visibility;

  const {
    accountId,
    selectedThreadProspectEmails,
    blockList,
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
    onCloseConversation,
    onOpenConversation,
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
        sortBy={sortBy}
        onSortByChange={setSortBy}
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        mailboxFilterId={mailboxFilterId}
        onMailboxFilterIdChange={setMailboxFilterId}
        campaignFilterId={campaignFilterId}
        onCampaignFilterIdChange={setCampaignFilterId}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        conversationStatusFilter={conversationStatusFilter}
        onConversationStatusFilterChange={setConversationStatusFilter}
        tagFilterIds={tagFilterIds}
        onTagFilterIdsChange={setTagFilterIds}
        campaignTagFilterIds={campaignTagFilterIds}
        onCampaignTagFilterIdsChange={setCampaignTagFilterIds}
        mailboxes={mailboxes}
        campaigns={campaigns}
        accountTags={accountTags}
        accountCampaignTags={accountCampaignTags}
        onClearAll={onClearAllFilters}
        isOnSavedDefault={isOnSavedDefault}
        onSaveAsDefault={onSaveAsDefault}
        onRemoveSavedDefault={onRemoveSavedDefault}
      />

      {accountId && (
        <BlockSenderModal
          visible={blockModalVisible}
          onClose={() => setBlockModalVisible(false)}
          participantEmails={selectedThreadProspectEmails}
          accountId={accountId}
          blockList={blockList}
          onBlocked={onBlocked}
        />
      )}

      {accountId && selectedThreadId && (
        <TagsPanelModal
          visible={tagsPanelVisible}
          onClose={() => setTagsPanelVisible(false)}
          accountId={accountId}
          threadTags={threadTagsMap[selectedThreadId] ?? []}
          accountTags={accountTags}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onUpdateTag={onUpdateTag}
          onDeleteTag={onDeleteTag}
          onTagCreated={onTagCreated}
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
        onCloseConversation={onCloseConversation}
        onOpenConversation={onOpenConversation}
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

      {replyDuplicateConfirm && (
        <ConfirmModal
          visible={!!replyDuplicateConfirm}
          onClose={() => setReplyDuplicateConfirm(null)}
          onConfirm={() => {
            replyDuplicateConfirm.onConfirm();
          }}
          title={replyDuplicateConfirm.title}
          message={replyDuplicateConfirm.message}
          confirmLabel="Reply anyway"
          cancelLabel="Cancel"
        />
      )}
    </>
  );
}
