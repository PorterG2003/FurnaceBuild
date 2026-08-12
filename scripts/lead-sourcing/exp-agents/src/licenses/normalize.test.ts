import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isBrokerishLicense,
  normalizeCaDreRow,
  normalizeFlDbprRow,
  normalizeTxTrecRow,
} from './normalize.ts';

describe('license normalizers', () => {
  it('normalizes CA/TX/FL broker rows and supervisor flags', () => {
    const ca = normalizeCaDreRow({
      'License Number': '01454605',
      'License Type': 'Broker',
      Name: 'Mike Sample Broker',
      City: 'Bakersfield',
    });
    assert.equal(ca?.state, 'CA');
    assert.equal(ca?.licenseNumber, '01454605');
    assert.equal(isBrokerishLicense(ca!), true);

    const tx = normalizeTxTrecRow({
      'License Type': 'Broker',
      'License Number': '654321',
      'Full Name': 'Casey Supervisor',
      'Designated Supervisor Flag': 'Y',
      County: 'Travis',
    });
    assert.equal(tx?.designatedSupervisor, true);
    assert.equal(tx?.state, 'TX');

    const fl = normalizeFlDbprRow({
      'License Number': 'BK3316750',
      'License Type': 'Real Estate Broker',
      'First Name': 'Luz',
      'Last Name': 'Abreu',
      City: 'Miami',
    });
    assert.equal(fl?.state, 'FL');
    assert.equal(isBrokerishLicense(fl!), true);
  });
});
