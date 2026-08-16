export interface TagLike {
  id: string;
  name: string;
  color: string | null;
  groupName?: string | null;
  isCatalog?: boolean;
}
