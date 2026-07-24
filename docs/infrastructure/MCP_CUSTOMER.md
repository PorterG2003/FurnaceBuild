# Furnace MCP (customer)

Connect Cursor, Claude, or other MCP clients to your Furnace account.

## Server URL

Production: `https://mcp.getfurnace.io/mcp`  
(See Account Settings → MCP for the URL for your environment.)

## Connect with OAuth

1. Add a **remote / HTTP** MCP server in your client with the URL above.
2. When prompted, sign in to Furnace and click **Approve**.
3. The client receives an access token; you do not paste an API key.

Tools mirror the Furnace Client API (campaigns, flows, leads, inbox, webhooks, API keys, mailbox connect sessions, and more). Server updates apply on the next session without changing your MCP config.

## Advanced (API key)

For scripts or non-OAuth clients, you can still send `Authorization: Bearer f_…` using a key from Account Settings → API keys. Prefer OAuth for interactive MCP clients.
