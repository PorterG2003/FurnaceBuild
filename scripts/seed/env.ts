import { config as loadEnv } from 'dotenv';

export function loadSeedEnv() {
  loadEnv();
  loadEnv({ path: '.env.local', override: true });
}

export function getSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
}

/** Returns ref from https://<ref>.supabase.co or null if host shape is different. */
export function parseSupabaseProjectRef(urlStr: string): string | null {
  try {
    const host = new URL(urlStr).hostname;
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function assertProjectRefIfSet(url: string) {
  const want = process.env.SEED_PROJECT_REF?.trim();
  if (!want) return;
  const got = parseSupabaseProjectRef(url);
  if (!got) {
    console.error(
      '[seed] SEED_PROJECT_REF is set but SUPABASE_URL host is not <ref>.supabase.co — cannot verify.'
    );
    process.exit(1);
  }
  if (got.toLowerCase() !== want.toLowerCase()) {
    console.error(
      `[seed] SEED_PROJECT_REF mismatch: env wants "${want}" but URL resolves to ref "${got}".`
    );
    process.exit(1);
  }
}
