import { Redirect } from 'expo-router';

/** Legacy route — async jobs live under /foundry/runs. */
export default function FoundryJobsRedirect() {
  return <Redirect href="/foundry/runs" />;
}
