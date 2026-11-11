-- =============================================================================
-- FX HUB · v1 · banco de dados, segurança (RLS) e funções
-- =============================================================================
-- Como o sistema guarda os dados
--   * app_docs     : dados internos da FX (clientes, conteúdos, financeiro...),
--                    um documento JSON por coleção. Só a equipe FX lê e grava.
--   * public_site  : o que o site público mostra (pacotes, presentes, logos,
--                    depoimentos autorizados). Qualquer visitante lê; só a equipe grava.
--   * leads        : respostas dos formulários do site. O visitante só cria
--                    pela função submit_lead; só a equipe lê.
--   * events       : visitas e cliques dos links de captação (rastreamento).
--   * team_members : quem é da equipe FX e com qual função.
--   * client_users : qual login de cliente enxerga qual empresa.
--   * Storage "backups": backups mensais, privado (equipe + o próprio cliente).
-- Nenhuma tabela é aberta sem RLS. Visitantes só usam funções com validação.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.team_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 80),
  role       text not null check (role in ('admin', 'criadora', 'captacao')),
  created_at timestamptz not null default now()
);

create table if not exists public.client_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  client_id  text not null check (length(client_id) between 1 and 64),
  created_at timestamptz not null default now()
);
create index if not exists client_users_client_idx on public.client_users (client_id);

create table if not exists public.app_docs (
  key        text primary key check (key in (
               'config', 'packages', 'links', 'team', 'clients', 'contents', 'meetings',
               'metrics', 'reports', 'ledger', 'tasks', 'evaluations', 'brands',
               'planRequests', 'evalRequests', 'flags')),
  data       jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.public_site (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id         text primary key check (length(id) between 6 and 64),
  token      uuid not null default gen_random_uuid(),
  session    text,
  link       text,
  track      text not null check (track in ('social', 'sistema')),
  phone      text not null check (phone ~ '^\d{12,13}$'),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone, created_at desc);

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  ev_id      text,
  at         timestamptz not null default now(),
  session    text,
  link       text,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb
);
create index if not exists events_at_idx on public.events (at desc);
create index if not exists events_session_idx on public.events (session, at desc);

-- -----------------------------------------------------------------------------
-- Funções de apoio (quem é quem)
-- -----------------------------------------------------------------------------
create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_client()
returns text language sql stable security definer set search_path = public as $$
  select client_id from public.client_users where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.team_members enable row level security;
alter table public.client_users enable row level security;
alter table public.app_docs     enable row level security;
alter table public.public_site  enable row level security;
alter table public.leads        enable row level security;
alter table public.events       enable row level security;

drop policy if exists team_read_team on public.team_members;
create policy team_read_team on public.team_members for select to authenticated using (public.is_team());
drop policy if exists admin_write_team on public.team_members;
create policy admin_write_team on public.team_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_users_read on public.client_users;
create policy client_users_read on public.client_users for select to authenticated using (public.is_team() or user_id = auth.uid());
drop policy if exists client_users_admin on public.client_users;
create policy client_users_admin on public.client_users for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists docs_team_read on public.app_docs;
create policy docs_team_read on public.app_docs for select to authenticated using (public.is_team());
-- gravação de app_docs só pela função save_doc (controle de versão)

drop policy if exists site_public_read on public.public_site;
create policy site_public_read on public.public_site for select to anon, authenticated using (true);
-- gravação só pela função publish_site

drop policy if exists leads_team_read on public.leads;
create policy leads_team_read on public.leads for select to authenticated using (public.is_team());
drop policy if exists leads_team_update on public.leads;
create policy leads_team_update on public.leads for update to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists leads_admin_delete on public.leads;
create policy leads_admin_delete on public.leads for delete to authenticated using (public.is_admin());

drop policy if exists events_team_read on public.events;
create policy events_team_read on public.events for select to authenticated using (public.is_team());
drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events for delete to authenticated using (public.is_admin());

revoke all on public.app_docs, public.public_site, public.leads, public.events, public.team_members, public.client_users from anon;
grant select on public.public_site to anon;
grant select on public.public_site, public.app_docs, public.leads, public.events, public.team_members, public.client_users to authenticated;
grant update on public.leads to authenticated;
grant delete on public.leads, public.events to authenticated;
grant insert, update, delete on public.team_members, public.client_users to authenticated;

-- -----------------------------------------------------------------------------
-- Quem sou eu (o app usa no login)
-- -----------------------------------------------------------------------------
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'team', (select to_jsonb(t) - 'user_id' from public.team_members t where t.user_id = auth.uid()),
    'client_id', (select client_id from public.client_users where user_id = auth.uid()));
$$;

-- -----------------------------------------------------------------------------
-- Equipe: salvar um documento com controle de versão
--   devolve {ok:true, version} ou {ok:false, conflict:true, version, data}
-- -----------------------------------------------------------------------------
create or replace function public.save_doc(p_key text, p_data jsonb, p_base integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.app_docs;
begin
  if not public.is_team() then raise exception 'not_allowed' using errcode = '42501'; end if;
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

-- Equipe: publicar o que o site mostra
create or replace function public.publish_site(p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if octet_length(p_data::text) > 8 * 1024 * 1024 then raise exception 'site_too_large'; end if;
  insert into public.public_site (id, data, updated_at) values (1, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$$;

-- Equipe: adicionar pessoa já cadastrada no Auth (admin)
create or replace function public.add_team_member(p_email text, p_name text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'user_not_found'; end if;
  insert into public.team_members (user_id, name, role) values (uid, trim(p_name), p_role)
  on conflict (user_id) do update set name = excluded.name, role = excluded.role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Site público: rastreamento e leads
-- -----------------------------------------------------------------------------
create or replace function public.track_event(p_session text, p_link text, p_type text, p_payload jsonb default '{}'::jsonb, p_ev_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type not in ('visit', 'cta', 'start', 'step', 'lead', 'package', 'bonus', 'wa', 'plan_request', 'login', 'backup_download') then return; end if;
  if p_session is null or length(p_session) > 64 or length(coalesce(p_link, '')) > 64 then return; end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 2000 then return; end if;
  -- limite simples contra abuso: 400 eventos por sessão por dia
  if (select count(*) from public.events where session = p_session and at > now() - interval '1 day') >= 400 then return; end if;
  insert into public.events (ev_id, session, link, type, payload) values (left(p_ev_id, 64), p_session, nullif(p_link, ''), p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.submit_lead(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := regexp_replace(coalesce(p_lead->>'phone', ''), '\D', '', 'g');
        v_id text := coalesce(p_lead->>'id', '');
        v_track text := p_lead->>'track';
        v_token uuid;
begin
  if octet_length(p_lead::text) > 20000 then raise exception 'lead_too_large'; end if;
  if length(trim(coalesce(p_lead->>'name', ''))) not between 2 and 80 then raise exception 'invalid_name'; end if;
  if length(trim(coalesce(p_lead->>'company', ''))) not between 2 and 120 then raise exception 'invalid_company'; end if;
  if v_phone !~ '^\d{12,13}$' then raise exception 'invalid_phone'; end if;
  if v_track not in ('social', 'sistema') then raise exception 'invalid_track'; end if;
  if v_id !~ '^[A-Za-z0-9_-]{6,64}$' then raise exception 'invalid_id'; end if;
  if coalesce((p_lead->>'consentAt'), '') = '' then raise exception 'consent_required'; end if;
  -- no máximo 5 envios por telefone em 24h
  if (select count(*) from public.leads where phone = v_phone and created_at > now() - interval '1 day') >= 5 then raise exception 'too_many_requests'; end if;
  insert into public.leads (id, session, link, track, phone, data)
  values (v_id, left(p_lead->>'session', 64), left(p_lead->>'link', 64), v_track, v_phone,
          (p_lead - 'token') || jsonb_build_object('phone', v_phone, 'stage', 'novo', 'package', null, 'bonusCode', null, 'notes', '[]'::jsonb))
  returning token into v_token;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create or replace function public.lead_choose(p_id text, p_token uuid, p_package text, p_bonus text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_package, '')) > 40 or length(coalesce(p_bonus, '')) > 20 then raise exception 'invalid'; end if;
  update public.leads
     set data = data || jsonb_build_object('package', p_package, 'bonusCode', p_bonus), updated_at = now()
   where id = p_id and token = p_token and created_at > now() - interval '2 hours';
end;
$$;

-- -----------------------------------------------------------------------------
-- Área do cliente: leitura só do que é dele
-- -----------------------------------------------------------------------------
create or replace function public.doc_items_for(p_key text, p_client text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
    from public.app_docs d, jsonb_array_elements(case when jsonb_typeof(d.data) = 'array' then d.data else '[]'::jsonb end) x
   where d.key = p_key and x->>'client' = p_client;
$$;

create or replace function public.portal_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid text := public.my_client(); cfg jsonb;
begin
  if cid is null then raise exception 'not_a_client' using errcode = '42501'; end if;
  select data into cfg from public.app_docs where key = 'config';
  return jsonb_build_object(
    'clientId', cid,
    'clients', coalesce((select jsonb_agg(x) from public.app_docs d, jsonb_array_elements(d.data) x where d.key = 'clients' and x->>'id' = cid), '[]'::jsonb),
    'contents', public.doc_items_for('contents', cid),
    'meetings', public.doc_items_for('meetings', cid),
    'metrics', public.doc_items_for('metrics', cid),
    'reports', public.doc_items_for('reports', cid),
    'ledger', public.doc_items_for('ledger', cid),
    'evaluations', public.doc_items_for('evaluations', cid),
    'planRequests', public.doc_items_for('planRequests', cid),
    'packages', coalesce((select data from public.app_docs where key = 'packages'), '[]'::jsonb),
    'config', jsonb_build_object('whatsapp', cfg->'whatsapp', 'domain', cfg->'domain', 'instagram', cfg->'instagram', 'logo', cfg->'logo', 'forms', cfg->'forms'));
end;
$$;

-- Área do cliente: ações permitidas (aprovar, pedir ajuste, avaliar, pedir troca de plano)
create or replace function public.portal_sync(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid text := public.my_client(); d public.app_docs; r jsonb; arr jsonb; i int; m text; done int := 0;
begin
  if cid is null then raise exception 'not_a_client' using errcode = '42501'; end if;
  if octet_length(p::text) > 50000 then raise exception 'payload_too_large'; end if;

  -- aprovações e pedidos de ajuste
  if jsonb_typeof(p->'reviews') = 'array' and jsonb_array_length(p->'reviews') > 0 then
    select * into d from public.app_docs where key = 'contents' for update;
    if found then
      arr := d.data;
      for r in select * from jsonb_array_elements(p->'reviews') loop
        if (r->>'status') not in ('aprovado', 'em_revisao') then continue; end if;
        for i in 0 .. jsonb_array_length(arr) - 1 loop
          if arr->i->>'id' = r->>'id' and arr->i->>'client' = cid and arr->i->>'status' = 'aguardando_aprovacao' then
            arr := jsonb_set(arr, array[i::text], (arr->i) || jsonb_build_object('status', r->>'status', 'feedback', left(coalesce(r->>'feedback', ''), 600), 'reviewedAt', (extract(epoch from now()) * 1000)::bigint));
            done := done + 1;
          end if;
        end loop;
      end loop;
      update public.app_docs set data = arr, version = version + 1, updated_at = now() where key = 'contents';
    end if;
  end if;

  -- avaliação do mês (uma por mês)
  if jsonb_typeof(p->'evaluation') = 'object' then
    r := p->'evaluation'; m := coalesce(r->>'month', to_char(now(), 'YYYY-MM'));
    if m !~ '^\d{4}-\d{2}$' then raise exception 'invalid_month'; end if;
    insert into public.app_docs (key, data) values ('evaluations', '[]'::jsonb) on conflict (key) do nothing;
    select * into d from public.app_docs where key = 'evaluations' for update;
    if not exists (select 1 from jsonb_array_elements(d.data) x where x->>'client' = cid and x->>'month' = m) then
      update public.app_docs set data = d.data || jsonb_build_array(jsonb_build_object(
          'id', 'ev' || substr(md5(random()::text), 1, 10), 'client', cid, 'month', m,
          'r', r->'r', 'text', left(coalesce(r->>'text', ''), 1200), 'company', left(coalesce(r->>'company', ''), 120),
          'consent', coalesce((r->>'consent')::boolean, false), 'onSite', coalesce((r->>'consent')::boolean, false),
          't', (extract(epoch from now()) * 1000)::bigint)),
        version = d.version + 1, updated_at = now() where key = 'evaluations';
      done := done + 1;
    end if;
  end if;

  -- pedido de troca de plano / serviço extra
  if jsonb_typeof(p->'planRequest') = 'object' then
    r := p->'planRequest';
    insert into public.app_docs (key, data) values ('planRequests', '[]'::jsonb) on conflict (key) do nothing;
    update public.app_docs set data = data || jsonb_build_array(jsonb_build_object(
        'id', 'pr' || substr(md5(random()::text), 1, 10), 'client', cid,
        'kind', case when r->>'kind' = 'troca' then 'troca' else 'extra' end,
        'to', left(r->>'to', 40), 'text', left(coalesce(r->>'text', ''), 600),
        't', (extract(epoch from now()) * 1000)::bigint, 'done', false)),
      version = version + 1, updated_at = now() where key = 'planRequests';
    done := done + 1;
  end if;

  return jsonb_build_object('ok', true, 'applied', done);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões de execução
-- -----------------------------------------------------------------------------
-- Só as funções do FX HUB (o projeto pode ter outros sistemas no mesmo banco)
revoke execute on function public.is_team(), public.is_admin(), public.my_client(), public.whoami(),
  public.save_doc(text, jsonb, integer), public.publish_site(jsonb), public.add_team_member(text, text, text),
  public.track_event(text, text, text, jsonb, text), public.submit_lead(jsonb), public.lead_choose(text, uuid, text, text),
  public.doc_items_for(text, text), public.portal_state(), public.portal_sync(jsonb) from public, anon;
grant execute on function public.track_event(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;
grant execute on function public.lead_choose(text, uuid, text, text) to anon, authenticated;
grant execute on function public.whoami() to authenticated;
grant execute on function public.save_doc(text, jsonb, integer) to authenticated;
grant execute on function public.publish_site(jsonb) to authenticated;
grant execute on function public.add_team_member(text, text, text) to authenticated;
grant execute on function public.portal_state() to authenticated;
grant execute on function public.portal_sync(jsonb) to authenticated;
grant execute on function public.is_team(), public.is_admin(), public.my_client() to authenticated;
revoke execute on function public.doc_items_for(text, text) from authenticated;

-- -----------------------------------------------------------------------------
-- Storage: backups mensais (privado)
--   caminho: <id do cliente>/<arquivo>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do nothing;

drop policy if exists backups_team_all on storage.objects;
create policy backups_team_all on storage.objects for all to authenticated
  using (bucket_id = 'backups' and public.is_team())
  with check (bucket_id = 'backups' and public.is_team());

drop policy if exists backups_client_read on storage.objects;
create policy backups_client_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = public.my_client());

-- Site começa vazio até a equipe publicar pela primeira vez
insert into public.public_site (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
