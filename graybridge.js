#!/usr/bin/env node
// graybridge — RCON relay for fleet-wide gray chat (CAVECREW method, zero bot ops).
// Bots' graychat.js POSTs {name,color,text} to 127.0.0.1:3199/say; this bridge
// sends the formatted /tellraw via RCON. Password: bots/.rcon (chmod 600).
// Start: setsid nohup node graybridge.js >> logs/graybridge.log 2>&1 &
'use strict';
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RCON_HOST = '100.101.197.44';
const RCON_PORT = 25575;
const HTTP_PORT = 3199;
const PASS_FILE = path.join(__dirname, '.rcon');

let sock = null, authed = false, nextId = 1;
const cmdQueue = [];
let draining = false;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

function packet(type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(nextId++, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

function connect() {
  let pass;
  try { pass = fs.readFileSync(PASS_FILE, 'utf8').trim(); } catch (e) {
    log('no .rcon password file yet — retrying in 15s'); setTimeout(connect, 15000); return;
  }
  sock = net.createConnection(RCON_PORT, RCON_HOST);
  let acc = Buffer.alloc(0);
  sock.on('connect', () => { log('tcp connected, authenticating'); sock.write(packet(3, pass)); });
  sock.on('data', (d) => {
    acc = Buffer.concat([acc, d]);
    while (acc.length >= 4) {
      const len = acc.readInt32LE(0);
      if (acc.length < 4 + len) break;
      const id = acc.readInt32LE(4);
      const type = acc.readInt32LE(8);
      acc = acc.subarray(4 + len);
      if (!authed && type === 2) {
        if (id === -1) { log('AUTH FAILED — wrong password in .rcon'); sock.destroy(); return; }
        authed = true; log('rcon authenticated'); drain();
      }
    }
  });
  sock.on('error', (e) => log('rcon error: ' + e.message));
  sock.on('close', () => { authed = false; sock = null; log('rcon closed, reconnect in 5s'); setTimeout(connect, 5000); });
}

function drain() {
  if (draining || !authed || !sock) return;
  draining = true;
  const step = () => {
    if (!authed || !sock || cmdQueue.length === 0) { draining = false; return; }
    try { sock.write(packet(2, cmdQueue.shift())); } catch (e) { log('write failed: ' + e.message); }
    setTimeout(step, 120); // gentle rate limit
  };
  step();
}

// ---------- Discord sink (the LOG tier's destination) ----------
// graychat v3 routes routine narration OUT of Minecraft chat; it lands in each bot's local
// log and here, so Felix gets one activity feed. Discord webhooks rate-limit around 30
// requests/minute, so we NEVER post per line: buffer everything and flush at most one
// combined message every FLUSH_MS (12/min worst case). The webhook URL lives in bots/.discord
// (gitignored, same handling as .rcon); until that file exists this is a no-op that still
// answers 200, so bots never fall back to spamming chat.
const DISCORD_FILE = path.join(__dirname, '.discord');
const FLUSH_MS = 5000;
const QUEUE_CAP = 200;        // drop-oldest beyond this; a backlog is never worth memory
const DISCORD_MAX = 1900;     // Discord's limit is 2000; leave room for the join separators
let logQueue = [];
let hookUrl = null, hookMtime = 0, hookChecked = 0;
let backoffUntil = 0;
const stats = { queued: 0, posted: 0, mocked: 0, dropped: 0, failed: 0, flushes: 0 };

function webhook() {
  // re-read on mtime change so the URL can be dropped in without restarting the bridge
  const now = Date.now();
  if (now - hookChecked < 5000) return hookUrl;
  hookChecked = now;
  try {
    const st = fs.statSync(DISCORD_FILE);
    if (st.mtimeMs !== hookMtime) {
      const raw = fs.readFileSync(DISCORD_FILE, 'utf8').trim();
      hookMtime = st.mtimeMs;
      hookUrl = /^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(raw) ? raw : null;
      log(hookUrl ? 'discord webhook loaded' : 'discord file present but not a webhook URL — ignoring');
    }
  } catch (e) { hookUrl = null; }
  return hookUrl;
}

async function flushLogs() {
  stats.flushes++;
  if (!logQueue.length || Date.now() < backoffUntil) return;
  const url = webhook();
  const batch = logQueue;
  logQueue = [];
  let content = batch.map((e) => `**${e.name}** ${e.text}`).join('  —  ');
  if (content.length > DISCORD_MAX) content = content.slice(0, DISCORD_MAX - 3) + '...';
  if (!url) {
    // MOCK MODE — no webhook configured yet. Log the exact payload that WOULD have been
    // posted so the batching can be verified before Felix drops the real URL in .discord.
    stats.mocked += batch.length;
    log(`discord[mock] would post ${batch.length} line(s): ${content.slice(0, 300)}`);
    return;
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (r.status === 429) {
      const retry = Number(r.headers.get('retry-after') || 5);
      backoffUntil = Date.now() + Math.min(60000, retry * 1000);
      stats.failed++;
      log(`discord 429 — backing off ${retry}s`);
    } else if (!r.ok) { stats.failed++; log('discord post failed: ' + r.status); }
    else stats.posted += batch.length;
  } catch (e) { stats.failed++; log('discord post error: ' + e.message); }
}
setInterval(() => { flushLogs().catch(() => {}); }, FLUSH_MS);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { name, text } = JSON.parse(body);
        if (typeof name !== 'string' || typeof text !== 'string' || !text.trim()) throw new Error('bad input');
        logQueue.push({ name: name.slice(0, 24), text: text.slice(0, 200) });
        stats.queued++;
        if (logQueue.length > QUEUE_CAP) { logQueue.splice(0, logQueue.length - QUEUE_CAP); stats.dropped++; }
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad'); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/say') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { name, color, text, tag } = JSON.parse(body);
        if (typeof name !== 'string' || typeof text !== 'string' || name.length > 24 || !/^[A-Za-z_]{3,16}$/.test(color || 'gray')) throw new Error('bad input');
        const t = text.length > 220 ? text.slice(0, 217) + '...' : text;
        // Per-crew tag (default "[FEL] " for backward compat / bots not yet sending one).
        // Bracket-and-letters-and-spaces only, short cap — this lands inside a JSON text
        // component (JSON.stringify below escapes it properly either way, this is just
        // sane-formatting hygiene, not an injection concern).
        const safeTag = (typeof tag === 'string' && tag.length > 0 && tag.length <= 12 && /^[[\]A-Za-z0-9 ]+$/.test(tag)) ? tag : '[FEL] ';
        const json = JSON.stringify([
          { text: '<', color: 'gray' },
          { text: safeTag + name, color: color || 'white' },
          { text: '> ', color: 'gray' },
          { text: t, color: 'gray' },
        ]);
        if (cmdQueue.length < 100) cmdQueue.push('tellraw @a ' + json);
        drain();
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad'); }
    });
  } else if (req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ authed, queued: cmdQueue.length, discord: { configured: Boolean(webhook()), pending: logQueue.length, ...stats } }));
  } else { res.writeHead(404); res.end(); }
}).listen(HTTP_PORT, '127.0.0.1', () => log('graybridge http on 127.0.0.1:' + HTTP_PORT));

connect();
