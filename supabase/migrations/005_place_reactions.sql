create table if not exists public.place_reactions (
  place_id uuid not null references public.places(id) on delete cascade,
  voter_hash text not null,
  reaction text not null check (reaction in ('like', 'love', 'fire', 'want_to_go')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (place_id, voter_hash)
);

create index if not exists place_reactions_counts_idx
on public.place_reactions(place_id, reaction);

alter table public.place_reactions enable row level security;
revoke all on table public.place_reactions from public, anon, authenticated;

create or replace function public.get_place_reactions(target_place_id uuid, voter_token text)
returns table (reaction_value text, reaction_count bigint, selected boolean)
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
  with available(value) as (
    values ('like'::text), ('love'::text), ('fire'::text), ('want_to_go'::text)
  ), counts as (
    select pr.reaction, count(*) as total
    from public.place_reactions pr
    where pr.place_id = target_place_id
    group by pr.reaction
  )
  select available.value,
         coalesce(counts.total, 0),
         exists (
           select 1
           from public.place_reactions own
           where own.place_id = target_place_id
             and own.voter_hash = token_hash
             and own.reaction = available.value
         )
  from available
  left join counts on counts.reaction = available.value;
end;
$$;

create or replace function public.set_place_reaction(target_place_id uuid, new_reaction text, voter_token text)
returns table (reaction_value text, reaction_count bigint, selected boolean)
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

  if new_reaction is not null and new_reaction not in ('like', 'love', 'fire', 'want_to_go') then
    raise exception 'invalid reaction';
  end if;

  if not exists (select 1 from public.places where id = target_place_id and status = 'approved') then
    raise exception 'place is not available';
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

  return query
  select * from public.get_place_reactions(target_place_id, voter_token);
end;
$$;

revoke all on function public.get_place_reactions(uuid, text) from public;
revoke all on function public.set_place_reaction(uuid, text, text) from public;
grant execute on function public.get_place_reactions(uuid, text) to anon, authenticated;
grant execute on function public.set_place_reaction(uuid, text, text) to anon, authenticated;
