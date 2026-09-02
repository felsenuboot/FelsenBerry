# The FelsenBerry v0.1.0 spin-out, folded back (2026-09-02)

On 2026-09-01 the engine was spun out as a standalone public repo (github.com/felsenuboot/FelsenBerry,
v0.1.0, MIT) to focus all work on "the engine". The team then kept building the real engine in place
(this repo's payloads: skills/agenda/survival/producer/decider/...), so the spin-out went stale after 6
commits. On 2026-09-02 the decision was made to have ONE repo named for the product: this repo was
renamed felcrew-mcp → FelsenBerry (history + issues preserved), and the spin-out's unique content was
folded in here verbatim for reference:

- README/CONTEXT/AGENTS/ROADMAP: the v1 product framing and design intent.
- docs/ARCHITECTURE, CHAINS, COOPERATION, PLAYBOOK: the execution-runtime design trilogy.
- src/planner.js + src/perception.js + test/lookahead.test.js: the look-ahead runtime slice
  (flag-gated ENGINE_LOOKAHEAD=1 design, mock-proven, never run live; see memory/roadmap).

Nothing here is wired into the live engine. Treat as design history; promote pieces deliberately.
