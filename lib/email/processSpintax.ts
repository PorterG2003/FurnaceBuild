/**
 * Process spintax: {option1|option2|option3} → pick one option per occurrence.
 * Supports nested spintax. Options may contain variables {{var}}; runs before variable merge.
 * Logic must stay in sync with workers/send-worker/src/email.ts.
 */

export interface ProcessSpintaxOptions {
  /** When true, pick first option (for stable preview). When false, pick randomly. */
  deterministic?: boolean;
}

/**
 * Replace {a|b|c} with one of the options. When deterministic is true, uses first option.
 */
export function processSpintax(str: string, options?: ProcessSpintaxOptions): string {
  if (!str) return '';

  const deterministic = options?.deterministic ?? false;

  // Match {opt1|opt2|opt3}; options can contain {{var}} (variable placeholders)
  const spinRegex = /\{((?:\{\{[^}]*\}\}|[^{}|])*(?:\|(?:\{\{[^}]*\}\}|[^{}|])*)+)\}/g;
  let result = str;
  let prev: string;
  do {
    prev = result;
    result = result.replace(spinRegex, (match, optionsStr: string) => {
      const optionsList = optionsStr.split('|').map((o) => o.trim());
      if (optionsList.length < 2) return match;
      const idx = deterministic ? 0 : Math.floor(Math.random() * optionsList.length);
      return optionsList[idx] ?? match;
    });
  } while (result !== prev);

  return result;
}
