import { Redirect } from 'expo-router';

/** Legacy route — state matching runs from Import results (pipeline). */
export default function FoundryStateMatchingRedirect() {
  return <Redirect href="/foundry/imports" />;
}
