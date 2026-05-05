import type { FluxCampaignEditorState } from '@/lib/flux/editor/reducer';

export const FLUX_METHODOLOGY_SECTION_MARKERS = [
  'WHO_ITS_FOR',
  'INPUTS',
  'DELIVERABLE',
  'HOOK',
  'WOW',
  '60S_TEST',
  'HONESTY',
] as const;

export const FLUX_CONSTRAINTS_SKELETON = [
  'WHO_ITS_FOR:',
  '- Primary audience and why this page exists for them.',
  '',
  'INPUTS:',
  '- What Flux already knows per lead (URL, company, notes, role, etc.).',
  '',
  'DELIVERABLE:',
  '- The tangible outcome the reader gets in under 60 seconds.',
  '',
  'HOOK:',
  '- Why this decision-maker says yes right now.',
  '',
  'WOW:',
  '- What makes the page feel bespoke and personally built.',
  '',
  '60S_TEST:',
  '- After a short scroll, the reader should be able to answer or do one concrete thing.',
  '',
  'HONESTY:',
  '- What not to invent and how to handle missing facts.',
].join('\n');

export interface FluxCampaignQaStructuralCheck {
  id:
    | 'offer_context'
    | 'written_spec'
    | 'personalization_surface'
    | 'page_skeleton'
    | 'proof_path'
    | 'deliverable_primitive'
    | 'crucible_lead'
    | 'ai_proof_pass';
  label: string;
  description: string;
  passed: boolean;
}

export interface FluxCampaignQaStatus {
  structural: FluxCampaignQaStructuralCheck[];
  structuralPassedCount: number;
  isStructuralComplete: boolean;
  isComplete: boolean;
}

interface FluxCampaignQaInput {
  editor: Pick<
    FluxCampaignEditorState,
    'name' | 'offerDescription' | 'blocks' | 'contentAssets' | 'copySlots' | 'constraints' | 'previewProspect'
  >;
  studioUnlocked: boolean;
  previewFresh: boolean;
}

const STRUCTURAL_THRESHOLDS = {
  offerDescriptionMinLength: 40,
  constraintsMinLength: 160,
  copySlotsMinCount: 3,
};

const DEFAULT_PREVIEW_NAME = 'Preview contact';
const DEFAULT_PREVIEW_COMPANY = 'Preview company';

export function parseFluxCopySlots(value: string): string[] {
  return value
    .split(',')
    .map((slot) => slot.trim())
    .filter(Boolean);
}

function constraintsHasSection(constraints: string, marker: (typeof FLUX_METHODOLOGY_SECTION_MARKERS)[number]) {
  return new RegExp(`(^|\\n)${marker}:`, 'i').test(constraints);
}

function hasMethodologySections(constraints: string) {
  return FLUX_METHODOLOGY_SECTION_MARKERS.every((marker) => constraintsHasSection(constraints, marker));
}

function hasConditionalProofWaiver(constraints: string) {
  return /(proof\s+tbd|generic proof|social proof pending|no proof available)/i.test(constraints);
}

function hasCopyOnlyWaiver(constraints: string) {
  return /(deliverable is copy-only|copy-only deliverable|no calculator needed)/i.test(constraints);
}

function needsCustomDeliverablePrimitive(source: string) {
  return /(calculator|estimate|projection|savings|score|audit|analysis|tool|compare|plan)/i.test(source);
}

function hasCustomDeliverablePrimitive(editor: FluxCampaignQaInput['editor']) {
  return editor.blocks.some(
    (block) =>
      block.type === 'tanners_tax_strategy' ||
      block.type === 'social_media_plan' ||
      block.type === 'competitor_ad_audit' ||
      block.type === 'quiz_and_book',
  );
}

function hasCrucibleLead(editor: FluxCampaignQaInput['editor']) {
  const lead = editor.previewProspect;
  const hasName = lead.name.trim().length > 0 && lead.name.trim() !== DEFAULT_PREVIEW_NAME;
  const hasCompany = lead.company.trim().length > 0 && lead.company.trim() !== DEFAULT_PREVIEW_COMPANY;
  const stressSignal = [
    lead.url,
    lead.email_notes,
    lead.role,
    lead.industry,
    lead.company_size,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  return hasName && hasCompany && stressSignal;
}

export function deriveFluxCampaignQaStatus(input: FluxCampaignQaInput): FluxCampaignQaStatus {
  const { editor, previewFresh, studioUnlocked } = input;
  const copySlots = parseFluxCopySlots(editor.copySlots);
  const constraints = editor.constraints.trim();
  const offerDescription = editor.offerDescription.trim();
  const hasProofBlocks = editor.blocks.some((block) => block.type === 'case_study' || block.type === 'testimonial');
  const hasProofAssets = editor.contentAssets.some(
    (asset) => asset.type === 'case_study' || asset.type === 'testimonial',
  );
  const deliverableSource = `${editor.name}\n${offerDescription}\n${constraints}`;
  const structural: FluxCampaignQaStructuralCheck[] = [
    {
      id: 'offer_context',
      label: 'Offer context exists',
      description: 'The campaign says who it is for and what the offer is trying to accomplish.',
      passed: offerDescription.length >= STRUCTURAL_THRESHOLDS.offerDescriptionMinLength || editor.name.trim().length > 0,
    },
    {
      id: 'written_spec',
      label: 'Written spec exists',
      description: 'Constraints include the methodology sections or enough detail to guide generation reliably.',
      passed:
        constraints.length >= STRUCTURAL_THRESHOLDS.constraintsMinLength || hasMethodologySections(editor.constraints),
    },
    {
      id: 'personalization_surface',
      label: 'Personalization slots exist',
      description: 'The model has enough named fields it is allowed to rewrite.',
      passed: copySlots.length >= STRUCTURAL_THRESHOLDS.copySlotsMinCount,
    },
    {
      id: 'page_skeleton',
      label: 'Page skeleton exists',
      description: 'There is a concrete page structure for the model to personalize.',
      passed: editor.blocks.length > 0,
    },
    {
      id: 'proof_path',
      label: 'Proof path is covered',
      description: 'Any proof blocks have supporting assets, or the spec explicitly notes a temporary proof waiver.',
      passed: !hasProofBlocks || hasProofAssets || hasConditionalProofWaiver(editor.constraints),
    },
    {
      id: 'deliverable_primitive',
      label: 'Deliverable primitive is covered',
      description:
        'Calculator- or plan-style offers use a matching custom block (e.g. tax calculator, social media plan), or the spec explicitly says the deliverable is copy-only.',
      passed:
        !needsCustomDeliverablePrimitive(deliverableSource) ||
        hasCustomDeliverablePrimitive(editor) ||
        hasCopyOnlyWaiver(editor.constraints),
    },
    {
      id: 'crucible_lead',
      label: 'Sample lead is realistic',
      description: 'The preview lead is not the placeholder and includes enough context to stress-test the page.',
      passed: hasCrucibleLead(editor),
    },
    {
      id: 'ai_proof_pass',
      label: 'AI preview is current',
      description: 'At least one AI preview has run and the current editor state does not need a fresh rerender.',
      passed: studioUnlocked && previewFresh,
    },
  ];

  const structuralPassedCount = structural.filter((row) => row.passed).length;
  const isStructuralComplete = structuralPassedCount === structural.length;
  const isComplete = isStructuralComplete;

  return {
    structural,
    structuralPassedCount,
    isStructuralComplete,
    isComplete,
  };
}
