import { Redirect } from 'expo-router';

/** Legacy route — review_tasks UI lives under /foundry/queue. */
export default function FoundryReviewRedirect() {
  return <Redirect href="/foundry/queue" />;
}
