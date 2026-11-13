-- Correção: o documento 'services' (aba Serviços) era recusado pela regra de nomes de app_docs.
alter table public.app_docs drop constraint app_docs_key_check;
alter table public.app_docs add constraint app_docs_key_check check (key = any (array['config','packages','links','team','clients','contents','meetings','metrics','reports','ledger','tasks','evaluations','brands','planRequests','evalRequests','services','flags']));
