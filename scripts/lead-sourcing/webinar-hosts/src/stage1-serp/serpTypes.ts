export type SerpOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
};

export type SerpSearchResponse = {
  organic?: SerpOrganicResult[];
};

export function mapSerpOrganic(
  response: SerpSearchResponse,
  searchQuery: string,
  serpPage: number,
  collectedAt: string,
): Array<{
  url: string;
  title: string;
  snippet: string;
  searchQuery: string;
  serpPosition: number;
  serpPage: number;
  collectedAt: string;
}> {
  const organic = response.organic ?? [];
  return organic
    .filter((item) => item.link)
    .map((item, index) => ({
      url: item.link!,
      title: item.title ?? '',
      snippet: item.snippet ?? '',
      searchQuery,
      serpPosition: item.position ?? index + 1 + (serpPage - 1) * 10,
      serpPage,
      collectedAt,
    }));
}
