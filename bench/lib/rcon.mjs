#!/usr/bin/env node
// bench/lib/rcon.mjs — minimal RCON client for fixture setup/teardown.
// Usage: node rcon.mjs <host> <port> <password> <command...>
// One command per invocation (fixtures call this per /setblock etc — simple > fast).
import net from 'node:net';

const [, , host, portStr, password, ...cmdParts] = process.argv;
const port = parseInt(portStr, 10);
const command = cmdParts.join(' ');
if (!host || !port || !password || !command) {
  console.error('usage: rcon.mjs <host> <port> <password> <command...>');
  process.exit(2);
}

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

const sock = net.createConnection(port, host);
let acc = Buffer.alloc(0);
let authed = false;
const timer = setTimeout(() => { console.error('rcon timeout'); process.exit(1); }, 8000);

sock.on('connect', () => sock.write(packet(1, 3, password)));
sock.on('data', (d) => {
  acc = Buffer.concat([acc, d]);
  while (acc.length >= 4) {
    const len = acc.readInt32LE(0);
    if (acc.length < 4 + len) break;
    const id = acc.readInt32LE(4);
    const body = acc.subarray(12, 4 + len - 2).toString('utf8');
    acc = acc.subarray(4 + len);
    if (!authed) {
      if (id === -1) { console.error('AUTH FAILED'); clearTimeout(timer); process.exit(1); }
      authed = true;
      sock.write(packet(2, 2, command));
    } else {
      console.log(body);
      clearTimeout(timer);
      sock.end();
      process.exit(0);
    }
  }
});
sock.on('error', (e) => { console.error('rcon error: ' + e.message); clearTimeout(timer); process.exit(1); });
