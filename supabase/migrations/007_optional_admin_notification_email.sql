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
