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

http.createServer((req, res) => {
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
    res.writeHead(200); res.end(JSON.stringify({ authed, queued: cmdQueue.length }));
  } else { res.writeHead(404); res.end(); }
}).listen(HTTP_PORT, '127.0.0.1', () => log('graybridge http on 127.0.0.1:' + HTTP_PORT));

connect();
