import type { TestConnectionResult, TestMailboxConnectionParams } from './connectionHealth.js';

export interface BulkMailboxConnectionTestItem<T> {
  key: string;
  input: T;
  params: TestMailboxConnectionParams;
}

export interface BulkMailboxConnectionTestProgress<T> {
  item: BulkMailboxConnectionTestItem<T>;
  index: number;
  total: number;
  status: 'testing' | 'done';
  result?: TestConnectionResult;
}

export interface BulkMailboxConnectionTestOutcome<T> {
  item: BulkMailboxConnectionTestItem<T>;
  index: number;
  total: number;
  result: TestConnectionResult;
}

export function buildConnectionTestFailure(message: string): TestConnectionResult {
  return {
    success: false,
    smtp: { success: false, error: message },
    imap: { success: false, error: message },
    message,
  };
}

export async function runBulkMailboxConnectionTests<T>(args: {
  items: BulkMailboxConnectionTestItem<T>[];
  testFn: (item: BulkMailboxConnectionTestItem<T>) => Promise<TestConnectionResult>;
  signal?: AbortSignal;
  onProgress?: (progress: BulkMailboxConnectionTestProgress<T>) => void;
}): Promise<BulkMailboxConnectionTestOutcome<T>[]> {
  const outcomes: BulkMailboxConnectionTestOutcome<T>[] = [];

  for (let index = 0; index < args.items.length; index += 1) {
    if (args.signal?.aborted) {
      break;
    }

    const item = args.items[index];
    args.onProgress?.({
      item,
      index,
      total: args.items.length,
      status: 'testing',
    });

    let result: TestConnectionResult;
    try {
      result = await args.testFn(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      result = buildConnectionTestFailure(message);
    }

    const outcome = {
      item,
      index,
      total: args.items.length,
      result,
    } satisfies BulkMailboxConnectionTestOutcome<T>;
    outcomes.push(outcome);

    args.onProgress?.({
      item,
      index,
      total: args.items.length,
      status: 'done',
      result,
    });
  }

  return outcomes;
}
