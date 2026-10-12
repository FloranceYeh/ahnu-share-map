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
