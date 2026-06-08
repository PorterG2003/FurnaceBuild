import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isFluxPublicLandingRoute, isInstallGateExemptRoute } from './installGate';

describe('isInstallGateExemptRoute', () => {
  it('exempts /install', () => {
    assert.strictEqual(isInstallGateExemptRoute('/install'), true);
    assert.strictEqual(isInstallGateExemptRoute('/install/'), true);
  });

  it('exempts Flux public landing pages under /p/', () => {
    assert.strictEqual(isInstallGateExemptRoute('/p'), true);
    assert.strictEqual(isInstallGateExemptRoute('/p/acme-corp'), true);
    assert.strictEqual(isInstallGateExemptRoute('/p/acme-corp/'), true);
  });

  it('exempts public invite acceptance routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/accept-platform-invite/abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/accept-invitation/abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/accept-account-amendment/abc'), true);
  });

  it('exempts invite-scoped auth routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/auth', '?invitation_id=abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/auth', 'invitation_id=abc'), true);
    assert.strictEqual(isInstallGateExemptRoute('/auth', '?amendment_id=abc'), true);
  });

  it('does not exempt other app routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/auth'), false);
    assert.strictEqual(isInstallGateExemptRoute('/'), false);
    assert.strictEqual(isInstallGateExemptRoute('/campaigns'), false);
    assert.strictEqual(isInstallGateExemptRoute('/account'), false);
    assert.strictEqual(isInstallGateExemptRoute('/flux'), false);
    assert.strictEqual(isInstallGateExemptRoute('/preview'), false);
  });
});

describe('isFluxPublicLandingRoute', () => {
  it('matches /p and /p/{slug}', () => {
    assert.strictEqual(isFluxPublicLandingRoute('/p'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/p/acme-corp'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/p/acme-corp/'), true);
    assert.strictEqual(isFluxPublicLandingRoute('/flux'), false);
  });
});
