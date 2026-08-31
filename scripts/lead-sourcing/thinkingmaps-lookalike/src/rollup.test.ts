import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWonAccountRow, rollupDistricts } from './rollup.js';

describe('rollupDistricts', () => {
  it('rolls child schools into the parent district and skips test accounts', () => {
    const rows = [
      parseWonAccountRow({
        'Account Name': 'Palm Tree Elementary',
        'Parent Account': 'Palmdale School District',
        ' Closed-Won Total ': '$173,550.00',
        'Billing City': 'Palmdale',
        'Billing State': 'CA',
        'Billing ZIP': '93550',
      }),
      parseWonAccountRow({
        'Account Name': 'Palmdale High',
        'Parent Account': 'Palmdale School District',
        ' Closed-Won Total ': '$50,000.00',
        'Billing City': 'Palmdale',
        'Billing State': 'CA',
        'Billing ZIP': '93550',
      }),
      parseWonAccountRow({
        'Account Name': 'Montebello USD',
        'Parent Account': 'No Parent Account',
        ' Closed-Won Total ': '$10.00',
        'Billing City': 'Montebello',
        'Billing State': 'CA',
        'Billing ZIP': '90640',
      }),
      parseWonAccountRow({
        'Account Name': 'JP TEST ACCOUNT',
        'Parent Account': 'No Parent Account',
        ' Closed-Won Total ': '$1.00',
        'Billing City': 'Cary',
        'Billing State': 'NC',
        'Billing ZIP': '27703',
      }),
    ];
    const districts = rollupDistricts(rows);
    assert.equal(districts.length, 2);
    const palmdale = districts.find((d) => /palmdale/i.test(d.district_name));
    assert.ok(palmdale);
    assert.equal(palmdale.account_count, 2);
    assert.equal(palmdale.revenue, 223550);
    assert.equal(districts.some((d) => /test/i.test(d.district_name)), false);
  });

  it('flags NYC subunits and charters', () => {
    const [nyc] = rollupDistricts([
      parseWonAccountRow({
        'Account Name': 'New York City Geographic District #10',
        'Parent Account': 'No Parent Account',
        ' Closed-Won Total ': '100',
        'Billing City': 'Bronx',
        'Billing State': 'NY',
      }),
    ]);
    const [charter] = rollupDistricts([
      parseWonAccountRow({
        'Account Name': 'Heartland Charter School',
        'Parent Account': 'Heartland Charter District',
        ' Closed-Won Total ': '100',
        'Billing City': 'Bakersfield',
        'Billing State': 'CA',
      }),
    ]);
    assert.equal(nyc?.is_nyc_subunit, true);
    assert.equal(charter?.is_charter, true);
    assert.equal(charter?.district_name, 'Heartland Charter District');
  });
});
