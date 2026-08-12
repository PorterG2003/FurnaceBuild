import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { HELP_EMAIL, HELP_EMAIL_URL, HELP_SCHEDULE_URL } from '@/components/ui/help/HelpModal';
import type { InviteCheckoutPhase } from '@/lib/billing/inviteCheckoutPhase';
import { getInviteCheckoutRecoveryCopy } from '@/lib/billing/inviteCheckoutRecoveryCopy';

export function PlatformInviteRecoveryStep({
  phase,
  failureSummary = null,
  hostedVerificationUrl = null,
  activationError = null,
  statusError = null,
  busy = false,
  onRetryActivation,
  onReplaceCheckout,
  onVerifyBank,
}: {
  phase: InviteCheckoutPhase;
  failureSummary?: string | null;
  hostedVerificationUrl?: string | null;
  activationError?: string | null;
  statusError?: string | null;
  busy?: boolean;
  onRetryActivation?: () => void;
  onReplaceCheckout?: () => void;
  onVerifyBank?: () => void;
}) {
  const copy = getInviteCheckoutRecoveryCopy(phase);
  const message =
    (phase === 'failed' || phase === 'expired') && failureSummary
      ? failureSummary
      : copy.message;
  const currentStep =
    phase === 'verification_required'
      ? 1
      : phase === 'processing' || phase === 'succeeded'
        ? 2
        : 0;
  const steps = ['Payment submitted', 'Bank verification', 'Workspace access'];
  const actionRequired = phase === 'verification_required';
  const isFailure = phase === 'failed' || phase === 'expired';
  const statusLabel = actionRequired
    ? 'Action required'
    : isFailure
      ? 'Payment interrupted'
      : phase === 'succeeded'
        ? 'Almost ready'
        : 'Setup in progress';

  return (
    <View className="w-full items-center justify-center py-2">
      <Text
        selectable={false}
        className={`text-xs font-instrument-semibold uppercase tracking-[1.5px] ${
          isFailure ? 'text-red-400' : actionRequired ? 'text-amber-400' : 'text-[#f85102]'
        }`}
      >
        {statusLabel}
      </Text>

      <Text
        selectable={false}
        className="mt-1.5 text-white text-3xl font-instrument-semibold text-center"
      >
        {copy.title}
      </Text>
      <Text
        selectable={false}
        className="mt-2 max-w-lg text-center text-gray-400 font-instrument leading-6"
      >
        {message}
      </Text>

      {!isFailure ? (
        <View className="w-full max-w-md mt-4">
          {steps.map((label, index) => {
            const completed = index < currentStep;
            const active = index === currentStep;
            const waitingForCustomer = active && actionRequired;
            return (
              <View key={label} className="flex-row items-center min-h-9">
                <View
                  className={`h-7 w-7 rounded-full items-center justify-center ${
                    completed ? 'bg-emerald-500' : ''
                  }`}
                >
                  {active && copy.showSpinner ? (
                    <ActivityIndicator size="small" color="#f85102" />
                  ) : (
                    <Text
                      selectable={false}
                      className={`text-xs font-instrument-semibold ${
                        completed
                          ? 'text-white'
                          : waitingForCustomer
                            ? 'text-amber-400'
                            : 'text-gray-600'
                      }`}
                    >
                      {completed ? '✓' : index + 1}
                    </Text>
                  )}
                </View>
                <Text
                  selectable={false}
                  className={`ml-3 font-instrument ${
                    active ? 'text-white' : completed ? 'text-gray-300' : 'text-gray-600'
                  }`}
                >
                  {label}
                </Text>
                {active ? (
                  <Text
                    selectable={false}
                    className={`ml-auto text-xs font-instrument-medium ${
                      waitingForCustomer ? 'text-amber-400' : 'text-[#f85102]'
                    }`}
                  >
                    {waitingForCustomer ? 'Action needed' : 'In progress'}
                  </Text>
                ) : completed ? (
                  <Text selectable={false} className="ml-auto text-xs text-gray-500 font-instrument">
                    Complete
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {activationError ? (
        <View className="w-full max-w-lg mt-4">
          <Alert variant="warning" message={activationError} />
        </View>
      ) : null}

      {statusError ? (
        <View className="w-full max-w-lg mt-4">
          <Alert variant="error" message={statusError} />
        </View>
      ) : null}

      <View className="w-full max-w-md gap-2 mt-4">
        {copy.showVerifyBank && hostedVerificationUrl ? (
          <Button
            onPress={() => {
              if (onVerifyBank) {
                onVerifyBank();
                return;
              }
              void Linking.openURL(hostedVerificationUrl);
            }}
            disabled={busy}
            fullWidth
            size="lg"
          >
            Verify bank account
          </Button>
        ) : null}

        {onRetryActivation && copy.showRetryActivation ? (
          <Button
            onPress={onRetryActivation}
            variant={activationError ? 'default' : 'outline'}
            disabled={busy}
            fullWidth
          >
            Retry workspace access
          </Button>
        ) : null}

        {onReplaceCheckout && copy.showReplaceCheckout ? (
          <Button onPress={onReplaceCheckout} disabled={busy} fullWidth size="lg">
            Start replacement checkout
          </Button>
        ) : null}

      </View>

      <View className="mt-5 h-px w-12 bg-white/10" />
      <Text selectable={false} className="text-center text-gray-600 font-instrument text-sm mt-3">
        Need help?{' '}
        <Text
          selectable={false}
          className="text-gray-400"
          onPress={() => {
            void Linking.openURL(HELP_EMAIL_URL);
          }}
        >
          Email {HELP_EMAIL}
        </Text>
        {' or '}
        <Text
          selectable={false}
          className="text-gray-400"
          onPress={() => {
            void Linking.openURL(HELP_SCHEDULE_URL);
          }}
        >
          book a call
        </Text>
      </Text>
    </View>
  );
}
