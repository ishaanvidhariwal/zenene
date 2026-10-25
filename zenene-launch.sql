-- =========================================================
-- ZENENE LAUNCH: per-account privacy + gratitude fix
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again.
--
-- 1. Every table only ever shows / changes the signed-in
--    person's own rows (Row Level Security).
-- 2. Calm's gratitude garden gets the columns it writes to
--    (entry_text, entry_date) - without them saving fails.
-- 3. New sign-ups get a profiles row with the name they chose.
-- =========================================================


-- ---------------------------------------------------------
-- 1. GRATITUDE COLUMNS
-- ---------------------------------------------------------

alter table public.gratitude_entries
    add column if not exists entry_text text,
    add column if not exists entry_date date not null default current_date;

-- The older columns must not block new inserts.
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'gratitude_entries' and column_name = 'items') then
        execute 'alter table public.gratitude_entries alter column items drop not null';
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'gratitude_entries' and column_name = 'date') then
        execute 'alter table public.gratitude_entries alter column date drop not null';
    end if;
end $$;


-- ---------------------------------------------------------
-- 2. user_id FILLS ITSELF IN
-- ---------------------------------------------------------

alter table public.journal_entries   alter column user_id set default auth.uid();
alter table public.mood_entries      alter column user_id set default auth.uid();
alter table public.gratitude_entries alter column user_id set default auth.uid();
alter table public.saved_resources   alter column user_id set default auth.uid();
alter table public.memories          alter column user_id set default auth.uid();


-- Mood check-ins are one per person per day (mood.html upserts on this).
do $$
begin
    create unique index if not exists mood_entries_user_date
        on public.mood_entries (user_id, entry_date);
exception when unique_violation then
    raise notice 'mood_entries has duplicate days per user; unique index skipped.';
end $$;


-- ---------------------------------------------------------
-- 3. ROW LEVEL SECURITY: OWN ROWS ONLY
-- Removes every existing policy on these tables first, so an
-- old "allow all" policy can't quietly leak entries.
-- ---------------------------------------------------------

do $$
declare
    pol record;
begin
    for pol in
        select policyname, tablename
        from pg_policies
        where schemaname = 'public'
          and tablename in (
              'journal_entries', 'mood_entries', 'gratitude_entries',
              'saved_resources', 'memories', 'profiles'
          )
    loop
        execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    end loop;
end $$;

alter table public.journal_entries   enable row level security;
alter table public.mood_entries      enable row level security;
alter table public.gratitude_entries enable row level security;
alter table public.saved_resources   enable row level security;
alter table public.memories          enable row level security;
alter table public.profiles          enable row level security;

create policy "journal_entries own rows" on public.journal_entries
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "mood_entries own rows" on public.mood_entries
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "gratitude_entries own rows" on public.gratitude_entries
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "saved_resources own rows" on public.saved_resources
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "memories own rows" on public.memories
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "profiles own row" on public.profiles
    for all to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);


-- ---------------------------------------------------------
-- 4. PROFILE ROW ON SIGN-UP
-- index.html sends the chosen name as display_name metadata.
-- ---------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    begin
        insert into public.profiles (id, display_name)
        values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
        on conflict (id) do nothing;
    exception when others then
        -- Never block a sign-up over the profile row;
        -- profile.html creates it on first save anyway.
        null;
    end;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Anyone who signed up before this trigger existed.
do $$
begin
    insert into public.profiles (id, display_name)
    select u.id, nullif(u.raw_user_meta_data ->> 'display_name', '')
    from auth.users u
    on conflict (id) do nothing;
exception when others then
    raise notice 'profile backfill skipped: %', sqlerrm;
end $$;


-- ---------------------------------------------------------
-- CHECK: every row below should say rowsecurity = true
-- ---------------------------------------------------------

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
      'journal_entries', 'mood_entries', 'gratitude_entries',
      'saved_resources', 'memories', 'profiles'
  )
order by tablename;
