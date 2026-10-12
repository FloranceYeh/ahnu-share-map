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
