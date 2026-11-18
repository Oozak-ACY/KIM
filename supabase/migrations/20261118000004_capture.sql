-- Capture: an AI assistant saves one Card through the KIM connector. The Card
-- keeps its Source, and each Captured Card is recorded so the free plan can
-- count them per calendar month. The limit itself is not enforced in v1.
alter table public.cards
  add column source_assistant text
    check (char_length(source_assistant) between 1 and 60),
  add column source_conversation text
    check (char_length(source_conversation) between 1 and 500),
  add constraint cards_source_complete
    check ((source_assistant is null) = (source_conversation is null));

-- A Card's Source is written at Capture and never changed, so the update
-- grants on cards leave it out.

create table public.captured_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Kept when the Card is deleted: it still counts for the month it was captured.
  card_id uuid references public.cards (id) on delete set null,
  captured_at timestamptz not null
);

create index captured_cards_user_id_captured_at_idx
  on public.captured_cards (user_id, captured_at);

-- Captured Cards are written by capture_card only, so the count the free
-- plan will rely on cannot be forged.
grant select on public.captured_cards to authenticated;

alter table public.captured_cards enable row level security;

create policy "Users read their own Captured Cards"
  on public.captured_cards for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Adds a Card, given as a cards row, and records it as a Captured Card in one
-- transaction. Captures go to a linked Account only. It runs as its owner to
-- write captured_cards, so it sets the user itself and names every column.
create function public.capture_card(card jsonb)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  captured public.cards;
begin
  if auth.uid() is null or not public.user_is_linked() then
    raise exception 'Captures need a linked Account';
  end if;

  insert into public.cards (
    user_id, cue, essence, hints, quiz_questions, quiz_mode, quiz_turn, tags,
    archived, archive_proposal_declined, source_assistant, source_conversation,
    created_at, due_at, fsrs_schedule
  )
  select
    auth.uid(), drafted.cue, drafted.essence, drafted.hints, drafted.quiz_questions,
    drafted.quiz_mode, drafted.quiz_turn, drafted.tags, drafted.archived,
    drafted.archive_proposal_declined, drafted.source_assistant,
    drafted.source_conversation, drafted.created_at, drafted.due_at, drafted.fsrs_schedule
  from jsonb_populate_record(null::public.cards, card) as drafted
  returning * into captured;

  if captured.source_assistant is null then
    raise exception 'A Captured Card needs its Source';
  end if;

  insert into public.captured_cards (user_id, card_id, captured_at)
  values (captured.user_id, captured.id, captured.created_at);

  return captured;
end;
$$;

revoke execute on function public.capture_card from public, anon;
grant execute on function public.capture_card to authenticated;
