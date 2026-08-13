# InMyArtifact zero-cost exact-head local acceptance

Status: **OPERATOR RUNBOOK**

GitHub-hosted Actions is not the default acceptance path while paid-hosted runner/billing constraints apply. The workflow is manual-only. Final standalone evidence should come from a clean exact-head Ubuntu WSL/local worktree following the governance `ZERO_COST_CI_EVIDENCE_POLICY.md`.

## Required evidence

Record:

- exact repository, branch and HEAD SHA;
- clean pre-test and post-test worktree;
- Ubuntu/WSL identity;
- Node and npm versions;
- `git diff --check`;
- JS/MJS syntax checks;
- `npm test` result and test count;
- `npm run smoke` result;
- explicit ecosystem-enabled startup fail-closed result;
- SHA-256 hashes of evidence logs.

## Acceptance commands

Run from the normal WSL clone after the final candidate head is pinned:

```bash
cd ~/projects/Inmyartifact
git fetch origin --prune

HEAD_SHA="$(git rev-parse origin/agent/fullstack-foundation-20260811)"
QA_DIR="/tmp/inmyartifact-qa-${HEAD_SHA:0:12}"
EVIDENCE_DIR="/tmp/inmyartifact-evidence-${HEAD_SHA:0:12}"

if git worktree list --porcelain | grep -q "$QA_DIR"; then
  git worktree remove --force "$QA_DIR"
fi
rm -rf "$QA_DIR" "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"

git worktree add --detach "$QA_DIR" "$HEAD_SHA"
cd "$QA_DIR"

git rev-parse HEAD | tee "$EVIDENCE_DIR/head.txt"
git status --porcelain | tee "$EVIDENCE_DIR/pre-test-git-status.txt"

{
  grep '^PRETTY_NAME=' /etc/os-release || true
  uname -a
  node --version
  npm --version
} | tee "$EVIDENCE_DIR/environment.txt"

set -o pipefail

git diff --check origin/main...HEAD 2>&1 | tee "$EVIDENCE_DIR/diff-check.log"
printf '%s\n' "${PIPESTATUS[0]}" > "$EVIDENCE_DIR/diff-check.exitcode"

find . -type f \( -name '*.js' -o -name '*.mjs' \) -not -path './node_modules/*' -print0 \
  | while IFS= read -r -d '' file; do node --check "$file" || exit 1; done \
  2>&1 | tee "$EVIDENCE_DIR/syntax.log"
printf '%s\n' "${PIPESTATUS[1]}" > "$EVIDENCE_DIR/syntax.exitcode"

npm test 2>&1 | tee "$EVIDENCE_DIR/npm-test.log"
printf '%s\n' "${PIPESTATUS[0]}" > "$EVIDENCE_DIR/npm-test.exitcode"

npm run smoke 2>&1 | tee "$EVIDENCE_DIR/smoke.log"
printf '%s\n' "${PIPESTATUS[0]}" > "$EVIDENCE_DIR/smoke.exitcode"

set +e
timeout 5s env INMYARTIFACT_ECOSYSTEM_ENABLED=1 node server.mjs \
  >"$EVIDENCE_DIR/ecosystem-disabled.log" 2>&1
GUARD_CODE=$?
set -e
printf '%s\n' "$GUARD_CODE" > "$EVIDENCE_DIR/ecosystem-disabled.exitcode"
cat "$EVIDENCE_DIR/ecosystem-disabled.log"

git status --porcelain | tee "$EVIDENCE_DIR/post-test-git-status.txt"

(
  cd "$EVIDENCE_DIR"
  sha256sum * | tee SHA256SUMS.txt
)
```

## Required interpretation

Acceptance requires:

```text
exact HEAD matches the pinned candidate
pre-test worktree = clean
git diff --check = 0
syntax = 0
npm test = 0
npm run smoke = 0
ecosystem-enabled startup = non-zero and immediate
expected fail-closed message present
post-test worktree = clean
```

The expected standalone guard message is:

```text
Ecosystem connection is intentionally disabled in standalone v0.1
```

Do not call the hosted workflow a PASS unless it actually runs. Do not rerun provider-blocked hosted workflows merely to obtain a green badge.

## Classification after a complete PASS

```text
LOCAL_WORKFLOW_EQUIVALENT_CI = PASS
INMYARTIFACT_STANDALONE_FOUNDATION = candidate_for_closure
GitHub-hosted Actions = NOT_USED_FOR_ACCEPTANCE
INMYARTIFACT_ECOSYSTEM_CONNECTION = DISABLED
INMYARTIFACT_INTEGRATION = prepared_not_connected
```

Standalone closure still requires final source review, dated governance evidence, product merge and tested-tree/merged-tree verification. It does not authorize the later V2.x resolver/CAS pilot.
