import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createImapFlowErrorGuard } from './imapFlowGuard.js';

test('createImapFlowErrorGuard captures async ImapFlow error events', () => {
  const client = new EventEmitter();
  const guard = createImapFlowErrorGuard(client);

  client.emit('error', new Error('Socket timeout'));
  assert.throws(() => guard.throwIfError(), /Socket timeout/);
  assert.doesNotThrow(() => guard.throwIfError());

  guard.dispose();
});

test('createImapFlowErrorGuard keeps the most recent error until consumed', () => {
  const client = new EventEmitter();
  const guard = createImapFlowErrorGuard(client);

  client.emit('error', new Error('first'));
  assert.throws(() => guard.throwIfError(), /first/);

  client.emit('error', new Error('second'));
  assert.throws(() => guard.throwIfError(), /second/);

  guard.dispose();
});
