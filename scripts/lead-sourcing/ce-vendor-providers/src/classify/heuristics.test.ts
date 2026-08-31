import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { extractTitle } from '../lib/html.js';
import { classifyFromHtml } from './heuristics.js';

function load(rel: string): string {
  return readFileSync(join(fixturesDir, rel), 'utf8');
}

describe('classifier heuristics', () => {
  it('labels a product homepage as commercial_vendor / customer', () => {
    const html = load('homepages/ledgersoft.html');
    const result = classifyFromHtml('LedgerSoft Inc.', html, extractTitle(html));
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'customer');
  });

  it('labels architecture manufacturer as commercial_vendor / partner', () => {
    const html = load('homepages/acme-windows.html');
    const result = classifyFromHtml('Acme Windows', html, extractTitle(html));
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'partner');
  });

  it('labels a hospital as institution', () => {
    const html = load('homepages/county-general.html');
    const result = classifyFromHtml('County General Hospital', html, extractTitle(html));
    assert.equal(result.entity_class, 'institution');
  });

  it('labels a membership society as society', () => {
    const html = load('homepages/counseling-society.html');
    const result = classifyFromHtml('American Counseling Society', html, extractTitle(html));
    assert.equal(result.entity_class, 'society');
  });

  it('labels a CE catalog as education_company', () => {
    const html = load('homepages/cpe-institute.html');
    const result = classifyFromHtml('CPE Learning Institute', html, extractTitle(html));
    assert.equal(result.entity_class, 'education_company');
  });

  it('flags a formal IME grant portal', () => {
    const html = load('pages/novo-grant-portal.html');
    const result = classifyFromHtml('Novo Nordisk', html, extractTitle(html));
    assert.equal(result.has_formal_grant_program, true);
  });

  it('treats ARCAT manufacturers as vendor/partner even on an AEC Daily catalog page', () => {
    const html = '<title>Courses</title><p>Browse our courses. Earn your AIA CE. All courses.</p>';
    const result = classifyFromHtml('3M Commercial Solutions', html, 'Courses', {
      source_directory: 'arcat',
      page_url: 'https://www.aecdaily.com/s/3m',
    });
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'partner');
    assert.equal(result.class_reason, 'ARCAT CES manufacturer list');
  });

  it('treats GreenCE manufacturer sponsors as vendor/partner even on a course catalog page', () => {
    const html = '<title>Courses</title><p>Browse our courses. Earn your AIA CE. All courses.</p>';
    const result = classifyFromHtml('Big Ass Fan Company', html, 'Courses', {
      source_directory: 'greence',
      page_url: 'https://www.bigassfans.com/',
    });
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'partner');
    assert.equal(result.class_reason, 'GreenCE manufacturer sponsor list');
  });

  it('still labels GreenCE, Inc. on the GreenCE directory as an education company', () => {
    const html = load('homepages/greence-academy.html');
    const result = classifyFromHtml('GreenCE, Inc.', html, extractTitle(html), {
      source_directory: 'greence',
      page_url: 'https://www.greence.com/',
    });
    assert.equal(result.entity_class, 'education_company');
  });

  it('treats Ron Blank manufacturer sponsors as vendor/partner', () => {
    const result = classifyFromHtml('ClarkDietrich', '<title>Steel framing</title>', 'Steel framing', {
      source_directory: 'ronblank',
      page_url: 'https://www.clarkdietrich.com/',
    });
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'partner');
    assert.equal(result.class_reason, 'Ron Blank manufacturer sponsor list');
  });

  it('still labels GreenCE Academy on ARCAT as an education company', () => {
    const html = load('homepages/greence-academy.html');
    const result = classifyFromHtml('GreenCE Academy', html, extractTitle(html), {
      source_directory: 'arcat',
      page_url: 'https://greence-academy.example/',
    });
    assert.equal(result.entity_class, 'education_company');
  });

  it('labels paid CPE catalogs as education_company even when they have Pricing', () => {
    const tax = classifyFromHtml(
      '101 Education Services Inc. (dba IRSTaxTraining.com)',
      '<h1>IRS Tax Training</h1><p>Continuing Education and study materials. Shopping Cart. Qualifying Education $224.95.</p>',
      'IRS Tax Training',
      { page_url: 'http://irstaxtraining.com/' },
    );
    const analyst = classifyFromHtml(
      '365 Financial Analyst',
      '<h1>Finance Courses to Boost Your Career</h1><p>Career Tracks. Certification platform. Pricing For Business. Sign Up.</p>',
      'Finance Courses to Boost Your Career',
      { page_url: 'https://365financialanalyst.com/' },
    );
    const acs = classifyFromHtml(
      'Accounting Conferences & Seminars, LLC',
      '<h1>CPE Webinars & Conferences for CPAs</h1><p>Upcoming Webinars. Live 1-day virtual conferences. In-House Training.</p>',
      'CPE Webinars & Conferences for CPAs | ACS Live',
      { page_url: 'http://acslive.com/' },
    );
    assert.equal(tax.entity_class, 'education_company');
    assert.equal(analyst.entity_class, 'education_company');
    assert.equal(acs.entity_class, 'education_company');
  });

  it('does not treat a wealth firm Foundation nav item as a society', () => {
    const result = classifyFromHtml(
      'Abacus Planning Group, Inc.',
      '<nav>Services Foundation Year Wealth Planning Investment Management Foundations & Endowments</nav><p>Fee Only Financial Planners. Wealth planning for families.</p>',
      'Fee Only Financial Planners | Columbia, SC',
      { page_url: 'http://abacusplanninggroup.com/' },
    );
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.notEqual(result.entity_class, 'society');
  });

  it('still keeps a software company with a free CPE webinar as a vendor', () => {
    const html = load('homepages/ledgersoft.html');
    const result = classifyFromHtml('LedgerSoft Inc.', html, extractTitle(html), {
      page_url: 'https://ledgersoft.example/',
    });
    assert.equal(result.entity_class, 'commercial_vendor');
  });

  it('labels a P.C. / CPA firm from the name when there is no homepage', () => {
    const firm = classifyFromHtml('Abeles and Hoffman, P.C.', '', '');
    const cpas = classifyFromHtml('AAFCPAs', '', '');
    assert.equal(firm.entity_class, 'commercial_vendor');
    assert.equal(cpas.entity_class, 'commercial_vendor');
  });

  it('labels a professional alliance as a society from the name', () => {
    const result = classifyFromHtml(
      "Accounting & Financial Women's Alliance",
      '<p>Join. Membership. Pricing for events.</p>',
      'AFWA',
    );
    assert.equal(result.entity_class, 'society');
  });

  it('does not treat University Partnerships nav as an institution', () => {
    const result = classifyFromHtml(
      'Becker Professional Education',
      '<nav><a>University Partnerships Bridge Program</a><a>Universities</a></nav><p>Exam Review & CE for CPA, CIA, CMA & EA Professionals. Courses & Products.</p>',
      'Exam Review & CE for CPA | Becker',
      { page_url: 'http://becker.com/' },
    );
    assert.equal(result.entity_class, 'education_company');
  });

  it('keeps CPE storefronts as education_company when a course list mentions tax software', () => {
    const mycpe = classifyFromHtml(
      'MY-CPE LLC',
      '<p>Unlimited CPE Credits. Course catalog. Drake tax software training. Request a demo of the platform.</p>',
      'MYCPE ONE: Unlimited CPE Credits',
      { page_url: 'https://my-cpe.com/' },
    );
    const surgent = classifyFromHtml(
      'Surgent McCoy Self-Study CPE, LLC',
      '<p>CPE Courses for CPAs. Unlimited Webinars. Unlimited Self-Study. Accounting software courses.</p>',
      'CPE Courses for CPAs & Tax Professionals | Surgent CPE',
      { page_url: 'https://surgentcpe.com/' },
    );
    assert.equal(mycpe.entity_class, 'education_company');
    assert.equal(surgent.entity_class, 'education_company');
  });

  it('labels Alliance Training as education, not a society', () => {
    const result = classifyFromHtml(
      'Alliance Training and Consulting, Inc.',
      '<p>View Courses. Instructor-Led Training. Cart.</p>',
      'Alliance Training - Our Company',
      { page_url: 'http://alliancetac.com/' },
    );
    assert.equal(result.entity_class, 'education_company');
  });

  it('labels academy/learning/webinar/education names as shops even when the page mentions a demo', () => {
    const demo = '<p>Request a demo. Tax software. Course catalog. Pricing.</p>';
    const names = [
      'Fast Forward Academy, LLC',
      'LinkedIn Learning',
      'ADVANCED WEBINARS LLC',
      'CPAacademy.org',
      'Kaplan Financial Education',
      'Tax Pro Academy, LLC',
      'The CPATrendlines Academy (Thomas Advisors /d/b/a)',
      'Symphona Seminars LLC (d/b/a SFA Audit Seminars)',
      'John Hancock Academy',
    ];
    for (const name of names) {
      const result = classifyFromHtml(name, demo, 'Home', { page_url: 'https://example.com/' });
      assert.equal(result.entity_class, 'education_company', name);
    }
  });

  it('keeps Academy of X as a society, not an education shop', () => {
    const result = classifyFromHtml(
      'American Academy of Pediatrics',
      '<p>Membership. Professional association. Join today.</p>',
      'AAP',
    );
    assert.equal(result.entity_class, 'society');
  });

  it('keeps consulting firms with Education in the name as vendors when they sell a product', () => {
    const result = classifyFromHtml(
      'Audit. Consulting. Education. LLC',
      '<p>Request a demo. Practice management. For accountants.</p>',
      'ACE',
    );
    assert.equal(result.entity_class, 'commercial_vendor');
  });

  it('treats manufacturer-directory trade associations as vendor/partner', () => {
    const html = '<title>Courses</title><p>Browse our courses. Earn your AIA CE. All courses.</p>';
    const result = classifyFromHtml('Steel Door Institute (SDI)', html, 'Courses', {
      source_directory: 'arcat',
      page_url: 'https://www.arcat.com/ces',
    });
    assert.equal(result.entity_class, 'commercial_vendor');
    assert.equal(result.audience_relationship, 'partner');
    assert.equal(result.class_reason, 'ARCAT CES manufacturer list');
  });

  it('still labels NASBA professional associations as society', () => {
    const demo = '<p>Request a demo. For advisors. Membership. Pricing. Free trial.</p>';
    const names = [
      'American Bankers Association',
      'National Association of Enrolled Agents',
      'HFMA Florida Chapter',
      'Exit Planning Institute',
      'Radiology Business Management Association',
      'The Conference Board',
      'Public Pension Financial Forum (P2F2)',
    ];
    for (const name of names) {
      const result = classifyFromHtml(name, demo, 'Home', { page_url: 'https://example.com/' });
      assert.equal(result.entity_class, 'society', name);
    }
  });

  it('does not let Foundation in a software company name win over a product homepage', () => {
    const result = classifyFromHtml(
      'Foundation Software, Inc.',
      '<p>Construction accounting software. Request a demo. Start a free trial.</p>',
      'Foundation Software',
      { page_url: 'https://foundationsoft.com/' },
    );
    assert.equal(result.entity_class, 'commercial_vendor');
  });

  it('labels remaining CPE shop names as education, not CPA firms', () => {
    const demo = '<p>Request a demo. Tax software. Course catalog. For accountants.</p>';
    const names = [
      'CPA Practice Advisor',
      'CPA to CPA, Inc.',
      'Advisors4Advisors',
      'GAAP Dynamics',
      'The Income Tax School',
    ];
    for (const name of names) {
      const result = classifyFromHtml(name, demo, 'Home', { page_url: 'https://example.com/' });
      assert.equal(result.entity_class, 'education_company', name);
    }
  });

  it('uses title and headline to drop training catalogs and membership orgs even with demo copy', () => {
    const energy = classifyFromHtml(
      'Enerdynamics Corp.',
      '<title>Energy Training Courses - Enerdynamics</title><meta name="description" content="Live seminars, online courses, books."><p>Request a demo of any online course. Cart. Live Seminars.</p>',
      'Energy Training Courses - Enerdynamics',
    );
    const tax = classifyFromHtml(
      'Jennings Advisory Group, LLC',
      '<title>TaxSpeaker | Expert CPE Training for Tax Professionals</title><p>Request a demo. Cart. View Courses in the store. Online CPE Courses. PDF of PowerPoint slides.</p>',
      'TaxSpeaker | Expert CPE Training for Tax Professionals',
    );
    const mastery = classifyFromHtml(
      'Profit Mastery',
      '<title>Profit Mastery</title><p>Profit Mastery University Coaching. Store All products Courses. Browse the store. Request a demo.</p>',
      'Profit Mastery',
    );
    const source = classifyFromHtml(
      'M&A Source',
      '<title>M&A Source | Education, Networking, & Resources</title><p>Membership Benefits. Join / Renew. Your source for M&A education and networking. Request a demo.</p>',
      'M&A Source | Education, Networking, & Resources',
    );
    const expo = classifyFromHtml(
      'Exponent Philanthropy',
      '<title>Exponent Philanthropy</title><p>A member-led community of lean funders. Join Our Community. Request a demo. For advisors.</p>',
      'Exponent Philanthropy',
    );
    const tcr = classifyFromHtml(
      'The Collaboration Room (TCR)',
      '<title>The Collaboration Room: A community for accounting firm owners</title><p>88 self-study courses. CPE and CE. Request a demo.</p>',
      'The Collaboration Room: A community for accounting firm owners',
    );
    const bank = classifyFromHtml(
      'Federal Home Loan Bank of Indianapolis',
      '<title>Homepage</title><p>We provide funding solutions. Request a demo. Register now for Shareholder Symposiums.</p>',
      'Homepage',
    );
    assert.equal(energy.entity_class, 'education_company', 'Enerdynamics');
    assert.equal(tax.entity_class, 'education_company', 'TaxSpeaker');
    assert.equal(mastery.entity_class, 'education_company', 'Profit Mastery');
    assert.equal(source.entity_class, 'society', 'M&A Source');
    assert.equal(expo.entity_class, 'society', 'Exponent');
    assert.equal(tcr.entity_class, 'society', 'TCR');
    assert.equal(bank.entity_class, 'institution', 'FHLB');
  });

  it('keeps product-software homepages as vendors even when they offer CPE', () => {
    const floqast = classifyFromHtml(
      'FloQast',
      '<title>FloQast | Auditable AI Accounting Automation</title><p>Watch A Demo. Start a free trial. FloQademy CPE courses.</p>',
      'FloQast | Auditable AI Accounting Automation',
    );
    const thinkcell = classifyFromHtml(
      'think-cell',
      '<title>PowerPoint software for charts | think-cell</title><p>Book a demo. Start free trial. Join our upcoming webinars.</p>',
      'PowerPoint software for charts | think-cell',
    );
    const pesi = classifyFromHtml(
      'PESI, Inc.',
      '<title>Continuing Education for Mental Health Professionals | PESI</title><meta name="description" content="Earn accredited continuing education."><p>Request a demo. For clinicians.</p>',
      'Continuing Education for Mental Health Professionals | PESI',
    );
    const medbridge = classifyFromHtml(
      'Medbridge',
      '<title>Healthcare Education and Patient Care Software | Medbridge</title><p>Request a demo. Start a free trial. CE courses for therapists.</p>',
      'Healthcare Education and Patient Care Software | Medbridge',
    );
    assert.equal(floqast.entity_class, 'commercial_vendor');
    assert.equal(thinkcell.entity_class, 'commercial_vendor');
    assert.equal(pesi.entity_class, 'education_company');
    assert.equal(medbridge.entity_class, 'commercial_vendor');
  });
});
