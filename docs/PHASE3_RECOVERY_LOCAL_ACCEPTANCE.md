# Phase 3 Reconciliation & Recovery — Local Exact-Head Acceptance

Status: V2.x Phase 3 backup/restore/reconciliation and corruption-recovery candidate checkpoint.

This runbook validates the exact InMyArtifact candidate head in clean Ubuntu/WSL without relying on GitHub-hosted Actions.

It does not authorize ecosystem adoption, Hub registration, automatic GC or byte deletion on lease expiry.

## Baseline

```text
repository: ceritaantarkita-req/Inmyartifact
accepted persistent-registry base: 4abcadba43fb75fd0cd778f0a97f9b9ebcc38268
branch: agent/v2x-phase3-artifact-resolver-pilot-20260814
```

## Exact-head command

```bash
set -euo pipefail

REPO="$HOME/projects/Inmyartifact"
BRANCH="agent/v2x-phase3-artifact-resolver-pilot-20260814"
BASE="4abcadba43fb75fd0cd778f0a97f9b9ebcc38268"
EXPECTED="<exact-candidate-head>"

[ -d "$REPO/.git" ] || {
  echo "STOP: Inmyartifact clone not found at $REPO"
  exit 1
}

cd "$REPO"
git fetch origin --prune

REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

echo "=== PHASE 3 ARTIFACT RECOVERY EXACT HEAD ==="
echo "expected: $EXPECTED"
echo "remote:   $REMOTE_HEAD"

[ "$REMOTE_HEAD" = "$EXPECTED" ] || {
  echo "STOP: Phase 3 Artifact branch changed"
  exit 1
}

git cat-file -e "$BASE^{commit}"

QA_DIR="/tmp/inmyartifact-phase3-recovery-${EXPECTED:0:12}"
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
  'contracts/artifact-reconciliation-report-v1.schema.json',
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
INMYARTIFACT_ECOSYSTEM_ENABLED=1 node server.mjs >/tmp/inmyartifact-phase3-recovery-ecosystem-disabled.log 2>&1
ECOSYSTEM_CODE=$?
set -e
cat /tmp/inmyartifact-phase3-recovery-ecosystem-disabled.log
[ "$ECOSYSTEM_CODE" -ne 0 ] || {
  echo "STOP: ecosystem-enabled standalone server unexpectedly started"
  exit 1
}
grep -q "Ecosystem connection is intentionally disabled" /tmp/inmyartifact-phase3-recovery-ecosystem-disabled.log || {
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
echo "INMYARTIFACT PHASE 3 RECONCILIATION / RECOVERY CANDIDATE PASS"
echo "HEAD: $EXPECTED"
echo "BASE: $BASE"
echo "READ-ONLY RESOLVER FOUNDATION: RETAINED"
echo "PERSISTENT BINDING REGISTRY: RETAINED"
echo "COLD BACKUP / RESTORE: PASS"
echo "CORRUPTION DETECTION / RECOVERY: PASS"
echo "AUTOMATIC DELETE AUTHORITY: NONE"
echo "GC CANDIDATES: NONE"
echo "ECOSYSTEM CONNECTION: DISABLED"
echo "HUB AUTHORITY: NOT STARTED"
echo "PHASE 3: IN PROGRESS"
echo "========================================================"
```

## Expected candidate-specific coverage

The accepted persistent-registry base had 40 tests. This slice adds 9 reconciliation-specific regressions, so an unchanged suite is expected to report **49 tests total**.

`npm run qa` also executes:

```text
standalone smoke: PASS
recovery smoke: PASS
```

The recovery smoke must show:

```text
preBackupStatus = HEALTHY
corruptStatus = RESTORE_OR_RECONCILE_REQUIRED
restoredStatus = HEALTHY
retainedReferencePreserved = true
automaticDeletesAllowed = false
gcCandidates = 0
```

Do not weaken assertions merely to force these expected values.

## Acceptance meaning

A clean run means only:

```text
PHASE3_BACKUP_RESTORE_RECONCILIATION = CANDIDATE_PASS
PHASE3_CORRUPTION_RECOVERY = CANDIDATE_PASS
```

It does not mean:

```text
ARTIFACT_GC_ENABLED = true
RETENTION_DELETE_AUTHORITY = true
INMYARTIFACT_ECOSYSTEM_ADOPTED = true
V2X_PHASE3 = CLOSED
```
