import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const essai = String(process.env.ESSAI || '').toLowerCase() === 'true';
const webhook = process.env.DISCORD_WEBHOOK || '';
const depot = process.env.GITHUB_REPOSITORY;
const donnees = JSON.parse(readFileSync('updates.json', 'utf8'));
const cfg = donnees.discord || {};

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function existe(tag) {
  try { gh(['release', 'view', tag, '--repo', depot, '--json', 'tagName']); return true; } catch { return false; }
}

const chrono = donnees.updates.map((u, i) => ({ u, i })).sort((a, b) => (a.u.date === b.u.date ? b.i - a.i : a.u.date < b.u.date ? -1 : 1));
const vus = {};
for (const { u } of chrono) {
  if (u.tag) continue;
  const base = u.version ? 'v' + u.version : u.date;
  vus[base] = (vus[base] || 0) + 1;
  u.tag = vus[base] > 1 ? base + '-' + vus[base] : base;
}

function corps(u) {
  if (u.body) return u.body.trim();
  return (u.items || []).map(t => '- ' + t).join('\n');
}

function nomRelease(u) {
  return (cfg.release || '{title}').replace('{title}', u.title).replace('{version}', u.version || '').replace(/\s+/g, ' ').trim();
}

function mention(u) {
  const p = u.ping !== undefined ? u.ping : cfg.ping;
  if (!p) return { texte: '', parse: [], roles: [] };
  if (p === 'everyone') return { texte: '||@everyone||', parse: ['everyone'], roles: [] };
  const id = String(p).replace(/[^0-9]/g, '');
  return { texte: '||<@&' + id + '>||', parse: [], roles: [id] };
}

function message(u, url) {
  const m = mention(u);
  const titre = (cfg.heading || '# {title} {ping}')
    .replace('{title}', u.title).replace('{ping}', m.texte).replace('{version}', u.version || '')
    .replace(/[ \t]+/g, ' ').trim();
  const lien = '-# [Release notes on GitHub](<' + url + '>)';
  return { texte: titre + '\n' + corps(u) + '\n\n' + lien, m };
}

function decouper(texte) {
  const morceaux = [];
  let courant = '';
  for (const bloc of texte.split(/\n(?=#{1,3} |\*\*)/)) {
    const ajout = (courant ? '\n' : '') + bloc;
    if ((courant + ajout).length > 1950 && courant) { morceaux.push(courant); courant = bloc; }
    else courant += ajout;
  }
  if (courant) morceaux.push(courant);
  return morceaux.flatMap(x => x.length <= 1990 ? [x] : x.match(/[\s\S]{1,1990}/g));
}

async function poster(u, url) {
  const { texte, m } = message(u, url);
  const parts = decouper(texte);
  if (essai || !webhook) {
    console.log('--- message ' + u.tag + ' (' + parts.length + ' partie(s), essai) ---\n' + parts.join('\n[...]\n'));
    return;
  }
  for (const [i, contenu] of parts.entries()) {
    const r = await fetch(webhook + '?wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contenu, allowed_mentions: i === 0 ? { parse: m.parse, roles: m.roles } : { parse: [] } })
    });
    if (!r.ok) throw new Error('Discord ' + r.status + ' ' + (await r.text()).slice(0, 300));
  }
  console.log('poste sur Discord : ' + u.tag);
}

const nouveaux = chrono.map(x => x.u).filter(u => !existe(u.tag));
console.log('versions sans release : ' + (nouveaux.map(u => u.tag).join(', ') || 'aucune'));

if (essai) {
  const dernier = chrono[chrono.length - 1].u;
  await poster(dernier, 'https://github.com/' + depot + '/releases/tag/' + dernier.tag);
} else {
  for (const u of nouveaux) {
    writeFileSync('notes.md', corps(u) + '\n');
    gh(['release', 'create', u.tag, '--repo', depot, '--title', nomRelease(u), '--notes-file', 'notes.md', '--target', process.env.GITHUB_SHA || 'main']);
    const url = 'https://github.com/' + depot + '/releases/tag/' + u.tag;
    console.log('release creee : ' + url);
    await poster(u, url);
  }
}
