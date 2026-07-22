#!/usr/bin/env tsx
/**
 * Standalone Client API docs deploy.
 *
 * Builds the Fumadocs static export and publishes it with an incremental
 * `aws s3 sync` + CloudFront invalidation. This is intentionally decoupled from
 * the Amplify/CloudFormation backend deploy — a docs change never triggers a
 * backend or worker deploy.
 *
 * Usage:
 *   npm run deploy:client-api-docs -- --env dev
 *   npm run deploy:client-api-docs -- --env prod
 *
 * Flags:
 *   --env dev|prod       (required) target environment
 *   --skip-build         reuse the existing docs/client-api/out (e.g. retry a failed sync)
 *   --skip-invalidation  sync only, do not create a CloudFront invalidation
 *   --prune-assets       delete orphaned _next assets after upload (run only well
 *                        after a deploy has propagated; see caching notes below)
 *   --region <region>    override AWS region (default: AWS_REGION or us-west-2)
 *
 * Resolution: the target S3 bucket and CloudFront distribution are discovered by
 * matching the distribution whose alias is the env's API domain, so no Amplify
 * App ID or generated outputs are required.
 *
 * Caching strategy (prevents the "no CSS / 404 after deploy" race):
 *   - Content-hashed assets under _next/ are uploaded first, WITHOUT --delete, and
 *     tagged immutable. Old asset chunks are kept so any still-cached old HTML keeps
 *     resolving during CloudFront/browser propagation.
 *   - HTML and other content is uploaded with must-revalidate so browsers/edges never
 *     serve stale HTML that points at asset hashes from a previous build.
 *   - Orphaned old assets accumulate; reclaim them later with --prune-assets.
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const docsProjectDir = path.join(repoRoot, 'docs', 'client-api');
const docsOutDir = path.join(docsProjectDir, 'out');

const DEFAULT_REGION = process.env.AWS_REGION?.trim() || 'us-west-2';

const ENV_DOMAINS: Record<'dev' | 'prod', string> = {
  dev: 'api-dev.getfurnace.io',
  prod: 'api.getfurnace.io',
};

// Invalidate everything with '/*'. The CloudFront viewer-request function rewrites
// URIs before the cache lookup (e.g. '/docs/guides/x/' -> '/guides/x/index.html',
// '/docs/_next/...' -> '/_next/...'), so cache keys are the rewritten ORIGIN paths.
// Invalidating '/docs' or '/docs/*' therefore matches nothing; '/*' covers all keys.
const INVALIDATION_PATHS = ['/*'];

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

type Args = {
  env: 'dev' | 'prod';
  skipBuild: boolean;
  skipInvalidation: boolean;
  pruneAssets: boolean;
  region: string;
};

function parseArgs(argv: string[]): Args {
  let env: string | undefined;
  let region = DEFAULT_REGION;
  let skipBuild = false;
  let skipInvalidation = false;
  let pruneAssets = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') {
      env = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    } else if (arg === '--region') {
      region = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--region=')) {
      region = arg.slice('--region='.length);
    } else if (arg === '--skip-build') {
      skipBuild = true;
    } else if (arg === '--skip-invalidation') {
      skipInvalidation = true;
    } else if (arg === '--prune-assets') {
      pruneAssets = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (env !== 'dev' && env !== 'prod') {
    throw new Error('Missing or invalid --env. Use "--env dev" or "--env prod".');
  }

  return { env, skipBuild, skipInvalidation, pruneAssets, region };
}

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function capture(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' });
}

function ensureAwsCli(): void {
  try {
    execSync('aws --version', { stdio: 'ignore' });
  } catch {
    throw new Error('AWS CLI not found on PATH. Install it and configure credentials before deploying docs.');
  }
}

function buildDocs(): void {
  console.log('== Generating docs content from TypeScript builders ==');
  run('npm', ['run', 'export:client-api-docs'], repoRoot);

  if (!fs.existsSync(path.join(docsProjectDir, 'node_modules'))) {
    console.log('== Installing docs dependencies (first run) ==');
    run('npm', ['ci'], docsProjectDir);
  }

  console.log('== Building static export (next build + flatten) ==');
  run('npm', ['run', 'build'], docsProjectDir);
}

type Distribution = {
  Id: string;
  Aliases?: { Items?: string[] };
  Origins?: { Items?: Array<{ DomainName: string }> };
};

function resolveTarget(domain: string): { distributionId: string; bucket: string } {
  console.log(`== Resolving CloudFront distribution for ${domain} ==`);
  const raw = capture('aws', ['cloudfront', 'list-distributions', '--output', 'json']);
  const parsed = JSON.parse(raw) as {
    DistributionList?: { Items?: Distribution[] };
  };
  const items = parsed.DistributionList?.Items ?? [];

  const match = items.find((dist) => (dist.Aliases?.Items ?? []).includes(domain));
  if (!match) {
    throw new Error(
      `No CloudFront distribution found with alias "${domain}". ` +
        'Confirm the AWS credentials/profile point at the correct account and that the distribution alias is attached.',
    );
  }

  const s3Origin = (match.Origins?.Items ?? []).find((origin) => /\.s3[.-]/.test(origin.DomainName));
  if (!s3Origin) {
    throw new Error(
      `Distribution ${match.Id} (alias ${domain}) has no S3 origin — cannot determine the docs bucket.`,
    );
  }

  const bucket = s3Origin.DomainName.replace(/\.s3[.-].*$/, '');
  return { distributionId: match.Id, bucket };
}

function syncToBucket(bucket: string, region: string): void {
  if (!fs.existsSync(docsOutDir)) {
    throw new Error(
      `Docs build output not found at ${docsOutDir}. Run without --skip-build, or build the docs first.`,
    );
  }

  const assetsDir = path.join(docsOutDir, '_next');

  // 1. Upload content-hashed assets first, immutable, WITHOUT --delete. Additive so
  //    any still-cached old HTML keeps resolving its assets during propagation.
  if (fs.existsSync(assetsDir)) {
    console.log(`== Uploading hashed assets to s3://${bucket}/_next/ (immutable) ==`);
    run(
      'aws',
      ['s3', 'sync', `${assetsDir}/`, `s3://${bucket}/_next/`, '--cache-control', ASSET_CACHE_CONTROL, '--region', region],
      repoRoot,
    );
  }

  // 2. Upload pages/content and prune stale pages, but never delete assets.
  console.log(`== Uploading pages/content to s3://${bucket}/ (must-revalidate) ==`);
  run(
    'aws',
    [
      's3', 'sync', `${docsOutDir}/`, `s3://${bucket}/`,
      '--exclude', '_next/*',
      '--delete',
      '--cache-control', HTML_CACHE_CONTROL,
      '--region', region,
    ],
    repoRoot,
  );

  // 3. Enforce must-revalidate on ALL HTML. `s3 sync` skips unchanged files, so
  //    re-stamp headers to guarantee HTML is never served stale (the root cause of
  //    "no CSS after deploy": old HTML pointing at deleted asset hashes).
  console.log('== Enforcing revalidation headers on HTML ==');
  run(
    'aws',
    [
      's3', 'cp', `s3://${bucket}/`, `s3://${bucket}/`,
      '--recursive',
      '--exclude', '*',
      '--include', '*.html',
      '--metadata-directive', 'REPLACE',
      '--content-type', 'text/html',
      '--cache-control', HTML_CACHE_CONTROL,
      '--region', region,
    ],
    repoRoot,
  );
}

function pruneOrphanedAssets(bucket: string, region: string): void {
  const assetsDir = path.join(docsOutDir, '_next');
  if (!fs.existsSync(assetsDir)) return;
  console.log(`== Pruning orphaned assets under s3://${bucket}/_next/ ==`);
  run(
    'aws',
    ['s3', 'sync', `${assetsDir}/`, `s3://${bucket}/_next/`, '--delete', '--cache-control', ASSET_CACHE_CONTROL, '--region', region],
    repoRoot,
  );
}

function invalidate(distributionId: string): void {
  console.log(`== Invalidating CloudFront ${distributionId} ==`);
  run(
    'aws',
    ['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', ...INVALIDATION_PATHS],
    repoRoot,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const domain = ENV_DOMAINS[args.env];

  console.log(`Deploying Client API docs -> ${args.env} (${domain}), region ${args.region}`);
  ensureAwsCli();

  if (args.skipBuild) {
    console.log('== Skipping build (--skip-build) ==');
  } else {
    buildDocs();
  }

  const { distributionId, bucket } = resolveTarget(domain);
  console.log(`Resolved bucket: ${bucket}`);
  console.log(`Resolved distribution: ${distributionId}`);

  syncToBucket(bucket, args.region);

  if (args.pruneAssets) {
    pruneOrphanedAssets(bucket, args.region);
  }

  if (args.skipInvalidation) {
    console.log('== Skipping CloudFront invalidation (--skip-invalidation) ==');
  } else {
    invalidate(distributionId);
  }

  console.log(`\nDone. Docs published to https://${domain}/docs`);
}

try {
  main();
} catch (error) {
  console.error(`\ndeploy-client-api-docs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
