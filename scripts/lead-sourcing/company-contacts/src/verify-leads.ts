import { runVerifyLeadsCli } from './verifyLeads.js';

runVerifyLeadsCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
