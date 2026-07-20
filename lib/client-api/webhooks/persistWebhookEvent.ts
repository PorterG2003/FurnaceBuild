/**
 * Canonical source moved to the shared @furnace/webhooks-lib package so both the
 * app/client-api and the standalone workers can consume it. This re-export keeps
 * existing client-api and app import paths stable.
 */
export * from '../../webhooks/persistWebhookEvent.js';
