// graychat v3 payload (inject via POST /eval, idempotent) — THE CHAT DIET.
//
// Minecraft chat was drowning in routine narration, so v3 sorts every bot.chat() into
// four tiers by prefix. The default changed: an unprefixed line no longer goes to chat.
//
//   (no prefix)  LOG         -> NOT in game chat. Local log + the Discord activity feed.
//   "@..."       INTERACTION -> gray bridge chat, "@" stripped. For talking TO someone.
//   "!..."       IMPORTANT   -> plain white chat, "!" stripped. Deaths, panics, done.
//   DEPOT/... etc PROTOCOL   -> plain white passthrough. The machine-readable ledger.
//   "/..."       COMMAND     -> plain passthrough, untouched.
//
// The point of the default: skills' ctx.say and idle-guard chatter become log-tier with
// ZERO skill changes, while anything a human or another crew needs to see is one
// character away. If you want it in chat, say so with "@" or "!".
//
// Re-inject after every bot process restart (like idleguard). Remove: __graychat.restore()
if (globalThis.__graychat && globalThis.__graychat.restore) { try { globalThis.__graychat.restore(); } catch (e) {} }
const g = { version: 4, enabled: true, sent: 0, passthrough: 0, logged: 0, logFailed: 0,
  deduped: 0, rateLimited: 0 };
// CHAT THROTTLE (v4). Five idle bots narrating a no-op every 30s put 20+ identical lines
// into public chat back to back, in front of players and an allied crew. The no-op messages
// themselves are fixed at the source, but a chat layer that will relay ANY repetition given
// to it is the reason a narration bug becomes a public incident — so the floor belongs here,
// where it covers every future caller rather than the two we just found.
// Two independent guards, both deliberately dumb and deterministic:
//   DEDUP     — the same exact line from the same bot inside DEDUP_MS is dropped.
//   RATE CAP  — at most RATE_MAX chat-tier lines per RATE_MS, whatever they say.
// Applies ONLY to the human-facing tiers. PROTOCOL lines are a machine-readable ledger that
// other crews parse (a dropped DEPOT line is a lost transaction) and "/" is a command, so
// both bypass this entirely.
const DEDUP_MS = 60000;
const RATE_MS = 30000;
const RATE_MAX = 8;
const recent = new Map();          // text -> last-sent ms
let windowStart = 0, windowCount = 0;
const throttled = (text) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > DEDUP_MS) recent.delete(k);
  const last = recent.get(text);
  if (last != null && now - last < DEDUP_MS) { g.deduped++; return true; }
  if (now - windowStart > RATE_MS) { windowStart = now; windowCount = 0; }
  if (windowCount >= RATE_MAX) { g.rateLimited++; return true; }
  recent.set(text, now);
  windowCount++;
  return false;
};
globalThis.__graychat = g;
const origChat = bot.chat.bind(bot);
g.restore = () => { bot.chat = origChat; g.enabled = false; };
// Find this bot's own real Minecraft team (via /team join <team> <bot>), if any.
const myTeam = () => {
  try {
    for (const t of Object.values(bot.teams || {})) {
      const m = t.members || (t.membersMap ? Object.keys(t.membersMap) : []);
      if (m.includes(bot.username)) return t;
    }
  } catch (e) {}
  return null;
};
const myTeamColor = () => {
  const t = myTeam();
  return (t && t.color && t.color !== "reset") ? t.color : "white";
};
// v2: per-crew tag (e.g. "[ENG] " for engineer test bots vs the default "[FEL] ")
// read from the bot's real team prefix — team-lead's spec: readable client-side
// from bot.teams entry's prefix.text (a JSON text component); some mineflayer
// versions may hand back a plain string instead, so accept both shapes.
const myTeamTag = () => {
  try {
    const t = myTeam();
    const p = t && t.prefix;
    if (typeof p === "string" && p.trim()) return p;
    if (p && typeof p.text === "string" && p.text.trim()) return p.text;
  } catch (e) {}
  return "[FEL] "; // fallback — matches graybridge's own default
};
const PROTOCOL = /^(DEPOT |USING |FREE |LEASE-BREAK |BASE |CLAIM |MAILBOX |HELLO |ROLE |TASK |OFFER |TRADE )/;
const TIMEOUT = () => ((typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(1500) : undefined);
// INTERACTION tier: gray tellraw via the local graybridge (RCON — no bot op needed).
// Falls back to plain chat if the bridge is down, so a message meant for chat is never lost.
const toChat = (text) => {
  const body = JSON.stringify({ name: bot.username, color: myTeamColor(), text, tag: myTeamTag() });
  fetch("http://127.0.0.1:3199/say", {
    method: "POST", headers: { "Content-Type": "application/json" }, body, signal: TIMEOUT(),
  }).then((r) => { if (!r.ok) origChat(text); }).catch(() => origChat(text));
  g.sent++;
};
// LOG tier: the bot's own stdout (runner redirects it to logs/<name>.log) plus the
// graybridge Discord sink, which batches. Deliberately NO chat fallback — a log line
// failing to reach Discord must not leak back into the chat we just cleaned up.
const toLog = (text) => {
  try { console.log(`[${new Date().toISOString()}] [${bot.username}] <say> ${text}`); } catch (e) {}
  try {
    fetch("http://127.0.0.1:3199/log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: bot.username, text }), signal: TIMEOUT(),
    }).catch(() => { g.logFailed++; });
  } catch (e) { g.logFailed++; }
  g.logged++;
};
bot.chat = (msg) => {
  try {
    if (!g.enabled || typeof msg !== "string") return origChat(msg);
    if (msg.startsWith("/")) { g.passthrough++; return origChat(msg); }
    // PROTOCOL before the throttle: a ledger line is data, not narration
    if (PROTOCOL.test(msg)) { g.passthrough++; return origChat(msg); }
    if (msg.startsWith("!")) {
      const body = msg.slice(1).trim();
      if (throttled(body)) { toLog(`[throttled] ${body}`); return; }
      g.passthrough++; return origChat(body);
    }
    if (msg.startsWith("@")) {
      const body = msg.slice(1).trim();
      if (throttled(body)) { toLog(`[throttled] ${body}`); return; }
      toChat(body); return;
    }
    toLog(msg);
    return;
  } catch (e) { return origChat(msg); }
};
return { installed: true, version: 4, dedupMs: DEDUP_MS, rateMax: RATE_MAX, rateMs: RATE_MS,
  teamColor: myTeamColor(), teamTag: myTeamTag(),
         tiers: { log: "(default)", interaction: "@", important: "!", protocol: "regex", command: "/" } };
