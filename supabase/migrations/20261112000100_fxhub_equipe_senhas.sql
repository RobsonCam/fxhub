-- =============================================================================
-- FX HUB · equipe, permissões por módulo e senhas
--   * team_members ganha cargo, telefone e a lista de módulos liberados
--   * team_can(módulo): administrador pode tudo; equipe só o que foi liberado
--   * financeiro bloqueado no banco para quem não tem o módulo (ler e gravar)
--   * leads: alterar e excluir exigem o módulo de leads
--   * team_list(): lista da equipe com e-mail e último acesso (só para a equipe)
--   * update_my_profile(): cada pessoa da equipe altera o próprio nome e telefone
--   * client_users.pw_set_at + client_password_changed(): o cliente avisa que
--     trocou a senha provisória (a FX deixa de mostrar a senha antiga)
-- Mexe só em objetos do FX HUB. Não toca nas tabelas fx_* nem crm_*.
-- =============================================================================

alter table public.team_members add column if not exists title text check (title is null or length(title) <= 60);
alter table public.team_members add column if not exists phone text check (phone is null or length(phone) <= 30);
alter table public.team_members add column if not exists perms text[] not null default '{}';
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members add constraint team_members_role_check check (role in ('admin', 'equipe', 'criadora', 'captacao'));

alter table public.client_users add column if not exists pw_set_at timestamptz;

create or replace function public.team_can(p_mod text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid() and (role = 'admin' or p_mod = any (perms)));
$$;

-- documento -> módulo que pode gravar
create or replace function public.doc_module(p_key text)
returns text language sql immutable as $$
  select case
    when p_key = 'ledger' then 'financeiro'
    when p_key = 'team' then 'equipe'
    when p_key in ('config', 'packages', 'links', 'brands') then 'site'
    when p_key in ('clients', 'planRequests') then 'clientes'
    when p_key = 'contents' then 'conteudos'
    when p_key in ('meetings', 'tasks') then 'agenda'
    when p_key in ('metrics', 'reports', 'evaluations', 'evalRequests') then 'relatorios'
    else 'equipe' end;
$$;

-- leitura dos documentos: financeiro só para quem tem o módulo
drop policy if exists docs_team_read on public.app_docs;
create policy docs_team_read on public.app_docs for select to authenticated
  using (public.is_team() and (key <> 'ledger' or public.team_can('financeiro')));

-- gravação com controle de versão, agora conferindo o módulo
create or replace function public.save_doc(p_key text, p_data jsonb, p_base integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.app_docs;
begin
  if not public.is_team() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_key <> 'flags' and not public.team_can(public.doc_module(p_key)) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_data is null then raise exception 'invalid_data'; end if;
  if octet_length(p_data::text) > 20 * 1024 * 1024 then raise exception 'doc_too_large'; end if;
  select * into cur from public.app_docs where key = p_key for update;
  if not found then
    insert into public.app_docs (key, data, version, updated_by) values (p_key, p_data, 1, auth.uid());
    return jsonb_build_object('ok', true, 'version', 1);
  end if;
  if cur.version <> coalesce(p_base, -1) then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', cur.version, 'data', cur.data);
  end if;
  update public.app_docs set data = p_data, version = cur.version + 1, updated_at = now(), updated_by = auth.uid() where key = p_key;
  return jsonb_build_object('ok', true, 'version', cur.version + 1);
end;
$$;

drop policy if exists leads_team_update on public.leads;
create policy leads_team_update on public.leads for update to authenticated using (public.team_can('leads')) with check (public.team_can('leads'));
drop policy if exists leads_admin_delete on public.leads;
create policy leads_admin_delete on public.leads for delete to authenticated using (public.team_can('leads'));

-- lista da equipe (com e-mail e último acesso)
create or replace function public.team_list()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select case when public.is_team() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', t.user_id, 'name', t.name, 'role', t.role, 'title', t.title, 'phone', t.phone, 'perms', to_jsonb(t.perms),
      'email', u.email, 'last_seen', u.last_sign_in_at, 'created_at', t.created_at) order by (t.role = 'admin') desc, t.name)
    from public.team_members t join auth.users u on u.id = t.user_id), '[]'::jsonb) else null end;
$$;

-- cada pessoa da equipe altera o próprio nome e telefone
create or replace function public.update_my_profile(p_name text, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'invalid_name'; end if;
  update public.team_members set name = trim(p_name), phone = nullif(left(trim(coalesce(p_phone, '')), 30), '') where user_id = auth.uid();
end;
$$;

-- o cliente trocou a senha provisória
create or replace function public.client_password_changed()
returns void language sql security definer set search_path = public as $$
  update public.client_users set pw_set_at = now() where user_id = auth.uid();
$$;

revoke execute on function public.team_can(text), public.doc_module(text), public.team_list(), public.update_my_profile(text, text), public.client_password_changed() from public, anon;
grant execute on function public.team_can(text), public.team_list(), public.update_my_profile(text, text), public.client_password_changed() to authenticated;
