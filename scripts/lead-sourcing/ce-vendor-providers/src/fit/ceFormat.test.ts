import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCeFormat, detectCeFormatFromHtml } from './ceFormat.js';

describe('CE delivery format', () => {
  it('treats in-office lunch-and-learns as in-person, not live online', () => {
    const result = detectCeFormat(
      'Book a lunch-and-learn at your firm. Our spec team presents in-office. You schedule the visit.',
    );
    assert.equal(result.has_live_online, false);
    assert.deepEqual(result.ce_formats, ['in_person']);
    assert.equal(result.primary_ce_format, 'in_person');
  });

  it('counts on-request virtual lunch-and-learns as live online without a public calendar', () => {
    const result = detectCeFormat(
      'Book a virtual or in-person lunch and learn. Schedule a session with our team. No upcoming dates listed.',
    );
    assert.equal(result.has_live_online, true);
    assert.deepEqual(result.ce_formats, ['live_online', 'in_person']);
    assert.equal(result.primary_ce_format, 'live_online');
  });

  it('keeps AIA article-plus-quiz on-demand separate from in-person lunch-and-learn', () => {
    const result = detectCeFormat(
      'Free AIA CES. Start the course: read the article and take the quiz. Also offer in-person Lunch & Learn at your office.',
    );
    assert.equal(result.has_live_online, false);
    assert.deepEqual(result.ce_formats, ['in_person', 'on_demand']);
    assert.equal(result.primary_ce_format, 'in_person');
  });

  it('does not treat a generic online course plus lunch-and-learn as live online', () => {
    const result = detectCeFormat(
      'Take our online continuing education course. Lunch and learn available for specifiers.',
    );
    assert.equal(result.has_live_online, false);
    assert.ok(result.ce_formats.includes('in_person'));
    assert.equal(result.ce_formats.includes('live_online'), false);
  });

  it('detects a live webinar for copy even when it is not a group calendar event', () => {
    const result = detectCeFormat('Join our live webinar. Complimentary CE credit. Register on this page.');
    assert.equal(result.has_live_online, true);
    assert.deepEqual(result.ce_formats, ['live_online']);
  });

  it('treats recorded webinars as on-demand, not live', () => {
    const result = detectCeFormat('Watch the recorded webinar and complete the quiz at your own pace.');
    assert.equal(result.has_live_online, false);
    assert.ok(result.ce_formats.includes('on_demand'));
  });

  it('ignores Webinars sitting in nav next to a lunch-and-learn page', () => {
    const html = `
      <html><head><title>Lunch and Learn</title></head>
      <body>
        <header><nav><a href="/lunch-and-learn">Lunch and Learn</a><a href="/webinars">Webinars</a></nav></header>
        <main><h1>Lunch and Learn</h1><p>Book a lunch-and-learn at your firm. Our spec team presents in-office.</p></main>
      </body></html>`;
    const result = detectCeFormatFromHtml(html);
    assert.equal(result.has_live_online, false);
    assert.deepEqual(result.ce_formats, ['in_person']);
  });

  it('does not treat Lunch & Learn next to Online Courses as virtual', () => {
    const html = `
      <html><head><title>Continuing Education</title></head>
      <body>
        <nav><a>Lunch & Learn</a><a>Online Courses</a></nav>
        <main><p>Request a lunch and learn at your office. Online courses are article and quiz.</p></main>
      </body></html>`;
    const result = detectCeFormatFromHtml(html);
    assert.equal(result.has_live_online, false);
    assert.ok(result.ce_formats.includes('in_person'));
    assert.ok(result.ce_formats.includes('on_demand'));
  });

  it('does not score a 404 page that still has Webinar in the chrome', () => {
    const html = `
      <html><head><title>Error 404 - Kee Safety</title></head>
      <body>
        <nav><a href="/education/aia-webinar">Webinar</a></nav>
        <h1>Page not found</h1>
      </body></html>`;
    const result = detectCeFormatFromHtml(html);
    assert.equal(result.has_live_online, false);
    assert.equal(result.primary_ce_format, 'unknown');
  });

  it('still detects a live CEU webinar in the page body', () => {
    const html = `
      <html><head><title>Register for our next Porous Pavers Education Webinar</title></head>
      <body>
        <nav><a href="/products">Products</a></nav>
        <main><p>Join us for our next live CEU webinar. Each month we host a free CEU course.</p></main>
      </body></html>`;
    assert.equal(detectCeFormatFromHtml(html).has_live_online, true);
  });

  it('treats mixed live-and-on-demand catalogs as live online plus on-demand', () => {
    const result = detectCeFormat(
      'EMDR Advanced Trainings. Grow with us through live and on-demand trainings designed to inspire. UPCOMING LIVE TRAININGS Join our expert-led workshops. LIVE: Oct 23, 2026 Body image disturbance. ON DEMAND TRAININGS Explore our library of on-demand EMDR trainings.',
    );
    assert.equal(result.has_live_online, true);
    assert.ok(result.ce_formats.includes('live_online'));
    assert.ok(result.ce_formats.includes('on_demand'));
    assert.equal(result.primary_ce_format, 'live_online');
  });

  it('treats a dated LIVE listing as live online', () => {
    const result = detectCeFormat(
      'EMDR Therapy for Body Image Disturbance LIVE: Oct 23, 2026 6 CES | Cost: $195 Register now.',
    );
    assert.equal(result.has_live_online, true);
    assert.ok(result.ce_formats.includes('live_online'));
  });

  it('does not treat "you live" metaphor copy as live online', () => {
    const result = detectCeFormat(
      "Being a therapist isn't just something you can just read about: it's something you live. That's why all of our trainers still carry full caseloads. Learn on your own schedule with our on-demand trainings. Access expert-led content anytime.",
    );
    assert.equal(result.has_live_online, false);
    assert.deepEqual(result.ce_formats, ['on_demand']);
  });

  it('does not treat recorded live training as scheduled live', () => {
    const result = detectCeFormat(
      'Watch this recorded live training at your own pace. On-demand library of past workshops.',
    );
    assert.equal(result.has_live_online, false);
    assert.ok(result.ce_formats.includes('on_demand'));
  });
});
