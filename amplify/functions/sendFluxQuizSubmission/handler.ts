import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { coercePageConfig } from '../../../lib/flux/coercePageConfig';
import {
  formatQuizAndBookAnswer,
  normalizeQuizAndBookResponseValue,
  type QuizAndBookResponseValue,
} from '../../../lib/flux/fluxQuizAndBook';
import { buildFluxQuizSubmissionEmail } from '../../../lib/email/transactional/presets/fluxQuizSubmission.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FALLBACK_DESTINATION_EMAIL = 'porter@getfurnace.io';

type FunctionUrlEvent = {
  headers?: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type QuizSubmissionRequest = {
  slug: string;
  blockId: string;
  answers: Record<string, unknown>;
};

function response(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event: FunctionUrlEvent): QuizSubmissionRequest {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body
    : '{}';
  const parsed = JSON.parse(raw) as Partial<QuizSubmissionRequest>;
  if (typeof parsed.slug !== 'string' || !parsed.slug.trim()) {
    throw new Error('Missing slug');
  }
  if (typeof parsed.blockId !== 'string' || !parsed.blockId.trim()) {
    throw new Error('Missing blockId');
  }
  if (!parsed.answers || typeof parsed.answers !== 'object' || Array.isArray(parsed.answers)) {
    throw new Error('Missing answers');
  }
  return {
    slug: parsed.slug.trim(),
    blockId: parsed.blockId.trim(),
    answers: parsed.answers,
  };
}

export const handler = async (event: FunctionUrlEvent) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseSecretKey) {
      return response(500, { error: 'Server configuration error' });
    }

    const { slug, blockId, answers } = parseBody(event);
    const supabase = createClient(supabaseUrl, supabaseSecretKey);

    const { data: page, error: pageError } = await supabase
      .from('flux_prospect_pages')
      .select('id, slug, status, prospect_id, page_config, published_at, updated_at')
      .eq('slug', slug)
      .maybeSingle();
    if (pageError) {
      return response(500, { error: 'Database error loading page', details: pageError.message });
    }
    if (!page || page.status !== 'live') {
      return response(404, { error: 'Live page not found' });
    }

    const config = coercePageConfig(page.page_config);
    if (!config) {
      return response(400, { error: 'Page config is not renderable' });
    }
    const block = config.blocks.find((candidate) => candidate.id === blockId);
    if (!block || block.type !== 'quiz_and_book') {
      return response(404, { error: 'Quiz block not found' });
    }

    const { data: prospect } = await supabase
      .from('flux_prospects')
      .select('name, company, role, url, industry, company_size, email_notes')
      .eq('id', page.prospect_id)
      .maybeSingle();

    const answerRows = block.props.questions
      .map((question) => {
        const normalized = normalizeQuizAndBookResponseValue(question, answers[question.id]);
        const answerText = formatQuizAndBookAnswer(question, normalized as QuizAndBookResponseValue | undefined);
        return {
          question,
          answerText,
          normalized,
        };
      })
      .filter((row) => row.answerText.trim().length > 0);

    if (answerRows.length === 0) {
      return response(400, { error: 'At least one answer is required' });
    }

    const destinationEmail = block.props.destinationEmail?.trim() || FALLBACK_DESTINATION_EMAIL;
    const pageUrl = `${process.env.WEB_APP_ORIGIN ?? 'https://build.getfurnace.io'}/p/${page.slug}`;
    const prospectName =
      (prospect && typeof prospect.name === 'string' && prospect.name.trim()) || config.prospectName.trim() || 'Unknown prospect';
    const companyName =
      (prospect && typeof prospect.company === 'string' && prospect.company.trim()) || config.companyName.trim() || 'Unknown company';

    const prospectDetails = [
      ['Prospect', prospectName],
      ['Company', companyName],
      ['Role', typeof prospect?.role === 'string' ? prospect.role.trim() : ''],
      ['Website', typeof prospect?.url === 'string' ? prospect.url.trim() : ''],
      ['Industry', typeof prospect?.industry === 'string' ? prospect.industry.trim() : ''],
      ['Company size', typeof prospect?.company_size === 'string' ? prospect.company_size.trim() : ''],
      ['Page URL', pageUrl],
      ['Page slug', page.slug],
      ['Published at', typeof page.published_at === 'string' ? page.published_at : ''],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));

    const notes =
      typeof prospect?.email_notes === 'string' && prospect.email_notes.trim()
        ? prospect.email_notes.trim()
        : '';

    const email = buildFluxQuizSubmissionEmail({
      companyName,
      prospectName,
      pageUrl,
      pageSlug: page.slug,
      prospectDetails,
      answerRows: answerRows.map((row) => ({
        prompt: row.question.prompt,
        answerText: row.answerText,
      })),
      notes: notes || undefined,
    });

    const { data, error } = await resend.emails.send({
      from: 'Furnace <porter@getfurnace.io>',
      to: [destinationEmail],
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (error) {
      return response(500, { error: 'Failed to send submission email', details: JSON.stringify(error) });
    }

    return response(200, {
      success: true,
      messageId: data?.id ?? '',
      destinationEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send Flux quiz submission failed', {
      severity: 'warning',
      error: message,
    });
    return response(500, { error: message });
  }
};
