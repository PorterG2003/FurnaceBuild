type InvitationRevisionPointers = {
  current_revision_number: number;
  published_revision_number: number | null;
  sent_at?: string | null;
  status: string;
};

export function getInvitationHasUnpublishedChanges(invitation: InvitationRevisionPointers): boolean {
  return (
    invitation.published_revision_number != null &&
    invitation.current_revision_number !== invitation.published_revision_number
  );
}

export function getInvitationIsPublished(invitation: InvitationRevisionPointers): boolean {
  return invitation.published_revision_number != null;
}

export function getInvitationPublishActionLabel(invitation: InvitationRevisionPointers): string {
  if (!getInvitationIsPublished(invitation)) {
    return 'Publish';
  }
  if (getInvitationHasUnpublishedChanges(invitation)) {
    return 'Publish';
  }
  return 'Resend';
}

export function getInvitationPublishConfirmTitle(invitation: InvitationRevisionPointers): string {
  if (!getInvitationIsPublished(invitation)) {
    return 'Publish to client?';
  }
  if (getInvitationHasUnpublishedChanges(invitation)) {
    return 'Publish changes to client?';
  }
  return 'Resend invite email?';
}

export function getInvitationPublishConfirmMessage(invitation: InvitationRevisionPointers): string {
  if (!getInvitationIsPublished(invitation)) {
    return 'This publishes the current package and emails the client their invite link.';
  }
  if (getInvitationHasUnpublishedChanges(invitation)) {
    return 'This replaces the live client package with your latest draft and emails the client again.';
  }
  return 'This sends the invite email again without changing the live package.';
}

export function getInvitationPublishConfirmLabel(invitation: InvitationRevisionPointers): string {
  if (!getInvitationIsPublished(invitation)) {
    return 'Publish';
  }
  if (getInvitationHasUnpublishedChanges(invitation)) {
    return 'Publish';
  }
  return 'Send';
}

export function getPublishedRevision(
  revisions: Array<{ revision_number: number; is_published?: boolean }>,
  publishedRevisionNumber: number | null,
) {
  if (publishedRevisionNumber == null) return null;
  return (
    revisions.find((revision) => revision.revision_number === publishedRevisionNumber) ??
    revisions.find((revision) => revision.is_published) ??
    null
  );
}

export type ClientLinkPillTone = 'live' | 'offline' | 'drift';

function formatUsdCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function shouldShowInvitationClientLinkPill(invitation: InvitationRevisionPointers): boolean {
  return !['pending_payment', 'active'].includes(invitation.status);
}

export function getInvitationClientLinkPill(
  invitation: InvitationRevisionPointers,
): { label: string; tone: ClientLinkPillTone } | null {
  if (!shouldShowInvitationClientLinkPill(invitation)) {
    return null;
  }

  if (invitation.published_revision_number == null) {
    return { label: 'Offline', tone: 'offline' };
  }

  if (getInvitationHasUnpublishedChanges(invitation)) {
    return {
      label: `Live v${invitation.published_revision_number} • Draft v${invitation.current_revision_number}`,
      tone: 'drift',
    };
  }

  return {
    label: `Live (v${invitation.published_revision_number})`,
    tone: 'live',
  };
}

export function getDefaultPreviewRevisionNumber(invitation: InvitationRevisionPointers): number {
  if (invitation.published_revision_number != null) {
    return invitation.published_revision_number;
  }
  return invitation.current_revision_number;
}

export type RevisionPreviewOptionInput = {
  revision_number: number;
  monthly_retainer_cents: number;
  is_published?: boolean;
  is_current?: boolean;
};

export function formatRevisionPreviewOption(revision: RevisionPreviewOptionInput): string {
  const base = `v${revision.revision_number} • ${formatUsdCents(revision.monthly_retainer_cents)}`;
  if (revision.is_published) {
    return `${base} • Live (client sees this)`;
  }
  if (revision.is_current) {
    return `${base} • Current draft`;
  }
  return base;
}
