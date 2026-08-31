// graychat payload (inject via POST /eval, idempotent): routine chat -> gray tellraw
// with team-colored name, mimicking real chat "<[FEL] Name> text". Requires the bot
// to be a server op (cosmetic use only - user rule: DO NOT CHEAT).
// Passthrough (stays plain): slash commands, protocol ledger lines (DEPOT/USING/
// FREE/LEASE-BREAK/BASE/CLAIM/MAILBOX/HELLO/ROLE/TASK/OFFER), and messages starting
// with "!" (important announcement marker - "!" is stripped, rest sent white).
// Re-inject after every bot process restart (like idleguard). Remove: __graychat.restore()
if (globalThis.__graychat && globalThis.__graychat.restore) { try { globalThis.__graychat.restore(); } catch (e) {} }
const g = { enabled: true, sent: 0, passthrough: 0 };
globalThis.__graychat = g;
const origChat = bot.chat.bind(bot);
g.restore = () => { bot.chat = origChat; g.enabled = false; };
const myTeamColor = () => {
  try {
    for (const t of Object.values(bot.teams || {})) {
      const m = t.members || (t.membersMap ? Object.keys(t.membersMap) : []);
      if (m.includes(bot.username) && t.color && t.color !== "reset") return t.color;
    }
  } catch (e) {}
  return "white";
};
const PROTOCOL = /^(DEPOT |USING |FREE |LEASE-BREAK |BASE |CLAIM |MAILBOX|HELLO |ROLE |TASK |OFFER )/;
bot.chat = (msg) => {
  try {
    if (!g.enabled || typeof msg !== "string" || msg.startsWith("/")) { g.passthrough++; return origChat(msg); }
    if (msg.startsWith("!")) { g.passthrough++; return origChat(msg.slice(1).trim()); }
    if (PROTOCOL.test(msg)) { g.passthrough++; return origChat(msg); }
    // v3: relay via the local graybridge (RCON) — no bot op needed. Uses global
    // fetch (require is absent in the eval sandbox). Falls back to plain chat if
    // the bridge is down so no message is ever lost.
    const body = JSON.stringify({ name: bot.username, color: myTeamColor(), text: msg });
    fetch("http://127.0.0.1:3199/say", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(1500) : undefined,
    }).then((r) => { if (!r.ok) origChat(msg); }).catch(() => origChat(msg));
    g.sent++;
    return;
  } catch (e) { return origChat(msg); }
};
return { installed: true, version: 1, teamColor: myTeamColor() };
