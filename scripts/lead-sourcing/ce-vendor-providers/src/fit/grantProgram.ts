const GRANT_PROGRAM =
  /\b(independent medical education|ime grant|educational grant (application|request|portal)|grant request portal|rfp calendar|apply for (an? )?(educational )?grant|grant-making)\b/i;

export function detectFormalGrantProgram(text: string): boolean {
  return GRANT_PROGRAM.test(text);
}
