// FX HUB · client-access
// Cria ou atualiza o login de um cliente na área do cliente.
// Só um administrador da FX pode chamar. A chave service_role fica só aqui, no servidor.
//
// Corpo: { client_id: string, email: string, code: string }
// O código de acesso do cliente vira a senha do login dele.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Endereços que podem chamar esta função. O segredo ALLOWED_ORIGINS, se existir, substitui esta lista.
const DEFAULT_ORIGINS = 'https://fxhub-midiasocial.netlify.app';
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);

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
  if (adminErr || isAdmin !== true) return json(req, { error: 'Só administradores da FX podem ativar logins de clientes.' }, 403);

  // 2. validação dos dados
  let body: { client_id?: string; email?: string; code?: string };
  try { body = await req.json(); } catch { return json(req, { error: 'Dados inválidos.' }, 400); }
  const clientId = String(body.client_id ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) return json(req, { error: 'Cliente inválido.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(req, { error: 'E-mail do cliente inválido.' }, 400);
  if (code.length < 6 || code.length > 40) return json(req, { error: 'O código precisa ter pelo menos 6 caracteres.' }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // 3. acha o usuário pelo e-mail (ou cria)
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json(req, { error: 'Não foi possível consultar os logins.' }, 500);
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u) userId = u.id;
    if (data.users.length < 1000) break;
  }

  if (userId) {
    // nunca mexe na senha de alguém da equipe por aqui
    const { data: tm } = await admin.from('team_members').select('user_id').eq('user_id', userId).maybeSingle();
    if (tm) return json(req, { error: 'Este e-mail é de alguém da equipe FX. Use outro e-mail para o cliente.' }, 409);
    // nem de quem já usa outro sistema deste projeto e não é cliente do FX HUB
    const { data: cu } = await admin.from('client_users').select('user_id').eq('user_id', userId).maybeSingle();
    if (!cu) return json(req, { error: 'Este e-mail já tem login em outro sistema da FX. Use outro e-mail para o cliente.' }, 409);
    const { error } = await admin.auth.admin.updateUserById(userId, { password: code, email_confirm: true });
    if (error) return json(req, { error: 'Não foi possível atualizar o login.' }, 500);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password: code, email_confirm: true, user_metadata: { kind: 'cliente' } });
    if (error || !data.user) return json(req, { error: 'Não foi possível criar o login.' }, 500);
    userId = data.user.id;
  }

  // 4. liga o login à empresa
  const { error: linkErr } = await admin.from('client_users').upsert({ user_id: userId, client_id: clientId }, { onConflict: 'user_id' });
  if (linkErr) return json(req, { error: 'Login criado, mas não foi possível ligar à empresa.' }, 500);

  return json(req, { ok: true });
});
