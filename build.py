#!/usr/bin/env python3
"""Gera a versão de produção do FX HUB a partir do protótipo.

Uso:  python3 build.py [caminho/do/prototipo.html]
Saída: public/index.html, public/app.css, public/app.js, public/cloud.js

O protótipo continua funcionando sozinho (modo demonstração). A produção usa o
mesmo código com ajustes para o Supabase (login, gravação na nuvem, backups).
"""
import re, sys, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'src' / 'fx-hub.html'
OUT = ROOT / 'public'
s = SRC.read_text(encoding='utf-8')

def rep(a, b, count=1):
    global s
    if a not in s:
        raise SystemExit(f'Trecho não encontrado no protótipo:\n{a[:160]}')
    s = s.replace(a, b, count)

# ---------- app.js: código principal com os ganchos da nuvem ----------
rep("<script>\n(() => {\n", "<script>\nwindow.__fxStart = () => {\n")
rep("  renderSite(); route();\n})();\n", "  renderSite(); route();\n  window.FX_CLOUD?.afterStart(db);\n};\nif (!window.FX_CLOUD_ENABLED) window.__fxStart();\n")
rep("  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }\n  if (!db || !db.config) db = fresh();",
    "  try { db = window.FX_CLOUD ? window.FX_CLOUD.db : JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }\n  if (!db || !db.config) { db = fresh(); if (window.FX_CLOUD) { db.seeded = db.proofSeeded = db.sysSeeded = db.resSeeded = true; } }")
rep("  const save = () => { try { localStorage.setItem(KEY",
    "  const save = () => { if (window.FX_CLOUD) return window.FX_CLOUD.save(db); try { localStorage.setItem(KEY")
# rotas: em produção o padrão é o site; trocar de "área" recarrega com o login certo
rep("    const h = location.hash.slice(1); const v = ['site', 'portal'].includes(h) ? h : 'painel';",
    "    const h = location.hash.slice(1); const CL = window.FX_CLOUD; const v = ['site', 'portal', 'painel'].includes(h) ? h : (CL ? 'site' : 'painel');\n"
    "    if (CL && ((CL.realm === 'site' && v !== 'site') || (CL.realm === 'portal' && v !== 'portal') || (CL.realm === 'painel' && v === 'portal' && !P.fromAdmin)) && CL.goRealm(v)) return;")
rep("if (!session) { session = { id: uid(), link: 'direto' }; track('visit');", "if (!session) { session = { id: uid(), link: window.FX_CLOUD?.link || 'direto' }; track('visit');")
# área do cliente
rep("  const P = { client: null, tab: 'visao',", "  const P = { client: window.FX_CLOUD?.portalClient || null, tab: window.FX_CLOUD?.portalTab || 'visao',")
rep("    if (T('#lg-ok')) { const m =",
    "    if (T('#lg-ok') && window.FX_CLOUD) { const m = $('#lg-mail').value.trim().toLowerCase(), cd = $('#lg-code').value.trim().toUpperCase(); if (!m || !cd) { $('#e-lg').textContent = 'Preencha o e-mail e o código.'; return; } $('#e-lg').textContent = 'Entrando…'; window.FX_CLOUD.portalLogin(m, cd).then(err => { if (err) $('#e-lg').textContent = err; }); return; }\n"
    "    if (T('#lg-ok')) { const m =")
rep("    if (T('#lg-out')) {", "    if (T('#lg-out') && window.FX_CLOUD && !P.fromAdmin) { window.FX_CLOUD.logout(); return; }\n    if (T('#lg-out')) {")
rep("    if (T('[data-go-portal]')) {", "    if (T('[data-go-portal]') && window.FX_CLOUD) { window.open('/cliente', '_blank', 'noopener'); return; }\n    if (T('#cloud-out')) { window.FX_CLOUD.logout(); return; }\n    if (T('[data-go-portal]')) {")
# backups no Storage privado
rep("    if (e.target.id === 'bk-file') {",
    "    if (e.target.id === 'bk-file' && window.FX_CLOUD) { const f = e.target.files[0]; pendingBk = f ? { name: f.name, size: f.size, file: f } : null; $('#e-bk').textContent = f && f.size > 50 * 1048576 ? 'O arquivo passa de 50 MB. Compacte em .zip ou divida.' : ''; if (f && f.size > 50 * 1048576) pendingBk = null; return; }\n"
    "    if (e.target.id === 'bk-file') {")
rep("    if ((el = T('#bk-add'))) {",
    "    if ((el = T('#bk-add')) && window.FX_CLOUD) { const c = clientById(el.dataset.id), sy = sysOf(c); const m = $('#bk-m').value; if (!m || !pendingBk?.file) { $('#e-bk').textContent = 'Escolha o mês e o arquivo do backup.'; return; } el.disabled = true; $('#e-bk').textContent = 'Enviando o arquivo…';\n"
    "      window.FX_CLOUD.uploadBackup(c.id, m, pendingBk.file).then(p => { const old = (sy.backups || []).find(x => x.month === m); if (old?.path && old.path !== p) window.FX_CLOUD.removeBackup(old.path); sy.backups = (sy.backups || []).filter(x => x.month !== m).concat([{ id: uid(), month: m, name: pendingBk.name, size: pendingBk.size, t: Date.now(), note: $('#bk-note').value.trim(), path: p }]); pendingBk = null; save(); renderAdmin(); toast(`Backup de ${mLong(m).toLowerCase()} guardado. O cliente já pode baixar.`); }, err => { el.disabled = false; $('#e-bk').textContent = 'Não foi possível enviar: ' + (err.message || 'erro'); }); return; }\n"
    "    if ((el = T('#bk-add'))) {")
rep("  const dlBackup = async (c, b) => {\n",
    "  const dlBackup = async (c, b) => {\n    if (window.FX_CLOUD && b.path) { try { const url = await window.FX_CLOUD.backupUrl(b.path); const a = document.createElement('a'); a.href = url; a.download = b.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); toast(`Baixando ${b.name}`); } catch (e) { toast('Não foi possível baixar agora. Tente de novo.'); } return; }\n")
rep("const sy = sysOf(clientById(cid)); sy.backups = sy.backups.filter(x => x.id !== bid);",
    "const sy = sysOf(clientById(cid)); const gone = sy.backups.find(x => x.id === bid); if (window.FX_CLOUD && gone?.path) window.FX_CLOUD.removeBackup(gone.path); sy.backups = sy.backups.filter(x => x.id !== bid);")
# equipe: convite vira vínculo com usuário do Supabase Auth
rep("    if (T('#tm-ok')) {",
    "    if (T('#tm-ok') && window.FX_CLOUD) { const n = $('#tm-n').value.trim(), m = $('#tm-e').value.trim(), r = $('#tm-r').value; if (n.length < 2 || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(m)) { $('#e-tm').textContent = 'Preencha nome e e-mail válidos.'; return; }\n"
    "      $('#e-tm').textContent = 'Salvando…'; window.FX_CLOUD.addTeam(m, n, r).then(() => { const ex = db.team.find(u => u.email === m); if (ex) Object.assign(ex, { name: n, role: r }); else db.team.push({ id: uid(), name: n, email: m, role: r }); save(); closeAll(); renderAdmin(); toast(`${n} agora tem acesso ao sistema`); }, err => { $('#e-tm').textContent = /user_not_found/.test(err.message) ? 'Crie primeiro o login desta pessoa no Supabase (Authentication → Users → Add user) com este e-mail.' : 'Não foi possível salvar: ' + err.message; }); return; }\n"
    "    if (T('#tm-ok')) {")
rep("Object.entries(ROLES).filter(r => r[0] !== 'admin')", "Object.entries(ROLES).filter(r => ['admin', 'criadora', 'captacao'].includes(r[0]))")
# instalar como aplicativo: botão no topo do sistema e da área do cliente
rep("      <button class=\"pill orange sm\" data-open-site=\"bio\">Ver site",
    "      <button class=\"pill sm\" data-fx-install-top hidden title=\"Instalar o FX HUB como aplicativo\"><svg class=\"i\"><use href=\"#i-down\"/></svg><span class=\"lbl\">Instalar app</span></button>\n      <button class=\"pill orange sm\" data-open-site=\"bio\">Ver site")
rep("<div class=\"right\"><button class=\"pill sm\" id=\"lg-out\">Sair</button></div>",
    "<div class=\"right\">${P.fromAdmin ? '' : `<button class=\"pill sm\" data-fx-install-top hidden title=\"Instalar como aplicativo\"><svg class=\"i\"><use href=\"#i-down\"/></svg><span class=\"lbl\">Instalar app</span></button>`}<button class=\"pill sm\" id=\"lg-out\">Sair</button></div>")
# acessos dos clientes: o login é ativado pelo próprio sistema (ensureLogin)
# topo do sistema: status de gravação e sair
rep("      <span class=\"livepill\"><i></i>Ao vivo</span>",
    "      <span class=\"sync\" id=\"sync-st\" hidden></span>\n      <span class=\"livepill\"><i></i>Ao vivo</span>")
rep("      <button class=\"pill orange sm\" data-open-site=\"bio\">Ver site <svg class=\"i\"><use href=\"#i-arrow\"/></svg></button>\n    </div>",
    "      <button class=\"pill orange sm\" data-open-site=\"bio\">Ver site <svg class=\"i\"><use href=\"#i-arrow\"/></svg></button>\n      <button class=\"pill sm\" id=\"cloud-out\" hidden>Sair</button>\n    </div>")
# ganchos que o cloud.js usa
rep("  renderSite(); route();\n  window.FX_CLOUD?.afterStart(db);",
    "  window.__fxApp = { toast, rerender: force => { const busyUi = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || !$('#modal')?.hidden; if (!force && busyUi) return; if ($('#v-painel').classList.contains('on')) renderAdmin(); else if ($('#v-portal').classList.contains('on')) renderPortal(); } };\n"
    "  renderSite(); route();\n  window.FX_CLOUD?.afterStart(db);")
# texto de demonstração do login do cliente não vale em produção
s = re.sub(r" Para testar: contato@studioexemplo\.com\.br e código FX2026 \(mídia social\) ou contato@distribuidoraexemplo\.com\.br e código SIS2026 \(sistema\)\.", "", s)

# ---------- separa CSS e JS (permite política de segurança sem scripts inline) ----------
css = re.search(r'<style>\n?(.*?)</style>', s, re.S)
js = re.search(r'<script>\n?(.*?)</script>', s, re.S)
extra_css = (ROOT / 'src' / 'cloud.css').read_text(encoding='utf-8')
html = s[:css.start()] + '<link rel="stylesheet" href="/app.css">' + s[css.end():]
js2 = re.search(r'<script>\n?(.*?)</script>', html, re.S)
# velocidade: logos de exemplo do primeiro uso já estão no banco; não vão no app publicado
js_txt = re.sub(r'const BRAND_SEED = \[.*?\];\n', 'const BRAND_SEED = [];\n', js.group(1), count=1, flags=re.S)
import hashlib
build_id = hashlib.sha1((js_txt + extra_css + (ROOT / 'src' / 'cloud.js').read_text(encoding='utf-8') + (ROOT / 'src' / 'pwa' / 'pwa.js').read_text(encoding='utf-8')).encode()).hexdigest()[:10]
V = '?v=' + build_id
html = html[:js2.start()] + f'<script src="/app-config.js"></script>\n<script src="/pwa.js{V}"></script>\n<script src="/cloud.js{V}"></script>\n<script src="/app.js{V}"></script>' + html[js2.end():]
html = html.replace('<link rel="stylesheet" href="/app.css">', f'<link rel="stylesheet" href="/app.css{V}">')
html = html.replace(' integrity=""', '')
html = html.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
cfg_txt = (OUT / 'app-config.js').read_text(encoding='utf-8') if (OUT / 'app-config.js').exists() else ''
SB_ORIGINS = [m.group(1) for m in re.finditer(r"supabaseUrl:\s*'(https://[^'/]+)", cfg_txt)]
head = ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="description" content="FX Mídia Social: identidade visual, conteúdo, gestão de redes e sistemas internos em Uruguaiana.">\n'
        + ''.join(f'<link rel="preconnect" href="{u}" crossorigin>\n' for u in SB_ORIGINS) + f'<link rel="preload" href="/app.js{V}" as="script">\n<link rel="preload" href="/cloud.js{V}" as="script">\n'
        '<meta name="theme-color" content="#0a0807">\n<link rel="icon" href="/favicon.png?v=2">\n<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n')
# a página do protótipo começa direto pelo <title>; aqui vira um documento completo
body_start = html.index('</style>') if '</style>' in html else None
first_tag_end = html.index(f'<link rel="stylesheet" href="/app.css{V}">') + len(f'<link rel="stylesheet" href="/app.css{V}">')
html = head + html[:first_tag_end] + '\n</head>\n<body>' + html[first_tag_end:] + '\n</body>\n</html>\n'

OUT.mkdir(exist_ok=True)
(OUT / 'index.html').write_text(html, encoding='utf-8')
(OUT / 'app.css').write_text(css.group(1) + '\n' + extra_css, encoding='utf-8')
(OUT / 'app.js').write_text(js_txt, encoding='utf-8')
shutil.copy(ROOT / 'src' / 'cloud.js', OUT / 'cloud.js')
shutil.copy(ROOT / 'src' / 'pwa' / 'pwa.js', OUT / 'pwa.js')
(OUT / 'sw.js').write_text((ROOT / 'src' / 'pwa' / 'sw.js').read_text(encoding='utf-8').replace('__BUILD__', build_id), encoding='utf-8')
for m in ('manifest-painel.webmanifest', 'manifest-cliente.webmanifest'):
    shutil.copy(ROOT / 'src' / 'pwa' / m, OUT / m)
if not (OUT / 'app-config.js').exists():
    shutil.copy(ROOT / 'src' / 'app-config.example.js', OUT / 'app-config.js')
print('ok:', ', '.join(f'{p.name} {p.stat().st_size // 1024} KB' for p in sorted(OUT.iterdir()) if p.is_file()))
