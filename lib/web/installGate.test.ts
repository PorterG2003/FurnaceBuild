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

  it('does not exempt other app routes', () => {
    assert.strictEqual(isInstallGateExemptRoute('/'), false);
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
