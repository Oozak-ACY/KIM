# KIM

A mobile memory companion. See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions.

- `packages/core`: the KIM core, pure TypeScript holding every domain rule
- `apps/mobile`: the Expo app
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

Locally, email links land in Mailpit at http://127.0.0.1:54324. Google stays off in `supabase/config.toml` until you set its credentials. OAuth redirects to `kim://` need a development build (`npx expo run:ios` or `npx expo run:android`), not Expo Go.

## Check

```bash
npm test
npm run typecheck
```
