/**
 * One-time migration: Create Supabase Auth users for existing public.users (Cognito migrants).
 *
 * For each row in public.users that has external_id set (legacy Cognito user), creates a
 * corresponding auth.users row with the SAME id so that public.users.id = auth.uid().
 * Users will need to reset their password via "Forgot Password" (Cognito hashes are not exportable).
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 * Run: npx tsx scripts/migrate-cognito-users-to-supabase-auth.ts
 *
 * Optional: DRY_RUN=1 to only log what would be done.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const dryRun = process.env.DRY_RUN === '1';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  external_id: string | null;
}

async function main() {
  console.log('Fetching public.users with external_id (Cognito migrants)...');
  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('id, email, name, external_id')
    .not('external_id', 'is', null);

  if (fetchError) {
    console.error('Failed to fetch users:', fetchError.message);
    process.exit(1);
  }

  const toMigrate = (users ?? []) as PublicUser[];
  console.log(`Found ${toMigrate.length} user(s) to migrate.`);

  if (dryRun) {
    toMigrate.forEach((u) => console.log(`  Would create auth user: id=${u.id} email=${u.email}`));
    console.log('DRY_RUN=1: no changes made.');
    return;
  }

  for (const u of toMigrate) {
    try {
      const { data: authUser, error } = await supabase.auth.admin.createUser({
        id: u.id,
        email: u.email,
        email_confirm: true,
        user_metadata: u.name ? { name: u.name } : undefined,
      } as { id: string; email: string; email_confirm: boolean; user_metadata?: object });

      if (error) {
        if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
          console.log(`  Skip (auth user exists): ${u.email}`);
        } else {
          console.error(`  Failed ${u.email}:`, error.message);
        }
        continue;
      }
      console.log(`  Created auth user: id=${authUser.user.id} email=${authUser.user.email}`);
    } catch (err) {
      console.error(`  Error for ${u.email}:`, err);
    }
  }

  console.log('Done. Users must use "Forgot Password" to set a new password.');
}

main();
