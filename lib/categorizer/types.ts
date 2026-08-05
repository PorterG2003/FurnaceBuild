export type CategorizerMessageSnippet = {
  subject: string | null;
  bodyText: string | null;
};

export type CategorizerThreadContext = {
  messageDate: Date;
  reply: CategorizerMessageSnippet;
  priorOutbound?: CategorizerMessageSnippet | null;
};
