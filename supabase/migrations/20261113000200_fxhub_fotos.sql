-- FX HUB · fotos de perfil (equipe) e foto da empresa enviada pelo próprio cliente
alter table public.team_members add column if not exists avatar text
  check (avatar is null or (avatar ~ '^data:image/(png|jpeg|webp);base64,' and length(avatar) <= 200000));

drop function if exists public.update_my_profile(text, text);
create or replace function public.update_my_profile(p_name text, p_phone text default null, p_avatar text default null, p_avatar_set boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'invalid_name'; end if;
  if p_avatar_set and p_avatar is not null and (p_avatar !~ '^data:image/(png|jpeg|webp);base64,' or length(p_avatar) > 200000) then raise exception 'invalid_image'; end if;
  update public.team_members set name = trim(p_name), phone = nullif(left(trim(coalesce(p_phone, '')), 30), ''),
    avatar = case when p_avatar_set then p_avatar else avatar end where user_id = auth.uid();
end;
$$;

create or replace function public.team_list()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select case when public.is_team() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', t.user_id, 'name', t.name, 'role', t.role, 'title', t.title, 'phone', t.phone, 'perms', to_jsonb(t.perms), 'avatar', t.avatar,
      'email', u.email, 'last_seen', u.last_sign_in_at, 'created_at', t.created_at) order by (t.role = 'admin') desc, t.name)
    from public.team_members t join auth.users u on u.id = t.user_id), '[]'::jsonb) else null end;
$$;

-- o cliente troca a foto (logo) da própria empresa
create or replace function public.client_set_logo(p_logo text)
returns void language plpgsql security definer set search_path = public as $$
declare cid text := public.my_client(); d public.app_docs; i int;
begin
  if cid is null then raise exception 'not_a_client' using errcode = '42501'; end if;
  if p_logo is not null and (p_logo !~ '^data:image/(png|jpeg|webp);base64,' or length(p_logo) > 200000) then raise exception 'invalid_image'; end if;
  select * into d from public.app_docs where key = 'clients' for update;
  if not found then return; end if;
  for i in 0 .. jsonb_array_length(d.data) - 1 loop
    if d.data->i->>'id' = cid then
      update public.app_docs set data = case when p_logo is null then jsonb_set(d.data, array[i::text], (d.data->i) - 'logo') else jsonb_set(d.data, array[i::text, 'logo'], to_jsonb(p_logo)) end,
        version = d.version + 1, updated_at = now() where key = 'clients';
      return;
    end if;
  end loop;
end;
$$;

revoke execute on function public.update_my_profile(text, text, text, boolean), public.client_set_logo(text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, boolean), public.client_set_logo(text), public.team_list() to authenticated;
