import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { PageLayout } from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/LoadingState';
import { Alert } from '@/components/ui/Alert';
import {
  AccountMembership,
  addUserToAccount,
  createAccount,
  createInvitation,
  createUserProfile,
  deleteInvitation,
  getAccountInvitations,
  getAccountMembers,
  getAccountMembershipsForUser,
  getUserByEmail,
  getUserByExternalId,
  removeMemberFromAccount,
  updateAccount,
  updateMemberRole,
  updateUserProfile,
} from '@/lib/supabase/services';
import { sendInvitationEmail } from '@/lib/services/email';
import type { AccountUser, Invitation, User } from '@/lib/supabase/types';

export default function AccountPage() {
  const { user } = useAuthenticator();
  const externalId = user?.userId ?? null;
  const loginId = user?.signInDetails?.loginId ?? null;
  const username = user?.username ?? null;
  const cognitoEmail =
    (user as any)?.attributes?.email ??
    (user as any)?.attributes?.preferred_username ??
    loginId ??
    null;

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [profile, setProfile] = useState<User | null>(null);
  const [membership, setMembership] = useState<AccountMembership | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ user: User; membership: AccountUser }>>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState('');
  const [companyInput, setCompanyInput] = useState('');
  const [inviteEmailInput, setInviteEmailInput] = useState('');

  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [inviting, setInviting] = useState(false);

  const buildDefaultAccountName = useCallback(
    (currentName?: string | null) => {
      if (currentName && currentName.trim().length > 0) {
        return `${currentName.trim()}'s Account`;
      }
      if (username && username.trim().length > 0) {
        return `${username.trim()}'s Account`;
      }
      if (loginId && loginId.trim().length > 0) {
        return `${loginId.trim()}'s Account`;
      }
      return 'New Account';
    },
    [loginId, username]
  );

  const resetProfileFeedback = useCallback(() => {
    setProfileMessage(null);
    setProfileError(null);
  }, []);

  const resetAccountFeedback = useCallback(() => {
    setAccountMessage(null);
    setAccountError(null);
  }, []);

  const resetInviteFeedback = useCallback(() => {
    setInviteMessage(null);
    setInviteError(null);
  }, []);

  const handleNameChange = (value: string) => {
    resetProfileFeedback();
    setNameInput(value);
  };

  const handleCompanyChange = (value: string) => {
    resetAccountFeedback();
    setCompanyInput(value);
  };

  const fetchAccountContext = useCallback(async () => {
    if (!externalId) {
      setLoadError('Unable to determine the signed-in user.');
      setIsLoading(false);
      return;
    }
    if (!cognitoEmail) {
      setLoadError('Unable to determine your email address from Cognito.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      resetProfileFeedback();
      resetAccountFeedback();

      let existingUser = await getUserByExternalId(externalId);

      if (!existingUser) {
        existingUser = await createUserProfile({
          external_id: externalId,
          email: cognitoEmail,
          name: username ?? undefined,
        });
      } else if (existingUser.email !== cognitoEmail) {
        existingUser = await updateUserProfile(existingUser.id, { email: cognitoEmail });
      }

      let memberships = await getAccountMembershipsForUser(existingUser.id);

      if (memberships.length === 0) {
        const account = await createAccount({
          name: buildDefaultAccountName(existingUser.name),
        });
        const membershipRecord = await addUserToAccount(account.id, existingUser.id, true);
        memberships = [
          {
            membership: membershipRecord,
            account,
          },
        ];
      }

      const primaryMembership =
        memberships.find((entry) => entry.membership.is_owner) ?? memberships[0] ?? null;

      setProfile(existingUser);
      setMembership(primaryMembership);
      setNameInput(existingUser.name ?? '');
      setCompanyInput(primaryMembership?.account.name ?? '');

      // Load team members and invitations if we have an account
      if (primaryMembership?.account.id) {
        const [members, pendingInvitations] = await Promise.all([
          getAccountMembers(primaryMembership.account.id),
          getAccountInvitations(primaryMembership.account.id),
        ]);
        setTeamMembers(members);
        setInvitations(pendingInvitations);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [
    buildDefaultAccountName,
    cognitoEmail,
    externalId,
    resetAccountFeedback,
    resetProfileFeedback,
    username,
  ]);

  useEffect(() => {
    fetchAccountContext();
  }, [fetchAccountContext]);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;

    const trimmedName = nameInput.trim();
    if (trimmedName.length === 0) {
      setProfileError('Name cannot be empty.');
      return;
    }

    setSavingProfile(true);
    resetProfileFeedback();

    try {
      const updated = await updateUserProfile(profile.id, { name: trimmedName });
      setProfile(updated);
      setNameInput(updated.name ?? '');
      setProfileMessage('Profile updated successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update profile.';
      setProfileError(message);
    } finally {
      setSavingProfile(false);
    }
  }, [nameInput, profile]);

  const handleSaveAccount = useCallback(async () => {
    if (!membership || !membership.account) return;
    if (!membership.membership.is_owner) return;

    const trimmedCompany = companyInput.trim();
    if (trimmedCompany.length === 0) {
      setAccountError('Company name cannot be empty.');
      return;
    }

    setSavingAccount(true);
    resetAccountFeedback();

    try {
      const updatedAccount = await updateAccount(membership.account.id, { name: trimmedCompany });
      setMembership({
        membership: membership.membership,
        account: updatedAccount,
      });
      setCompanyInput(updatedAccount.name ?? '');
      setAccountMessage('Company name updated successfully.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update company name.';
      setAccountError(message);
    } finally {
      setSavingAccount(false);
    }
  }, [companyInput, membership, resetAccountFeedback]);

  const handleInviteTeamMember = useCallback(async () => {
    if (!membership || !membership.account || !profile) return;
    if (!membership.membership.is_owner) return;

    const trimmedEmail = inviteEmailInput.trim().toLowerCase();
    if (trimmedEmail.length === 0) {
      setInviteError('Please enter an email address.');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setInviteError('Please enter a valid email address.');
      return;
    }

    // Don't allow inviting yourself
    if (trimmedEmail === profile.email.toLowerCase()) {
      setInviteError('You cannot invite yourself.');
      return;
    }

    // Check if user is already a member
    const existingMember = teamMembers.find(
      (m) => m.user.email.toLowerCase() === trimmedEmail
    );
    if (existingMember) {
      setInviteError('This user is already a team member.');
      return;
    }

    // Check if there's already a pending invitation
    const existingInvitation = invitations.find(
      (inv) => inv.email.toLowerCase() === trimmedEmail
    );
    if (existingInvitation) {
      setInviteError('An invitation has already been sent to this email.');
      return;
    }

    setInviting(true);
    resetInviteFeedback();

    try {
      // Try to find existing user by email
      const existingUser = await getUserByEmail(trimmedEmail);

      if (existingUser) {
        // User exists, add them directly to the account
        await addUserToAccount(membership.account.id, existingUser.id, false);
        setInviteMessage(`${trimmedEmail} has been added to the team.`);
        // Refresh team members
        const updatedMembers = await getAccountMembers(membership.account.id);
        setTeamMembers(updatedMembers);
      } else {
        // User doesn't exist, create invitation first to get the ID
        // Then send email with the real ID, and delete invitation if email fails
        let invitation: Invitation | null = null;
        
        try {
          // Create invitation first so we have the ID for the email
          invitation = await createInvitation({
            account_id: membership.account.id,
            email: trimmedEmail,
            invited_by_user_id: profile.id,
            status: 'pending',
          });

          // Build accept URL with the real invitation ID
          const baseUrl = typeof window !== 'undefined' 
            ? window.location.origin 
            : 'https://build.getfurnace.io';
          const acceptUrl = `${baseUrl}/accept-invitation/${invitation.id}`;

          // Send invitation email with the real invitation ID
          await sendInvitationEmail({
            to: trimmedEmail,
            inviterName: profile.name || profile.email,
            inviterEmail: profile.email,
            accountName: membership.account.name,
            acceptUrl,
          });

          setInviteMessage(`Invitation sent to ${trimmedEmail}.`);
          // Refresh invitations
          const updatedInvitations = await getAccountInvitations(membership.account.id);
          setInvitations(updatedInvitations);
        } catch (emailError) {
          console.error('Failed to send invitation email:', emailError);
          
          // Email failed, delete the invitation we just created
          if (invitation) {
            try {
              await deleteInvitation(invitation.id);
            } catch (deleteError) {
              console.error('Failed to clean up invitation after email failure:', deleteError);
            }
          }
          
          // Re-throw the error so the outer catch handles it
          throw emailError;
        }
      }

      setInviteEmailInput('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send invitation.';
      setInviteError(message);
    } finally {
      setInviting(false);
    }
  }, [
    inviteEmailInput,
    membership,
    profile,
    teamMembers,
    invitations,
    resetInviteFeedback,
  ]);

  const handleRevokeInvitation = useCallback(async (invitationId: string) => {
    if (!membership || !membership.account) return;
    if (!membership.membership.is_owner) return;

    setRevokingInvitationId(invitationId);
    resetInviteFeedback();

    try {
      await deleteInvitation(invitationId);
      setInviteMessage('Invitation revoked successfully.');
      
      // Refresh invitations
      const updatedInvitations = await getAccountInvitations(membership.account.id);
      setInvitations(updatedInvitations);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to revoke invitation.';
      setInviteError(message);
    } finally {
      setRevokingInvitationId(null);
    }
  }, [membership, resetInviteFeedback]);

  const handleUpdateMemberRole = useCallback(async (membershipId: string, newRole: 'owner' | 'admin' | 'member') => {
    if (!membership || !membership.account) return;
    if (!membership.membership.is_owner) return;

    setUpdatingRoleId(membershipId);
    resetInviteFeedback();

    try {
      await updateMemberRole(membershipId, newRole);
      setInviteMessage('Member role updated successfully.');
      
      // Refresh team members
      const updatedMembers = await getAccountMembers(membership.account.id);
      setTeamMembers(updatedMembers);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update member role.';
      setInviteError(message);
    } finally {
      setUpdatingRoleId(null);
    }
  }, [membership, resetInviteFeedback]);

  const handleRemoveMember = useCallback(async (membershipId: string, memberName: string) => {
    if (!membership || !membership.account) return;
    if (!membership.membership.is_owner) return;

    // Confirm before removing
    if (typeof window !== 'undefined' && !window.confirm(`Are you sure you want to remove ${memberName} from the team?`)) {
      return;
    }

    setRemovingMemberId(membershipId);
    resetInviteFeedback();

    try {
      await removeMemberFromAccount(membershipId);
      setInviteMessage('Member removed successfully.');
      
      // Refresh team members
      const updatedMembers = await getAccountMembers(membership.account.id);
      setTeamMembers(updatedMembers);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to remove member.';
      setInviteError(message);
    } finally {
      setRemovingMemberId(null);
    }
  }, [membership, resetInviteFeedback]);

  const isOwner = membership?.membership.is_owner ?? false;
  return (
    <PageLayout contentPadding={0} scrollable={false}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: 48,
          flexGrow: 1,
        }}
      >
          {/* Header */}
          <View 
            style={{
              backgroundColor: '#121212',
              borderBottomWidth: 1,
              borderBottomColor: '#2A2A2A',
              paddingHorizontal: 24,
              paddingVertical: 16,
            }}
          >
            <Text className="text-white text-2xl font-instrument-semibold">
              Account Settings
            </Text>
            <Text className="text-gray-400 text-xs font-instrument mt-0.5">
              Manage your profile and team
            </Text>
          </View>

          {/* Content */}
          <View className="p-6 items-center">
            <View className="w-full max-w-2xl">
          {isLoading ? (
            <LoadingState message="Loading account details..." color="#f33203" />
          ) : loadError ? (
            <Alert variant="error" message={loadError} />
          ) : (
            <>
              <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg p-5 mb-4">
                <Text className="text-white text-base font-instrument-semibold mb-5">
                  Your Profile
                </Text>

                <View className="mb-4">
                  <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                    Name
                  </Text>
                  <TextInput
                    value={nameInput}
                    onChangeText={handleNameChange}
                    placeholder="Enter your name"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="words"
                    className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
                    style={{
                      borderColor: '#3A3A3A',
                      backgroundColor: '#121212',
                      color: '#FFFFFF',
                      borderWidth: 1,
                    }}
                  />
                </View>

                <View className="mb-4">
                  <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                    Email
                  </Text>
                  <Text className="text-white text-sm font-instrument mb-1.5">
                    {profile?.email ?? cognitoEmail ?? 'Not available'}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    Email comes from Cognito and cannot be edited here.
                  </Text>
                </View>

                {profileError ? (
                  <View className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <Text className="text-red-400 text-xs font-instrument-medium">
                      {profileError}
                    </Text>
                  </View>
                ) : null}

                {profileMessage ? (
                  <View className="mb-3 p-2.5 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <Text className="text-green-400 text-xs font-instrument-medium">
                      {profileMessage}
                    </Text>
                  </View>
                ) : null}

                <Button onPress={handleSaveProfile} disabled={savingProfile} size="sm" className="mt-2">
                  {savingProfile ? 'Saving...' : 'Save Name'}
                </Button>
              </View>

              <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg p-5 mb-4">
                <Text className="text-white text-base font-instrument-semibold mb-5">
                  Company
                </Text>

                {isOwner ? (
                  <View className="mb-4">
                    <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                      Company Name
                    </Text>
                    <TextInput
                      value={companyInput}
                      onChangeText={handleCompanyChange}
                      placeholder="Enter company name"
                      placeholderTextColor="#9CA3AF"
                      className="border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white"
                      style={{
                        borderColor: '#3A3A3A',
                        backgroundColor: '#121212',
                        color: '#FFFFFF',
                        borderWidth: 1,
                      }}
                    />
                    <Text className="text-xs text-gray-500 mt-1.5">
                      Company name changes apply to all collaborators.
                    </Text>
                  </View>
                ) : (
                  <View className="mb-4">
                    <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                      Company Name
                    </Text>
                    <Text className="text-white text-sm font-instrument mb-1.5">
                      {membership?.account?.name ?? 'Not available'}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      Only account owners can change the company name.
                    </Text>
                  </View>
                )}

                {accountError ? (
                  <View className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <Text className="text-red-400 text-xs font-instrument-medium">
                      {accountError}
                    </Text>
                  </View>
                ) : null}

                {accountMessage ? (
                  <View className="mb-3 p-2.5 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <Text className="text-green-400 text-xs font-instrument-medium">
                      {accountMessage}
                    </Text>
                  </View>
                ) : null}

                {isOwner && (
                  <Button onPress={handleSaveAccount} disabled={savingAccount} size="sm" className="mt-2">
                    {savingAccount ? 'Saving...' : 'Save Company Name'}
                  </Button>
                )}
              </View>

              {isOwner && membership?.account ? (
                <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg p-5">
                  <Text className="text-white text-base font-instrument-semibold mb-5">
                    Team Members
                  </Text>

                  {/* Invite Section */}
                  <View className="mb-4 pb-4 border-b border-[#2A2A2A]">
                    <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                      Invite Team Member
                    </Text>
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <TextInput
                          value={inviteEmailInput}
                          onChangeText={(value) => {
                            resetInviteFeedback();
                            setInviteEmailInput(value);
                          }}
                          placeholder="Enter email address"
                          placeholderTextColor="#9CA3AF"
                          autoCapitalize="none"
                          keyboardType="email-address"
                          className="border rounded-lg px-3 py-2 bg-[#121212] text-sm text-white"
                          style={{
                            borderColor: '#3A3A3A',
                            backgroundColor: '#121212',
                            color: '#FFFFFF',
                            borderWidth: 1,
                          }}
                        />
                      </View>
                      <Button
                        onPress={handleInviteTeamMember}
                        disabled={inviting}
                        size="sm"
                        className="px-4"
                      >
                        {inviting ? 'Sending...' : 'Invite'}
                      </Button>
                    </View>

                    {inviteError ? (
                      <View className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <Text className="text-red-400 text-xs font-instrument-medium">
                          {inviteError}
                        </Text>
                      </View>
                    ) : null}

                    {inviteMessage ? (
                      <View className="mt-2 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <Text className="text-green-400 text-xs font-instrument-medium">
                          {inviteMessage}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Current Team Members */}
                  {teamMembers.length > 0 && (
                    <View className="mb-4">
                      <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                        Current Members ({teamMembers.length})
                      </Text>
                      <View className="bg-[#121212] border border-[#2A2A2A] rounded-lg overflow-hidden">
                        {teamMembers.map((member, index) => {
                          const isCurrentUser = member.user.id === profile?.id;
                          const canManage = membership?.membership.is_owner && !isCurrentUser;
                          const currentRole = member.membership.role || (member.membership.is_owner ? 'owner' : 'member');
                          
                          return (
                            <View
                              key={member.membership.id}
                              className={`flex-row items-center justify-between px-3 py-2.5 ${
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
                                <Text className="text-gray-400 text-xs font-instrument">
                                  {member.user.email}
                                </Text>
                              </View>
                              
                              <View className="flex-row items-center gap-2">
                                {canManage && Platform.OS === 'web' ? (
                                  <select
                                    value={currentRole}
                                    onChange={(e) => handleUpdateMemberRole(member.membership.id, e.target.value as 'owner' | 'admin' | 'member')}
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
                                  <View className={`px-2 py-0.5 rounded ${
                                    currentRole === 'owner' 
                                      ? 'bg-brand-orange/20 border border-brand-orange/30' 
                                      : currentRole === 'admin'
                                      ? 'bg-blue-500/20 border border-blue-500/30'
                                      : 'bg-gray-500/20 border border-gray-500/30'
                                  }`}>
                                    <Text className={`text-xs font-instrument-medium capitalize ${
                                      currentRole === 'owner'
                                        ? 'text-brand-orange'
                                        : currentRole === 'admin'
                                        ? 'text-blue-400'
                                        : 'text-gray-400'
                                    }`}>
                                      {currentRole}
                                    </Text>
                                  </View>
                                )}
                                
                                {canManage && (
                                  <TouchableOpacity
                                    onPress={() => handleRemoveMember(member.membership.id, member.user.name || member.user.email)}
                                    disabled={removingMemberId === member.membership.id}
                                    className="px-2 py-1 rounded bg-red-500/10 border border-red-500/20 active:bg-red-500/20"
                                    activeOpacity={0.7}
                                  >
                                    {removingMemberId === member.membership.id ? (
                                      <ActivityIndicator size="small" color="#ef4444" />
                                    ) : (
                                      <Text className="text-red-400 text-xs font-instrument-medium">
                                        Remove
                                      </Text>
                                    )}
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Pending Invitations */}
                  {invitations.length > 0 && (
                    <View>
                      <Text className="text-xs text-gray-400 font-instrument-medium mb-2">
                        Pending Invitations ({invitations.length})
                      </Text>
                      <View className="bg-[#121212] border border-[#2A2A2A] rounded-lg overflow-hidden">
                        {invitations.map((invitation, index) => (
                          <View
                            key={invitation.id}
                            className={`flex-row items-center justify-between px-3 py-2 ${
                              index < invitations.length - 1 ? 'border-b border-[#2A2A2A]' : ''
                            }`}
                          >
                            <View className="flex-1 mr-2">
                              <Text className="text-white text-sm font-instrument mb-0.5">
                                {invitation.email}
                              </Text>
                              <Text className="text-gray-500 text-xs font-instrument">
                                Pending
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => handleRevokeInvitation(invitation.id)}
                              disabled={revokingInvitationId === invitation.id}
                              className="px-2 py-1 rounded bg-red-500/10 border border-red-500/20 active:bg-red-500/20"
                              activeOpacity={0.7}
                            >
                              {revokingInvitationId === invitation.id ? (
                                <ActivityIndicator size="small" color="#ef4444" />
                              ) : (
                                <Text className="text-red-400 text-xs font-instrument-medium">
                                  Revoke
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ) : null}
            </>
          )}
            </View>
          </View>
        </ScrollView>
    </PageLayout>
  );
}

