import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { sendInvitationEmail } from '../functions/sendInvitationEmail/resource';
import { testMailboxConnection } from '../functions/testMailboxConnection/resource';

/*== STEP 1 ===============================================================
The section below creates a Todo database table with a "content" field. Try
adding a new "isDone" field as a boolean. The authorization rule below
specifies that any unauthenticated user can "create", "read", "update", 
and "delete" any "Todo" records.
=========================================================================*/
const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [allow.guest()]),
  
  sendInvitationEmail: a
    .query()
    .arguments({
      to: a.string().required(),
      inviterName: a.string().required(),
      inviterEmail: a.string().required(),
      accountName: a.string().required(),
      acceptUrl: a.string(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(sendInvitationEmail)),
  
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

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
