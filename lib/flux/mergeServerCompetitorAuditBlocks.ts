import type { CompetitorAdAuditBlock, PageConfig } from './types';

function clonePageConfig(config: PageConfig): PageConfig {
  return JSON.parse(JSON.stringify(config)) as PageConfig;
}

/**
 * Preserve the latest async audit payload from the server while keeping any local non-audit edits.
 * This prevents a stale editor draft from overwriting a completed competitor audit back to `running`.
 */
export function mergeServerCompetitorAuditBlocksIntoDraft(draft: PageConfig, server: PageConfig): PageConfig {
  const serverById = new Map(server.blocks.map((block) => [block.id, block]));
  const next = clonePageConfig(draft);
  next.blocks = next.blocks.map((block) => {
    if (block.type !== 'competitor_ad_audit') return block;
    const serverBlock = serverById.get(block.id);
    if (!serverBlock || serverBlock.type !== 'competitor_ad_audit') return block;

    const { lastAuditDomainReport: _omitReport, ...draftAuditProps } = block.props;
    const merged: CompetitorAdAuditBlock = {
      ...block,
      props: {
        ...draftAuditProps,
        status: serverBlock.props.status,
        errorMessage: serverBlock.props.errorMessage,
        lastAuditAt: serverBlock.props.lastAuditAt,
        competitors: serverBlock.props.competitors,
        heading: block.props.heading,
      },
    };
    return merged;
  });
  return next;
}
