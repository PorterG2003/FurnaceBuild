-- ============================================
-- Remove platform invite first-month discount data
-- ============================================

UPDATE public.platform_invitation_revisions
SET first_month_discount_cents = 0
WHERE first_month_discount_cents <> 0;

UPDATE public.platform_invitations
SET
  first_month_discount_cents = 0,
  status = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment' AND published_revision_number IS NULL
      THEN 'draft'
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN 'sent'
    ELSE status
  END,
  accepted_by_user_id = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN NULL
    ELSE accepted_by_user_id
  END,
  terms_accepted_at = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN NULL
    ELSE terms_accepted_at
  END,
  terms_accepted_ip = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN NULL
    ELSE terms_accepted_ip
  END,
  prepared_full_name = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN NULL
    ELSE prepared_full_name
  END,
  prepared_account_name = CASE
    WHEN created_account_id IS NULL AND status = 'pending_payment'
      THEN NULL
    ELSE prepared_account_name
  END,
  checkout_revision_number = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE checkout_revision_number
  END,
  stripe_checkout_session_id = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE stripe_checkout_session_id
  END,
  selected_payment_route = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE selected_payment_route
  END,
  selected_payment_route_fee_cents = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN 0
    ELSE selected_payment_route_fee_cents
  END,
  selected_payment_subtotal_cents = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE selected_payment_subtotal_cents
  END,
  selected_payment_total_cents = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE selected_payment_total_cents
  END,
  recurring_anchor_at = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE recurring_anchor_at
  END,
  first_recurring_invoice_target_cents = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE first_recurring_invoice_target_cents
  END,
  first_recurring_coupon_id = CASE
    WHEN created_account_id IS NULL AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
      THEN NULL
    ELSE first_recurring_coupon_id
  END,
  updated_at = now()
WHERE first_month_discount_cents <> 0
   OR (
     created_account_id IS NULL
     AND status IN ('draft', 'sent', 'pending_payment', 'expired', 'revoked')
     AND (
       checkout_revision_number IS NOT NULL
       OR stripe_checkout_session_id IS NOT NULL
       OR selected_payment_route IS NOT NULL
       OR COALESCE(selected_payment_route_fee_cents, 0) <> 0
       OR selected_payment_subtotal_cents IS NOT NULL
       OR selected_payment_total_cents IS NOT NULL
       OR recurring_anchor_at IS NOT NULL
       OR first_recurring_invoice_target_cents IS NOT NULL
       OR first_recurring_coupon_id IS NOT NULL
       OR (
         status = 'pending_payment'
         AND (
           accepted_by_user_id IS NOT NULL
           OR terms_accepted_at IS NOT NULL
           OR terms_accepted_ip IS NOT NULL
           OR prepared_full_name IS NOT NULL
           OR prepared_account_name IS NOT NULL
         )
       )
     )
   );
