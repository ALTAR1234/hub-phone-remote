// Hub: phone remote for Listener, Gamer, Weber and Streamer on your PC.
const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- pairing: the QR link carries the token once; it's kept on this phone ----------
const pairMatch = /#pair=([0-9a-f]{64})/.exec(location.hash);
if (pairMatch) {
  localStorage.setItem('hub.token', pairMatch[1]);
  history.replaceState(null, '', location.pathname);
}
const token = () => localStorage.getItem('hub.token') || '';

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-hub-token': token(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    showPairing();
    throw new Error('Not paired');
  }
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}
const tap = (fn) => async (e) => {
  try {
    await fn(e);
  } catch (err) {
    if (err.message !== 'Not paired') toast(err.message);
  }
};

function sheet(html, wire) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  s.hidden = false;
  s.onclick = (e) => e.target === s && (s.hidden = true);
  wire?.(s);
}
const closeSheet = () => ($('#sheet').hidden = true);

// ---------- tabs ----------
let tab = localStorage.getItem('hub.tab') || 'music';
let musicTimer;
function go(name) {
  tab = name;
  localStorage.setItem('hub.tab', name);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  clearInterval(musicTimer);
  $('#view').scrollTop = 0;
  ({ music, games, tv, web })[name]();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));

function showPairing() {
  $('#tabs').hidden = true;
  $('#view').innerHTML = `<div class="pair"><div class="art">✦</div><h1>Pair this phone</h1>
    <p class="sub" style="margin:0">On your PC, open the Hub pairing page (or ask Jarvis to “show the phone pairing code”) and type the 6-digit code here.</p>
    <form class="field" id="pf" style="margin-top:8px"><input id="pcode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000" style="text-align:center;font-size:22px;letter-spacing:.2em"><button class="btn glow">Pair</button></form>
    <div class="sub" id="perr" style="margin:6px 0 0;color:#ff8aa8"></div></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    $('#perr').textContent = '';
    try {
      const r = await fetch('/api/pair/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#pcode').value }) });
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error(j.error || 'Try again');
      localStorage.setItem('hub.token', j.token);
      location.reload();
    } catch (err) {
      $('#perr').textContent = err.message;
    }
  };
}

// ---------- music (Listener) ----------
async function music() {
  const v = $('#view');
  v.innerHTML = `<h1>Music</h1>
    <div class="card now"><div class="art">♪</div><b id="m-title">…</b><small id="m-artist">Listener on your PC</small>
      <div class="ctrls"><button class="ctrl small" data-a="shuffle" aria-label="Shuffle">⤮</button><button class="ctrl" data-a="previous" aria-label="Previous">⏮</button><button class="ctrl big" id="m-play" data-a="toggle" aria-label="Play or pause">▶</button><button class="ctrl" data-a="next" aria-label="Next">⏭</button><button class="ctrl small" data-a="like" aria-label="Like">♥</button></div>
      <div class="vol">🔈<input type="range" id="m-vol" min="0" max="100" step="5" value="70" aria-label="Volume">🔊</div>
    </div>
    <h2>Play something</h2>
    <form class="field" id="m-form"><input id="m-q" placeholder="A song, artist or album" enterkeyhint="go" autocomplete="off"><button class="btn glow">Play</button></form>
    <div class="chips">${['Chill', 'Hype', 'Focus', 'Throwbacks', 'Sabrina Carpenter', 'Drake'].map((c) => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
  const render = (n) => {
    if (!$('#m-title')) return;
    $('#m-title').textContent = n.title || 'Nothing playing';
    $('#m-artist').textContent = n.artist || 'Pick something below';
    $('#m-play').textContent = n.playing ? '⏸' : '▶';
  };
  const refresh = () => api('/api/music').then(render).catch(() => {});
  v.querySelectorAll('[data-a]').forEach((b) => (b.onclick = tap(async () => {
    const r = await api('/api/music', { action: b.dataset.a });
    if (b.dataset.a === 'like') toast('Liked');
    else if (b.dataset.a === 'shuffle') toast('Shuffle toggled');
    render(r.title !== undefined ? r : await api('/api/music'));
  })));
  $('#m-vol').onchange = tap(() => api('/api/music', { action: 'volume', value: Number($('#m-vol').value) }));
  const play = tap(async (q) => {
    toast(`Playing ${q}…`);
    render(await api('/api/music', { action: 'play', query: q }));
  });
  $('#m-form').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#m-q').value.trim();
    if (q) play(q);
    $('#m-q').blur();
  };
  v.querySelectorAll('[data-q]').forEach((c) => (c.onclick = () => play(c.dataset.q)));
  refresh();
  musicTimer = setInterval(() => !document.hidden && refresh(), 5000);
}

// ---------- games (Gamer) ----------
async function games() {
  const v = $('#view');
  v.innerHTML = `<h1>Games</h1><p class="sub">Tap a game to start it on your PC.</p><div class="games" id="g-list"><div class="empty">Loading…</div></div>`;
  const { games: list } = await api('/api/games').catch((e) => ({ games: [], error: e.message }));
  $('#g-list').innerHTML = list.length
    ? list.map((g) => `<button class="game" data-id="${esc(g.id)}" style="${g.cover ? `background-image:url('${esc(g.cover)}${g.cover.startsWith('/api/') ? '' : ''}')` : ''}">${g.pinned ? '<i class="pin">PINNED</i>' : ''}<span>${esc(g.title)}</span></button>`).join('')
    : '<div class="empty">No games found in Gamer.</div>';
  // covers saved on the PC need the pairing token, so fetch them with it
  for (const b of v.querySelectorAll('.game')) {
    const g = list.find((x) => x.id === b.dataset.id);
    if (g?.cover?.startsWith('/api/')) {
      b.style.backgroundImage = '';
      fetch(g.cover, { headers: { 'x-hub-token': token() } }).then((r) => r.blob()).then((bl) => (b.style.backgroundImage = `url('${URL.createObjectURL(bl)}')`)).catch(() => {});
    }
    b.onclick = () =>
      sheet(`<h3>${esc(g.title)}</h3><p>${g.playtime ? `${(g.playtime / 3600).toFixed(1)} hours played` : 'Not played yet'} · ${esc(g.source || '')}</p><div class="acts"><button class="btn glow" id="g-go">Play on PC</button><button class="btn ghost" id="g-x">Cancel</button></div>`, (s) => {
        s.querySelector('#g-x').onclick = closeSheet;
        s.querySelector('#g-go').onclick = tap(async () => {
          await api('/api/games/launch', { id: g.id });
          closeSheet();
          toast(`Starting ${g.title} on your PC`);
        });
      });
  }
}

// ---------- TV (Streamer) ----------
async function tv() {
  const v = $('#view');
  v.innerHTML = `<h1>TV</h1><p class="sub">Shows open in their own iPhone app. Or play them on your PC.</p><div id="tv"><div class="empty">Loading…</div></div>`;
  const d = await api('/api/tv').catch(() => null);
  if (!d) return ($('#tv').innerHTML = '<div class="empty">Couldn’t reach Streamer’s list.</div>');
  const poster = (s) => `<button class="poster" data-show="${s.id}"><div class="p-art" style="background-image:url('${esc(s.poster)}')"></div><b>${esc(s.name)}</b></button>`;
  const all = [...d.top, ...d.rows.flatMap((r) => r.shows)];
  $('#tv').innerHTML =
    (d.continue.length
      ? `<h2>Continue watching</h2><div class="row">${d.continue.map((c, i) => `<button class="cont" style="--c:${c.color}" data-cont="${i}"><small>${esc(c.serviceName)}</small><b>${esc(c.title)}</b></button>`).join('')}</div>`
      : '') +
    `<h2>Top picks</h2><div class="row">${d.top.map(poster).join('')}</div>` +
    d.rows.map((r) => `<h2><i style="--c:${r.color}"></i>${esc(r.name)}</h2><div class="row">${r.shows.map(poster).join('')}</div>`).join('');
  v.querySelectorAll('[data-cont]').forEach((b) => (b.onclick = () => (location.href = d.continue[Number(b.dataset.cont)].url)));
  v.querySelectorAll('[data-show]').forEach((b) => {
    const s = all.find((x) => String(x.id) === b.dataset.show);
    b.onclick = () =>
      sheet(`<span class="tag" style="--c:${s.color}">${esc(s.serviceName)}</span><h3 style="margin-top:10px">${esc(s.name)}</h3><p>${[s.year, s.rating ? `★ ${s.rating}` : '', (s.genres || []).join(' · ')].filter(Boolean).join(' · ')}</p><p>${esc(s.summary)}</p>
        <div class="acts"><a class="btn glow" style="display:grid;place-items:center;text-decoration:none" href="${esc(s.link)}">Watch on iPhone</a><button class="btn ghost" id="t-pc">Play on PC</button></div>`, (sh) => {
        sh.querySelector('#t-pc').onclick = tap(async () => {
          await api('/api/tv/pc', { title: s.name, service: s.serviceName });
          closeSheet();
          toast(`Opening ${s.name} on your PC`);
        });
      });
  });
}

// ---------- web (Weber on the PC) ----------
async function web() {
  const v = $('#view');
  v.innerHTML = `<h1>Web</h1><p class="sub">Open sites in Weber on your PC.</p>
    <form class="field" id="w-form"><input id="w-q" placeholder="Search or type an address" enterkeyhint="go" autocomplete="off" autocapitalize="off"><button class="btn glow">Open</button></form>
    <div class="chips">${['youtube.com', 'netflix.com', 'reddit.com', 'github.com', 'espn.com'].map((c) => `<button class="chip" data-q="${c}">${c}</button>`).join('')}</div>
    <h2>Open on your PC</h2><div class="tabs-list" id="w-tabs"><div class="empty">Loading…</div></div>`;
  const load = async () => {
    const { tabs = [] } = await api('/api/web').catch(() => ({}));
    $('#w-tabs').innerHTML = tabs.filter((t) => t.url).length
      ? tabs.filter((t) => t.url).map((t) => `<div class="card wtab${t.active ? ' on' : ''}" data-id="${t.id}"><div><b>${esc(t.title)}</b><small>${esc(t.url)}</small></div><button class="x" data-close="${t.id}" aria-label="Close tab">✕</button></div>`).join('')
      : '<div class="empty">No pages open.</div>';
    v.querySelectorAll('.wtab').forEach((t) => (t.onclick = tap(async (e) => {
      if (e.target.dataset.close) await api('/api/web', { action: 'close', id: e.target.dataset.close });
      else await api('/api/web', { action: 'switch', id: t.dataset.id });
      load();
    })));
  };
  const open = tap(async (q) => {
    await api('/api/web', { action: 'open', query: q });
    toast('Opened on your PC');
    load();
  });
  $('#w-form').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#w-q').value.trim();
    if (q) open(q);
    $('#w-q').value = '';
    $('#w-q').blur();
  };
  v.querySelectorAll('[data-q]').forEach((c) => (c.onclick = () => open(c.dataset.q)));
  load();
}

// ---------- start ----------
if (!token()) showPairing();
else go(tab);
