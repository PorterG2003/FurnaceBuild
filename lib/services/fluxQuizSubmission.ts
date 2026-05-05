import outputs from '@/amplify_outputs.json';

const custom = (outputs as { custom?: { sendFluxQuizSubmissionUrl?: string } }).custom;
const SEND_FLUX_QUIZ_SUBMISSION_URL = custom?.sendFluxQuizSubmissionUrl;

export type SubmitFluxQuizPayload = {
  slug: string;
  blockId: string;
  answers: Record<string, unknown>;
};

export async function submitFluxQuizSubmission(params: SubmitFluxQuizPayload): Promise<void> {
  if (!SEND_FLUX_QUIZ_SUBMISSION_URL) {
    throw new Error(
      'Flux quiz submission URL is not configured. Deploy the Amplify backend and ensure amplify_outputs.json includes custom.sendFluxQuizSubmissionUrl.',
    );
  }

  const res = await fetch(SEND_FLUX_QUIZ_SUBMISSION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data as { error?: string }).error ||
      (data as { details?: string }).details ||
      'Failed to submit quiz answers';
    throw new Error(message);
  }
}
