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

test('createImapFlowErrorGuard still has a listener after dispose (late socket timeout cannot crash)', () => {
  const client = new EventEmitter();
  const guard = createImapFlowErrorGuard(client);

  guard.dispose();

  // A socket timeout arriving after teardown must not surface as an unhandled 'error'
  // event, which Node would otherwise throw and crash the worker process on.
  assert.ok(client.listenerCount('error') >= 1, 'safety error listener must survive dispose');
  assert.doesNotThrow(() => client.emit('error', new Error('Socket timeout')));
});
