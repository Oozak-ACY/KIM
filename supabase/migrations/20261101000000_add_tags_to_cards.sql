alter table public.cards
  add column tags text[] not null default '{}';

grant update (tags) on public.cards to authenticated;
