-- FX HUB · catálogo de serviços: o documento 'services' é gravado por quem tem o módulo "site"
-- (mesmo módulo dos pacotes). Só muda o mapeamento documento -> módulo.
create or replace function public.doc_module(p_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_key = 'ledger' then 'financeiro'
    when p_key = 'team' then 'equipe'
    when p_key in ('config', 'packages', 'services', 'links', 'brands') then 'site'
    when p_key in ('clients', 'planRequests') then 'clientes'
    when p_key = 'contents' then 'conteudos'
    when p_key in ('meetings', 'tasks') then 'agenda'
    when p_key in ('metrics', 'reports', 'evaluations', 'evalRequests') then 'relatorios'
    else 'equipe' end;
$$;
revoke execute on function public.doc_module(text) from public, anon;
