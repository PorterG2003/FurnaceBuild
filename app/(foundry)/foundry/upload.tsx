import { Redirect } from 'expo-router';

/** Legacy route — Google Maps CSV import lives under /foundry/imports. */
export default function FoundryUploadRedirect() {
  return <Redirect href="/foundry/imports" />;
}
