import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMAIL_HTML_SCOPE_SELECTOR,
  isolateEmailCss,
  isolateEmailHtmlForRender,
  selectorNeedsAppIsolation,
} from './isolate-email-html.js';

const PROOFPOINT_OUTLOOK_CSS = `
<!--
div
	{margin:0!important;
	padding:16px!important}
.x_ExternalClass
	{width:100%}
.x_ExternalClass, .x_ExternalClass p, .x_ExternalClass span, .x_ExternalClass font, .x_ExternalClass td, .x_ExternalClass div
	{line-height:100%}
#x_outlook a
	{padding:0}
table
	{}
table, td
	{border-collapse:collapse}
.x_pfptPreheader153756
	{display:none!important;
	visibility:hidden;
	font-size:1px;
	line-height:1px;
	max-height:0px;
	max-width:0px;
	opacity:0;
	overflow:hidden}
.x_pfptFooter153756
	{margin-bottom:50px!important}
-->
`;

describe('isolateEmailHtmlForRender', () => {
  it('drops Outlook paragraph resets and Proofpoint document-level div padding', () => {
    const isolated = isolateEmailCss(PROOFPOINT_OUTLOOK_CSS);

    assert.equal(/(^|[,}])\s*div\s*\{/.test(isolated), false);
    assert.equal(/(^|[,}])\s*P\s*\{/i.test(isolated), false);
    assert.equal(/(^|[,}])\s*table\s*\{/.test(isolated), false);
    assert.equal(isolated.includes('padding:16px'), false);
    assert.equal(isolated.includes('margin:0!important'), false);
  });

  it('scopes remaining class and id rules to the message container', () => {
    const isolated = isolateEmailCss(PROOFPOINT_OUTLOOK_CSS);

    assert.match(isolated, new RegExp(`${EMAIL_HTML_SCOPE_SELECTOR.replace('.', '\\.')} \\.x_ExternalClass`));
    assert.match(isolated, new RegExp(`${EMAIL_HTML_SCOPE_SELECTOR.replace('.', '\\.')} #x_outlook a`));
    assert.match(isolated, /x_pfptPreheader153756/);
    assert.match(isolated, /x_pfptFooter153756/);
  });

  it('prevents this thread HTML from leaking a global div reset into the page', () => {
    const html = `<html>
<head>
<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style>
</head>
<body dir="ltr">
<div class="elementToProof">I am interested.</div>
<style>${PROOFPOINT_OUTLOOK_CSS}</style>
<div><span class="x_pfptPreheader153756">hidden</span></div>
</body>
</html>`;

    const isolated = isolateEmailHtmlForRender(html);

    assert.equal(isolated.includes('<html'), false);
    assert.equal(isolated.includes('<body'), false);
    assert.match(isolated, /I am interested/);
    assert.equal(/(^|[,}])\s*div\s*\{/.test(isolated), false);
    assert.equal(/(^|[,}])\s*P\s*\{/.test(isolated), false);
    assert.match(isolated, /x_pfptPreheader153756/);
    assert.match(isolated, new RegExp(`${EMAIL_HTML_SCOPE_SELECTOR.replace('.', '\\.')} \\.x_pfptPreheader153756`));
  });

  it('scopes nested @media rules and drops @import', () => {
    const isolated = isolateEmailCss(`
      @import url("https://evil.example/x.css");
      @media screen {
        div { color: red; }
        .sig { color: blue; }
      }
    `);

    assert.equal(isolated.includes('@import'), false);
    assert.equal(isolated.includes('div{'), false);
    assert.match(isolated, /@media screen/);
    assert.match(isolated, new RegExp(`${EMAIL_HTML_SCOPE_SELECTOR.replace('.', '\\.')} \\.sig`));
  });

  it('treats class, id, and attribute selectors as email-specific', () => {
    assert.equal(selectorNeedsAppIsolation('div'), false);
    assert.equal(selectorNeedsAppIsolation('P'), false);
    assert.equal(selectorNeedsAppIsolation('*'), false);
    assert.equal(selectorNeedsAppIsolation('.x_ExternalClass p'), true);
    assert.equal(selectorNeedsAppIsolation('#x_outlook a'), true);
    assert.equal(selectorNeedsAppIsolation('div[class="x"]'), true);
  });
});
