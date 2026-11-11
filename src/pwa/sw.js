/* FX HUB · service worker
   - Deixa o app abrir rápido e instalar como aplicativo.
   - Páginas e scripts: busca na internet primeiro (sempre a versão mais nova);
     sem internet, usa a cópia guardada.
   - Nunca guarda dados do Supabase (login, clientes, leads): esses vêm sempre do servidor. */
const VERSION = 'fxhub-__BUILD__';
const SHELL = ['/', '/index.html', '/app.js', '/app.css', '/cloud.js', '/pwa.js', '/app-config.js', '/favicon.png',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/manifest-painel.webmanifest', '/manifest-cliente.webmanifest',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;   // dados: sempre direto do servidor
  const sameOrigin = url.origin === location.origin;
  const isCdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (!sameOrigin && !isCdn) return;
  if (req.mode === 'navigate') {   // qualquer endereço do app abre o index.html
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('/index.html', cp)); return r; }).catch(() => caches.match('/index.html')));
    return;
  }
  if (isCdn) { e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; }))); return; }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
});
