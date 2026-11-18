-- Nudges: the server decides what is due and pushes it to the phone
-- (ADR 0002). A scheduled job calls the send-nudges Edge Function, which asks
-- @kim/core to plan the Nudges and sends them through Expo's push service.

-- The phones a linked Account receives Nudges on, with the language the app
-- speaks there. A push token belongs to one Account at a time.
create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'fr')),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- Only register_push_token and the Nudge job touch it.
alter table public.push_tokens enable row level security;

-- Registers this phone for the signed-in Account's Nudges, taking the token
-- from any Account that held it before, such as one signed out on this phone.
-- Nudges require a linked Account.
create function public.register_push_token(push_token text, push_language text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.user_is_linked() then
    raise exception 'Nudges require a linked account';
  end if;

  insert into public.push_tokens (token, user_id, language, updated_at)
  values (push_token, auth.uid(), push_language, now())
  on conflict (token) do update
  set user_id = excluded.user_id,
      language = excluded.language,
      updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.register_push_token from public, anon;
grant execute on function public.register_push_token to authenticated;

-- One row per Nudge sent for a Card's due date, so a Card is never nudged
-- twice for the same due date. Later the daily cap counts these rows.
create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  due_at timestamptz not null,
  sent_at timestamptz not null,
  unique (card_id, due_at)
);

create index nudges_user_id_sent_at_idx on public.nudges (user_id, sent_at);

-- Only the Nudge job, with the service role, touches it.
alter table public.nudges enable row level security;

-- The Cards the Nudge job considers: newly due (between due_after and
-- due_by), not Archived, of Accounts with a phone registered. Whether the Account is linked comes along, so the core
-- keeps the final say. due_at is the Card's current due date: a Card reviewed
-- since it came due is due later, so it is not returned.
create function public.nudge_candidates(due_after timestamptz, due_by timestamptz)
returns table (
  user_id uuid,
  linked boolean,
  card_id uuid,
  cue text,
  due_at timestamptz,
  archived boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cards.user_id,
    not coalesce(users.is_anonymous, false),
    cards.id,
    cards.cue,
    cards.due_at,
    cards.archived
  from public.cards
  join auth.users on users.id = cards.user_id
  where cards.due_at between due_after and due_by
    and not cards.archived
    and exists (
      select 1 from public.push_tokens where push_tokens.user_id = cards.user_id
    );
$$;

revoke execute on function public.nudge_candidates from public, anon, authenticated;
grant execute on function public.nudge_candidates to service_role;

-- Runs the Nudge job every five minutes. It reads the project URL and a
-- secret key from Vault, which each project sets once:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<secret key>', 'secret_key');
-- Without them the job's calls fail and no Nudge is sent.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-nudges',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
