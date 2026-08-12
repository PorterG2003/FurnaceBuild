import type { CapturedRoster } from './rosterTypes.ts';
import { classifyHostKind, hostPrefix, normalizeHost } from './rosterHosts.ts';

export type CaptureIntegrity = {
  host: string;
  count: number;
  kind: 'regional' | 'personal' | 'unknown' | 'suspicious_tiny';
  trustedForCoverage: boolean;
  reason: string;
};

/**
 * Tiny non-state hosts that return a single agent are usually personal aliases
 * or broken/default responses, not regional MLS coverage.
 */
export function assessCaptureIntegrity(capture: CapturedRoster): CaptureIntegrity {
  const host = normalizeHost(capture.host);
  const prefix = hostPrefix(host);
  const count = capture.count ?? capture.agents.length;
  const kind = classifyHostKind(count, prefix);
  const isStatePrefix = /^[a-z]{2}$/i.test(prefix);

  if (count <= 1 && !isStatePrefix) {
    return {
      host,
      count,
      kind: 'suspicious_tiny',
      trustedForCoverage: false,
      reason: 'tiny non-state roster; treat as personal/alias or incomplete capture',
    };
  }

  if (kind === 'personal') {
    return {
      host,
      count,
      kind,
      trustedForCoverage: false,
      reason: 'classified as personal host',
    };
  }

  return {
    host,
    count,
    kind,
    trustedForCoverage: count >= 20 || isStatePrefix,
    reason: count >= 20 || isStatePrefix ? 'trusted regional/state host' : 'small unknown host',
  };
}

export function findDuplicateTinyCaptures(
  captures: CapturedRoster[],
): Array<{ agentId: string; hosts: string[] }> {
  const byAgent = new Map<string, string[]>();
  for (const capture of captures) {
    const integrity = assessCaptureIntegrity(capture);
    if (integrity.kind !== 'suspicious_tiny') continue;
    for (const agent of capture.agents) {
      const key = String(agent.agentid);
      const bucket = byAgent.get(key) ?? [];
      bucket.push(normalizeHost(capture.host));
      byAgent.set(key, bucket);
    }
  }
  return [...byAgent.entries()]
    .filter(([, hosts]) => hosts.length > 1)
    .map(([agentId, hosts]) => ({ agentId, hosts: [...new Set(hosts)].sort() }));
}
