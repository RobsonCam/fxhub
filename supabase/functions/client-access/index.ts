// FX HUB · client-access (acessos com e-mail e senha)
// Só um administrador da FX pode chamar. A chave service_role fica só aqui, no servidor.
//
// Cliente   { kind?: 'client', client_id, email, password }       cria o login ou define nova senha provisória
//           { kind: 'client', action: 'remove', client_id }        desliga o acesso da empresa
// Equipe    { kind: 'team', email, name, role, title?, perms?, password? }   cria ou atualiza a pessoa
//           { kind: 'team', action: 'remove', user_id }            tira a pessoa da equipe (o login não é apagado)
// Compatível com a versão anterior, que mandava { client_id, email, code }.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Endereços que podem chamar esta função. O segredo ALLOWED_ORIGINS, se existir, substitui esta lista.
const DEFAULT_ORIGINS = 'https://fxmidiasocial.netlify.app,https://fxhub-midiasocial.netlify.app';
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
const MODULES = ['leads', 'site', 'clientes', 'conteudos', 'agenda', 'relatorios', 'financeiro'];

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED.length === 0 || ALLOWED.includes(origin) ? origin || '*' : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

const passErr = (p: string) =>
  p.length < 8 || p.length > 72 ? 'A senha precisa ter de 8 a 72 caracteres.' : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Use letras e números na senha.' : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Método não permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // 1. quem está pedindo precisa ser administrador da FX
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) return json(req, { error: 'Só administradores da FX podem alterar acessos.' }, 403);
  const { data: me } = await asCaller.auth.getUser();
  const callerId = me?.user?.id ?? null;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: 'Dados inválidos.' }, 400); }
  const kind = body.kind === 'team' ? 'team' : 'client';
  const action = body.action === 'remove' ? 'remove' : 'save';
  const email = String(body.email ?? '').trim().toLowerCase();
  // senha nova diferencia maiúsculas; o "código" antigo era sempre em maiúsculas
  const password = body.password != null ? String(body.password) : body.code != null ? String(body.code).trim().toUpperCase() : '';
  const legacy = body.password == null && body.code != null;

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const findUser = async (mail: string) => {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error('Não foi possível consultar os logins.');
      const u = data.users.find((x) => (x.email ?? '').toLowerCase() === mail);
      if (u) return u.id;
      if (data.users.length < 1000) break;
    }
    return null;
  };

  try {
    // ============================ CLIENTES ============================
    if (kind === 'client') {
      const clientId = String(body.client_id ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) return json(req, { error: 'Cliente inválido.' }, 400);
      if (action === 'remove') {
        await admin.from('client_users').delete().eq('client_id', clientId);
        return json(req, { ok: true });
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(req, { error: 'E-mail do cliente inválido.' }, 400);
      if (legacy ? password.length < 6 || password.length > 40 : !!passErr(password)) return json(req, { error: legacy ? 'O código precisa ter pelo menos 6 caracteres.' : passErr(password) }, 400);

      let userId = await findUser(email);
      if (userId) {
        const { data: tm } = await admin.from('team_members').select('user_id').eq('user_id', userId).maybeSingle();
        if (tm) return json(req, { error: 'Este e-mail é de alguém da equipe FX. Use outro e-mail para o cliente.' }, 409);
        const { data: cu } = await admin.from('client_users').select('user_id').eq('user_id', userId).maybeSingle();
        if (!cu) return json(req, { error: 'Este e-mail já tem login em outro sistema da FX. Use outro e-mail para o cliente.' }, 409);
        const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
        if (error) return json(req, { error: 'Não foi possível atualizar o login.' }, 500);
      } else {
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: 'cliente' } });
        if (error || !data.user) return json(req, { error: 'Não foi possível criar o login.' }, 500);
        userId = data.user.id;
      }
      const { error: linkErr } = await admin.from('client_users').upsert({ user_id: userId, client_id: clientId, pw_set_at: null }, { onConflict: 'user_id' });
      if (linkErr) return json(req, { error: 'Login criado, mas não foi possível ligar à empresa.' }, 500);
      return json(req, { ok: true });
    }

    // ============================ EQUIPE ============================
    if (action === 'remove') {
      const uid = String(body.user_id ?? '');
      if (!/^[0-9a-f-]{36}$/.test(uid)) return json(req, { error: 'Pessoa inválida.' }, 400);
      if (uid === callerId) return json(req, { error: 'Você não pode tirar o seu próprio acesso.' }, 400);
      const { data: t } = await admin.from('team_members').select('role').eq('user_id', uid).maybeSingle();
      if (t?.role === 'admin') {
        const { count } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
        if ((count ?? 0) <= 1) return json(req, { error: 'A FX precisa de pelo menos um administrador.' }, 400);
      }
      await admin.from('team_members').delete().eq('user_id', uid);
      return json(req, { ok: true });
    }

    const name = String(body.name ?? '').trim();
    const role = body.role === 'admin' ? 'admin' : 'equipe';
    const title = String(body.title ?? '').trim().slice(0, 60) || null;
    const perms = Array.isArray(body.perms) ? [...new Set(body.perms.map(String).filter((m) => MODULES.includes(m)))] : [];
    if (name.length < 2 || name.length > 80) return json(req, { error: 'Preencha o nome (2 a 80 letras).' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(req, { error: 'E-mail inválido.' }, 400);
    if (password && passErr(password)) return json(req, { error: passErr(password) }, 400);

    let userId = await findUser(email);
    let created = false, passwordSet = false;
    if (userId) {
      const { data: cu } = await admin.from('client_users').select('user_id').eq('user_id', userId).maybeSingle();
      if (cu) return json(req, { error: 'Este e-mail é o login de um cliente. Use outro e-mail para a equipe.' }, 409);
      const { data: tm } = await admin.from('team_members').select('role').eq('user_id', userId).maybeSingle();
      if (tm?.role === 'admin' && role !== 'admin' && userId === callerId) return json(req, { error: 'Você não pode tirar o seu próprio nível de administrador.' }, 400);
      if (tm?.role === 'admin' && role !== 'admin') {
        const { count } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
        if ((count ?? 0) <= 1) return json(req, { error: 'A FX precisa de pelo menos um administrador.' }, 400);
      }
      // a senha só é trocada para quem já é da equipe; login de outro sistema continua com a senha que já usa
      if (password && tm) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) return json(req, { error: 'Não foi possível trocar a senha.' }, 500);
        passwordSet = true;
      }
    } else {
      if (!password) return json(req, { error: 'Defina uma senha provisória para o primeiro acesso.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: 'equipe' } });
      if (error || !data.user) return json(req, { error: 'Não foi possível criar o login.' }, 500);
      userId = data.user.id; created = true; passwordSet = true;
    }
    const { error: upErr } = await admin.from('team_members').upsert({ user_id: userId, name, role, title, perms: role === 'admin' ? [] : perms }, { onConflict: 'user_id' });
    if (upErr) return json(req, { error: 'Não foi possível salvar a pessoa na equipe.' }, 500);
    return json(req, { ok: true, user_id: userId, created, password_set: passwordSet });
  } catch (e) {
    return json(req, { error: (e as Error).message || 'Erro inesperado.' }, 500);
  }
});
