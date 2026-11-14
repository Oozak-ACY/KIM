alter table public.cards
  add column hints text not null default '',
  add column archived boolean not null default false;

-- Editing a Card changes what it says; archiving keeps it out of Reviews.
-- The update policy from scheduling already limits users to their own Cards.
grant update (cue, essence, hints, archived) on public.cards to authenticated;

-- Deleting a Card deletes its Reviews through their on delete cascade.
grant delete on public.cards to authenticated;

create policy "Users delete their own Cards"
  on public.cards for delete
  to authenticated
  using ((select auth.uid()) = user_id);
