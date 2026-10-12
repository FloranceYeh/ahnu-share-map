alter table public.places
  add column if not exists image_urls text[] not null default '{}';

update public.places
set image_urls = array[cover_url]
where coalesce(array_length(image_urls, 1), 0) = 0
  and cover_url is not null
  and cover_url <> '';
