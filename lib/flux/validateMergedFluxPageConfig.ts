import type { Block, ContentAssetType, PageConfig } from './types';
import { getFluxCopyBudgetViolations } from './fluxCopyBudgets';
import { parseInPageScrollTargetFromCtaUrl } from './fluxScrollTag';

const HTTP_PREFIX = /^https?:\/\//i;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidFluxCtaUrl(url: string): boolean {
  const t = url.trim();
  if (!t) return false;
  if (parseInPageScrollTargetFromCtaUrl(t)) return true;
  return HTTP_PREFIX.test(t);
}

const TRANSPARENCY_PREFIX = 'https://adstransparency.google.com/';

function parseContentAssetRows(raw: unknown[]): { id: string; type: ContentAssetType }[] {
  const out: { id: string; type: ContentAssetType }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.type !== 'string') continue;
    if (o.type === 'case_study' || o.type === 'testimonial' || o.type === 'stat') {
      out.push({ id: o.id, type: o.type });
    }
  }
  return out;
}

function poolIds(assets: { id: string; type: ContentAssetType }[], type: 'case_study' | 'testimonial') {
  return new Set(assets.filter((a) => a.type === type).map((a) => a.id));
}

/**
 * Post-merge semantic checks for fluxGenerate (Zod already passed).
 * Returns human-readable issue lines for LLM repair prompts.
 */
export function getMergedFluxPageConfigSemanticIssues(
  merged: PageConfig,
  contentAssetsRaw: unknown[],
): string[] {
  const assets = parseContentAssetRows(Array.isArray(contentAssetsRaw) ? contentAssetsRaw : []);
  const caseStudyIds = poolIds(assets, 'case_study');
  const testimonialIds = poolIds(assets, 'testimonial');
  const issues: string[] = [];

  const push = (block: Block, msg: string) => {
    issues.push(`Block ${block.id} (${block.type}): ${msg}`);
  };

  for (const block of merged.blocks) {
    switch (block.type) {
      case 'hero': {
        const { headline, subheadline, ctaText, ctaUrl, heroImageUrl } = block.props;
        if (!headline.trim()) push(block, 'headline is empty');
        if (!subheadline.trim()) push(block, 'subheadline is empty');
        if (!ctaText.trim()) push(block, 'ctaText is empty');
        if (!ctaUrl.trim()) push(block, 'ctaUrl is empty');
        else if (!isValidFluxCtaUrl(ctaUrl)) push(block, 'ctaUrl must be http(s) or an in-page anchor like #section');
        if (heroImageUrl && !HTTP_PREFIX.test(heroImageUrl.trim())) {
          push(block, 'heroImageUrl must start with http:// or https://');
        }
        break;
      }
      case 'cta': {
        const { headline, ctaText, ctaUrl } = block.props;
        if (!headline.trim()) push(block, 'headline is empty');
        if (!ctaText.trim()) push(block, 'ctaText is empty');
        if (!ctaUrl.trim()) push(block, 'ctaUrl is empty');
        else if (!isValidFluxCtaUrl(ctaUrl)) push(block, 'ctaUrl must be http(s) or an in-page anchor like #section');
        break;
      }
      case 'case_study': {
        const id = block.props.assetId.trim();
        if (caseStudyIds.size > 0) {
          if (!id) push(block, 'assetId is empty but content_assets includes case_study entries; pick one id');
          else if (!caseStudyIds.has(id))
            push(block, `assetId "${id}" is not a valid case_study content_assets id`);
        } else if (id) {
          push(block, 'no case_study content_assets; set assetId to "" (empty block)');
        }
        break;
      }
      case 'testimonial': {
        const id = block.props.assetId.trim();
        if (testimonialIds.size > 0) {
          if (!id) push(block, 'assetId is empty but content_assets includes testimonial entries; pick one id');
          else if (!testimonialIds.has(id))
            push(block, `assetId "${id}" is not a valid testimonial content_assets id`);
        } else if (id) {
          push(block, 'no testimonial content_assets; set assetId to "" (empty block)');
        }
        break;
      }
      case 'benefits': {
        const { heading, items } = block.props;
        if (!heading.trim()) push(block, 'heading is empty');
        if (!Array.isArray(items) || items.length < 1) {
          push(block, 'benefits.items must have at least one entry');
        } else {
          items.forEach((it, i) => {
            if (!it.title.trim()) push(block, `items[${i}].title is empty`);
            if (!it.description.trim()) push(block, `items[${i}].description is empty`);
          });
        }
        break;
      }
      case 'social_media_plan': {
        const p = block.props;
        if (!p.inferred_vertical.trim()) push(block, 'inferred_vertical is empty');
        if (!p.inferred_vertical_rationale.trim()) push(block, 'inferred_vertical_rationale is empty');
        if (!p.positioning_summary.trim()) push(block, 'positioning_summary is empty');
        if (!p.platform_mix_note.trim()) push(block, 'platform_mix_note is empty');
        if (!Array.isArray(p.cta_ladder) || !p.cta_ladder.some((s) => typeof s === 'string' && s.trim())) {
          push(block, 'cta_ladder must include at least one non-empty step');
        }
        if (!Array.isArray(p.weeks) || p.weeks.length < 1) {
          push(block, 'weeks must have at least one week');
        } else if (p.weeks.length > 4) {
          push(block, 'weeks should be at most 4 for this block');
        } else {
          p.weeks.forEach((week, wi) => {
            if (!week.theme.trim()) push(block, `weeks[${wi}].theme is empty`);
            if (!Array.isArray(week.days) || week.days.length < 1) {
              push(block, `weeks[${wi}].days must have at least one day`);
            } else {
              week.days.forEach((day, di) => {
                if (!day.platform.trim()) push(block, `weeks[${wi}].days[${di}].platform is empty`);
                if (!day.post_type.trim()) push(block, `weeks[${wi}].days[${di}].post_type is empty`);
                if (!day.hook.trim()) push(block, `weeks[${wi}].days[${di}].hook is empty`);
              });
            }
          });
        }
        break;
      }
      case 'competitor_ad_audit': {
        if (!block.props.heading.trim()) push(block, 'heading is empty');
        if (block.props.status === 'ready') {
          const p = block.props;
          if (p.competitors.length < 1 || p.competitors.length > 3) {
            push(block, 'competitors must have 1–3 rows when status is ready');
          }
          for (let i = 0; i < p.competitors.length; i += 1) {
            const row = p.competitors[i]!;
            if (!row.name?.trim()) push(block, `competitors[${i}].name is empty`);
            if (!row.mapImageUrl?.trim() || !HTTP_PREFIX.test(row.mapImageUrl.trim())) {
              push(block, `competitors[${i}].mapImageUrl must be an http(s) URL`);
            }
            if (!row.adsSummary?.trim()) push(block, `competitors[${i}].adsSummary is empty`);
            if (!Array.isArray(row.examples) || row.examples.length < 1 || row.examples.length > 2) {
              push(block, `competitors[${i}].examples must have 1 or 2 items`);
            } else {
              row.examples.forEach((ex, j) => {
                if (!ex.headline?.trim()) push(block, `competitors[${i}].examples[${j}].headline is empty`);
                if (!ex.body?.trim()) push(block, `competitors[${i}].examples[${j}].body is empty`);
                const u = ex.sourceUrl?.trim() ?? '';
                if (!u.startsWith(TRANSPARENCY_PREFIX)) {
                  push(block, `competitors[${i}].examples[${j}].sourceUrl must start with ${TRANSPARENCY_PREFIX}`);
                }
              });
            }
          }
        }
        break;
      }
      case 'quiz_and_book': {
        const p = block.props;
        if (!p.heading.trim()) push(block, 'heading is empty');
        if (!p.subheading.trim()) push(block, 'subheading is empty');
        if (!p.summaryHeading.trim()) push(block, 'summaryHeading is empty');
        if (!p.summaryBody.trim()) push(block, 'summaryBody is empty');
        if (!p.calendlyUrl.trim()) push(block, 'calendlyUrl is empty');
        else if (!HTTP_PREFIX.test(p.calendlyUrl.trim())) {
          push(block, 'calendlyUrl must start with http:// or https://');
        }
        if (p.destinationEmail?.trim() && !SIMPLE_EMAIL.test(p.destinationEmail.trim())) {
          push(block, 'destinationEmail must be a valid email address when provided');
        }
        if (!Array.isArray(p.questions) || p.questions.length < 1) {
          push(block, 'questions must include at least one step');
          break;
        }
        p.questions.forEach((question, qi) => {
          if (!question.prompt.trim()) push(block, `questions[${qi}].prompt is empty`);
          const needsOptions =
            question.type === 'single_select' ||
            question.type === 'multi_select' ||
            question.type === 'dropdown';
          if (needsOptions) {
            if (!Array.isArray(question.options) || question.options.length < 2) {
              push(block, `questions[${qi}].options must include at least two options`);
              return;
            }
            question.options.forEach((option, oi) => {
              if (!option.label.trim()) push(block, `questions[${qi}].options[${oi}].label is empty`);
            });
          }
        });
        break;
      }
      default:
        break;
    }
  }

  issues.push(...getFluxCopyBudgetViolations(merged));

  return issues;
}

/** Join semantic issues for OpenRouter repair prompt (bounded size). */
export function formatMergedFluxSemanticIssuesForRepair(issues: string[], maxLen = 600): string {
  const body = issues.map((s) => `- ${s}`).join('\n');
  const full = `Semantic issues:\n${body}`;
  return full.length > maxLen ? `${full.slice(0, maxLen)}…` : full;
}
