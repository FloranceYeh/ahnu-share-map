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

alter table public.place_reactions
  drop constraint if exists place_reactions_reaction_check;

alter table public.place_reactions
  add constraint place_reactions_reaction_definition_fkey
  foreign key (reaction) references public.reaction_definitions(value)
  on delete restrict;

create table if not exists public.place_reaction_options (
  place_id uuid not null references public.places(id) on delete cascade,
  reaction_value text not null references public.reaction_definitions(value) on delete restrict,
  is_enabled boolean not null default true,
  primary key (place_id, reaction_value)
);

create index if not exists place_reaction_options_place_idx
on public.place_reaction_options(place_id);

alter table public.reaction_definitions enable row level security;
alter table public.place_reaction_options enable row level security;

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

drop function if exists public.set_place_reaction(uuid, text, text);
drop function if exists public.get_place_reactions(uuid, text);

create function public.get_place_reactions(target_place_id uuid, voter_token text)
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
         coalesce(counts.total, 0),
         exists (
           select 1
           from public.place_reactions own
           where own.place_id = target_place_id
             and own.voter_hash = token_hash
             and own.reaction = available.value
         )
  from available
  left join counts on counts.reaction = available.value
  order by available.sort_order, available.value;
end;
$$;

create function public.set_place_reaction(target_place_id uuid, new_reaction text, voter_token text)
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
         coalesce(counts.total, 0)
  from available_reactions ar
  left join counts
    on counts.place_id = ar.place_id and counts.reaction = ar.value
  order by ar.place_id, ar.sort_order, ar.value;
$$;

revoke all on function public.get_place_reactions(uuid, text) from public;
revoke all on function public.set_place_reaction(uuid, text, text) from public;
revoke all on function public.get_place_reaction_summaries(uuid[]) from public;
grant execute on function public.get_place_reactions(uuid, text) to anon, authenticated;
grant execute on function public.set_place_reaction(uuid, text, text) to anon, authenticated;
grant execute on function public.get_place_reaction_summaries(uuid[]) to anon, authenticated;
