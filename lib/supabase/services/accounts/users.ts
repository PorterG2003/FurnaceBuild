import { supabase } from '../../client';
import type { User, UserInsert, UserUpdate } from '../../types';

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch user: ${error.message}`);
  return data ?? null;
}

export async function getUserByExternalId(externalId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch user: ${error.message}`);
  return data ?? null;
}

export async function createUserProfile(user: UserInsert): Promise<User> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .insert({
      ...user,
      created_at: user.created_at ?? now,
      updated_at: user.updated_at ?? now,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create user: ${error.message}`);
  if (!data) throw new Error('Failed to create user: No data returned');
  return data;
}

export async function updateUserProfile(id: string, updates: UserUpdate): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update user: ${error.message}`);
  if (!data) throw new Error('Failed to update user: No data returned');
  return data;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch user by email: ${error.message}`);
  return data ?? null;
}
