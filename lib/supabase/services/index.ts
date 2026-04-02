/**
 * Central export for all Supabase services.
 * Inbox and campaigns are split into submodules; re-exported here for backward compatibility.
 */

export * from './campaigns';
export * from './leads';
export * from './accounts';
export * from './mailboxes';
export * from './inbox';
export * from './block-list';
export * from './thread-tags';
export * from './smartlead-migrations';
export * from './user-access-flags';
