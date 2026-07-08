import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  basePath: '/docs',
  turbopack: {
    root: import.meta.dirname,
  },
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_DOCS_BASE_PATH: '/docs',
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
