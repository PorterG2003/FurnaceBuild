import { runFindContactsCli } from './findContacts.js';

runFindContactsCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
