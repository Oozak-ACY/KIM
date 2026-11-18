# The KIM connector is a Node service, with Supabase Auth as its OAuth server

The MCP server runs as its own Node service (`apps/mcp`) rather than as a Supabase Edge Function. It reuses the KIM core as is, which Deno cannot import without the copying the Nudge job does for one file, and it serves the OAuth consent page, which Edge Functions cannot serve as HTML. Supabase Auth's OAuth 2.1 server issues the access tokens, so every connector query runs as the user under the same row level security as the app.

## Considered Options

- **Edge Function**: no extra host to run, but the core would need a Deno-ready build and the consent page another home.
- **The connector as its own authorization server**: more control over consent and tokens, but a second identity system to keep in step with Supabase Auth.
