import test from 'node:test';

test(
  'integration: runMetaAdLibraryLookup hits Meta Ad Library',
  { skip: process.env.META_ADS_INTEGRATION !== '1' },
  async () => {
    const { runMetaAdLibraryLookup } = await import('./metaAdLibraryLookup.js');
    const result = await runMetaAdLibraryLookup({
      domain: 'nike.com',
      companyName: 'Nike',
      headless: true,
      timeoutMs: 30_000,
    });
    if (result.result !== 'yes') {
      throw new Error(`Expected yes for nike.com, got ${JSON.stringify(result)}`);
    }
  },
);
