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

## Check

```bash
npm test
npm run typecheck
```
