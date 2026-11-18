# KIM

A mobile memory companion. See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions.

- `packages/core`: the KIM core, pure TypeScript holding every domain rule
- `packages/supabase`: the Card and Settings stores on Supabase, shared by the app and the connector
- `apps/mobile`: the Expo app
- `apps/mcp`: the KIM connector, a remote MCP server assistants use to Capture Cards
- `supabase`: database migrations and local configuration

## Develop

Local Supabase needs Docker running.

```bash
npm install
supabase start
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env`, set the anon key printed by `supabase status`, and on a phone or emulator replace `127.0.0.1` with this computer's LAN IP. Then start the app:

```bash
npm run start --workspace @kim/mobile
```

A hosted Supabase project needs anonymous sign-ins turned on in its Auth settings; `supabase/config.toml` only covers local development.

### Accounts

Every Account starts anonymous and becomes linked when the user signs in with Google or an email magic link. KIM does not offer Sign in with Apple. In the hosted project's Auth settings:

- turn on manual linking, which lets an anonymous user link Google;
- add `kim://**` to the redirect URLs;
- set up the Google provider (a web client ID and secret).

Do not run `supabase config push` against a hosted project from this folder: it pushes the local development settings, such as email confirmations off. Change hosted Auth settings in the dashboard.

Locally, email links land in Mailpit at http://127.0.0.1:54324. Google stays off in `supabase/config.toml` until you set its credentials. OAuth redirects to `kim://` need a development build (`npx expo run:ios` or `npx expo run:android`), not Expo Go.

### KIM connector

The connector is a remote MCP server (streamable HTTP) at `/mcp`, signed in through Supabase Auth's OAuth 2.1 server (see `docs/adr/0003-connector-on-node-with-supabase-oauth.md`). Only linked Accounts can connect. Locally, with `supabase start` running:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> KIM_MCP_URL=http://127.0.0.1:3000 npm start --workspace @kim/mcp
```

It listens on port 3000, the local site URL, so Supabase Auth sends the user to its consent page at `/oauth/consent`. Set `PORT` and `HOST` to change where it listens.

To host it, deploy `apps/mcp` as a Node service with `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the publishable key), `KIM_MCP_URL` (its public URL) and `HOST=0.0.0.0`. In the hosted project's Auth settings:

- turn on the OAuth 2.1 server with dynamic client registration;
- set the site URL to the connector's public URL, and the authorization path to `/oauth/consent`;
- add `<connector URL>/oauth/consent**` to the redirect URLs.

Users then add `<connector URL>/mcp` as a custom connector in Claude or ChatGPT. Captured Cards are counted per month; enforcing the free plan's limit is off (`captureLimitEnforced` in the core's `Features`).

## Check

```bash
npm test
npm run typecheck
```
