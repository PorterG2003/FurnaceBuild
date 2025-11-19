-- ============================================
-- Migration: Add Roles to Account Users
-- ============================================
-- Adds role support and ability to manage team members

-- Add role column to account_users table
-- Roles: 'owner', 'admin', 'member'
ALTER TABLE account_users 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member'));

-- Update existing owners to have 'owner' role
UPDATE account_users 
SET role = 'owner' 
WHERE is_owner = TRUE;

-- Create index for role queries
CREATE INDEX IF NOT EXISTS idx_account_users_role ON account_users(role);

-- Update comment
COMMENT ON COLUMN account_users.role IS 'User role in the account: owner (full control), admin (manage team), member (standard access)';

