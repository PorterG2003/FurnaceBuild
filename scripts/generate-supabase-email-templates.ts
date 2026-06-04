import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSupabaseAuthTemplates } from '../lib/email/transactional/presets/auth/index.js';

const OUTPUT_PATH = resolve(
  process.cwd(),
  'docs/infrastructure/SUPABASE_EMAIL_TEMPLATES.md',
);

function renderTemplateSection(index: number, dashboardName: string, subject: string, html: string): string {
  return `## ${index}. ${dashboardName}

**Subject:**
\`\`\`
${subject}
\`\`\`

**Body (HTML):**
\`\`\`html
${html.trim()}
\`\`\`

---
`;
}

function main(): void {
  const templates = buildSupabaseAuthTemplates();
  const sections = templates.map((template, index) =>
    renderTemplateSection(index + 1, template.dashboardName, template.email.subject, template.email.html),
  );

  const doc = `# Supabase Auth Email Templates

Copy each **Subject** and **Body (HTML)** into your Supabase project: **Authentication** → **Email Templates**. Brand colors: Furnace orange \`#F3440D\`, dark \`#1a1a1a\`, neutral gray text.

> **Generated file.** Do not edit by hand — run \`npm run generate:supabase-email-templates\` after changing \`lib/email/transactional/\`.

---

${sections.join('\n')}

## Paste instructions

1. Supabase Dashboard → **Authentication** → **Email Templates**.
2. For each template type (Confirm signup, Magic link, Reset password, etc.):
   - Set **Subject** to the line under "Subject:" above.
   - Paste the full **Body** HTML (including \`<!DOCTYPE>\` and \`<html>…</html>\`) into the body editor.
3. Save. Ensure **SMTP** is configured for the project (Project settings → Auth → SMTP) or emails won't send.

All templates use \`{{ .ConfirmationURL }}\`, \`{{ .Token }}\`, \`{{ .Email }}\`, etc. Do not remove these; Supabase replaces them when sending.
`;

  writeFileSync(OUTPUT_PATH, doc, 'utf8');
  console.log(`Wrote ${templates.length} Supabase auth templates to ${OUTPUT_PATH}`);
}

main();
