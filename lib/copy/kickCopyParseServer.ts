import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

let client: LambdaClient | null = null;

/**
 * Server-side async hand-off. InvocationType Event returns after AWS accepts
 * the event; it never holds the Client API request open for OpenRouter.
 */
export async function kickCopyParseFromServer(accountId: string): Promise<void> {
  const functionName = process.env.COPY_STRUCTURE_PARSE_FUNCTION_NAME?.trim();
  if (!functionName || !accountId) return;

  try {
    client ??= new LambdaClient({});
    await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ accountId })),
      }),
    );
  } catch (error) {
    console.warn('[copyStructureParse] server kick failed', error);
  }
}
