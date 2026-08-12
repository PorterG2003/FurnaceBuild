import type { InviteCheckoutPhase } from './inviteCheckoutPhase';

export function getInviteCheckoutRecoveryCopy(phase: InviteCheckoutPhase): {
  title: string;
  message: string;
  showSpinner: boolean;
  showVerifyBank: boolean;
  showReplaceCheckout: boolean;
  showRetryActivation: boolean;
} {
  switch (phase) {
    case 'verification_required':
      return {
        title: 'Verify your bank account',
        message:
          'Stripe sent a small microdeposit to your bank account. Enter the verification code to finish authorizing ACH. Your workspace will open after verification.',
        showSpinner: false,
        showVerifyBank: true,
        showReplaceCheckout: false,
        showRetryActivation: false,
      };
    case 'processing':
      return {
        title: 'Setting up your workspace',
        message:
          'Your bank account is verified and the debit has started. We are creating your workspace and will open it automatically.',
        showSpinner: true,
        showVerifyBank: false,
        showReplaceCheckout: false,
        showRetryActivation: true,
      };
    case 'failed':
      return {
        title: 'Payment needs attention',
        message:
          'The bank payment did not complete. You can safely start a replacement checkout without changing the signed agreement.',
        showSpinner: false,
        showVerifyBank: false,
        showReplaceCheckout: true,
        showRetryActivation: false,
      };
    case 'expired':
      return {
        title: 'Payment needs attention',
        message:
          'The previous checkout session expired before payment finished. Start a replacement checkout to continue.',
        showSpinner: false,
        showVerifyBank: false,
        showReplaceCheckout: true,
        showRetryActivation: false,
      };
    case 'succeeded':
      return {
        title: 'Activating your workspace',
        message: 'Payment is confirmed. We are opening your workspace.',
        showSpinner: true,
        showVerifyBank: false,
        showReplaceCheckout: false,
        showRetryActivation: true,
      };
    case 'open':
      return {
        title: 'Checking your bank payment',
        message:
          'Checkout is complete. We are waiting for Stripe to confirm the next bank-payment step.',
        showSpinner: true,
        showVerifyBank: false,
        showReplaceCheckout: false,
        showRetryActivation: false,
      };
    case 'awaiting_checkout':
    default:
      return {
        title: 'Checking payment status',
        message: 'We are confirming your payment status with Stripe.',
        showSpinner: true,
        showVerifyBank: false,
        showReplaceCheckout: false,
        showRetryActivation: false,
      };
  }
}
