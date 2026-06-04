import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { testMailboxConnection } from '../functions/testMailboxConnection/resource';

const schema = a.schema({
  testMailboxConnection: a
    .query()
    .arguments({
      smtp_host: a.string().required(),
      smtp_port: a.integer().required(),
      smtp_username: a.string().required(),
      smtp_password: a.string().required(),
      smtp_use_tls: a.boolean().required(),
      smtp_use_ssl: a.boolean().required(),
      imap_host: a.string().required(),
      imap_port: a.integer().required(),
      imap_username: a.string().required(),
      imap_password: a.string().required(),
      imap_use_ssl: a.boolean().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(testMailboxConnection)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
