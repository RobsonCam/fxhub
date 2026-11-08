# FX HUB

Plataforma da **FX Mídia Social**: site com formulários de diagnóstico, links de captação rastreados, CRM de leads, clientes, conteúdos, calendário, métricas, financeiro, avaliações e área do cliente (mídia social e sistemas).

| Endereço | O que abre |
|---|---|
| `/` | Site público |
| `/c/bio` ou `/?l=bio` | Site com o link de captação "bio" (o sistema registra de onde a pessoa veio) |
| `/painel` | Sistema da equipe FX (login com e-mail e senha) |
| `/cliente` | Área do cliente (e-mail + código de acesso) |
| `/avaliar` | Área do cliente já na avaliação do mês |

Peças: **Supabase** (banco, login, arquivos), **Netlify** (hospedagem), **GitHub** (código e histórico).

---

## Estrutura

```
public/                 o que vai para o ar (Netlify publica esta pasta)
  index.html            página única
  app.js / app.css      o sistema (gerado pelo build.py)
  cloud.js              ligação com o Supabase (login, gravação, backups)
  app-config.js         URL e chave pública do Supabase  ← você preenche
src/
  fx-hub.html           protótipo completo (fonte do app.js / app.css)
  cloud.js, cloud.css   código da nuvem
build.py                gera public/ a partir de src/
supabase/
  migrations/           banco, regras de segurança e funções
  functions/client-access/   cria o login dos clientes (roda no servidor)
netlify.toml            endereços, segurança e cache
docs/arquitetura.md     como os dados ficam guardados e protegidos
```

Sem `app-config.js` preenchido, o sistema abre em **modo demonstração** (dados só no navegador, com exemplos).

---

## Publicar: passo a passo

### 1. Supabase (banco de dados)

1. Em [supabase.com/dashboard](https://supabase.com/dashboard), crie o projeto **fx-hub** na região **South America (São Paulo)**.
   - O plano gratuito permite **2 projetos ativos**. Se já tiver 2, pause um deles ou passe a organização para o plano Pro.
2. **SQL Editor → New query**: cole todo o arquivo `supabase/migrations/20261108000100_fxhub_v1.sql` e clique em **Run**.
3. **Authentication → Sign In / Providers**: desligue **Allow new users to sign up**. Só a FX cria logins.
4. **Authentication → URL Configuration**: em **Site URL**, coloque o endereço do site (ex.: `https://fxmidiasocial.com.br`).
5. **Authentication → Users → Add user → Create new user**: crie o seu login (e-mail e senha, marque *Auto Confirm User*).
6. **SQL Editor**: transforme esse login em administrador (troque o e-mail):
   ```sql
   insert into public.team_members (user_id, name, role)
   select id, 'Robson', 'admin' from auth.users where email = 'SEU-EMAIL@exemplo.com';
   ```
7. **Edge Functions → Deploy a new function → Via Editor**: nome `client-access`, cole `supabase/functions/client-access/index.ts` e publique.
   Depois, em **Edge Functions → Secrets**, crie `ALLOWED_ORIGINS` com o endereço do site (ex.: `https://fxmidiasocial.com.br,https://fx-hub.netlify.app`).
   *(Pela CLI: `supabase link --project-ref <ref>` e `supabase functions deploy client-access`.)*
8. **Project Settings → API Keys**: copie a **Project URL** e a chave **publishable** (ou a *anon*). **Nunca** use a `service_role` no site.

### 2. Configurar o site

Abra `public/app-config.js` e preencha:

```js
window.FX_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseKey: 'sb_publishable_...',
};
```

### 3. GitHub

1. Crie o repositório **fx-hub** (privado) em [github.com/new](https://github.com/new).
2. Envie esta pasta inteira:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/fx-hub.git
   git push -u origin main
   ```
   Ou, sem terminal: no repositório vazio, **uploading an existing file** e arraste o conteúdo da pasta.

### 4. Netlify

1. **Add new site → Import an existing project → GitHub** e escolha o `fx-hub`.
2. *Build command*: deixe vazio. *Publish directory*: `public`.
3. **Deploy**. Cada novo push no GitHub publica sozinho.
4. **Domain management**: adicione `fxmidiasocial.com.br` e siga as instruções de DNS. O HTTPS é automático.

### 5. Primeiro acesso

1. Entre em `/painel` com o login do passo 1.5. Na primeira vez o sistema cria a estrutura vazia (sem os exemplos do protótipo) e publica o site.
2. **Site e bônus**: confira WhatsApp, Instagram, domínio e pacotes, e salve.
3. **Equipe**: crie os logins da Bruna e da Renata em *Supabase → Authentication → Add user* e depois use **Convidar pessoa** no sistema com o mesmo e-mail.
4. **Clientes**: cadastre o cliente com e-mail e, em **Equipe → Acessos dos clientes**, clique em **Ativar login**. O cliente entra em `/cliente` com o e-mail e o código.
5. **Links de captação**: use `https://seu-dominio/c/bio`, `/c/anuncio`, `/c/whatsapp`, `/c/qrcode` nas campanhas.

---

## Atualizar o sistema

1. Altere `src/fx-hub.html` (ou os arquivos de `src/`).
2. Rode `python3 build.py`.
3. Faça commit e push. O Netlify publica em seguida.

Mudanças no banco: crie um novo arquivo em `supabase/migrations/` e rode no SQL Editor (ou `supabase db push`).

## Segurança, em resumo

- Todas as tabelas têm RLS. Visitantes não leem nada além do que o site mostra.
- O formulário do site só grava pela função `submit_lead`, que valida nome, empresa, WhatsApp e autorização (LGPD) e limita envios repetidos.
- Cada cliente só enxerga a própria empresa, e só pode aprovar conteúdos, avaliar e pedir troca de plano.
- Backups ficam num bucket privado; o download usa link temporário de 5 minutos.
- A chave `service_role` fica só na função `client-access`, no servidor.

Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md).
