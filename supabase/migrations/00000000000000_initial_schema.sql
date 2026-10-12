-- ============================================================================
-- 001_initial.sql
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.categories (
  id text primary key,
  label text not null,
  color text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.detail_fields (
  key text primary key,
  label text not null,
  default_value text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  recommendation text not null,
  category_id text references public.categories(id),
  latitude double precision not null,
  longitude double precision not null,
  address text,
  hours text,
  price text,
  best_for text,
  rating numeric(2,1),
  cover_url text,
  tags text[] not null default '{}',
  highlights text[] not null default '{}',
  custom_details jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  query_code text unique not null default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint places_coordinates_valid check (latitude between -90 and 90 and longitude between -180 and 180)
);

create index if not exists places_status_idx on public.places(status);
create index if not exists places_query_code_idx on public.places(query_code);

create table if not exists public.submission_rate_limits (
  rate_key text not null,
  day date not null default current_date,
  count integer not null default 0,
  primary key (rate_key, day)
);

alter table public.categories enable row level security;
alter table public.detail_fields enable row level security;
alter table public.places enable row level security;
alter table public.admin_users enable row level security;
alter table public.submission_rate_limits enable row level security;

create policy "public reads active categories" on public.categories for select using (is_active = true);
create policy "public reads active detail fields" on public.detail_fields for select using (is_active = true);
create policy "public reads approved places" on public.places for select using (status = 'approved');
create policy "admin reads own membership" on public.admin_users for select to authenticated using (user_id = auth.uid());
create policy "admin manages categories" on public.categories for all to authenticated using (exists (select 1 from public.admin_users a where a.user_id = auth.uid())) with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
create policy "admin manages detail fields" on public.detail_fields for all to authenticated using (exists (select 1 from public.admin_users a where a.user_id = auth.uid())) with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
create policy "admin manages places" on public.places for all to authenticated using (exists (select 1 from public.admin_users a where a.user_id = auth.uid())) with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-images', 'submission-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-images', 'place-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "anonymous uploads submission images" on storage.objects for insert to anon with check (bucket_id = 'submission-images');
create policy "admin reads submission images" on storage.objects for select to authenticated using (bucket_id = 'submission-images' and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
create policy "admin manages public place images" on storage.objects for all to authenticated using (bucket_id in ('submission-images', 'place-images') and exists (select 1 from public.admin_users a where a.user_id = auth.uid())) with check (bucket_id in ('submission-images', 'place-images') and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create or replace function public.get_submission_status(code text)
returns table (id uuid, status text, rejection_reason text, submitted_at timestamptz, reviewed_at timestamptz)
language sql security definer set search_path = public
as $$
  select p.id, p.status, p.rejection_reason, p.submitted_at, p.reviewed_at
  from public.places p
  where upper(p.query_code) = upper(code)
  limit 1;
$$;
revoke all on function public.get_submission_status(text) from public;
grant execute on function public.get_submission_status(text) to anon, authenticated;

create or replace function public.consume_submission_quota(key text, max_count integer default 5)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare new_count integer;
begin
  insert into public.submission_rate_limits(rate_key, day, count)
  values (key, current_date, 1)
  on conflict (rate_key, day) do update
    set count = public.submission_rate_limits.count + 1
    where public.submission_rate_limits.count < max_count
  returning count into new_count;
  return new_count is not null and new_count <= max_count;
end;
$$;
revoke all on function public.consume_submission_quota(text, integer) from public;
grant execute on function public.consume_submission_quota(text, integer) to service_role;

-- ============================================================================
-- 002_seed_catalog.sql
-- ============================================================================

insert into public.categories(id, label, color, sort_order) values
  ('food', '吃饭', '#ec7356', 10),
  ('coffee', '咖啡', '#d9a64d', 20),
  ('fun', '娱乐', '#63a47d', 30)
on conflict (id) do update set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order;

insert into public.detail_fields(key, label, default_value, sort_order) values
  ('hours', '营业时间', '营业时间以店面为准', 10),
  ('price', '人均消费', '价格以店面为准', 20),
  ('bestFor', '适合', '随时去逛', 30)
on conflict (key) do update set label = excluded.label, default_value = excluded.default_value, sort_order = excluded.sort_order;

-- ============================================================================
-- 003_security_hardening.sql
-- ============================================================================

-- Keep database-level limits in place even when a client bypasses the UI.
do $$
begin
  alter table public.places add constraint places_name_length check (char_length(btrim(name)) between 1 and 120) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.places add constraint places_recommendation_length check (char_length(btrim(recommendation)) between 1 and 2000) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.places add constraint places_optional_text_length check (
    (address is null or char_length(address) <= 240)
    and (hours is null or char_length(hours) <= 120)
    and (price is null or char_length(price) <= 120)
    and (best_for is null or char_length(best_for) <= 120)
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.places add constraint places_custom_details_size check (pg_column_size(custom_details) <= 16384) not valid;
exception when duplicate_object then null;
end $$;

drop policy if exists "anonymous uploads submission images" on storage.objects;
create policy "anonymous uploads submission images"
on storage.objects for insert to anon
with check (
  bucket_id = 'submission-images'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]+$'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

-- ============================================================================
-- 004_place_images.sql
-- ============================================================================

alter table public.places
  add column if not exists image_urls text[] not null default '{}';

update public.places
set image_urls = array[cover_url]
where coalesce(array_length(image_urls, 1), 0) = 0
  and cover_url is not null
  and cover_url <> '';

-- ============================================================================
-- 005_place_reactions.sql
-- ============================================================================

create table if not exists public.reaction_definitions (
  value text primary key,
  emoji text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.reaction_definitions(value, emoji, label, sort_order) values
  ('like', '👍', '赞同', 10),
  ('love', '❤️', '喜欢', 20),
  ('fire', '🔥', '很棒', 30),
  ('want_to_go', '👀', '想去', 40)
on conflict (value) do update
set emoji = excluded.emoji,
    label = excluded.label,
    sort_order = excluded.sort_order;

create table if not exists public.place_reactions (
  place_id uuid not null references public.places(id) on delete cascade,
  voter_hash text not null,
  reaction text not null references public.reaction_definitions(value) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, voter_hash)
);

create table if not exists public.place_reaction_options (
  place_id uuid not null references public.places(id) on delete cascade,
  reaction_value text not null references public.reaction_definitions(value) on delete restrict,
  is_enabled boolean not null default true,
  primary key (place_id, reaction_value)
);

create table if not exists public.place_reaction_adjustments (
  place_id uuid not null references public.places(id) on delete cascade,
  reaction_value text not null references public.reaction_definitions(value) on delete restrict,
  adjustment bigint not null,
  primary key (place_id, reaction_value)
);

create index if not exists place_reactions_counts_idx
on public.place_reactions(place_id, reaction);
create index if not exists place_reaction_options_place_idx
on public.place_reaction_options(place_id);

alter table public.reaction_definitions enable row level security;
alter table public.place_reactions enable row level security;
alter table public.place_reaction_options enable row level security;
alter table public.place_reaction_adjustments enable row level security;
revoke all on table public.place_reactions from public, anon, authenticated;

create policy "public reads active reaction definitions"
on public.reaction_definitions for select using (is_active = true);
create policy "admin manages reaction definitions"
on public.reaction_definitions for all to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
create policy "admin manages place reaction options"
on public.place_reaction_options for all to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

create or replace function public.get_place_reactions(target_place_id uuid, voter_token text)
returns table (
  reaction_value text,
  reaction_emoji text,
  reaction_label text,
  reaction_count bigint,
  selected boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token_hash text;
begin
  if voter_token is null or char_length(voter_token) < 16 or char_length(voter_token) > 200 then
    raise exception 'invalid voter token';
  end if;

  if not exists (select 1 from public.places where id = target_place_id and status = 'approved') then
    raise exception 'place is not available';
  end if;

  token_hash := encode(digest(voter_token, 'sha256'), 'hex');

  return query
  with available as (
    select rd.value, rd.emoji, rd.label, rd.sort_order
    from public.reaction_definitions rd
    left join public.place_reaction_options pro
      on pro.place_id = target_place_id and pro.reaction_value = rd.value
    where rd.is_active and coalesce(pro.is_enabled, true)
  ), counts as (
    select pr.reaction, count(*) as total
    from public.place_reactions pr
    where pr.place_id = target_place_id
    group by pr.reaction
  )
  select available.value,
         available.emoji,
         available.label,
         greatest(coalesce(counts.total, 0) + coalesce(adjustments.adjustment, 0), 0),
         exists (
           select 1
           from public.place_reactions own
           where own.place_id = target_place_id
             and own.voter_hash = token_hash
             and own.reaction = available.value
         )
  from available
  left join counts on counts.reaction = available.value
  left join public.place_reaction_adjustments adjustments
    on adjustments.place_id = target_place_id
    and adjustments.reaction_value = available.value
  order by available.sort_order, available.value;
end;
$$;

create or replace function public.set_place_reaction(target_place_id uuid, new_reaction text, voter_token text)
returns table (
  reaction_value text,
  reaction_emoji text,
  reaction_label text,
  reaction_count bigint,
  selected boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token_hash text;
begin
  if voter_token is null or char_length(voter_token) < 16 or char_length(voter_token) > 200 then
    raise exception 'invalid voter token';
  end if;

  if not exists (select 1 from public.places where id = target_place_id and status = 'approved') then
    raise exception 'place is not available';
  end if;

  if new_reaction is not null and not exists (
    select 1
    from public.reaction_definitions rd
    left join public.place_reaction_options pro
      on pro.place_id = target_place_id and pro.reaction_value = rd.value
    where rd.value = new_reaction and rd.is_active and coalesce(pro.is_enabled, true)
  ) then
    raise exception 'invalid reaction';
  end if;

  token_hash := encode(digest(voter_token, 'sha256'), 'hex');

  if new_reaction is null then
    delete from public.place_reactions
    where place_id = target_place_id and voter_hash = token_hash;
  else
    insert into public.place_reactions(place_id, voter_hash, reaction)
    values (target_place_id, token_hash, new_reaction)
    on conflict (place_id, voter_hash) do update
    set reaction = excluded.reaction, updated_at = now();
  end if;

  return query select * from public.get_place_reactions(target_place_id, voter_token);
end;
$$;

create or replace function public.set_place_reaction_count(
  target_place_id uuid,
  target_reaction text,
  target_count bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count bigint;
begin
  if not exists (
    select 1 from public.admin_users where user_id = auth.uid()
  ) then
    raise exception 'admin access required';
  end if;

  if target_count is null or target_count < 0 then
    raise exception 'invalid reaction count';
  end if;

  if not exists (select 1 from public.places where id = target_place_id and status = 'approved') then
    raise exception 'place is not available';
  end if;

  if not exists (
    select 1
    from public.reaction_definitions rd
    left join public.place_reaction_options pro
      on pro.place_id = target_place_id and pro.reaction_value = rd.value
    where rd.value = target_reaction and rd.is_active and coalesce(pro.is_enabled, true)
  ) then
    raise exception 'invalid reaction';
  end if;

  select count(*) into current_count
  from public.place_reactions
  where place_id = target_place_id and reaction = target_reaction;

  if target_count = current_count then
    delete from public.place_reaction_adjustments
    where place_id = target_place_id and reaction_value = target_reaction;
  else
    insert into public.place_reaction_adjustments(place_id, reaction_value, adjustment)
    values (target_place_id, target_reaction, target_count - current_count)
    on conflict (place_id, reaction_value) do update
    set adjustment = excluded.adjustment;
  end if;

  return target_count;
end;
$$;

create or replace function public.get_place_reaction_summaries(target_place_ids uuid[])
returns table (
  place_id uuid,
  reaction_value text,
  reaction_emoji text,
  reaction_label text,
  reaction_count bigint
)
language sql
security definer
set search_path = public
as $$
  with available_places as (
    select p.id
    from public.places p
    where p.id = any(target_place_ids) and p.status = 'approved'
  ), available_reactions as (
    select ap.id as place_id, rd.value, rd.emoji, rd.label, rd.sort_order
    from available_places ap
    cross join public.reaction_definitions rd
    left join public.place_reaction_options pro
      on pro.place_id = ap.id and pro.reaction_value = rd.value
    where rd.is_active and coalesce(pro.is_enabled, true)
  ), counts as (
    select pr.place_id, pr.reaction, count(*) as total
    from public.place_reactions pr
    where pr.place_id = any(target_place_ids)
    group by pr.place_id, pr.reaction
  )
  select ar.place_id,
         ar.value,
         ar.emoji,
         ar.label,
         greatest(coalesce(counts.total, 0) + coalesce(adjustments.adjustment, 0), 0)
  from available_reactions ar
  left join counts
    on counts.place_id = ar.place_id and counts.reaction = ar.value
  left join public.place_reaction_adjustments adjustments
    on adjustments.place_id = ar.place_id
    and adjustments.reaction_value = ar.value
  order by ar.place_id, ar.sort_order, ar.value;
$$;

revoke all on function public.get_place_reactions(uuid, text) from public;
revoke all on function public.set_place_reaction(uuid, text, text) from public;
revoke all on function public.set_place_reaction_count(uuid, text, bigint) from public;
revoke all on function public.get_place_reaction_summaries(uuid[]) from public;
grant execute on function public.get_place_reactions(uuid, text) to anon, authenticated;
grant execute on function public.set_place_reaction(uuid, text, text) to anon, authenticated;
grant execute on function public.set_place_reaction_count(uuid, text, bigint) to authenticated;
grant execute on function public.get_place_reaction_summaries(uuid[]) to anon, authenticated;

-- ============================================================================
-- 006_recommendation_sorting.sql
-- ============================================================================

create table if not exists public.recommendation_sort_settings (
  id boolean primary key default true check (id),
  distance_weight integer not null default 50 check (distance_weight between 0 and 100),
  response_weight integer not null default 50 check (response_weight between 0 and 100),
  updated_at timestamptz not null default now(),
  constraint recommendation_sort_weights_total check (distance_weight + response_weight = 100)
);

insert into public.recommendation_sort_settings(id, distance_weight, response_weight)
values (true, 50, 50)
on conflict (id) do nothing;

alter table public.recommendation_sort_settings enable row level security;

create policy "public reads recommendation sort settings"
on public.recommendation_sort_settings for select
using (true);

create policy "admin manages recommendation sort settings"
on public.recommendation_sort_settings for all to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

grant select on table public.recommendation_sort_settings to anon, authenticated;
grant insert, update, delete on table public.recommendation_sort_settings to authenticated;

-- ============================================================================
-- 007_optional_admin_notification_email.sql
-- ============================================================================

alter table public.admin_users
alter column email drop not null;

update public.admin_users
set email = null
where email is not null and btrim(email) = '';

do $$
begin
  alter table public.admin_users
  add constraint admin_users_email_not_blank
  check (email is null or char_length(btrim(email)) > 0);
exception when duplicate_object then null;
end $$;

comment on column public.admin_users.email is
'Optional notification email. Admin authentication and authorization use user_id.';
