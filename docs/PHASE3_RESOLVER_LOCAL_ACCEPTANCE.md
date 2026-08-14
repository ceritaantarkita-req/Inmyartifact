# Phase 3 Resolver Pilot — Local Exact-Head Acceptance

Status: initial V2.x Phase 3 read-only resolver foundation checkpoint.

This runbook validates the exact InMyArtifact candidate head in clean Ubuntu/WSL without relying on GitHub-hosted Actions.

It does not authorize ecosystem adoption, Hub registration, resolver writes, retention enforcement or GC.

## Baseline

```text
repository: ceritaantarkita-req/Inmyartifact
base main: 7879db9965032bd260ed3e7c6736d1632dd0a710
branch: agent/v2x-phase3-artifact-resolver-pilot-20260814
```

## Exact-head command

```bash
set -euo pipefail

REPO="$HOME/projects/Inmyartifact"
BRANCH="agent/v2x-phase3-artifact-resolver-pilot-20260814"
BASE="7879db9965032bd260ed3e7c6736d1632dd0a710"
EXPECTED="<exact-candidate-head>"

[ -d "$REPO/.git" ] || {
  echo "STOP: Inmyartifact clone not found at $REPO"
  exit 1
}

cd "$REPO"
git fetch origin --prune

REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

echo "=== PHASE 3 ARTIFACT RESOLVER EXACT HEAD ==="
echo "expected: $EXPECTED"
echo "remote:   $REMOTE_HEAD"

[ "$REMOTE_HEAD" = "$EXPECTED" ] || {
  echo "STOP: Phase 3 Artifact branch changed"
  exit 1
}

git cat-file -e "$BASE^{commit}"

QA_DIR="/tmp/inmyartifact-phase3-resolver-${EXPECTED:0:12}"
git worktree remove --force "$QA_DIR" 2>/dev/null || true
rm -rf "$QA_DIR"
git worktree add --detach "$QA_DIR" "$EXPECTED"
cd "$QA_DIR"

echo "=== DIFF CHECK ==="
git diff --check "$BASE...$EXPECTED"

echo "=== CONTRACT PARSE ==="
node - <<'NODE'
const fs = require('node:fs')
for (const file of [
  'contracts/artifact-ref-v1.schema.json',
  'contracts/artifact-resolver-pilot-v1.schema.json',
  'contracts/inmy-product-manifest.json',
]) {
  JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`${file}: JSON PASS`)
}
NODE

echo "=== FULL QA ==="
npm run qa

echo "=== ECOSYSTEM SERVER MUST STILL FAIL CLOSED ==="
set +e
INMYARTIFACT_ECOSYSTEM_ENABLED=1 node server.mjs >/tmp/inmyartifact-phase3-ecosystem-disabled.log 2>&1
ECOSYSTEM_CODE=$?
set -e
cat /tmp/inmyartifact-phase3-ecosystem-disabled.log
[ "$ECOSYSTEM_CODE" -ne 0 ] || {
  echo "STOP: ecosystem-enabled standalone server unexpectedly started"
  exit 1
}
grep -q "Ecosystem connection is intentionally disabled" /tmp/inmyartifact-phase3-ecosystem-disabled.log || {
  echo "STOP: expected ecosystem fail-closed reason not found"
  exit 1
}

echo "=== POST-QA WORKTREE ==="
STATUS="$(git status --short)"
printf '%s\n' "$STATUS"
[ -z "$STATUS" ] || {
  echo "STOP: QA modified the candidate worktree"
  exit 1
}

echo "========================================================"
echo "INMYARTIFACT PHASE 3 READ-ONLY RESOLVER FOUNDATION CANDIDATE PASS"
echo "HEAD: $EXPECTED"
echo "BASE: $BASE"
echo "ECOSYSTEM CONNECTION: DISABLED"
echo "HUB AUTHORITY: NOT STARTED"
echo "RESOLVER WRITE PATH: NOT STARTED"
echo "RETENTION ENFORCEMENT / GC: NOT STARTED"
echo "PHASE 3: IN PROGRESS"
echo "========================================================"
```

## Expected candidate-specific coverage

The accepted standalone base previously had 19 tests. This first resolver slice adds 11 resolver-specific regressions while retaining the integration-boundary test, so an unchanged suite is expected to report **30 tests total**.

Do not weaken assertions merely to force that number. If the total differs, inspect the exact test list and reason before accepting the run.

Resolver-specific checks cover:

- default-disabled activation;
- `art_...` identity separate from digest identity;
- no digest-based resolution API;
- exact caller/operation/owner authorization;
- sensitivity cap;
- sync-class cap;
- per-artifact byte quota;
- binding-drift failure;
- product ownership/provenance/retention descriptor;
- fail-closed integrity preparation;
- no filesystem/local-record exposure;
- strict bounded configuration;
- product-owned retention intent;
- resolver source guard against network/environment/process/filesystem primitives;
- strict resolver schema publication.

## Result semantics

A clean run means only:

```text
PHASE3_RESOLVER_READONLY_FOUNDATION = CANDIDATE_PASS
```

It does not mean:

```text
INMYARTIFACT_ECOSYSTEM_ADOPTED = true
HUB_ARTIFACT_AUTHORITY_ENABLED = true
ARTIFACT_GC_ENABLED = true
V2X_PHASE3 = CLOSED
```
