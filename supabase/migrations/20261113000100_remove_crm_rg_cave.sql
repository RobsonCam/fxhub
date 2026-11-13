-- RG CAVE deixou de ser cliente da FX (12/11/2026). Aplicada direto no banco, a pedido do Robson.
-- Também foram apagados (dados, não estrutura): o cliente RG CAVE GYM no FX Gestão antigo e seus registros,
-- os 7 logins da RG CAVE e a logo "Cave Gym" das marcas do site. Os 2 recebimentos no financeiro foram mantidos.
drop trigger if exists crm_docs_touch on public.crm_docs;
drop table if exists public.crm_docs;
drop table if exists public.crm_locks;
drop table if exists public.crm_owners;
drop function if exists public.crm_acquire_lock(text, integer);
drop function if exists public.crm_docs_touch();
drop function if exists public.crm_email();
drop function if exists public.crm_is_staff();
drop function if exists public.crm_whoami();
