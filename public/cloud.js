/* =============================================================================
   FX HUB · modo nuvem (Supabase)
   Sem app-config.js preenchido, o sistema roda em modo demonstração
   (dados só neste navegador). Com ele, este arquivo:
     - carrega os dados certos para quem está acessando (visitante, equipe ou cliente)
     - faz o login da equipe e dos clientes
     - salva as alterações no Supabase (com controle de versão e mescla)
   ============================================================================= */
(() => {
  const CFG = window.FX_CONFIG || {};
  if (!CFG.supabaseUrl || !CFG.supabaseKey) return;
  window.FX_CLOUD_ENABLED = true;
  document.documentElement.classList.add('fx-cloud');

  const DOC_KEYS = ['config', 'packages', 'links', 'team', 'clients', 'contents', 'meetings', 'metrics', 'reports', 'ledger', 'tasks', 'evaluations', 'brands', 'planRequests', 'evalRequests'];
  const PUB_KEYS = ['config', 'packages', 'links', 'brands', 'evaluations', 'clients'];
  const NOT_FLAGS = new Set([...DOC_KEYS, 'leads', 'events']);
  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const J = o => JSON.stringify(o === undefined ? null : o);
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // ---------- onde a pessoa está ----------
  const path = location.pathname.replace(/\/+$/, '');
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(location.search);
  // o endereço principal abre o sistema da equipe; o site fica em /site e nos links /c/...
  // links de captação: /bio, /anuncio... (um nome só depois da barra). /c/bio continua valendo.
  const RESERVED = ['', 'painel', 'cliente', 'avaliar', 'site', 'c', 'icons', 'index', 'app', 'admin', 'login', 'api'];
  const seg = path.split('/').filter(Boolean);
  const pathSlug = seg[0] === 'c' && seg[1] ? seg[1] : (seg.length === 1 && !RESERVED.includes(seg[0].toLowerCase()) && !seg[0].includes('.') ? seg[0] : '');
  const linkSlug = (params.get('l') || params.get('origem') || pathSlug || '').toLowerCase();
  let REALM = 'painel';
  if (path === '/cliente' || path === '/avaliar') REALM = 'portal';
  else if (path === '/site' || linkSlug) REALM = 'site';

  document.documentElement.classList.add('realm-' + REALM);
  // ---------- velocidade: o site não espera a biblioteca do Supabase ----------
  const REST = CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1';
  const HDR = { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + CFG.supabaseKey, 'Content-Type': 'application/json' };
  const rest = async (fn, args) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: HDR, body: JSON.stringify(args || {}), keepalive: fn === 'track_event' }); const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; } if (!r.ok) throw new Error((d && (d.message || d.error)) || r.statusText); return d; };
  const PUB_CACHE = 'fxhub-pub';
  const fetchPub = () => fetch(`${REST}/public_site?select=data&id=eq.1`, { headers: HDR }).then(r => { if (!r.ok) throw new Error('site ' + r.status); return r.json(); }).then(rows => rows?.[0]?.data || {});
  const pubEarly = REALM === 'site' ? fetchPub() : null;
  if (pubEarly) pubEarly.catch(() => null);
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const loadLib = () => new Promise((ok, no) => { if (window.supabase?.createClient) return ok(); const t = document.createElement('script'); t.src = LIB; t.crossOrigin = 'anonymous'; t.onload = () => (window.supabase?.createClient ? ok() : no(new Error('lib'))); t.onerror = () => no(new Error('lib')); document.head.appendChild(t); });
  const libEarly = REALM === 'site' ? null : loadLib();
  if (libEarly) libEarly.catch(() => null);
  let sb = null;
  const offline = () => {
    // uma versão antiga do app instalável podia barrar a biblioteca: remove e recarrega uma vez
    let healed = false; try { healed = sessionStorage.getItem('fx-sw-heal') === '1'; } catch (e) {}
    if (!healed && navigator.serviceWorker && navigator.serviceWorker.controller && navigator.onLine !== false) {
      try { sessionStorage.setItem('fx-sw-heal', '1'); } catch (e) {}
      navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches?.keys?.()).then(ks => ks && Promise.all(ks.map(k => caches.delete(k)))).catch(() => null).then(() => location.reload());
      return;
    }
    const d = document.getElementById('fx-boot') || document.createElement('div'); d.id = 'fx-boot'; d.innerHTML = '<div class="fx-boot-in"><span class="hub-word"><em>FX</em> HUB</span><h1>Sem conexão.</h1><p>Confira a internet e tente de novo.</p><button class="pill orange" id="fx-retry">Tentar de novo</button></div>'; if (!d.isConnected) document.body.appendChild(d); document.getElementById('fx-retry').addEventListener('click', () => location.reload());
  };
  const initSb = async () => { if (sb) return sb; await (libEarly || loadLib());
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: REALM === 'portal' ? 'fxhub-cliente' : 'fxhub-equipe' } });
    C.sb = sb; return sb; };
  const rpc = async (fn, args) => { if (!sb) return rest(fn, args); const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };

  const C = (window.FX_CLOUD = { realm: REALM, sb: null, db: null, link: null, portalClient: null, portalTab: path === '/avaliar' ? 'avaliar' : null });

  // ---------- telas de apoio (carregando / login / erro) ----------
  const boot = document.createElement('div');
  boot.id = 'fx-boot';
  boot.innerHTML = '<div class="fx-boot-in"><span class="hub-word"><em>FX</em> HUB</span><p>Carregando…</p></div>';
  const showBoot = html => { boot.querySelector('.fx-boot-in').innerHTML = html; if (!boot.isConnected) document.body.appendChild(boot); };
  const hideBoot = () => boot.remove();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const loginForm = (title, sub, userLabel, passLabel, err) => `
    <form class="fx-login glass" id="fx-login" novalidate>
      <span class="hub-word"><em>FX</em> HUB</span>
      <h1>${esc(title)}</h1><p>${esc(sub)}</p>
      <label for="fx-u">${esc(userLabel)}</label><input class="in" id="fx-u" type="email" autocomplete="username" required>
      <label for="fx-p">${esc(passLabel)}</label><input class="in" id="fx-p" type="password" autocomplete="current-password" required>
      <span class="err-t" id="fx-e">${esc(err || '')}</span>
      <button class="pill orange lg" type="submit">Entrar</button>
      <a class="fx-back" href="/site">Ver o site</a>
    </form>`;

  const askLogin = (err) => new Promise(resolve => {
    showBoot(loginForm('Sistema da FX', 'Acesso da equipe FX Mídia Social.', 'E-mail', 'Senha', err));
    const f = document.getElementById('fx-login');
    document.getElementById('fx-u').focus();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('fx-u').value.trim(), password = document.getElementById('fx-p').value;
      const eEl = document.getElementById('fx-e');
      if (!email || !password) { eEl.textContent = 'Preencha e-mail e senha.'; return; }
      eEl.textContent = 'Entrando…';
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { eEl.textContent = 'E-mail ou senha não conferem.'; return; }
      resolve();
    });
  });

  // ---------- leitura em páginas (o Supabase devolve no máximo 1000 linhas por vez) ----------
  const fetchAll = async build => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await build().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; };
  const evFromRow = r => ({ ...(r.payload || {}), id: r.ev_id || 'e' + r.id, t: Date.parse(r.at), type: r.type, link: r.link, session: r.session });
  const leadFromRow = r => ({ ...r.data, id: r.id });

  // ---------- estado base para o site público e a área do cliente ----------
  const baseDb = pub => ({
    config: pub.config || {}, packages: pub.packages || [], links: pub.links || [], brands: pub.brands || [],
    evaluations: pub.evaluations || [], clients: pub.clients || [],
    team: [], leads: [], events: [], contents: [], meetings: [], metrics: [], reports: [], ledger: [], tasks: [], planRequests: [], evalRequests: [],
    seeded: true, proofSeeded: true, sysSeeded: true, resSeeded: true, brandsSeeded: true, teamV2: true, packsV7: true,
  });

  // ---------- o que o site mostra (montado pela equipe e publicado) ----------
  const buildPublic = db => {
    const ev = (db.evaluations || []).filter(e => e.consent && e.onSite !== false && (e.text || '').trim().length >= 10 && !e.example);
    const ids = new Set(ev.map(e => e.client));
    const c = db.config || {};
    return {
      config: { headline: c.headline, whatsapp: c.whatsapp, instagram: c.instagram, facebook: c.facebook, waMsg: c.waMsg || null, footer: c.footer || null, domain: c.domain, bonusSocial: c.bonusSocial, bonusSystem: c.bonusSystem, forms: c.forms, logo: c.logo || null },
      packages: db.packages || [], links: (db.links || []).map(l => ({ id: l.id, name: l.name, slug: l.slug })), brands: (db.brands || []).filter(b => b.on),
      evaluations: ev.map(e => ({ id: e.id, client: e.client, company: e.company, text: e.text, r: e.r, t: e.t, month: e.month, consent: true, onSite: true })),
      clients: (db.clients || []).filter(x => ids.has(x.id) && !x.example).map(x => ({ id: x.id, name: x.name, logo: x.logo || null, segment: x.segment })),
      publishedAt: new Date().toISOString(),
    };
  };

  // ---------- mescla de três vias (quando duas pessoas mudam a mesma coleção) ----------
  const merge3 = (base, local, server) => {
    if (Array.isArray(local) && Array.isArray(server) && (local.every(x => x && x.id) || !local.length) && server.every(x => x && x.id)) {
      const B = new Map((Array.isArray(base) ? base : []).filter(x => x && x.id).map(x => [x.id, J(x)]));
      const S = new Map(server.map(x => [x.id, x]));
      const out = []; const seen = new Set();
      for (const l of local) { seen.add(l.id); const s = S.get(l.id); const b = B.get(l.id);
        if (!s) { if (b === undefined) out.push(l); else if (J(l) !== b) out.push(l); continue; }   // removido no servidor: mantém só se mudou aqui
        if (J(l) === b) out.push(s); else out.push(l); }
      for (const s of server) if (!seen.has(s.id) && !B.has(s.id)) out.push(s);                       // novos itens do servidor
      return out;
    }
    return J(local) === J(base) ? server : local;
  };

  // ---------- status de gravação (topo do sistema) ----------
  let stEl = null;
  const setStatus = (kind, txt) => { stEl = stEl || document.getElementById('sync-st'); if (!stEl) return; stEl.hidden = false; stEl.className = 'sync ' + kind; stEl.textContent = txt; };

  // ===================== EQUIPE =====================
  const last = {}; let leadSnap = new Map(); let evCount = 0; let busy = false, again = false, timer = 0, lastLeadAt = null, lastEvId = 0;
  const flagsOf = db => { const f = {}; Object.keys(db).forEach(k => { if (!NOT_FLAGS.has(k)) f[k] = db[k]; }); return f; };

  const syncAdmin = async () => {
    const db = C.db; if (!db) return;
    if (busy) { again = true; return; } busy = true; let merged = false, pubChanged = false;
    try {
      setStatus('saving', 'Salvando…');
      for (const k of [...DOC_KEYS, 'flags']) {
        const cur = k === 'flags' ? flagsOf(db) : db[k]; if (cur === undefined) continue;
        const s = J(cur); if (last[k] && s === last[k].s) continue;
        let res = await rpc('save_doc', { p_key: k, p_data: cur, p_base: last[k] ? last[k].v : 0 });
        if (!res.ok && res.conflict) {
          const m = merge3(last[k] ? last[k].d : null, cur, res.data);
          if (k === 'flags') Object.assign(db, m); else db[k] = m;
          res = await rpc('save_doc', { p_key: k, p_data: m, p_base: res.version }); merged = true;
        }
        if (res.ok) { const v = k === 'flags' ? flagsOf(db) : db[k]; last[k] = { s: J(v), v: res.version, d: clone(v) }; if (PUB_KEYS.includes(k)) pubChanged = true; }
      }
      // leads alterados ou apagados pela equipe
      const now = new Map((db.leads || []).map(l => [l.id, J(l)]));
      for (const [id, s] of now) if (leadSnap.has(id) && leadSnap.get(id) !== s) { const { error } = await sb.from('leads').update({ data: JSON.parse(s), updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; }
      const gone = [...leadSnap.keys()].filter(id => !now.has(id));
      if (gone.length) { const { error } = await sb.from('leads').delete().in('id', gone); if (error) throw error; }
      for (const [id, s] of now) if (leadSnap.has(id)) leadSnap.set(id, s);
      gone.forEach(id => leadSnap.delete(id));
      // "apagar visitas de teste"
      if (evCount && !(db.events || []).length) { const { error } = await sb.from('events').delete().gte('id', 0); if (error) throw error; }
      evCount = (db.events || []).length;
      if (pubChanged) await rpc('publish_site', { p_data: buildPublic(db) });
      setStatus('ok', 'Salvo');
      if (merged) window.__fxApp?.rerender(true);
    } catch (e) {
      console.error('[FX HUB] erro ao salvar', e);
      setStatus('err', 'Sem conexão · tentando de novo');
      clearTimeout(timer); timer = setTimeout(syncAdmin, 5000);
    }
    busy = false; if (again) { again = false; syncAdmin(); }
  };

  // novidades vindas do site (leads, visitas) e da área do cliente (aprovações, avaliações)
  const pollAdmin = async () => {
    const db = C.db; if (!db || busy) return;
    try {
      let changed = false;
      const { data: docs, error } = await sb.from('app_docs').select('key,version,data');
      if (error) throw error;
      for (const d of docs) { if (!last[d.key] || d.version <= last[d.key].v) continue;
        const cur = d.key === 'flags' ? flagsOf(db) : db[d.key];
        if (J(cur) === last[d.key].s) { if (d.key === 'flags') Object.assign(db, d.data); else db[d.key] = d.data; last[d.key] = { s: J(d.data), v: d.version, d: clone(d.data) }; changed = true; } }
      const { data: L } = await sb.from('leads').select('id,data,created_at').gt('created_at', lastLeadAt || '1970-01-01').order('created_at', { ascending: true }).limit(500);
      (L || []).forEach(r => { if (!leadSnap.has(r.id)) { const l = leadFromRow(r); db.leads.unshift(l); leadSnap.set(r.id, J(l)); changed = true; } lastLeadAt = r.created_at; });
      const { data: E } = await sb.from('events').select('*').gt('id', lastEvId).order('id', { ascending: true }).limit(1000);
      (E || []).forEach(r => { db.events.push(evFromRow(r)); lastEvId = r.id; changed = true; });
      evCount = db.events.length;
      if (changed) window.__fxApp?.rerender(false);
    } catch (e) { console.warn('[FX HUB] atualização automática falhou', e); }
  };

  const loadAdmin = async () => {
    const { data: who } = await sb.rpc('whoami');
    if (!who || !who.team) { await sb.auth.signOut(); return askLogin('Este login não é da equipe FX.').then(loadAdmin); }
    showBoot('<span class="hub-word"><em>FX</em> HUB</span><p>Carregando os dados da FX…</p>');
    const { data: docs, error } = await sb.from('app_docs').select('key,data,version'); if (error) throw error;
    const leads = await fetchAll(() => sb.from('leads').select('id,data,created_at').order('created_at', { ascending: false }));
    const since = new Date(Date.now() - 400 * 864e5).toISOString();
    const events = await fetchAll(() => sb.from('events').select('*').gte('at', since).order('id', { ascending: true }));
    let db = null;
    if (docs.length) {
      db = {}; docs.forEach(d => { if (d.key === 'flags') Object.assign(db, d.data); else db[d.key] = d.data; last[d.key] = { s: J(d.data), v: d.version, d: clone(d.data) }; });
      DOC_KEYS.forEach(k => { if (db[k] === undefined) db[k] = k === 'config' ? {} : []; });
    }
    C.firstRun = !docs.length;
    C.pendingLeads = leads.map(leadFromRow); C.pendingEvents = events.map(evFromRow);
    leadSnap = new Map(C.pendingLeads.map(l => [l.id, J(l)]));
    lastLeadAt = leads.length ? leads[0].created_at : null; lastEvId = events.length ? events.at(-1).id : 0; evCount = events.length;
    if (db) { db.leads = C.pendingLeads.slice(); db.events = C.pendingEvents.slice(); }
    C.db = db; C.team = who.team;
  };

  // ===================== SITE PÚBLICO =====================
  const sentEv = new Set(); const leadTok = new Map(); const leadSent = new Map();
  const syncSite = async () => {
    const db = C.db; if (!db) return;
    for (const e of db.events || []) {
      if (sentEv.has(e.id)) continue; sentEv.add(e.id);
      const { id, t, type, link, session, ...payload } = e;
      rest('track_event', { p_session: session || 'sem-sessao', p_link: link || '', p_type: type, p_payload: payload, p_ev_id: id }).catch(err => console.warn('[FX HUB] evento não enviado', err.message));
    }
    for (const l of db.leads || []) {
      if (!leadTok.has(l.id) && !leadSent.has(l.id)) {
        leadSent.set(l.id, 'sending');
        try { const r = await rpc('submit_lead', { p_lead: l }); leadTok.set(l.id, r.token); leadSent.set(l.id, J([l.package, l.bonusCode])); }
        catch (e) { leadSent.delete(l.id); console.error('[FX HUB] lead não enviado', e); window.__fxApp?.toast(/too_many/.test(e.message) ? 'Recebemos vários envios deste número hoje. A FX vai falar com você pelo WhatsApp.' : 'Não conseguimos enviar agora. Confira a internet ou fale com a FX pelo WhatsApp.'); }
      } else if (leadTok.has(l.id)) {
        const s = J([l.package, l.bonusCode]);
        if (leadSent.get(l.id) !== s && l.package) { leadSent.set(l.id, s); rest('lead_choose', { p_id: l.id, p_token: leadTok.get(l.id), p_package: l.package, p_bonus: l.bonusCode || null }).catch(err => console.warn('[FX HUB] escolha não enviada', err.message)); }
      }
    }
  };

  // ===================== ÁREA DO CLIENTE =====================
  let pBase = null;
  const syncPortal = async () => {
    const db = C.db; if (!db || !pBase) return;
    const cid = C.portalClient; const p = {};
    const reviews = (db.contents || []).filter(x => x.client === cid && pBase.status.get(x.id) === 'aguardando_aprovacao' && ['aprovado', 'em_revisao'].includes(x.status)).map(x => ({ id: x.id, status: x.status, feedback: x.feedback || '' }));
    if (reviews.length) p.reviews = reviews;
    const ev = (db.evaluations || []).find(x => x.client === cid && !pBase.evals.has(x.id)); if (ev) p.evaluation = ev;
    const pr = (db.planRequests || []).find(x => x.client === cid && !pBase.plans.has(x.id)); if (pr) p.planRequest = pr;
    for (const e of db.events || []) { if (pBase.evs.has(e.id)) continue; pBase.evs.add(e.id); const { id, t, type, link, ...payload } = e; sb.rpc('track_event', { p_session: 'cliente-' + cid, p_link: 'portal', p_type: type, p_payload: payload, p_ev_id: id }); }
    if (!Object.keys(p).length) return;
    const prev = reviews.map(r => [r.id, pBase.status.get(r.id)]);
    reviews.forEach(r => pBase.status.set(r.id, r.status)); if (ev) pBase.evals.add(ev.id); if (pr) pBase.plans.add(pr.id);   // marca já, para não enviar duas vezes
    try { await rpc('portal_sync', { p }); }
    catch (e) { prev.forEach(([id, st]) => pBase.status.set(id, st)); if (ev) pBase.evals.delete(ev.id); if (pr) pBase.plans.delete(pr.id); console.error('[FX HUB] ação não enviada', e); window.__fxApp?.toast('Não conseguimos enviar agora. Tente de novo em instantes.'); }
  };

  const loadPortal = async () => {
    const { data: s } = await sb.auth.getSession();
    const pubRes = await sb.from('public_site').select('data').eq('id', 1).maybeSingle();
    const pub = pubRes.data?.data || {};
    if (!s.session) { C.db = pub.config ? baseDb(pub) : null; return; }
    const { data: who } = await sb.rpc('whoami');
    if (!who?.client_id) { await sb.auth.signOut(); C.db = pub.config ? baseDb(pub) : null; C.loginError = 'Este login não é de um cliente. A equipe entra pelo endereço principal do sistema.'; return; }
    const st = await rpc('portal_state');
    const db = baseDb(pub);
    ['clients', 'contents', 'meetings', 'metrics', 'reports', 'ledger', 'evaluations', 'planRequests', 'packages'].forEach(k => { db[k] = st[k] || []; });
    db.config = { ...db.config, ...Object.fromEntries(Object.entries(st.config || {}).filter(([, v]) => v != null)) };
    C.db = db; C.portalClient = st.clientId;
    pBase = { status: new Map(db.contents.map(x => [x.id, x.status])), evals: new Set(db.evaluations.map(x => x.id)), plans: new Set(db.planRequests.map(x => x.id)), evs: new Set() };
  };

  // ===================== API usada pelo app =====================
  C.save = () => {
    if (REALM === 'painel') { clearTimeout(timer); timer = setTimeout(syncAdmin, 700); setStatus('saving', 'Salvando…'); }
    else if (REALM === 'site') syncSite();
    else if (REALM === 'portal') syncPortal();
    return true;
  };
  C.afterStart = db => {
    C.db = db;
    if (REALM === 'painel') {
      (C.pendingLeads || []).forEach(l => { if (!db.leads.some(x => x.id === l.id)) db.leads.push(l); });
      db.leads.sort((a, b) => (b.created || 0) - (a.created || 0));
      db.events = (C.pendingEvents || []).concat((db.events || []).filter(e => !(C.pendingEvents || []).some(x => x.id === e.id)));
      const so = document.getElementById('cloud-out'); if (so) so.hidden = false;
      setStatus('ok', 'Salvo');
      syncAdmin();
      setInterval(pollAdmin, 45000);
      addEventListener('beforeunload', e => { if (busy || timer) { /* gravação pendente */ } });
    }
    if (REALM === 'site') { db.events.forEach(e => sentEv.add(e.id)); syncSite(); }
  };
  C.portalLogin = async (email, code) => {
    const { error } = await sb.auth.signInWithPassword({ email, password: code });
    if (error) return 'E-mail ou código não conferem. Confira os dados enviados pela FX.';
    const { data: who } = await sb.rpc('whoami');
    if (!who?.client_id) { await sb.auth.signOut(); return 'Este login não é de um cliente.'; }
    location.reload(); return null;
  };
  C.logout = async () => { await sb.auth.signOut(); location.href = REALM === 'portal' ? '/cliente' : '/'; };
  C.goRealm = h => { const to = h === 'painel' ? '/' : h === 'portal' ? '/cliente' : '/site'; if (location.pathname !== to || REALM !== (h === 'portal' ? 'portal' : h === 'painel' ? 'painel' : 'site')) { location.href = to; return true; } return false; };
  C.uploadBackup = async (clientId, month, file) => {
    const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-80);
    const p = `${clientId}/${month}-${safe}`;
    const { error } = await sb.storage.from('backups').upload(p, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (error) throw error; return p;
  };
  C.removeBackup = async p => { if (p) await sb.storage.from('backups').remove([p]); };
  C.backupUrl = async p => { const { data, error } = await sb.storage.from('backups').createSignedUrl(p, 300, { download: true }); if (error) throw error; return data.signedUrl; };
  // cliente excluído: desliga o login dele da empresa (o login em si continua no Supabase)
  C.unlinkClient = async id => { try { await sb.from('client_users').delete().eq('client_id', id); } catch (e) { console.warn('[FX HUB] desligar acesso', e); } };
  C.clientAccess = async (c) => {
    const { data, error } = await sb.functions.invoke('client-access', { body: { client_id: c.id, email: c.email, code: c.portalCode } });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch (e) {} throw new Error(msg); }
    return data;
  };
  C.addTeam = (email, name, role) => rpc('add_team_member', { p_email: email, p_name: name, p_role: role });

  // ===================== início =====================
  const start = async () => {
    try {
      if (REALM !== 'site') { try { await initSb(); } catch (e) { hideBoot(); offline(); return; } }
      if (REALM === 'painel') {
        const { data: s } = await sb.auth.getSession();
        if (!s.session) await askLogin();
        await loadAdmin();
        if (location.hash.slice(1) !== 'painel') history.replaceState(null, '', location.pathname + location.search + '#painel');
      } else if (REALM === 'portal') {
        await loadPortal();
        if (location.hash.slice(1) !== 'portal') history.replaceState(null, '', location.pathname + location.search + '#portal');
      } else {
        let cached = null; try { cached = JSON.parse(localStorage.getItem(PUB_CACHE) || 'null'); } catch (e) {}
        let pub;
        if (cached?.config) { pub = cached; pubEarly.then(fresh => { const s2 = JSON.stringify(fresh); try { localStorage.setItem(PUB_CACHE, s2); } catch (e) {} if (s2 !== JSON.stringify(cached) && fresh.config && C.db) { PUB_KEYS.forEach(k => { C.db[k] = fresh[k] || (k === 'config' ? {} : []); }); window.__fxApp?.rerender?.(true); } }).catch(() => null); }
        else { pub = await pubEarly; try { localStorage.setItem(PUB_CACHE, JSON.stringify(pub)); } catch (e) {} }
        C.db = pub.config ? baseDb(pub) : null; C.noPublish = !pub.config;
        if (linkSlug && C.db) { const L = (C.db.links || []).find(l => l.slug === linkSlug || l.id === linkSlug); C.link = L ? L.id : null; }
        if (!['site', ''].includes(location.hash.slice(1))) history.replaceState(null, '', location.pathname + location.search + '#site');
        else if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#site');
      }
      hideBoot();
      window.__fxStart();
    } catch (e) {
      console.error('[FX HUB] falha ao iniciar', e);
      showBoot('<span class="hub-word"><em>FX</em> HUB</span><h1>Não foi possível carregar.</h1><p>Confira a internet e tente de novo. Se continuar, avise a FX.</p><button class="pill orange" id="fx-retry">Tentar de novo</button>'); document.getElementById('fx-retry')?.addEventListener('click', () => location.reload());
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(boot); start(); });
  else { document.body.appendChild(boot); start(); }
})();
