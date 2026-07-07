export function modelLink(schemaName: string): string {
  return `[${schemaName}](#/components/schemas/${schemaName})`;
}

export function modelsLink(...schemaNames: string[]): string {
  return schemaNames.map((name) => modelLink(name)).join(', ');
}
