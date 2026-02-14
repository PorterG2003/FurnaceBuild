import assert from 'node:assert/strict';
import { sanitizeEmailBody, getDisplayBody } from '../lib/email';

function run(): void {
  const qpSample = `Another one coming through=C2=A0\nOn M= on, Feb 9, 2026 at 2:38=E2=80=AFPM`;
  const qpDecoded = sanitizeEmailBody(qpSample, { format: 'text' });
  assert(!qpDecoded.includes('=C2=A0'));
  assert(!qpDecoded.includes('=E2=80=AF'));
  assert(!qpDecoded.includes('M= on'));

  const mojibakeSample = `On Mon, Feb 9, 2026 at 4:31â¯PM Porter Gardiner <porter@getfurnace.io> wrote:\nAnother one coming throughÂ `;
  const mojibakeDecoded = sanitizeEmailBody(mojibakeSample, { format: 'text' });
  assert(!mojibakeDecoded.includes('â¯'));
  assert(!mojibakeDecoded.includes('Â'));
  assert(/4:31\s*PM/.test(mojibakeDecoded));

  const doubleMojibakeSample = `On Mon, Feb 9, 2026 at 4:31Ã¢ÂÂ¯PM Porter Gardiner <porter@getfurnace.io> wrote:\nAnother one coming throughÃ `;
  const doubleMojibakeDecoded = sanitizeEmailBody(doubleMojibakeSample, { format: 'text' });
  assert(!doubleMojibakeDecoded.includes('Ã¢ÂÂ¯'));
  assert(!doubleMojibakeDecoded.includes('Ã'));
  assert(/4:31\s*PM/.test(doubleMojibakeDecoded));

  const qpDbSample = `On Mon, Feb 9, 2026 at 4:31=E2=80=AFPM Porter Gardiner <porter@getfurnace.i=\no> wrote:`;
  const qpDbDecoded = sanitizeEmailBody(qpDbSample, { format: 'text' });
  assert(!qpDbDecoded.includes('=E2=80=AF'));
  assert(!qpDbDecoded.includes('i=\no'));

  const htmlSample = `CTO &am= p; Cofounder\n<= /div>\n<= br>`;
  const htmlSanitized = sanitizeEmailBody(htmlSample, { format: 'html' });
  assert(!htmlSanitized.includes('&am= p;'));
  assert(htmlSanitized.includes('&amp;') || htmlSanitized.includes('&'));
  assert(!htmlSanitized.includes('<= /div>'));
  assert(htmlSanitized.includes('</div>') || !htmlSanitized.includes('div'));

  const gmailQuotedPrintableHtml = `<div dir=3D"ltr">This format better?</div><br><div class=3D"gmail_quote gma=
il_quote_container"><div dir=3D"ltr" class=3D"gmail_attr">On Mon, Feb 9, 20=
26 at 4:31=E2=80=AFPM Porter Gardiner &lt;<a href=3D"mailto:porter@getfurna=
ce.io">porter@getfurnace.io</a>&gt; wrote:<br></div><blockquote class=3D"gm=
ail_quote" style=3D"margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,=
204,204);padding-left:1ex"><div dir=3D"ltr">Another one coming through=C2=
=A0</div></blockquote></div>`;
  const gmailHtmlSanitized = sanitizeEmailBody(gmailQuotedPrintableHtml, { format: 'html' });
  assert(!gmailHtmlSanitized.includes('=3D'));
  assert(!gmailHtmlSanitized.includes('=E2=80=AF'));
  assert(!gmailHtmlSanitized.includes('=C2=A0'));
  assert(gmailHtmlSanitized.includes('4:31'));
  assert(gmailHtmlSanitized.includes('mailto:porter@getfurnace.io'));

  const htmlResidualMojibake = `<div>On Mon, Feb 9, 2026 at 4:31â¯PM</div><div>throughÂ </div>`;
  const htmlResidualFixed = sanitizeEmailBody(htmlResidualMojibake, { format: 'html' });
  assert(!htmlResidualFixed.includes('â¯'));
  assert(!htmlResidualFixed.includes('Â'));

  const quoted = `This is the new content.\n\nOn Fri, Feb 6, 2026 at 1:41 PM Porter Gardiner <porter@getfurnace.io> wrote:\nOld content`;
  const display = getDisplayBody(quoted, { format: 'text' });
  assert(display.includes('This is the new content.'));
  assert(!display.includes('Old content'));

  console.log('Email parsing fixtures passed.');
}

run();

