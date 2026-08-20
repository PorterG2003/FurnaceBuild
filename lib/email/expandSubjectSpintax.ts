import {
  findTopLevelSpintaxGroups,
  selectSpintaxOptionIndex,
  splitTopLevelOptions,
} from './processSpintax.js';

export const MAX_SUBJECT_BRANCH_PRODUCT = 12;

export interface SubjectSpintaxGroupMeta {
  groupIndex: number;
  optionsRaw: string;
  optionCount: number;
}

export interface ExpandedSubjectBranch {
  branchKey: string;
  resolvedSubject: string;
  indices: number[];
}

export interface SubjectExpansionResult {
  branches: ExpandedSubjectBranch[];
  groups: SubjectSpintaxGroupMeta[];
}

/**
 * Expand top-level spintax groups in a subject into the Cartesian product of
 * branches. Returns a single branch with the original text when there is no
 * spintax, and falls back to the raw template when the product exceeds the cap.
 */
export function expandSubjectSpintax(subject: string): SubjectExpansionResult {
  const groups = findTopLevelSpintaxGroups(subject);
  if (groups.length === 0) {
    return {
      branches: [{ branchKey: '', resolvedSubject: subject, indices: [] }],
      groups: [],
    };
  }

  const perGroup = groups.map((g) => splitTopLevelOptions(g.inner));
  let product = 1;
  for (const opts of perGroup) {
    product *= opts.length;
    if (product > MAX_SUBJECT_BRANCH_PRODUCT) {
      return {
        branches: [{ branchKey: '', resolvedSubject: subject, indices: [] }],
        groups: [],
      };
    }
  }

  const groupMeta: SubjectSpintaxGroupMeta[] = groups.map((g, i) => ({
    groupIndex: i,
    optionsRaw: g.inner,
    optionCount: perGroup[i]!.length,
  }));

  const branches: ExpandedSubjectBranch[] = [];
  const combos = cartesian(perGroup);
  for (const combo of combos) {
    let resolved = '';
    let cursor = 0;
    for (let g = 0; g < groups.length; g++) {
      resolved += subject.slice(cursor, groups[g]!.start);
      resolved += combo.texts[g];
      cursor = groups[g]!.end;
    }
    resolved += subject.slice(cursor);
    branches.push({
      branchKey: combo.indices.join('-'),
      resolvedSubject: resolved,
      indices: combo.indices,
    });
  }

  return { branches, groups: groupMeta };
}

function* cartesian(
  optionSets: string[][],
): Generator<{ indices: number[]; texts: string[] }> {
  if (optionSets.length === 0) {
    yield { indices: [], texts: [] };
    return;
  }
  const [first, ...rest] = optionSets;
  for (let i = 0; i < first!.length; i++) {
    for (const suffix of cartesian(rest)) {
      yield {
        indices: [i, ...suffix.indices],
        texts: [first![i]!, ...suffix.texts],
      };
    }
  }
}

/**
 * Pick the subject branch key using the same FNV path as processSpintax:
 * path = String(g) for top-level groups, scope = 'subject'.
 */
export function selectSubjectBranchKey(subject: string, seed: string): string {
  const expansion = expandSubjectSpintax(subject);
  if (expansion.groups.length === 0) return '';
  const indices = expansion.groups.map((group, i) =>
    selectSpintaxOptionIndex(group.optionCount, {
      seed,
      scope: 'subject',
      path: String(i),
      optionsRaw: group.optionsRaw,
    }),
  );
  return indices.join('-');
}

export function resolvedSubjectForBranchKey(
  subject: string,
  renderKey: string,
): string {
  const expansion = expandSubjectSpintax(subject);
  const branch = expansion.branches.find((item) => item.branchKey === renderKey);
  return branch?.resolvedSubject ?? expansion.branches[0]?.resolvedSubject ?? subject;
}
