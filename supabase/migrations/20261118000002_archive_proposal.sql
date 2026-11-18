-- Archive proposal: after a remembered Review closing an interval of at
-- least 180 days, KIM proposes archiving the Card. Declining keeps it
-- scheduled and is remembered here, so KIM never proposes again for it.
alter table public.cards
  add column archive_proposal_declined boolean not null default false;

-- The update policy from scheduling already limits users to their own Cards.
grant update (archive_proposal_declined) on public.cards to authenticated;
