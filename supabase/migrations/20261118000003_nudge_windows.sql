-- Nudge windows, daily cap and grouping. The user chooses when and how often
-- KIM nudges; the Nudge job plans within those choices, and groups the due
-- Cards past the daily cap into one Nudge.

-- Whether a Nudge window list is well formed: a non-empty array of
-- {"start": minutes, "end": minutes} after local midnight, start and end
-- different. One that ends before it starts runs across midnight; an end of
-- 1440 is midnight at the close of the day.
create function public.is_nudge_window_list(windows jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(windows) = 'array'
    and jsonb_array_length(windows) > 0
    and not exists (
      select 1
      from jsonb_array_elements(windows) as window_value
      where jsonb_typeof(window_value) <> 'object'
        or jsonb_typeof(window_value -> 'start') <> 'number'
        or jsonb_typeof(window_value -> 'end') <> 'number'
        or (window_value ->> 'start')::numeric not between 0 and 1439
        or (window_value ->> 'end')::numeric not between 0 and 1440
        or (window_value ->> 'start')::numeric % 1 <> 0
        or (window_value ->> 'end')::numeric % 1 <> 0
        or (window_value ->> 'start')::numeric = (window_value ->> 'end')::numeric
    );
$$;

-- time_zone stays null until the app saves the phone's, when it first
-- registers for Nudges. The app checks it is a zone Intl knows, as the job
-- does; Postgres's own list differs, so it is not checked here, and the job
-- plans in UTC for a zone it cannot read.
alter table public.settings
  add column nudges_on boolean not null default true,
  add column nudge_windows jsonb not null default '[{"start": 540, "end": 1260}]'
    check (public.is_nudge_window_list(nudge_windows)),
  add column daily_nudge_cap integer not null default 3
    check (daily_nudge_cap between 1 and 10),
  add column time_zone text;

grant update (nudges_on, nudge_windows, daily_nudge_cap, time_zone)
  on public.settings to authenticated;

-- A Card nudged within a grouped Nudge. Only single-Card Nudges count against
-- the daily cap, and a user gets one grouped Nudge a local day.
alter table public.nudges
  add column grouped boolean not null default false;

-- The Cards the Nudge job considers: due by due_by and not yet nudged for
-- their current due date, not Archived, of Accounts with a phone registered
-- and Nudges on. A due Card left out of a Nudge stays here until it is
-- nudged or reviewed, so it rolls over to the next window. Whether the
-- Account is linked comes along, so the core keeps the final say.
drop function public.nudge_candidates(timestamptz, timestamptz);

create function public.nudge_candidates(due_by timestamptz)
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
  left join public.settings on settings.user_id = cards.user_id
  where cards.due_at <= due_by
    and not cards.archived
    and coalesce(settings.nudges_on, true)
    and exists (
      select 1 from public.push_tokens where push_tokens.user_id = cards.user_id
    )
    and not exists (
      select 1 from public.nudges
      where nudges.card_id = cards.id and nudges.due_at = cards.due_at
    );
$$;

revoke execute on function public.nudge_candidates from public, anon, authenticated;
grant execute on function public.nudge_candidates to service_role;
