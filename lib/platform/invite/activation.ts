export type InviteActivationPollResult =
  | { kind: 'ready' }
  | { kind: 'timed_out' }
  | { kind: 'error'; message: string };

export async function waitForInviteActivation(args: {
  checkMemberships: () => Promise<number>;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<InviteActivationPollResult> {
  const maxAttempts = args.maxAttempts ?? 10;
  const delayMs = args.delayMs ?? 1500;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const membershipCount = await args.checkMemberships();
      if (membershipCount > 0) {
        return { kind: 'ready' };
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return { kind: 'timed_out' };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'We could not confirm your workspace access yet.',
    };
  }
}
