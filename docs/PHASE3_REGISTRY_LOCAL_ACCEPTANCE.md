# Phase 3 Persistent Resolver Registry — Local Exact-Head Acceptance

Status: V2.x Phase 3 persistent product-owned binding registry checkpoint.

This runbook validates the next InMyArtifact candidate after the accepted read-only resolver foundation.

It does not authorize ecosystem adoption, Hub registration, resolver byte writes/deletes, retention enforcement, background expiry processing or GC.

## Accepted prior checkpoint

```text
repository: ceritaantarkita-req/Inmyartifact
standalone base: 7879db9965032bd260ed3e7c6736d1632dd0a710
accepted read-only resolver head: d2ef3aea4948b3a019fbb60947b838896f6ab53a
branch: agent/v2x-phase3-artifact-resolver-pilot-20260814
```

## Exact-head command

```bash
set -euo pipefail

REPO="$HOME/projects/Inmyartifact"
BRANCH="agent/v2x-phase3-artifact-resolver-pilot-20260814"
BASE="d2ef3aea4948b3a019fbb60947b838896f6ab53a"
EXPECTED="<exact-candidate-head>"

[ -d "$REPO/.git" ] || {
  echo "STOP: Inmyartifact clone not found at $REPO"
  exit 1
}

cd "$REPO"
git fetch origin --prune

REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

echo "=== PHASE 3 ARTIFACT REGISTRY EXACT HEAD ==="
echo "expected: $EXPECTED"
echo "remote:   $REMOTE_HEAD"

[ "$REMOTE_HEAD" = "$EXPECTED" ] || {
  echo "STOP: Phase 3 Artifact branch changed"
  exit 1
}

git cat-file -e "$BASE^{commit}"

QA_DIR="/tmp/inmyartifact-phase3-registry-${EXPECTED:0:12}"
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
  'contracts/artifact-resolver-registry-v1.schema.json',
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
INMYARTIFACT_ECOSYSTEM_ENABLED=1 node server.mjs >/tmp/inmyartifact-phase3-registry-ecosystem-disabled.log 2>&1
ECOSYSTEM_CODE=$?
set -e
cat /tmp/inmyartifact-phase3-registry-ecosystem-disabled.log
[ "$ECOSYSTEM_CODE" -ne 0 ] || {
  echo "STOP: ecosystem-enabled standalone server unexpectedly started"
  exit 1
}
grep -q "Ecosystem connection is intentionally disabled" /tmp/inmyartifact-phase3-registry-ecosystem-disabled.log || {
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
echo "INMYARTIFACT PHASE 3 PERSISTENT RESOLVER REGISTRY CANDIDATE PASS"
echo "HEAD: $EXPECTED"
echo "BASE: $BASE"
echo "READ-ONLY RESOLVER FOUNDATION: RETAINED"
echo "PERSISTENT BINDING REGISTRY: CANDIDATE PASS"
echo "LEASE EXPIRY BYTE DELETE AUTHORITY: NONE"
echo "ECOSYSTEM CONNECTION: DISABLED"
echo "HUB AUTHORITY: NOT STARTED"
echo "RETENTION ENFORCEMENT / GC: NOT STARTED"
echo "PHASE 3: IN PROGRESS"
echo "========================================================"
```

## Expected candidate-specific coverage

The accepted read-only resolver checkpoint reported 30 tests. This registry slice adds 10 registry-specific tests, so an unchanged suite is expected to report **40 tests total**.

Do not weaken assertions to force that number. If the total differs, inspect the exact test list.

Registry-specific coverage includes:

- persistent restart survival through the validated store;
- owner-only binding registration;
- current Artifact source-truth matching before registration;
- duplicate ecosystem/local binding rejection;
- bounded registry capacity;
- owner-only pin/lease updates;
- active lease evaluation;
- expired lease -> review-required, never GC authority;
- durable product-pin semantics;
- persistent bindings feeding the accepted read-only resolver;
- strict state validation and ownership/retention invariants;
- source guard against network/environment/process/direct filesystem primitives;
- strict registry schema publication.

## Result semantics

A clean run means only:

```text
PHASE3_PERSISTENT_BINDING_REGISTRY = CANDIDATE_PASS
```

It does not mean:

```text
INMYARTIFACT_ECOSYSTEM_ADOPTED = true
HUB_ARTIFACT_AUTHORITY_ENABLED = true
ARTIFACT_RETENTION_ENFORCED = true
ARTIFACT_GC_ENABLED = true
V2X_PHASE3 = CLOSED
```
