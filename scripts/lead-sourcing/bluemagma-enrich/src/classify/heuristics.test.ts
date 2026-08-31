import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { extractTitle } from '../lib/html.js';
import { classifyCompanyRole, classifyFromHtml } from './heuristics.js';

function load(rel: string): string {
  return readFileSync(join(fixturesDir, rel), 'utf8');
}

describe('company role heuristics', () => {
  it('drops known compliance platforms by name', () => {
    const result = classifyCompanyRole({
      company_name: 'Dash ComplyOps',
      headlines:
        'Healthtech Security & Compliance Automation | Co-Founder @ Dash ComplyOps',
    });
    assert.equal(result.company_role, 'compliance_platform');
    assert.equal(result.is_compliance_platform, true);
  });

  it('labels a product homepage as a compliance platform', () => {
    const html = load('homepages/dash-complyops.html');
    const result = classifyFromHtml('Dash ComplyOps', html, extractTitle(html));
    assert.equal(result.company_role, 'compliance_platform');
  });

  it('labels an audit firm and keeps it (does not drop)', () => {
    const html = load('homepages/finepoint.html');
    const result = classifyFromHtml('Fine Point CPA', html, extractTitle(html));
    assert.equal(result.company_role, 'auditor');
    assert.equal(result.is_compliance_platform, false);
  });

  it('labels GRC advisory as consultant, not platform', () => {
    const html = load('homepages/mrp.html');
    const result = classifyFromHtml('Managed Risk Partners', html, extractTitle(html), {
      headlines: 'SOC 2 won’t save your deals. I will. | GRC advisory',
    });
    assert.equal(result.company_role, 'consultant');
    assert.equal(result.is_compliance_platform, false);
  });

  it('does not treat Head of Compliance as a vendor role', () => {
    const result = classifyCompanyRole({
      company_name: 'ShipHero',
      headlines: 'Head of Compliance | Governance, Risk and Compliance',
      titles: 'Head of Compliance',
    });
    assert.equal(result.company_role, 'prospect');
  });

  it('labels a SaaS homepage without compliance product copy as prospect', () => {
    const html = load('homepages/speakeasy.html');
    const result = classifyFromHtml('Speakeasy', html, extractTitle(html));
    assert.equal(result.company_role, 'prospect');
  });

  it('does not treat a Thoropass/Vanta mention on another firm’s site as a platform', () => {
    const result = classifyCompanyRole({
      company_name: 'Managed Risk Partners',
      headlines: 'SOC 2 won’t save your deals. I will. | GRC advisory',
      homepage_title: 'Trust programs',
      homepage_text:
        'We run Trust Management programs. Many clients already use Thoropass or Vanta; we complement that stack. Risk advisory firm.',
    });
    assert.equal(result.company_role, 'consultant');
    assert.equal(result.is_compliance_platform, false);
  });

  it('does not treat Book a demo plus a SOC 2 badge as selling compliance software', () => {
    const result = classifyCompanyRole({
      company_name: 'Redouble AI',
      headlines: 'CTO | Enterprise & Scientific Software | Agentic AI',
      homepage_title: 'Redouble',
      homepage_text:
        'Book a Demo of our scientific software platform. Security is built in: we are SOC 2 Type 2, HIPAA, and GDPR compliant.',
    });
    assert.equal(result.company_role, 'prospect');
    assert.equal(result.is_compliance_platform, false);
  });

  it('drops a GRC product whose headline is Connected GRC', () => {
    const result = classifyCompanyRole({
      company_name: 'Fabrik',
      headlines: 'Powering Connected GRC & Customer Trust',
    });
    assert.equal(result.company_role, 'compliance_platform');
  });

  it('labels ISO-in-weeks training as consultant', () => {
    const result = classifyCompanyRole({
      company_name: 'GRCLab',
      headlines: 'Founder of GRCLab.com — Helping you achieve ISO 27001 certification in 12 weeks.',
    });
    assert.equal(result.company_role, 'consultant');
    assert.equal(result.is_compliance_platform, false);
  });

  it('labels a GRC-named firm without product copy as consultant', () => {
    const result = classifyCompanyRole({
      company_name: 'AgileGRC',
      headlines: 'Agile Governance, Risk and Compliance Executive • Speaker/Teacher',
    });
    assert.equal(result.company_role, 'consultant');
  });

  it('returns unknown when there is no company signal', () => {
    const result = classifyCompanyRole({ company_name: '', headlines: '' });
    assert.equal(result.company_role, 'unknown');
  });
});
