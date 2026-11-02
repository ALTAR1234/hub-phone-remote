// Phone hub: a phone-sized remote for Listener, Gamer, Weber and Streamer.
// Listens on 127.0.0.1 only. Tailscale ("tailscale serve") carries it to your own
// devices, at home or away, without opening anything to the internet. Every API
// call must carry the pairing token your phone gets once by scanning a QR code
// on this PC. It talks to the apps through their own private control channels.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const APPDATA = process.env.APPDATA || '';
const LOCAL = process.env.LOCALAPPDATA || '';
const DEV = path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason');
const PORT = 47800;

// ---------- pairing token (made once, kept in %APPDATA%\phone-hub) ----------
const DATA = path.join(APPDATA, 'phone-hub');
fs.mkdirSync(DATA, { recursive: true });
const CONFIG = path.join(DATA, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch {
  config = { token: crypto.randomBytes(32).toString('hex') };
  fs.writeFileSync(CONFIG, JSON.stringify(config));
}
const tokenOk = (t) => typeof t === 'string' && t.length === config.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(config.token));

// ---------- the apps ----------
const firstExisting = (...p) => p.find((x) => fs.existsSync(x)) ?? null;
const APPS = {
  listener: { control: path.join(APPDATA, 'aurora-music', 'control.json'), exe: () => firstExisting(path.join(LOCAL, 'Programs', 'aurora-music', 'Listener.exe'), path.join(DEV, 'aurora-music', 'Listener.cmd')) },
  gamer: { control: path.join(APPDATA, 'nexus-games', 'control.json'), exe: () => firstExisting(path.join(LOCAL, 'Programs', 'nexus-games', 'Gamer.exe'), path.join(DEV, 'nexus', 'Gamer.cmd')) },
  weber: { control: path.join(APPDATA, 'Weber', 'control.json'), exe: () => firstExisting(path.join(LOCAL, 'Programs', 'weber-browser', 'Weber.exe'), path.join(DEV, 'weber', 'Weber.cmd')) },
  streamer: { control: path.join(APPDATA, 'Streamer', 'control.json'), exe: () => firstExisting(path.join(LOCAL, 'Programs', 'Streamer', 'electron.exe'), path.join(DEV, 'streamer-tv', 'Streamer.cmd')) },
};
// open a program, link or shortcut the way double-clicking would
const launch = (target) => spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();

function sendTo(app, body, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(APPS[app].control, 'utf8'));
    } catch {
      return reject(Object.assign(new Error('not running'), { code: 'NOT_RUNNING' }));
    }
    const data = JSON.stringify({ token: cfg.token, ...body });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(out || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || `${app} said ${res.statusCode}`));
        } catch {
          reject(new Error(`Bad reply from ${app}`));
        }
      });
    });
    // only a refused connection means the app isn't running; a slow answer is just slow
    req.on('error', (e) => reject(e.code === 'ECONNREFUSED' ? Object.assign(new Error('not running'), { code: 'NOT_RUNNING' }) : new Error(`${app} didn't answer: ${e.message}`)));
    req.on('timeout', () => req.destroy(new Error(`${app} took too long`)));
    req.end(data);
  });
}
/** Send a command, starting the app on the PC first if it isn't running. */
async function command(app, body) {
  try {
    return await sendTo(app, body);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  const exe = APPS[app].exe();
  if (!exe) throw new Error(`${app} isn't installed on the PC`);
  launch(exe);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await sendTo(app, body);
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error(`${app} did not start in time`);
}
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

// ---------- API ----------
const SERVICES = {
  netflix: ['Netflix', '#e50914', (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`],
  disney: ['Disney+', '#113ccf', (q) => `https://www.disneyplus.com/search?q=${encodeURIComponent(q)}`],
  hulu: ['Hulu', '#1ce783', (q) => `https://www.hulu.com/search?q=${encodeURIComponent(q)}`],
  prime: ['Prime Video', '#00a8e1', (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=instant-video`],
  paramount: ['Paramount+', '#0064ff', (q) => `https://www.paramountplus.com/search/?q=${encodeURIComponent(q)}`],
  peacock: ['Peacock', '#f6c94b', (q) => `https://www.peacocktv.com/watch/search?q=${encodeURIComponent(q)}`],
  appletv: ['Apple TV+', '#a1a1a6', (q) => `https://tv.apple.com/search?term=${encodeURIComponent(q)}`],
  youtube: ['YouTube', '#ff0033', (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`],
};
const api = {
  'GET /api/status': async () => {
    const running = {};
    await Promise.all(Object.keys(APPS).map(async (a) => (running[a] = await sendTo(a, { action: a === 'listener' ? 'now' : 'see' }).then(() => true, () => false))));
    return { running };
  },
  // music (Listener)
  'GET /api/music': () => command('listener', { action: 'now' }),
  'POST /api/music': (b) => {
    const action = String(b.action || '');
    if (!['play', 'pause', 'resume', 'toggle', 'next', 'previous', 'like', 'shuffle', 'volume'].includes(action)) throw new Error('Unknown music action');
    return command('listener', { action, query: String(b.query ?? '').slice(0, 200), value: Number(b.value) || 0 });
  },
  // games (Gamer's library; launched on the PC exactly as Gamer does)
  'GET /api/games': () => {
    const lib = readJson(path.join(APPDATA, 'nexus-games', 'library.json'), { games: [] });
    return {
      games: lib.games
        .filter((g) => !g.hidden)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        .map((g) => ({ id: g.id, title: g.title, source: g.source, pinned: !!g.pinned, playtime: g.playtime ?? 0, lastPlayed: g.lastPlayed ?? null, cover: coverUrl(g.cover || g.hero || g.header) })),
    };
  },
  'POST /api/games/launch': (b) => {
    const lib = readJson(path.join(APPDATA, 'nexus-games', 'library.json'), { games: [] });
    const g = lib.games.find((x) => x.id === b.id);
    if (!g?.target) throw new Error('No such game');
    launch(g.target);
    return { launched: g.title };
  },
  // TV (Streamer's catalog; shows open in the service's own iPhone app via its link)
  'GET /api/tv': () => {
    const cat = readJson(path.join(APPDATA, 'Streamer', 'catalog.json'), { shows: [] });
    const st = readJson(path.join(APPDATA, 'Streamer', 'streamer.json'), { continue: [] });
    const rows = Object.entries(SERVICES).map(([id, [name, color]]) => ({ id, name, color, shows: cat.shows.filter((s) => s.service === id).slice(0, 20).map(slimShow) })).filter((r) => r.shows.length);
    return {
      services: Object.entries(SERVICES).map(([id, [name, color]]) => ({ id, name, color })),
      continue: (st.continue ?? []).slice(0, 12).map((c) => ({ ...c, serviceName: SERVICES[c.service]?.[0] ?? c.service, color: SERVICES[c.service]?.[1] ?? '#666' })),
      top: cat.shows.slice(0, 20).map(slimShow),
      rows,
    };
  },
  'POST /api/tv/pc': (b) => command('streamer', { action: 'watch', query: String(b.title ?? '').slice(0, 200), service: String(b.service ?? '').slice(0, 40) }),
  // web (Weber on the PC)
  'GET /api/web': () => command('weber', { action: 'tabs' }),
  'POST /api/web': (b) => {
    if (b.action === 'open') return command('weber', { action: 'open', query: String(b.query ?? '').slice(0, 2000), newTab: true });
    if (b.action === 'switch' || b.action === 'close') return command('weber', { action: b.action, value: Number(b.id) || 0 });
    throw new Error('Unknown web action');
  },
};
function slimShow(s) {
  const svc = SERVICES[s.service];
  // the show's own page on its service when known (opens that service's iPhone app), else a search there
  const link = s.site && svc && new URL(s.site).hostname.includes(new URL(svc[2]('x')).hostname.replace(/^www\./, '').split('.').slice(-2).join('.')) ? s.site : svc?.[2](s.name);
  return { id: s.id, name: s.name, service: s.service, serviceName: svc?.[0], color: svc?.[1], year: s.year, rating: s.rating, genres: s.genres?.slice(0, 3), poster: s.poster, summary: (s.summary || '').slice(0, 400), link };
}
// game art: web images pass through; art Gamer saved on the PC is served by the hub
function coverUrl(c) {
  if (!c) return null;
  if (/^https:\/\//.test(c)) return c;
  const m = /^nexus:\/\/app\/_data\/covers\/([\w.-]+)$/.exec(c);
  return m ? `/api/cover/${m[1]}` : null;
}

// ---------- static files, pairing page ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

// the pairing page is only shown on this PC itself, never through Tailscale
const viaTailscale = (req) => Object.keys(req.headers).some((h) => h.startsWith('tailscale-') || h === 'x-forwarded-for');
// A Home Screen app on iPhone doesn't share Safari's storage, so the page also shows a
// 6-digit code to type in. One use, 10 minutes; wrong tries count toward the lockout.
let pairCode = null;
const freshCode = () => {
  if (!pairCode || pairCode.until < Date.now()) pairCode = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + 10 * 60000 };
  return pairCode.code;
};
async function pairPage(req) {
  const code = freshCode();
  const host = config.publicUrl || 'https://<your-pc>.ts.net';
  const link = `${host}/#pair=${config.token}`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' } });
  return `<!doctype html><meta charset=utf-8><title>Pair your phone</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111116;color:#fff;font:15px system-ui}main{max-width:460px;text-align:center;padding:24px}img{border-radius:18px;background:#fff;padding:10px}p{color:#aaa;line-height:1.5}code{font-size:12px;word-break:break-all;color:#888}</style><main><h1>Pair your iPhone</h1><p>Already added Hub to your Home Screen? Open it and type this code:</p><div style="font:800 54px/1 system-ui;letter-spacing:.18em;margin:6px 0 22px">${code.slice(0, 3)} ${code.slice(3)}</div><p style="margin-bottom:10px">Works once, for 10 minutes. Or scan this with the iPhone camera:</p><img src="${qr}" alt="pairing code"><p>Then in Safari tap Share → <b>Add to Home Screen</b>.<br>Keep these private; they unlock the remote.</p><code>${config.publicUrl ? config.publicUrl : 'Tailscale address not set yet: run setup first'}</code></main>`;
}

const fails = new Map(); // ip -> { n, until }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => {
    if (res.headersSent) return res.end();
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  try {
    if (url.pathname === '/pair') {
      if (viaTailscale(req)) return send(404, 'Not found', 'text/plain');
      return send(200, await pairPage(req), 'text/html; charset=utf-8');
    }
    if (url.pathname.startsWith('/api/')) {
      const who = req.headers['tailscale-user-login'] || req.socket.remoteAddress;
      const f = fails.get(who);
      if (f && f.until > Date.now()) return send(429, { error: 'Too many tries. Wait a minute.' });
      if (url.pathname === '/api/pair/redeem' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) if ((raw += chunk).length > 200) return send(413, { error: 'Too large' });
        const given = String(JSON.parse(raw || '{}').code || '').replace(/\D/g, '');
        if (pairCode && pairCode.until > Date.now() && given.length === 6 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pairCode.code))) {
          pairCode = null;
          fails.delete(who);
          return send(200, { token: config.token });
        }
        const n = (f?.n ?? 0) + 1;
        fails.set(who, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        return send(403, { error: 'That code isn’t right, or it expired. Reload the pairing page on your PC.' });
      }
      if (!tokenOk(req.headers['x-hub-token'])) {
        const n = (f?.n ?? 0) + 1;
        fails.set(who, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        return send(401, { error: 'This phone is not paired.' });
      }
      fails.delete(who);
      const cover = /^\/api\/cover\/([\w.-]+)$/.exec(url.pathname);
      if (cover && req.method === 'GET') {
        const file = path.join(APPDATA, 'nexus-games', 'covers', cover[1]);
        return send(200, await fsp.readFile(file), MIME[path.extname(file)] ?? 'image/jpeg');
      }
      const fn = api[`${req.method} ${url.pathname}`];
      if (!fn) return send(404, { error: 'Not found' });
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 10_000) return send(413, { error: 'Too large' });
        }
        body = raw ? JSON.parse(raw) : {};
      }
      return send(200, (await fn(body)) ?? { ok: true });
    }
    // the app itself (no data in these files)
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(403, 'Forbidden', 'text/plain');
    const ext = path.extname(file);
    const bytes = await fsp.readFile(file); // read first, so a missing file can still get a clean 404
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'max-age=3600', ...SECURITY_HEADERS });
    res.end(bytes);
  } catch (e) {
    if (e.code === 'ENOENT') return send(404, { error: 'Not found' });
    send(500, { error: e.message });
  }
});
// ---------- cloud sync: Listener's library goes to Hub in the cloud, so the phone has it with the PC off ----------
async function syncListener() {
  if (!config.cloudUrl || !config.cloudToken) return;
  try {
    const lib = await sendTo('listener', { action: 'export' }, 180000);
    const r = await fetch(`${config.cloudUrl}/api/sync/listener`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.cloudToken}` }, body: JSON.stringify(lib) });
    console.log(`listener sync: ${r.status} (${lib.home.length} shelves, ${lib.liked.length} liked, ${lib.playlists.length} playlists)`);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') console.log('listener sync failed:', e.message);
  }
}
setTimeout(syncListener, 60000);
setInterval(syncListener, 30 * 60000);

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(path.join(DATA, 'hub.json'), JSON.stringify({ pid: process.pid, port: PORT }));
  console.log(`phone hub on http://127.0.0.1:${PORT} (pairing page: /pair)`);
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'Phone hub is already running.' : e.message);
  process.exit(0);
});
