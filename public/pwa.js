/* FX HUB · instalar como aplicativo (computador e celular) */
(() => {
  const path = location.pathname.replace(/\/+$/, ''), hash = location.hash.slice(1);
  const cloud = !!(window.FX_CONFIG && window.FX_CONFIG.supabaseUrl);
  const realm = (path === '/cliente' || path === '/avaliar' || hash === 'portal') ? 'cliente' : (cloud && (path === '/site' || path.startsWith('/c/') || /^\/[^/.]+$/.test(path) && !/^\/(painel|cliente|avaliar)$/i.test(path) || /[?&](l|origem)=/.test(location.search))) ? 'site' : 'painel';
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document);
  const iosSafari = ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  const KEY = 'fxhub-install-dismiss-' + realm;
  let deferred = null;

  // manifesto certo para cada área: equipe instala "FX HUB", cliente instala "FX Cliente"
  if (realm !== 'site') {
    const m = document.createElement('link'); m.rel = 'manifest'; m.href = `/manifest-${realm}.webmanifest`; document.head.appendChild(m);
    const t = document.createElement('meta'); t.name = 'apple-mobile-web-app-title'; t.content = realm === 'painel' ? 'FX HUB' : 'FX Cliente'; document.head.appendChild(t);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => null));
  }
  if (standalone) document.documentElement.classList.add('is-app');
  if (realm === 'site' || standalone) return;

  const name = realm === 'painel' ? 'FX HUB' : 'a Área do Cliente FX';
  const dismissed = () => { try { return Date.now() - (+localStorage.getItem(KEY) || 0) < 14 * 864e5; } catch (e) { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, Date.now()); } catch (e) {} };

  const bar = document.createElement('div');
  bar.className = 'fx-install'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Instalar aplicativo');
  bar.innerHTML = `<img src="/icons/icon-192.png" alt="" width="40" height="40"><div><b>Instale ${name}</b><span>${ios ? 'Abre direto da tela inicial do celular, como um aplicativo.' : 'Abre numa janela própria, no computador ou no celular.'}</span></div><button class="pill orange sm" type="button" data-fx-install>Instalar</button><button class="fx-x" type="button" aria-label="Agora não">×</button>`;

  const sheet = document.createElement('div');
  sheet.className = 'fx-ios'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Como instalar no iPhone');
  sheet.innerHTML = `<div class="fx-ios-box"><img src="/icons/icon-192.png" alt="" width="56" height="56"><h2>Instalar no iPhone ou iPad</h2><ol>
      <li><span>1</span><p>${iosSafari ? 'Toque em <b>Compartilhar</b> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg> na barra do Safari.' : 'Abra este endereço no <b>Safari</b> (no iPhone, só o Safari instala apps).'}</p></li>
      <li><span>2</span><p>Role e toque em <b>Adicionar à Tela de Início</b>.</p></li>
      <li><span>3</span><p>Toque em <b>Adicionar</b>. O ícone da FX aparece na sua tela.</p></li></ol>
      <button class="pill orange" type="button" data-fx-ios-close>Entendi</button></div>`;

  const show = () => { if (!dismissed()) bar.hidden = false; document.querySelectorAll('[data-fx-install-top]').forEach(b => (b.hidden = false)); };
  const install = async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; bar.hidden = true; if (r && r.outcome === 'accepted') document.querySelectorAll('[data-fx-install-top]').forEach(b => (b.hidden = true)); return; }
    if (ios) { sheet.hidden = false; sheet.querySelector('[data-fx-ios-close]').focus(); }
  };

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { bar.hidden = true; document.querySelectorAll('[data-fx-install-top]').forEach(b => (b.hidden = true)); remember(); });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-fx-install], [data-fx-install-top]')) { install(); return; }
    if (e.target.closest('.fx-install .fx-x')) { bar.hidden = true; remember(); return; }
    if (e.target.closest('[data-fx-ios-close]') || e.target === sheet) sheet.hidden = true;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) sheet.hidden = true; });
  const mount = () => { document.body.append(bar, sheet); if (ios) setTimeout(show, 2500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  // o botão do topo do sistema é criado depois que o app desenha a tela
  new MutationObserver(() => { if (deferred || ios) document.querySelectorAll('[data-fx-install-top][hidden]').forEach(b => (b.hidden = false)); }).observe(document.documentElement, { childList: true, subtree: true });
})();
