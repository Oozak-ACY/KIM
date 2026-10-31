create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cue text not null,
  essence text not null,
  created_at timestamptz not null
);

create index cards_user_id_idx on public.cards (user_id);

grant select, insert on public.cards to authenticated;

alter table public.cards enable row level security;

-- Anonymous sessions use the authenticated role, so these cover them too.
create policy "Users read their own Cards"
  on public.cards for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own Cards"
  on public.cards for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
