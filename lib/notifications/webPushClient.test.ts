import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWebPushDeviceStatus } from './webPushClient';

test('classifyWebPushDeviceStatus reports unsupported without Notification API', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'unsupported',
    pushManagerSupported: false,
    serviceWorkerSupported: false,
    localEndpoint: null,
    activeEndpoints: [],
  });
  assert.equal(status.kind, 'unsupported');
  assert.equal(status.registeredInFurnace, false);
});

test('classifyWebPushDeviceStatus reports needs_install without PushManager', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'default',
    pushManagerSupported: false,
    serviceWorkerSupported: true,
    localEndpoint: null,
    activeEndpoints: [],
  });
  assert.equal(status.kind, 'needs_install');
});

test('classifyWebPushDeviceStatus reports permission_denied', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'denied',
    pushManagerSupported: true,
    serviceWorkerSupported: true,
    localEndpoint: null,
    activeEndpoints: ['https://push.example/other'],
  });
  assert.equal(status.kind, 'permission_denied');
  assert.equal(status.registeredInFurnace, false);
});

test('classifyWebPushDeviceStatus reports permission_default before prompt', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'default',
    pushManagerSupported: true,
    serviceWorkerSupported: true,
    localEndpoint: null,
    activeEndpoints: [],
  });
  assert.equal(status.kind, 'permission_default');
});

test('classifyWebPushDeviceStatus reports enabled when local endpoint is in Furnace', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'granted',
    pushManagerSupported: true,
    serviceWorkerSupported: true,
    localEndpoint: 'https://push.example/this',
    activeEndpoints: ['https://push.example/other', 'https://push.example/this'],
  });
  assert.equal(status.kind, 'enabled');
  assert.equal(status.registeredInFurnace, true);
});

test('classifyWebPushDeviceStatus reports local_only when subscription is not in Furnace', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'granted',
    pushManagerSupported: true,
    serviceWorkerSupported: true,
    localEndpoint: 'https://push.example/this',
    activeEndpoints: ['https://push.example/other'],
  });
  assert.equal(status.kind, 'local_only');
  assert.equal(status.registeredInFurnace, false);
});

test('classifyWebPushDeviceStatus reports permission_granted_unregistered without local sub', () => {
  const status = classifyWebPushDeviceStatus({
    permission: 'granted',
    pushManagerSupported: true,
    serviceWorkerSupported: true,
    localEndpoint: null,
    activeEndpoints: ['https://push.example/other'],
  });
  assert.equal(status.kind, 'permission_granted_unregistered');
  assert.equal(status.registeredInFurnace, false);
});
