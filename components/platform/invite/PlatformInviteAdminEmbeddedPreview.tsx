import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlatformInvitePreviewFrame } from '@/components/platform/invite/PlatformInvitePreviewFrame';
import type { PlatformInvitePreviewViewport } from '@/components/platform/invite/PlatformInvitePreviewFrame';
import {
  buildAdminInvitePreviewUrl,
  storePlatformInvitePreviewDraft,
} from '@/lib/platform/invite/preview';
import type { PlatformContractViewData } from '@/lib/platform/contract/types';

type DraftPreviewProps = {
  source: 'draft';
  draftData: PlatformContractViewData | null;
  label?: string;
  headerRight?: ReactNode;
  showControls?: boolean;
  showTitle?: boolean;
  initialViewport?: PlatformInvitePreviewViewport;
  viewport?: PlatformInvitePreviewViewport;
  onViewportChange?: (viewport: PlatformInvitePreviewViewport) => void;
  showViewportControls?: boolean;
};

type RevisionPreviewProps = {
  source: 'revision';
  invitationId: string | null | undefined;
  revisionNumber?: number | null;
  label?: string;
  headerRight?: ReactNode;
  showControls?: boolean;
  showTitle?: boolean;
  initialViewport?: PlatformInvitePreviewViewport;
  viewport?: PlatformInvitePreviewViewport;
  onViewportChange?: (viewport: PlatformInvitePreviewViewport) => void;
  showViewportControls?: boolean;
};

type Props = DraftPreviewProps | RevisionPreviewProps;

export function PlatformInviteAdminEmbeddedPreview({
  label,
  headerRight,
  showControls,
  showTitle,
  initialViewport,
  viewport,
  onViewportChange,
  showViewportControls,
  ...props
}: Props) {
  const draftKeyRef = useRef<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const draftData = props.source === 'draft' ? props.draftData : null;
  const invitationId = props.source === 'revision' ? props.invitationId : null;
  const revisionNumber = props.source === 'revision' ? props.revisionNumber : null;

  const serializedDraft = useMemo(() => {
    if (!draftData) return null;
    return JSON.stringify(draftData);
  }, [draftData]);

  useEffect(() => {
    if (props.source !== 'draft') {
      draftKeyRef.current = null;
      setDraftKey(null);
      return;
    }

    if (!draftData || typeof window === 'undefined') {
      draftKeyRef.current = null;
      setDraftKey(null);
      return;
    }

    try {
      const nextDraftKey = storePlatformInvitePreviewDraft(
        draftData,
        draftKeyRef.current ?? undefined,
      );
      draftKeyRef.current = nextDraftKey;
      setDraftKey(nextDraftKey);
      setDraftVersion((current) => current + 1);
    } catch {
      draftKeyRef.current = null;
      setDraftKey(null);
    }
  }, [draftData, props.source, serializedDraft]);

  const iframeSrc = useMemo(() => {
    if (props.source === 'revision') {
      if (!invitationId) return null;
      return buildAdminInvitePreviewUrl({
        invitationId,
        revisionNumber,
        embedded: true,
      });
    }

    if (!draftKey) return null;
    return buildAdminInvitePreviewUrl({ draftKey, embedded: true });
  }, [draftKey, invitationId, props.source, revisionNumber]);

  const frameKey =
    props.source === 'revision'
      ? `revision:${invitationId ?? 'missing'}:${revisionNumber ?? 'current'}`
      : `draft:${draftKey ?? 'missing'}:${draftVersion}`;

  return (
    <PlatformInvitePreviewFrame
      key={frameKey}
      variant="iframe"
      iframeSrc={iframeSrc}
      label={label}
      headerRight={headerRight}
      showControls={showControls}
      showTitle={showTitle}
      initialViewport={initialViewport}
      viewport={viewport}
      onViewportChange={onViewportChange}
      showViewportControls={showViewportControls}
    />
  );
}
