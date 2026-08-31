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
const g = { version: 3, enabled: true, sent: 0, passthrough: 0, logged: 0, logFailed: 0 };
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
    if (msg.startsWith("!")) { g.passthrough++; return origChat(msg.slice(1).trim()); }
    if (PROTOCOL.test(msg)) { g.passthrough++; return origChat(msg); }
    if (msg.startsWith("@")) { toChat(msg.slice(1).trim()); return; }
    toLog(msg);
    return;
  } catch (e) { return origChat(msg); }
};
return { installed: true, version: 3, teamColor: myTeamColor(), teamTag: myTeamTag(),
         tiers: { log: "(default)", interaction: "@", important: "!", protocol: "regex", command: "/" } };
