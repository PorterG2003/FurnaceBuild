import { runResolveOrgsCli } from './resolveOrgs.js';

runResolveOrgsCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
