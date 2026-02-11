/** Type declaration for optional expo-document-picker (used for native attachment picker). Install with: npx expo install expo-document-picker */
declare module 'expo-document-picker' {
  export function getDocumentAsync(options: {
    type?: string;
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }): Promise<
    | { canceled: true }
    | { canceled: false; assets: { uri: string; name?: string; mimeType?: string; size?: number }[] }
  >;
}
