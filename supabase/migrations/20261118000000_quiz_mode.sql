-- Quiz mode: a Card can carry up to 3 Quiz questions, each with its expected
-- answer, and be reviewed by asking them in turn. quiz_turn counts the Card's
-- Quiz mode Reviews, so the next one asks the following Quiz question.
alter table public.cards
  add column quiz_mode boolean not null default false,
  add column quiz_questions jsonb not null default '[]'
    check (
      jsonb_typeof(quiz_questions) = 'array'
      -- QUIZ_QUESTIONS_MAX in @kim/core.
      and jsonb_array_length(quiz_questions) <= 3
    ),
  add column quiz_turn integer not null default 0 check (quiz_turn >= 0);

-- The update policy from scheduling already limits users to their own Cards.
grant update (quiz_mode, quiz_questions, quiz_turn) on public.cards to authenticated;

-- record_review now also saves the Quiz turn. Its old signature goes, so
-- no client can reschedule a Card without moving the rotation.
drop function public.record_review(
  uuid, timestamptz, jsonb, timestamptz, text, text, text
);

-- Reschedules a Card and logs its Review in one transaction.
create function public.record_review(
  review_card_id uuid,
  new_due_at timestamptz,
  new_fsrs_schedule jsonb,
  new_quiz_turn integer,
  review_reviewed_at timestamptz,
  review_grade text,
  review_channel text,
  review_mode text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.cards
  set
    due_at = new_due_at,
    fsrs_schedule = new_fsrs_schedule,
    quiz_turn = new_quiz_turn
  where id = review_card_id;

  if not found then
    raise exception 'Card % not found', review_card_id;
  end if;

  insert into public.reviews (card_id, reviewed_at, grade, channel, mode)
  values (
    review_card_id,
    review_reviewed_at,
    review_grade,
    review_channel,
    review_mode
  );
end;
$$;

revoke execute on function public.record_review from public, anon;
grant execute on function public.record_review to authenticated;

-- One row per Account, created on its first change; until then the app uses
-- the defaults. Deleting the Account deletes its Settings by the cascade.
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  new_cards_in_quiz_mode boolean not null default false
);

grant select, insert, update (new_cards_in_quiz_mode) on public.settings to authenticated;

alter table public.settings enable row level security;

create policy "Users read their own Settings"
  on public.settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own Settings"
  on public.settings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users change their own Settings"
  on public.settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
