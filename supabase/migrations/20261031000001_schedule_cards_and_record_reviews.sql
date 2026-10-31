alter table public.cards
  add column due_at timestamptz,
  add column fsrs_schedule jsonb;

-- Cards created before scheduling start as new Cards, due since their creation.
update public.cards
set
  due_at = created_at,
  fsrs_schedule = jsonb_build_object(
    'stability', 0,
    'stabilityFast', 0,
    'difficulty', 0,
    'state', 0,
    'scheduleStatus', 'new',
    'lastReviewAt', null,
    'cardId', id::text,
    'reps', 0,
    'lapses', 0,
    'scheduledDays', 0,
    'learningStep', 0
  );

alter table public.cards
  alter column due_at set not null,
  alter column fsrs_schedule set not null;

create index cards_user_id_due_at_idx on public.cards (user_id, due_at);

grant update (due_at, fsrs_schedule) on public.cards to authenticated;

create policy "Users reschedule their own Cards"
  on public.cards for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  reviewed_at timestamptz not null,
  grade text not null check (grade in ('again', 'hard', 'good')),
  channel text not null check (channel in ('app', 'chat')),
  mode text not null check (mode in ('recall', 'quiz'))
);

create index reviews_card_id_idx on public.reviews (card_id);

grant select, insert on public.reviews to authenticated;

alter table public.reviews enable row level security;

create policy "Users read their own Reviews"
  on public.reviews for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create Reviews of their own Cards"
  on public.reviews for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cards
      where cards.id = card_id and cards.user_id = (select auth.uid())
    )
  );

-- Reschedules a Card and logs its Review in one transaction.
create function public.record_review(
  review_card_id uuid,
  new_due_at timestamptz,
  new_fsrs_schedule jsonb,
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
  set due_at = new_due_at, fsrs_schedule = new_fsrs_schedule
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
