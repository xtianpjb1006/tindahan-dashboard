// Store dashboard on GitHub Pages: fetches data/summary.json (encrypted by the POS), decrypts it on this phone and
// shows today's numbers at a glance. View only. Refreshes every 5 minutes; the POS sends a new summary every 5 minutes
// to the repo's "data" branch (not the Pages branch), read through the GitHub API (raw file as a fallback).
import { decryptEnvelope, decryptWithKey } from './crypto.js';

const app = document.getElementById('app');
const staleMin = (s) => (s.everyMin ?? 60) + 15; // the POS's own update time (5, 15, 30 or 60 min) + 15 min of slack
const KEEP = 'tpos-dashboard-key'; // "Remember on this phone": the derived key + salt, never the passphrase
const peso = (c) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (c) => (c >= 100000000 ? `₱${(c / 100000000).toFixed(1)}M` : c >= 100000 ? `₱${(c / 100000).toFixed(c >= 1000000 ? 0 : 1)}k` : `₱${Math.round(c / 100)}`);
const time = (iso) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
const dayName = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PAY = { cash: 'Cash', gcash: 'GCash', qr: 'QR Ph', card: 'Card / Tap', utang: 'Utang' };
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let key = null; let keySalt = null;
// On GitHub Pages (owner.github.io/repo/) the data comes from the "data" branch; anywhere else (a local test) from data/.
const gh = location.hostname.endsWith('.github.io') ? { owner: location.hostname.split('.')[0], repo: location.pathname.split('/')[1] } : null;
async function fetchEnvelope() {
  const t = Date.now();
  let r = await fetch(gh ? `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/data/summary.json?ref=data&t=${t}` : `data/summary.json?t=${t}`,
    { cache: 'no-store', headers: gh ? { Accept: 'application/vnd.github.raw+json' } : {} });
  if (gh && (r.status === 403 || r.status === 429)) // API limit (60 an hour per internet address) → the raw file, up to 5 min older
    r = await fetch(`https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/data/data/summary.json?t=${t}`, { cache: 'no-store' });
  if (gh && r.status === 404) r = await fetch(`data/summary.json?t=${t}`, { cache: 'no-store' }); // a POS from before 2026-10-26 still sends here
  if (r.status === 404) throw new Error('No data yet — the POS sends its first summary within 5 minutes after you turn the online dashboard on.');
  if (!r.ok) throw new Error(`Could not load the data (${r.status}). Check your internet.`);
  return r.json();
}

function render(s) {
  const d = s.today; const lw = s.lastWeek;
  const diff = lw.total ? Math.round(((d.total - lw.total) / lw.total) * 100) : null;
  const ageMin = (Date.now() - new Date(s.generatedAt)) / 60000;
  const max = Math.max(1, ...s.week.map((w) => w.total));
  const pays = Object.entries(s.payments).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const a = s.alerts;
  app.innerHTML = `
    <div class="top"><h1>${esc(s.store)}</h1><span class="asof">As of ${time(s.generatedAt)}${s.date !== new Date().toLocaleDateString('en-CA') ? `, ${esc(s.date)}` : ''}</span></div>
    ${ageMin > staleMin(s) ? `<div class="banner warn" role="status">⚠ Not updated for ${ageMin > 120 ? `${Math.round(ageMin / 60)} hours` : `${Math.round(ageMin)} minutes`} — the POS may be closed or offline. These are the numbers from ${time(s.generatedAt)}.</div>` : ''}
    <section class="card hero">
      <h2>Sales today</h2>
      <div class="big num">${peso(d.total)}</div>
      <div class="sub">${d.count} sale${d.count === 1 ? '' : 's'} · ${diff == null ? 'none by this time last week' : `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}%</span> vs same time last ${dayName(s.week[6].date)} (${peso(lw.total)})`}</div>
      ${s.load.total ? `<div class="sub">+ Load ${peso(s.load.total)} (${s.load.count})</div>` : ''}
    </section>
    ${s.profit ? `<section class="card stat">
      <h2>Profit today</h2>
      <div class="v num${s.profit.profit < 0 ? ' down' : ''}">${peso(s.profit.profit)}</div>
      <div class="s">${s.profit.revenue ? `${(s.profit.margin / 100).toFixed(1)}% margin on ${peso(s.profit.revenue)} sales with cost` : 'No sales with cost yet today'}${s.profit.uncosted ? ` · ${peso(s.profit.uncosted)} without cost not counted` : ''}</div>
    </section>` : ''}
    <section class="card">
      <h2>Last 7 days</h2>
      <div class="bars" role="img" aria-label="Sales per day: ${s.week.map((w) => `${dayName(w.date)} ${peso(w.total)}`).join(', ')}">
        ${s.week.map((w, i) => `<div class="bar${i === 6 ? ' today' : ''}"><b class="num">${short(w.total)}</b><i style="height:${Math.round((w.total / max) * 100)}%"></i><span>${i === 6 ? 'Today' : dayName(w.date)}</span></div>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>Paid by (today)</h2>
      <div class="rows">${pays.length ? pays.map(([m, v]) => `<div class="row"><span>${PAY[m] ?? esc(m)}</span><span class="num">${peso(v)}</span></div>`).join('') : '<p class="muted">No sales yet today.</p>'}</div>
    </section>
    <section class="card">
      <h2>Stock</h2>
      <div class="chips">
        ${a.out ? `<span class="chip err">✕ ${a.out} out of stock</span>` : ''}
        ${a.low ? `<span class="chip warn">! ${a.low} low</span>` : ''}
        ${a.expiring ? `<span class="chip warn">! ${a.expiring} expiring soon</span>` : ''}
        ${!a.out && !a.low && !a.expiring ? '<span class="chip ok">✓ Nothing low or out</span>' : ''}
      </div>
    </section>
    <div class="grid2">
      <section class="card stat"><h2>GCash float</h2><div class="v num">${peso(s.floats.gcash ?? 0)}</div></section>
      <section class="card stat"><h2>Maya float</h2><div class="v num">${peso(s.floats.maya ?? 0)}</div></section>
    </div>
    <section class="card">
      <h2>Utang</h2>
      <div class="stat"><div class="v num ${s.utang.total ? 'utang' : ''}">${peso(s.utang.total)}</div><div class="s">${s.utang.customers} customer${s.utang.customers === 1 ? ' owes' : 's owe'}</div></div>
      ${s.utang.top.length ? `<div class="rows" style="margin-top:8px">${s.utang.top.map((c) => `<div class="row"><span>${esc(c.name)}</span><span class="num">${peso(c.balance)}</span></div>`).join('')}</div>` : ''}
    </section>
    <section class="card">
      <h2>Shift</h2>
      <p style="margin:0">${s.shift.open ? `<span class="chip ok">● Open</span> since ${time(s.shift.since)} · ${esc(s.shift.by)} · ${s.shift.sales} sale${s.shift.sales === 1 ? '' : 's'}` : '<span class="chip warn">No shift open</span>'}</p>
    </section>
    <section class="card">
      <h2>Latest sales</h2>
      <div class="rows">${s.recent.length ? s.recent.map((r) => `<div class="row${r.voided ? ' voided' : ''}"><span class="num">${time(r.at)} · No. ${String(r.number).padStart(6, '0')}${r.voided ? ' (voided)' : ''}</span><span class="num">${peso(r.total)} <span class="muted">${r.methods.map((m) => PAY[m] ?? m).join(' + ')}</span></span></div>`).join('') : '<p class="muted">No sales yet.</p>'}</div>
    </section>
    <div class="foot"><span>Updates every hour from the POS · this page checks every 5 min</span><button type="button" id="lock">Lock</button></div>`;
  document.getElementById('lock').onclick = () => { try { localStorage.removeItem(KEEP); } catch {} location.reload(); };
}

function showError(text) {
  const msg = document.getElementById('unlock-msg');
  if (msg) msg.textContent = text;
  else app.insertAdjacentHTML('afterbegin', `<div class="banner warn" role="alert">⚠ ${esc(text)}</div>`);
}

async function refresh() {
  try {
    const env = await fetchEnvelope();
    if (env.salt !== keySalt) { try { localStorage.removeItem(KEEP); } catch {} location.reload(); return; } // passphrase changed in the POS
    render(await decryptWithKey(env, key));
  } catch (e) { showError(e.message); }
}

async function start(summary) {
  render(summary);
  setInterval(refresh, 5 * 60000);
}

document.getElementById('unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = document.getElementById('pass').value;
  document.getElementById('unlock-msg').textContent = 'Opening…';
  try {
    const env = await fetchEnvelope();
    let out;
    try { out = await decryptEnvelope(env, pass); } catch (err) { if (/format/.test(err.message)) throw err; throw new Error('Wrong passphrase — try again.'); }
    key = out.key; keySalt = env.salt;
    if (document.getElementById('remember').checked) {
      try { localStorage.setItem(KEEP, JSON.stringify({ salt: env.salt, key: b64(await crypto.subtle.exportKey('raw', key)) })); } catch {}
    }
    start(out.summary);
  } catch (err) { document.getElementById('unlock-msg').textContent = err.message; }
});

// Remembered on this phone: open straight away.
(async () => {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(KEEP) || 'null'); } catch {}
  if (!kept) return document.getElementById('pass').focus();
  try {
    const env = await fetchEnvelope();
    if (env.salt !== kept.salt) throw new Error('changed');
    key = await crypto.subtle.importKey('raw', unb64(kept.key), { name: 'AES-GCM' }, true, ['decrypt']);
    keySalt = env.salt;
    start(await decryptWithKey(env, key));
  } catch (e) {
    try { localStorage.removeItem(KEEP); } catch {}
    document.getElementById('unlock-msg').textContent = e.message === 'changed' ? 'The passphrase was changed in the POS — type the new one.' : e.message;
  }
})();
