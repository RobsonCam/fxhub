# FX HUB · arquitetura da versão 1

## Três áreas, um app

O mesmo `index.html` atende três públicos. O `cloud.js` descobre quem está acessando pelo endereço e carrega só o necessário:

| Área | Quem | Login | O que carrega |
|---|---|---|---|
| Site (`/`, `/c/...`) | visitantes | nenhum | `public_site` (pacotes, presentes, formulários, logos, depoimentos autorizados) |
| Sistema (`/painel`) | equipe FX | e-mail + senha | todos os documentos, leads e eventos |
| Área do cliente (`/cliente`) | clientes | e-mail + código | só os dados da empresa dele, via `portal_state()` |

## Onde os dados ficam

| Tabela | Conteúdo | Leitura | Gravação |
|---|---|---|---|
| `app_docs` | uma linha por coleção (clientes, conteúdos, financeiro, tarefas, métricas, relatórios, avaliações...) em JSON | equipe | equipe, via `save_doc()` com controle de versão |
| `public_site` | o que o site mostra | todos | equipe, via `publish_site()` (automático ao salvar) |
| `leads` | respostas dos formulários | equipe | visitante via `submit_lead()` / `lead_choose()`; equipe edita |
| `events` | visitas, cliques e etapas do funil | equipe | visitante via `track_event()` |
| `team_members` | equipe FX e função | equipe | admin |
| `client_users` | login do cliente → empresa | equipe e o próprio cliente | admin (função `client-access`) |
| Storage `backups` | backups mensais (`<cliente>/<mês>-<arquivo>`) | equipe e o próprio cliente | equipe |

### Por que documentos JSON

O sistema já funciona sobre um estado único em memória. Guardar cada coleção como documento manteve o código testado do protótipo e deixou o banco simples. Para duas pessoas mexendo ao mesmo tempo:

1. cada documento tem `version`;
2. `save_doc(key, data, versão_base)` só grava se ninguém gravou antes;
3. se alguém gravou, o app faz uma mescla de três vias item a item (pelo `id`): o que só o outro mudou entra, o que só você mudou fica, e em conflito real vale a sua versão;
4. a cada 45 segundos o sistema busca leads, visitas e aprovações novas.

Quando o volume crescer (milhares de conteúdos ou lançamentos), a evolução natural é passar as coleções maiores para tabelas próprias.

## Segurança

- RLS ligado em todas as tabelas; o papel `anon` só lê `public_site`.
- Funções `security definer` com `search_path` fixo e validação de entrada (tamanho, formato de telefone, consentimento LGPD, tipos de evento).
- Limites contra abuso: 5 leads por telefone em 24h; 400 eventos por sessão por dia.
- O cliente só pode: aprovar ou pedir ajuste de conteúdo que está aguardando aprovação **dele**; avaliar uma vez por mês; pedir troca de plano.
- O token do lead (para registrar o pacote escolhido) expira em 2 horas.
- A política de segurança do navegador (CSP) só permite scripts do próprio site e do jsDelivr (biblioteca do Supabase, versão fixa).

## Limites conhecidos da v1

- **Funções da equipe**: Robson (admin), Bruna e Renata têm o mesmo acesso de leitura e gravação no banco. Esconder telas por função (ex.: financeiro) é o próximo passo.
- **Imagens** (logos e capas) ficam dentro dos documentos, compactadas no navegador. Para muitas capas, o ideal é movê-las para o Storage.
- **Números de monitoramento e resultados** dos sistemas dos clientes são lançados à mão pela FX. Puxar automático das APIs do Supabase, Netlify e GitHub é uma etapa futura.
- **WhatsApp**: os botões abrem conversas com mensagem pronta (`wa.me`); não há envio automático.
- **Dados do protótipo**: o que foi testado no artefato fica no navegador onde foi usado e não é levado para o Supabase. O sistema publicado começa limpo.
