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
