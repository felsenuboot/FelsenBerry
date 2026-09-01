#!/bin/zsh
# bench/preflight.sh <port> — the agenda pre-flight, meant to be run on the SOAK BOT itself
# right after it comes up on a new stack and BEFORE committing to a multi-hour run.
#
# It executes nothing in the world: every case goes through __agenda.step()'s dry-run hook or
# stubs __skills.start, and each fixture restores the fields it touches. Safe on a live bot.
#
# What it is actually for: catching payload drift and stale injection in about a second. A bot
# can report the right versions in /state and still be running a half-injected stack; these
# cases exercise the real predicates, so they fail loudly when the ladder is not what you think.
# stack-check runs FIRST and checks PRESENCE, because the behavioural fixtures stub
# __skills.start and would otherwise pass green on a bot where `produce` was never installed.
set -e
PORT="${1:-3110}"
cd "$(dirname "$0")/.."
python3 - "$PORT" <<'PY'
import json, sys, urllib.request
port = sys.argv[1]
total = passed = 0
for f in ['stack-check', 'tier-choice', 'move-detect', 'agenda-ladder', 'agenda-deepkit', 'agenda-resume', 'assert-produce']:
    code = open('bench/fixtures/%s.js' % f).read()
    req = urllib.request.Request('http://127.0.0.1:%s/eval' % port,
                                 data=json.dumps({'code': code}).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=180))
    except Exception as e:
        print('%-18s UNREACHABLE %s' % (f, e)); sys.exit(1)
    if not r.get('ok'):
        print('%-18s EVAL ERROR %s' % (f, r.get('error'))); sys.exit(1)
    d = r['result']
    if d.get('skipped'):
        print('%-18s SKIPPED (%s)' % (f, d['skipped'])); continue
    if 'firePassed' in d:
        p, n, bad = d['firePassed'] + d['actPassed'], len(d['fire']) + len(d['acts']), d['failures']
    else:
        p, n, bad = d['passed'], len(d['cases']), d.get('failed') or []
    total += n; passed += p
    print('%-18s %2d/%2d %s' % (f, p, n, bad if bad else ''))
print('PRE-FLIGHT: %d/%d' % (passed, total))
sys.exit(0 if passed == total else 1)
PY
