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
