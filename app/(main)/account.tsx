import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BuildingLibraryIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { ManageBlockListModal } from '@/components/inbox';
import { canManageAccountTeam, getAccountMembershipRole } from '@/lib/account/teamManagementPermissions';
import {
  MigrationHistoryModal,
  SmartleadMigrationWizardModal,
} from '@/components/account/smartleadMigration';
import { AccountApiKeysSection, AccountWebhooksSection } from '@/components/account/api';
import { AccountNotificationsSection } from '@/components/account/AccountNotificationsSection';
import type { BalancedSection } from '@/components/ui/layout';
import {
  BalancedTwoColumnLayout,
  LAYOUT_BREAKPOINT,
  PageHeader,
  PageLayout,
} from '@/components/ui/layout';
import { WorkspaceSwitcherContent } from '@/components/ui/WorkspaceSwitcherPopover';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { Alert, useSmoothLoading, useToast } from '@/components/ui/feedback';
import { AccountSettingsSkeleton } from '@/components/skeletons';
import { useAccountSettingsData } from '@/hooks/useAccountSettingsData';
import { usePlatformAdminAccess } from '@/hooks/usePlatformAdminAccess';
import { BaseModal, ConfirmDeleteModal, ModalFooter } from '@/components/ui/modals';
import { HelpModal } from '@/components/ui/help';
import { BottomSheet } from '@/components/ui/modals/BottomSheet';
import { useAccount } from '@/contexts/AccountContext';
import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { useOnboardingTrigger } from '@/components/onboarding/useOnboardingTrigger';
import { TARGETS } from '@/lib/onboarding/types';
import {
  deleteInvitation,
  inviteUserToAccount,
  listSmartleadMigrationRuns,
  removeBlockEntry,
  removeMemberFromAccount,
  updateAccount,
  updateMemberRole,
  updateUserProfile,
} from '@/lib/supabase/services';
import { signOut } from '@/lib/supabase/client';
import { sendInvitationEmail } from '@/lib/services/email';
import type { AccountUser, BlockListEntry, Invitation, SmartleadMigrationRun, User } from '@/lib/supabase/types';

/** Max width per column so line length stays readable. */
const DESKTOP_COLUMN_MAX_WIDTH = 440;
/** Effective max width of the two-column content block, including the gap between columns. */
const DESKTOP_TWO_COLUMN_WIDTH = DESKTOP_COLUMN_MAX_WIDTH * 2 + 24;

const ACTIVE_SMARTLEAD_RUN_STATUSES: SmartleadMigrationRun['status'][] = [
  'queued',
  'launch_requested',
  'task_started',
  'running',
  'cancel_requested',
];

function getSmartleadRunSummary(run: SmartleadMigrationRun): string {
  switch (run.status) {
    case 'queued':
    case 'launch_requested':
      return 'Launch requested. Preparing the ECS task.';
    case 'task_started':
      return 'ECS task created. Waiting for the worker to claim the run.';
    case 'failed_to_launch':
      return 'This run never created an ECS task.';
    case 'failed_to_claim':
      return 'An ECS task was created, but the worker never claimed the run.';
    default:
      return `${run.completed_campaign_count + run.failed_campaign_count} of ${run.selected_campaign_count} campaigns processed`;
  }
}

const inputStyle = {
  borderColor: '#3A3A3A',
  backgroundColor: '#121212',
  color: '#FFFFFF',
  borderWidth: 1,
} as const;

function AccountProfileSection({
  cardVariant,
  cardClassName,
  titleClassName,
  nameInput,
  onNameChange,
  profile,
  userEmail,
  savingProfile,
  onSaveProfile,
}: {
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  nameInput: string;
  onNameChange: (v: string) => void;
  profile: User | null;
  userEmail: string | null;
  savingProfile: boolean;
  onSaveProfile: () => void;
}) {
  const profileSectionRef = useOnboardingTarget(TARGETS.accountProfile);
  return (
    <Card ref={profileSectionRef} variant={cardVariant} className={cardClassName}>
      <Text className={titleClassName}>Your Profile</Text>
      <View className="mb-4">
        <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Name</Text>
        <TextInput
          value={nameInput}
          onChangeText={onNameChange}
          placeholder="Enter your name"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="words"
          className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
          style={inputStyle}
        />
      </View>
      <View className="mb-4">
        <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Email</Text>
        <Text className="text-white text-sm font-instrument mb-1.5">
          {profile?.email ?? userEmail ?? 'Not available'}
        </Text>
        <Text className="text-xs text-gray-500">
          Email comes from your login and cannot be edited here.
        </Text>
      </View>
      <Button onPress={onSaveProfile} disabled={savingProfile} size="sm" className="mt-2">
        {savingProfile ? 'Saving...' : 'Save Name'}
      </Button>
    </Card>
  );
}

function AccountCompanySection({
  cardVariant,
  cardClassName,
  titleClassName,
  companyInput,
  onCompanyChange,
  membership,
  isOwner,
  savingAccount,
  onSaveAccount,
}: {
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  companyInput: string;
  onCompanyChange: (v: string) => void;
  membership: { account: { name: string | null } } | null;
  isOwner: boolean;
  savingAccount: boolean;
  onSaveAccount: () => void;
}) {
  return (
    <Card variant={cardVariant} className={cardClassName ?? ''}>
      <Text className={titleClassName}>Company</Text>
      {isOwner ? (
        <>
          <View className="mb-4">
            <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Company Name</Text>
            <TextInput
              value={companyInput}
              onChangeText={onCompanyChange}
              placeholder="Enter company name"
              placeholderTextColor="#9CA3AF"
              className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
              style={inputStyle}
            />
            <Text className="text-xs text-gray-500 mt-1.5">
              Company name changes apply to all collaborators.
            </Text>
          </View>
          <Button onPress={onSaveAccount} disabled={savingAccount} size="sm" className="mt-2">
            {savingAccount ? 'Saving...' : 'Save Company Name'}
          </Button>
        </>
      ) : (
        <View className="mb-4">
          <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Company Name</Text>
          <Text className="text-white text-sm font-instrument mb-1.5">
            {membership?.account?.name ?? 'Not available'}
          </Text>
          <Text className="text-xs text-gray-500">
            Only account owners can change the company name.
          </Text>
        </View>
      )}
    </Card>
  );
}

function AccountTeamMembersSection({
  cardVariant,
  cardClassName,
  titleClassName,
  teamMembers,
  profile,
  canManageTeam,
  inviteEmailInput,
  setInviteEmailInput,
  onInviteTeamMember,
  inviting,
  updatingRoleId,
  setRoleEditMember,
  onUpdateMemberRole,
  onRequestRemoveMember,
  removingMemberId,
  invitations,
  onRevokeInvitation,
  revokingInvitationId,
}: {
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  teamMembers: Array<{
    user: User & { name: string | null; email: string };
    membership: { id: string; role: string | null; is_owner: boolean };
  }>;
  profile: User | null;
  canManageTeam: boolean;
  inviteEmailInput: string;
  setInviteEmailInput: (v: string) => void;
  onInviteTeamMember: () => void;
  inviting: boolean;
  updatingRoleId: string | null;
  setRoleEditMember: (v: { membershipId: string; memberName: string } | null) => void;
  onUpdateMemberRole: (membershipId: string, role: 'owner' | 'admin' | 'member') => void;
  onRequestRemoveMember: (membershipId: string, memberName: string) => void;
  removingMemberId: string | null;
  invitations: Invitation[];
  onRevokeInvitation: (id: string) => void;
  revokingInvitationId: string | null;
}) {
  const teamSectionRef = useOnboardingTarget(TARGETS.accountTeam);
  const currentMembersBlock = (
    <>
      {teamMembers.length > 0 ? (
        <View className="mb-4">
          <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
            Current Members ({teamMembers.length})
          </Text>
          <View className="rounded-lg overflow-hidden">
            {teamMembers.map((member, index) => {
              const isCurrentUser = member.user.id === profile?.id;
              const canManage = canManageTeam && !isCurrentUser;
              const currentRole = getAccountMembershipRole(member.membership);
              return (
                <View
                  key={member.membership.id}
                  className={`flex-row items-center justify-between py-2.5 ${
                    index < teamMembers.length - 1 ? 'border-b border-[#2A2A2A]' : ''
                  }`}
                >
                  <View className="flex-1 mr-2">
                    <Text className="text-white text-sm font-instrument-medium mb-0.5">
                      {member.user.name || 'No name'}
                      {isCurrentUser && (
                        <Text className="text-gray-500 text-xs ml-1">(You)</Text>
                      )}
                    </Text>
                    <Text className="text-gray-400 text-xs font-instrument">{member.user.email}</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    {canManage && Platform.OS === 'web' ? (
                      <select
                        value={currentRole}
                        onChange={(e) =>
                          onUpdateMemberRole(
                            member.membership.id,
                            (e.target as HTMLSelectElement).value as 'owner' | 'admin' | 'member'
                          )
                        }
                        disabled={updatingRoleId === member.membership.id}
                        style={{
                          backgroundColor: '#121212',
                          borderColor: '#3A3A3A',
                          borderWidth: 1,
                          borderRadius: 6,
                          padding: '4px 8px',
                          color: '#FFFFFF',
                          fontSize: 12,
                          fontFamily: 'Instrument Sans, system-ui, sans-serif',
                          cursor: updatingRoleId === member.membership.id ? 'not-allowed' : 'pointer',
                          opacity: updatingRoleId === member.membership.id ? 0.5 : 1,
                        }}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    ) : (
                      <View className="flex-row items-center gap-2">
                        <View
                          className={`px-2 py-0.5 rounded ${
                            currentRole === 'owner'
                              ? 'bg-brand-orange/20 border border-brand-orange/30'
                              : currentRole === 'admin'
                                ? 'bg-blue-500/20 border border-blue-500/30'
                                : 'bg-gray-500/20 border border-gray-500/30'
                          }`}
                        >
                          <Text
                            className={`text-xs font-instrument-medium capitalize ${
                              currentRole === 'owner'
                                ? 'text-brand-orange'
                                : currentRole === 'admin'
                                  ? 'text-blue-400'
                                  : 'text-gray-400'
                            }`}
                          >
                            {currentRole}
                          </Text>
                        </View>
                        {canManage && Platform.OS !== 'web' && (
                          <Button
                            variant="secondary"
                            size="xs"
                            onPress={() =>
                              setRoleEditMember({
                                membershipId: member.membership.id,
                                memberName: member.user.name || member.user.email,
                              })
                            }
                            disabled={updatingRoleId === member.membership.id}
                          >
                            {updatingRoleId === member.membership.id ? 'Updating...' : 'Change role'}
                          </Button>
                        )}
                      </View>
                    )}
                    {canManage && (
                      <Button
                        variant="destructive"
                        size="xs"
                        onPress={() =>
                          onRequestRemoveMember(
                            member.membership.id,
                            member.user.name || member.user.email
                          )
                        }
                        disabled={removingMemberId === member.membership.id}
                      >
                        {removingMemberId === member.membership.id ? 'Removing...' : 'Remove'}
                      </Button>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <View className="mb-4 py-3">
          <Text className="text-gray-400 text-sm font-instrument">
            {canManageTeam
              ? 'No other members yet. Invite someone by email above.'
              : 'No other members yet.'}
          </Text>
        </View>
      )}
    </>
  );

  const pendingInvitationsBlock = canManageTeam && invitations.length > 0 && (
    <View>
      <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
        Pending Invitations ({invitations.length})
      </Text>
      <View className="rounded-lg overflow-hidden">
        {invitations.map((invitation, index) => (
          <View
            key={invitation.id}
            className={`flex-row items-center justify-between py-2 ${
              index < invitations.length - 1 ? 'border-b border-[#2A2A2A]' : ''
            }`}
          >
            <View className="flex-1 mr-2">
              <Text className="text-white text-sm font-instrument mb-0.5">{invitation.email}</Text>
              <Text className="text-gray-500 text-xs font-instrument">Pending</Text>
            </View>
            <Button
              variant="destructive"
              size="xs"
              onPress={() => onRevokeInvitation(invitation.id)}
              disabled={revokingInvitationId === invitation.id}
            >
              {revokingInvitationId === invitation.id ? 'Revoking...' : 'Revoke'}
            </Button>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <Card ref={teamSectionRef} variant={cardVariant} className={cardClassName ?? ''}>
      <Text className={titleClassName}>Team Members</Text>
      {canManageTeam && (
        <View className="mb-4 pb-4 border-b border-[#2A2A2A]">
          <Text className="text-xs text-gray-400 font-instrument-medium mb-2">Invite Team Member</Text>
          <Text className="text-xs text-gray-500 mb-2">
            They'll get an email with a link to join this account.
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <TextInput
                value={inviteEmailInput}
                onChangeText={setInviteEmailInput}
                placeholder="Enter email address"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                keyboardType="email-address"
                className="border rounded-lg px-3 py-2 bg-[#121212] text-sm text-white"
                style={inputStyle}
              />
            </View>
            <Button onPress={onInviteTeamMember} disabled={inviting} size="sm" className="px-4">
              {inviting ? 'Sending...' : 'Invite'}
            </Button>
          </View>
        </View>
      )}
      {currentMembersBlock}
      {pendingInvitationsBlock}
    </Card>
  );
}

function AccountBlockListSection({
  cardVariant,
  cardClassName,
  titleClassName,
  onOpenModal,
}: {
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  onOpenModal: () => void;
}) {
  return (
    <Card variant={cardVariant} className={cardClassName ?? ''}>
      <Text className={titleClassName}>Inbox / Block list</Text>
      <Text className="text-gray-500 text-xs font-instrument mb-4">
        Blocked addresses and domains do not receive automated campaign emails. You can still reply
        manually from the inbox.
      </Text>
      <Button variant="secondary" size="sm" className="self-start" onPress={onOpenModal}>
        Manage Block List
      </Button>
    </Card>
  );
}

function AccountSmartleadSection({
  cardVariant,
  cardClassName,
  titleClassName,
  smartleadRun,
  onOpenWizard,
  onOpenHistory,
  activeRunStatuses,
  getRunSummary,
}: {
  cardVariant: 'card' | 'inline';
  cardClassName?: string;
  titleClassName: string;
  smartleadRun: SmartleadMigrationRun | null;
  onOpenWizard: (runId: string | null) => void;
  onOpenHistory: () => void;
  activeRunStatuses: SmartleadMigrationRun['status'][];
  getRunSummary: (run: SmartleadMigrationRun) => string;
}) {
  return (
    <Card variant={cardVariant} className={cardClassName ?? ''}>
      <Text className={titleClassName}>Smartlead Migration</Text>
      <Text className="text-gray-500 text-xs font-instrument mb-4">
        Import campaigns and leads from your Smartlead account. Background runs keep their progress
        and errors visible even after reloads.
      </Text>
      {smartleadRun ? (
        <View className="mb-4 rounded-xl border border-[#2A2A2A] bg-[#141414] p-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-white text-sm font-instrument-medium">
              {activeRunStatuses.includes(smartleadRun.status)
                ? 'Active migration'
                : 'Most recent migration'}
            </Text>
            <View className="rounded-full border border-[#2A2A2A] bg-[#1F1F1F] px-2.5 py-1">
              <Text className="text-[11px] text-gray-300 font-instrument-medium capitalize">
                {smartleadRun.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>
          <Text className="text-gray-400 text-xs font-instrument mt-2">
            {getRunSummary(smartleadRun)}
          </Text>
          <Text className="text-gray-500 text-xs font-instrument mt-1">
            {smartleadRun.leads_imported} leads, {smartleadRun.conversations_imported} conversations
          </Text>
          {smartleadRun.last_error_message ? (
            <Text className="text-red-400 text-xs font-instrument mt-2">
              {smartleadRun.last_error_message}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          size="sm"
          onPress={() => {
            if (smartleadRun && activeRunStatuses.includes(smartleadRun.status)) {
              onOpenWizard(smartleadRun.id);
            } else {
              onOpenWizard(null);
            }
          }}
        >
          {smartleadRun && activeRunStatuses.includes(smartleadRun.status)
            ? 'View Migration'
            : 'Start Migration'}
        </Button>
        <Button variant="secondary" size="sm" onPress={onOpenHistory}>
          View All Migrations
        </Button>
      </View>
    </Card>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const { toast } = useToast();
  const platformAdminAccess = usePlatformAdminAccess();
  const accountIntegrationsRef = useOnboardingTarget(TARGETS.accountIntegrations);
  const accountWebhooksRef = useOnboardingTarget(TARGETS.accountWebhooks);
  const { switch_account } = useLocalSearchParams<{ switch_account?: string }>();
  const {
    user: profile,
    account,
    memberships,
    teamMembers,
    invitations,
    blockList,
    loading: contextLoading,
    refetching,
    error: loadError,
    refetch,
    refetchAccountData,
    setCurrentAccountId,
  } = useAccount();

  const membership = useMemo(
    () => (account ? memberships.find((m) => m.account.id === account.id) ?? null : null),
    [account, memberships]
  );
  const isOwner = membership?.membership.is_owner ?? false;
  const membershipRole = getAccountMembershipRole(membership?.membership);
  const canManageTeam = canManageAccountTeam(membership?.membership);

  const settingsBootstrapReady =
    !contextLoading && !refetching && !!account?.id;
  const settings = useAccountSettingsData(account?.id, {
    enabled: settingsBootstrapReady,
    includeAdminData: canManageTeam,
  });

  const pageLoading =
    contextLoading || refetching || settings.loading;

  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const [layoutStable, setLayoutStable] = useState(isMobile);

  useEffect(() => {
    setLayoutStable(isMobile);
  }, [account?.id, isMobile]);

  useEffect(() => {
    if (pageLoading) {
      setLayoutStable(isMobile);
    }
  }, [pageLoading, isMobile]);

  const awaitingLayout = !isMobile && !layoutStable;
  const showSkeleton = useSmoothLoading(pageLoading || awaitingLayout);

  useOnboardingTrigger('account', { when: !pageLoading && !awaitingLayout });

  const switchHandledRef = useRef(false);
  useEffect(() => {
    if (switch_account && !switchHandledRef.current && memberships.length > 0) {
      switchHandledRef.current = true;
      setCurrentAccountId(switch_account);
    }
  }, [switch_account, memberships.length, setCurrentAccountId]);
  const userEmail = profile?.email ?? null;

  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState('');
  const [companyInput, setCompanyInput] = useState('');
  const [inviteEmailInput, setInviteEmailInput] = useState('');

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingSuppressBounced, setSavingSuppressBounced] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [blockListModalVisible, setBlockListModalVisible] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [smartleadWizardVisible, setSmartleadWizardVisible] = useState(false);
  const [smartleadHistoryVisible, setSmartleadHistoryVisible] = useState(false);
  const smartleadRun = settings.data?.smartleadRun ?? null;
  const [selectedSmartleadRunId, setSelectedSmartleadRunId] = useState<string | null>(null);
  const [smartleadRuns, setSmartleadRuns] = useState<SmartleadMigrationRun[]>([]);
  const [smartleadRunsLoading, setSmartleadRunsLoading] = useState(false);
  const [smartleadRunsError, setSmartleadRunsError] = useState<string | null>(null);
  const [roleEditMember, setRoleEditMember] = useState<{ membershipId: string; memberName: string } | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{
    membershipId: string;
    memberName: string;
  } | null>(null);

  const handleNameChange = (value: string) => {
    setNameInput(value);
  };

  const handleCompanyChange = (value: string) => {
    setCompanyInput(value);
  };

  useEffect(() => {
    if (!profile) {
      setNameInput('');
      return;
    }
    setNameInput(profile.name ?? '');
  }, [profile?.id, profile?.name]);

  useEffect(() => {
    if (!membership?.account) {
      setCompanyInput('');
      return;
    }
    setCompanyInput(membership.account.name ?? '');
  }, [membership?.account?.id, membership?.account?.name]);

  useEffect(() => {
    if (!smartleadHistoryVisible || !account?.id) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refreshRuns = async () => {
      setSmartleadRunsLoading(true);
      setSmartleadRunsError(null);
      try {
        const runs = await listSmartleadMigrationRuns(account.id);
        if (!cancelled) {
          setSmartleadRuns(runs);
        }
      } catch (error) {
        if (!cancelled) {
          setSmartleadRunsError(
            error instanceof Error ? error.message : 'Failed to load migration history.',
          );
        }
      } finally {
        if (!cancelled) {
          setSmartleadRunsLoading(false);
        }
      }
    };

    void refreshRuns();
    intervalId = setInterval(() => {
      void refreshRuns();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [smartleadHistoryVisible, account?.id]);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;

    const trimmedName = nameInput.trim();
    if (trimmedName.length === 0) {
      toast.error('Name cannot be empty.');
      return;
    }

    setSavingProfile(true);

    try {
      await updateUserProfile(profile.id, { name: trimmedName });
      await refetch();
      setNameInput(trimmedName);
      toast.success('Profile updated successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update profile.';
      toast.error(message);
    } finally {
      setSavingProfile(false);
    }
  }, [nameInput, profile, refetch, toast]);

  const handleSaveAccount = useCallback(async () => {
    if (!membership || !membership.account) return;
    if (!membership.membership.is_owner) return;

    const trimmedCompany = companyInput.trim();
    if (trimmedCompany.length === 0) {
      toast.error('Company name cannot be empty.');
      return;
    }

    setSavingAccount(true);

    try {
      const updatedAccount = await updateAccount(membership.account.id, { name: trimmedCompany });
      await refetch();
      setCompanyInput(updatedAccount.name ?? '');
      toast.success('Company name updated successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update company name.';
      toast.error(message);
    } finally {
      setSavingAccount(false);
    }
  }, [companyInput, membership, refetch, toast]);

  const handleSuppressBouncedChange = useCallback(
    async (value: boolean) => {
      if (!membership?.account || !membership.membership.is_owner) return;
      setSavingSuppressBounced(true);
      try {
        await updateAccount(membership.account.id, { suppress_bounced_emails: value });
        await refetch();
        toast.success(value ? 'Bounced emails will be blocked automatically.' : 'Bounced emails will not be added to the block list.');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update setting.';
        toast.error(message);
      } finally {
        setSavingSuppressBounced(false);
      }
    },
    [membership, refetch, toast]
  );

  const handleInviteTeamMember = useCallback(async () => {
    if (!membership || !membership.account || !profile) return;
    if (!canManageAccountTeam(membership.membership)) return;

    const trimmedEmail = inviteEmailInput.trim().toLowerCase();
    if (trimmedEmail.length === 0) {
      toast.error('Please enter an email address.');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Please enter a valid email address.');
      return;
    }

    // Don't allow inviting yourself
    if (trimmedEmail === profile.email.toLowerCase()) {
      toast.error('You cannot invite yourself.');
      return;
    }

    // Check if user is already a member
    const existingMember = teamMembers.find(
      (m) => m.user.email.toLowerCase() === trimmedEmail
    );
    if (existingMember) {
      toast.error('This user is already a team member.');
      return;
    }

    // Check if there's already a pending invitation
    const existingInvitation = invitations.find(
      (inv) => inv.email.toLowerCase() === trimmedEmail
    );
    if (existingInvitation) {
      toast.error('An invitation has already been sent to this email.');
      return;
    }

    setInviting(true);

    try {
      const result = await inviteUserToAccount(membership.account.id, trimmedEmail, profile.id);
      const status = result.status;

      if (status === 'already_member') {
        toast.info(`${trimmedEmail} is already a member of this team.`);
      } else if (status === 'pending_invite') {
        toast.info(`${trimmedEmail} already has a pending invite.`);
      } else if (status === 'invited') {
        const invitationId = result.invitation_id!;
        const baseUrl = typeof window !== 'undefined'
          ? window.location.origin
          : 'https://build.getfurnace.io';
        const acceptUrl = `${baseUrl}/accept-invitation/${invitationId}`;

        try {
          await sendInvitationEmail({
            to: trimmedEmail,
            inviterName: profile.name || profile.email,
            inviterEmail: profile.email,
            accountName: membership.account.name,
            acceptUrl,
          });
        } catch (emailError) {
          try { await deleteInvitation(invitationId); } catch { /* best-effort cleanup */ }
          throw emailError;
        }

        toast.success(`Invitation sent to ${trimmedEmail}.`);
      }

      await refetchAccountData();

      setInviteEmailInput('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send invitation.';
      toast.error(message);
    } finally {
      setInviting(false);
    }
  }, [
    inviteEmailInput,
    membership,
    profile,
    refetch,
    refetchAccountData,
    teamMembers,
    invitations,
    toast,
  ]);

  const handleRevokeInvitation = useCallback(async (invitationId: string) => {
    if (!membership || !membership.account) return;
    if (!canManageAccountTeam(membership.membership)) return;

    setRevokingInvitationId(invitationId);

    try {
      await deleteInvitation(invitationId);
      await refetchAccountData();
      toast.success('Invitation revoked successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to revoke invitation.';
      toast.error(message);
    } finally {
      setRevokingInvitationId(null);
    }
  }, [membership, refetchAccountData, toast]);

  const handleUpdateMemberRole = useCallback(async (membershipId: string, newRole: 'owner' | 'admin' | 'member') => {
    if (!membership || !membership.account) return;
    if (!canManageAccountTeam(membership.membership)) return;

    setUpdatingRoleId(membershipId);

    try {
      await updateMemberRole(membershipId, newRole);
      await refetchAccountData();
      toast.success('Member role updated successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update member role.';
      toast.error(message);
    } finally {
      setUpdatingRoleId(null);
    }
  }, [membership, refetchAccountData, toast]);

  const handleRequestRemoveMember = useCallback((membershipId: string, memberName: string) => {
    if (!membership || !membership.account) return;
    if (!canManageAccountTeam(membership.membership)) return;
    setMemberToRemove({ membershipId, memberName });
  }, [membership]);

  const handleConfirmRemoveMember = useCallback(async () => {
    if (!memberToRemove) return;
    if (!membership || !membership.account) return;
    if (!canManageAccountTeam(membership.membership)) return;

    const { membershipId } = memberToRemove;
    setRemovingMemberId(membershipId);

    try {
      await removeMemberFromAccount(membershipId);
      await refetchAccountData();
      setMemberToRemove(null);
      toast.success('Member removed successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to remove member.';
      toast.error(message);
    } finally {
      setRemovingMemberId(null);
    }
  }, [memberToRemove, membership, refetchAccountData, toast]);

  const handleUnblock = useCallback(async (entryId: string) => {
    if (!membership?.account) return;
    setUnblockingId(entryId);
    try {
      await removeBlockEntry(membership.account.id, entryId);
      await refetchAccountData();
    } catch (error: unknown) {
      console.error('Failed to unblock:', error);
    } finally {
      setUnblockingId(null);
    }
  }, [membership, refetchAccountData]);

  const sectionTitleClass = isMobile
    ? 'text-lg font-instrument-semibold text-white pb-2 mb-3 border-b border-[#2A2A2A]'
    : 'text-lg font-instrument-semibold text-white pb-2 mb-4 border-b border-[#2A2A2A]';
  /** Notifications card uses a row header (title + action); border/spacing live on the row. */
  const sectionNotificationsTitleClass = 'text-lg font-instrument-semibold text-white';
  const sectionCardVariant = 'card';
  const sectionCardClassName = isMobile ? 'mb-5' : 'mb-8 p-5';

  const sections = useMemo((): BalancedSection[] => {
    const base: BalancedSection[] = [
      {
        id: 'profile',
        groupLabel: 'Profile & account',
        content: (
          <AccountProfileSection
            cardVariant={sectionCardVariant}
            cardClassName={sectionCardClassName}
            titleClassName={sectionTitleClass}
            nameInput={nameInput}
            onNameChange={handleNameChange}
            profile={profile}
            userEmail={userEmail}
            savingProfile={savingProfile}
            onSaveProfile={handleSaveProfile}
          />
        ),
      },
      ...(membership?.account
        ? [
            {
              id: 'notifications',
              groupLabel: 'Profile & account',
              content: (
                <AccountNotificationsSection
                  accountId={membership.account.id}
                  cardVariant={sectionCardVariant}
                  cardClassName={sectionCardClassName}
                  titleClassName={sectionNotificationsTitleClass}
                  initialPrefs={settings.data?.prefs}
                  initialSubCount={settings.data?.subCount}
                />
              ),
            } satisfies BalancedSection,
          ]
        : []),
      {
        id: 'company',
        groupLabel: 'Team',
        content: (
          <AccountCompanySection
            cardVariant={sectionCardVariant}
            cardClassName={sectionCardClassName}
            titleClassName={sectionTitleClass}
            companyInput={companyInput}
            onCompanyChange={handleCompanyChange}
            membership={membership}
            isOwner={isOwner}
            savingAccount={savingAccount}
            onSaveAccount={handleSaveAccount}
          />
        ),
      },
    ];
    if (membership?.account) {
      base.push({
        id: 'api-keys',
        groupLabel: 'Integrations',
        content: canManageTeam ? (
            <AccountApiKeysSection
              anchorRef={accountIntegrationsRef}
              account={membership.account}
              cardVariant={sectionCardVariant}
              cardClassName={sectionCardClassName}
              titleClassName={sectionTitleClass}
              headerTitleClassName={sectionNotificationsTitleClass}
              initialKeys={settings.data?.apiKeys}
            />
        ) : (
          <Card variant={sectionCardVariant} className={sectionCardClassName ?? ''}>
            <Text className={sectionTitleClass}>API Keys</Text>
            <Text className="text-sm text-gray-400">
              Owners and admins can manage account API keys.
            </Text>
          </Card>
        ),
      });
      base.push({
        id: 'webhooks',
        groupLabel: 'Integrations',
        content: canManageTeam ? (
          <AccountWebhooksSection
            anchorRef={accountWebhooksRef}
            account={membership.account}
            cardVariant={sectionCardVariant}
            cardClassName={sectionCardClassName}
            titleClassName={sectionTitleClass}
            headerTitleClassName={sectionNotificationsTitleClass}
            onAccountUpdated={refetch}
            initialFailedDeliveryCount={settings.data?.webhookFailedDeliveryCount}
          />
        ) : (
          <Card variant={sectionCardVariant} className={sectionCardClassName ?? ''}>
            <Text className={sectionTitleClass}>Webhooks</Text>
            <Text className="text-sm text-gray-400">
              Owners and admins can manage account webhook settings.
            </Text>
          </Card>
        ),
      });
      base.push({
        id: 'team-members',
        groupLabel: 'Team',
        content: (
          <AccountTeamMembersSection
            cardVariant={sectionCardVariant}
            cardClassName={sectionCardClassName}
            titleClassName={sectionTitleClass}
            teamMembers={teamMembers}
            profile={profile}
            canManageTeam={canManageTeam}
            inviteEmailInput={inviteEmailInput}
            setInviteEmailInput={setInviteEmailInput}
            onInviteTeamMember={handleInviteTeamMember}
            inviting={inviting}
            updatingRoleId={updatingRoleId}
            setRoleEditMember={setRoleEditMember}
            onUpdateMemberRole={handleUpdateMemberRole}
            onRequestRemoveMember={handleRequestRemoveMember}
            removingMemberId={removingMemberId}
            invitations={invitations}
            onRevokeInvitation={handleRevokeInvitation}
            revokingInvitationId={revokingInvitationId}
          />
        ),
      });
    }
    base.push({
      id: 'block-list',
      groupLabel: 'Tools',
      content: (
        <AccountBlockListSection
          cardVariant={sectionCardVariant}
          cardClassName={sectionCardClassName}
          titleClassName={sectionTitleClass}
          onOpenModal={() => setBlockListModalVisible(true)}
        />
      ),
    });
    if (!isMobile) {
      base.push({
        id: 'smartlead',
        groupLabel: 'Tools',
        content: (
          <AccountSmartleadSection
            cardVariant={sectionCardVariant}
            cardClassName={sectionCardClassName}
            titleClassName={sectionTitleClass}
            smartleadRun={smartleadRun}
            onOpenWizard={(runId) => {
              setSelectedSmartleadRunId(runId);
              setSmartleadWizardVisible(true);
            }}
            onOpenHistory={() => setSmartleadHistoryVisible(true)}
            activeRunStatuses={ACTIVE_SMARTLEAD_RUN_STATUSES}
            getRunSummary={getSmartleadRunSummary}
          />
        ),
      });
    }
    if (isMobile && platformAdminAccess === 'allowed') {
      base.push({
        id: 'admin-tools',
        groupLabel: 'Admin',
        content: (
          <Card
            variant={sectionCardVariant}
            onPress={() => router.push('/admin')}
            className={sectionCardClassName}
          >
            <View className="flex-row items-center gap-3">
              <BuildingLibraryIcon size={22} color="#f85102" />
              <View className="flex-1">
                <Text className="text-white font-instrument-semibold text-base">Admin Tools</Text>
                <Text className="text-sm text-gray-400 font-instrument mt-1">
                  Manage accounts, invites, and platform terms.
                </Text>
              </View>
              <ChevronRightIcon size={18} color="#6b7280" />
            </View>
          </Card>
        ),
      });
    }
    return base;
  }, [
    isMobile,
    platformAdminAccess,
    router,
    sectionCardVariant,
    sectionCardClassName,
    sectionTitleClass,
    sectionNotificationsTitleClass,
    nameInput,
    handleNameChange,
    profile,
    userEmail,
    savingProfile,
    handleSaveProfile,
    companyInput,
    handleCompanyChange,
    membership,
    membership?.account,
    isOwner,
    canManageTeam,
    savingAccount,
    handleSaveAccount,
    teamMembers,
    inviteEmailInput,
    setInviteEmailInput,
    handleInviteTeamMember,
    inviting,
    updatingRoleId,
    setRoleEditMember,
    handleUpdateMemberRole,
    handleRequestRemoveMember,
    removingMemberId,
    invitations,
    handleRevokeInvitation,
    revokingInvitationId,
    smartleadRun,
    settings.data,
    refetch,
  ]);

  const signOutButton = (
    <Button variant="destructive" size="sm" onPress={() => signOut()}>
      Sign out
    </Button>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Account"
        subtitle={
          membership?.account?.name
            ? `Manage your profile and ${membership.account.name}`
            : 'Manage your profile and team'
        }
        primaryAction={!isMobile ? signOutButton : undefined}
      />

      {loadError ? (
        <Alert variant="error" message={loadError} />
      ) : settings.error && !pageLoading ? (
        <Alert
          variant="error"
          message={settings.error}
          actionText="Try again"
          onAction={() => void settings.refresh()}
        />
      ) : (
        <>
          {(pageLoading || showSkeleton || awaitingLayout) ? (
            <AccountSettingsSkeleton isMobile={isMobile} includeSmartlead={!isMobile} />
          ) : null}

          {!pageLoading ? (
          <View
            style={
              awaitingLayout
                ? { opacity: 0, position: 'absolute', width: '100%', pointerEvents: 'none' as const }
                : undefined
            }
          >
          {membershipRole === 'member' && membership?.account?.name ? (
            <View
              style={{
                maxWidth: isMobile ? undefined : DESKTOP_TWO_COLUMN_WIDTH,
                alignSelf: 'center',
                width: '100%',
              }}
              className={isMobile ? 'mb-4' : 'mb-6'}
            >
              <View className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <Text className="text-amber-200 text-sm font-instrument">
                  You're viewing {membership.account.name} as a member. Owners and admins can manage the team, but only owners can change company details.
                </Text>
              </View>
            </View>
          ) : null}

          {isMobile && memberships.length > 1 ? (
            <Card variant="card" className="mb-5">
              <Text className={sectionTitleClass}>Workspace</Text>
              <Text className="text-xs text-gray-500 font-instrument mb-4 leading-5">
                Campaigns, inbox, and senders use the account you choose. You belong to {memberships.length}{' '}
                workspaces—pick one anytime.
              </Text>
              <View className="mb-4 py-2.5 px-3 rounded-lg bg-white/[0.04] border border-[#2A2A2A]">
                <Text className="text-xs text-gray-400 font-instrument-medium mb-1">Currently viewing</Text>
                <Text className="text-gray-200 text-sm font-instrument" numberOfLines={2}>
                  {account?.name ?? 'Select account'}
                </Text>
              </View>
              <Button variant="outline" size="sm" onPress={() => setAccountSwitcherOpen(true)} className="w-full">
                Switch account
              </Button>
            </Card>
          ) : null}

          <BalancedTwoColumnLayout
            sections={sections}
            isDesktop={!isMobile}
            compact={isMobile}
            contentMaxWidth={DESKTOP_TWO_COLUMN_WIDTH}
            columnMaxWidth={DESKTOP_COLUMN_MAX_WIDTH}
            onLayoutStable={() => setLayoutStable(true)}
          />

          {isMobile && (
            <View className="mt-4 pt-4 border-t border-[#2A2A2A] gap-3">
              <Button variant="outline" size="sm" onPress={() => setHelpOpen(true)} className="w-full">
                Need help?
              </Button>
              {signOutButton}
            </View>
          )}

          <SmartleadMigrationWizardModal
                visible={smartleadWizardVisible}
                onClose={() => {
                  setSmartleadWizardVisible(false);
                  setSelectedSmartleadRunId(null);
                }}
                initialRunId={selectedSmartleadRunId}
              />
              <MigrationHistoryModal
                visible={smartleadHistoryVisible}
                onClose={() => setSmartleadHistoryVisible(false)}
                runs={smartleadRuns}
                loading={smartleadRunsLoading}
                error={smartleadRunsError}
                onReviewRun={(runId) => {
                  setSelectedSmartleadRunId(runId);
                  setSmartleadHistoryVisible(false);
                  setSmartleadWizardVisible(true);
                }}
              />

              {membership ? (
                <ManageBlockListModal
                  visible={blockListModalVisible}
                  onClose={() => setBlockListModalVisible(false)}
                  accountId={membership.account.id}
                  onUnblock={handleUnblock}
                  unblockingId={unblockingId}
                  suppressBouncedEmails={membership.account.suppress_bounced_emails !== false}
                  onSuppressBouncedChange={handleSuppressBouncedChange}
                  savingSuppressBounced={savingSuppressBounced}
                  isOwner={!!isOwner}
                />
              ) : null}

              <BottomSheet
                visible={accountSwitcherOpen}
                onClose={() => setAccountSwitcherOpen(false)}
              >
                <WorkspaceSwitcherContent
                  memberships={memberships}
                  currentAccountId={account?.id ?? null}
                  onChange={(id) => setCurrentAccountId(id)}
                  listMaxHeight={320}
                />
              </BottomSheet>

              <BaseModal
                visible={roleEditMember !== null}
                onClose={() => setRoleEditMember(null)}
                title="Change role"
                description={roleEditMember ? `Set role for ${roleEditMember.memberName}` : undefined}
                compact
                footer={
                  <ModalFooter>
                    {(['owner', 'admin', 'member'] as const).map((role) => (
                      <Button
                        key={role}
                        size="sm"
                        variant="outline"
                        onPress={async () => {
                          if (!roleEditMember) return;
                          await handleUpdateMemberRole(roleEditMember.membershipId, role);
                          setRoleEditMember(null);
                        }}
                        disabled={updatingRoleId === roleEditMember?.membershipId}
                      >
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </Button>
                    ))}
                  </ModalFooter>
                }
              />

              <ConfirmDeleteModal
                visible={memberToRemove !== null}
                onClose={() => setMemberToRemove(null)}
                onConfirm={handleConfirmRemoveMember}
                title="Remove team member?"
                itemName={memberToRemove?.memberName}
                description="They will lose access to this workspace. This cannot be undone."
                confirmLabel="Remove"
                isLoading={removingMemberId !== null}
                requireConfirmation={false}
              />

              <HelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} />
          </View>
          ) : null}
        </>
      )}
    </PageLayout>
  );
}

