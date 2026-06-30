-- Allow an 'aborted' onboarding status.
--
-- A flow is marked 'aborted' when it ended only because a step's spotlight
-- target never appeared (not because the user completed or dismissed it).
-- Persisting it (rather than retrying forever) avoids an every-visit loop on a
-- permanently-missing anchor, while staying distinct from completed/dismissed
-- so broken anchors are visible in analytics. The row still counts as "seen",
-- so the flow won't auto-trigger again until replayed (its row is deleted).

ALTER TABLE public.user_onboarding_state
  DROP CONSTRAINT IF EXISTS user_onboarding_state_status_check;

ALTER TABLE public.user_onboarding_state
  ADD CONSTRAINT user_onboarding_state_status_check
  CHECK (status IN ('completed', 'dismissed', 'aborted'));
