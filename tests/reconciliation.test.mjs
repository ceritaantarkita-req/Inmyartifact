import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ARTIFACT_RECONCILIATION_VERSION,
  createArtifactReconciliationReport,
} from '../lib/reconciliation.mjs';

const LOCAL_ID = 'artifact_11111111-1111-4111-8111-111111111111';
const LOCAL_ID_2 = 'artifact_22222222-2222-4222-8222-222222222222';
const ART_ID = 'art_0123456789abcdef';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const DIGEST_2 = `sha256:${'b'.repeat(64)}`;

function artifact(overrides = {}) {
  return {
    id: LOCAL_ID,
    digest: DIGEST,
    size: 128,
    mediaType: 'application/json',
    sensitivity: 'INTERNAL',
    syncClass: 'LOCAL_ONLY',
    producer: 'inmy-rnd',
    producerRevision: 'rev-001',
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    artifactId: ART_ID,
    localArtifactId: LOCAL_ID,
    digest: DIGEST,
    size: 128,
    mediaType: 'application/json',
    ownerProduct: 'inmy-rnd',
    sensitivity: 'INTERNAL',
    syncClass: 'LOCAL_ONLY',
    producer: 'inmy-rnd',
    producerRevision: 'rev-001',
    retention: {
      mode: 'PRODUCT_PIN',
      authorityProduct: 'inmy-rnd',
      leaseExpiresAt: null,
    },
    ...overrides,
  };
}

function audit(overrides = {}) {
  return {
    ok: true,
    expectedBlobs: 1,
    missing: [],
    corrupt: [],
    orphan: [],
    policy: 'records-persist-until-explicit-delete; blobs-persist-while-referenced; no-background-gc',
    ...overrides,
  };
}

function report(overrides = {}) {
  return createArtifactReconciliationReport({
    bindings: [binding()],
    artifacts: [artifact()],
    integrityAudit: audit(),
    observedAt: '2026-08-14T08:00:00.000Z',
    ...overrides,
  });
}

test('healthy pinned binding remains retained with zero GC candidates', () => {
  const result = report();
  assert.equal(result.reportVersion, ARTIFACT_RECONCILIATION_VERSION);
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.retainedReferencesIntact, true);
  assert.equal(result.automaticDeletesAllowed, false);
  assert.deepEqual(result.gcCandidates, []);
  assert.deepEqual(result.findings, []);
  assert.equal(result.retained[0].retentionState, 'PINNED');
  assert.ok(Object.isFrozen(result));
});

test('expired product lease requires owner review and never becomes delete authority', () => {
  const leased = binding({
    retention: {
      mode: 'PRODUCT_LEASE',
      authorityProduct: 'inmy-rnd',
      leaseExpiresAt: '2026-08-14T07:00:00.000Z',
    },
  });
  const result = report({ bindings: [leased] });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.retainedReferencesIntact, true);
  assert.equal(result.retained[0].retentionState, 'LEASE_EXPIRED_REVIEW_REQUIRED');
  assert.equal(result.findings[0].code, 'LEASE_EXPIRED_OWNER_REVIEW');
  assert.equal(result.findings[0].action, 'OWNER_REVIEW_NO_DELETE_AUTHORITY');
  assert.deepEqual(result.gcCandidates, []);
});

test('missing bound local record is blocking and preserves no-delete semantics', () => {
  const result = report({ artifacts: [] });
  assert.equal(result.status, 'RESTORE_OR_RECONCILE_REQUIRED');
  assert.equal(result.retainedReferencesIntact, false);
  assert.equal(result.findings[0].code, 'BOUND_RECORD_MISSING');
  assert.equal(result.findings[0].action, 'RESTORE_OR_REBIND_REQUIRED');
  assert.equal(result.automaticDeletesAllowed, false);
});

test('missing or corrupt retained bytes require restore and never GC', () => {
  const missing = report({
    integrityAudit: audit({ ok: false, missing: [{ digest: DIGEST, expectedSize: 128 }] }),
  });
  assert.equal(missing.status, 'RESTORE_OR_RECONCILE_REQUIRED');
  assert.equal(missing.findings.some((item) => item.code === 'BOUND_CONTENT_MISSING'), true);
  assert.deepEqual(missing.gcCandidates, []);

  const corrupt = report({
    integrityAudit: audit({
      ok: false,
      corrupt: [{ digest: DIGEST, expectedSize: 128, actualSize: 7, actual: DIGEST_2, reason: 'digest-mismatch' }],
    }),
  });
  assert.equal(corrupt.status, 'RESTORE_OR_RECONCILE_REQUIRED');
  assert.equal(corrupt.findings.some((item) => item.code === 'BOUND_CONTENT_CORRUPT'), true);
  assert.equal(corrupt.retainedReferencesIntact, false);
});

test('binding drift blocks reconciliation before any lifecycle action', () => {
  const result = report({ artifacts: [artifact({ producerRevision: 'rev-002' })] });
  assert.equal(result.status, 'RESTORE_OR_RECONCILE_REQUIRED');
  assert.equal(result.findings.some((item) => item.code === 'BINDING_DRIFT'), true);
  assert.equal(result.automaticDeletesAllowed, false);
});

test('unbound local records and orphan blobs are review-only', () => {
  const extra = artifact({ id: LOCAL_ID_2, digest: DIGEST_2, size: 64, producerRevision: 'rev-002' });
  const result = report({
    artifacts: [artifact(), extra],
    integrityAudit: audit({ orphan: [{ digest: `sha256:${'c'.repeat(64)}`, size: 42 }] }),
  });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.retainedReferencesIntact, true);
  assert.equal(result.findings.some((item) => item.code === 'UNBOUND_LOCAL_RECORD'), true);
  assert.equal(result.findings.some((item) => item.code === 'ORPHAN_BLOB'), true);
  assert.deepEqual(result.gcCandidates, []);
});

test('reconciliation validation rejects duplicate binding identities and invalid timestamps', () => {
  assert.throws(() => report({ bindings: [binding(), binding()] }), /duplicate ecosystem artifactId/);
  assert.throws(() => report({ observedAt: 'not-a-time' }), /observedAt/);
  assert.throws(() => report({
    bindings: [binding({ retention: { mode: 'PRODUCT_PIN', authorityProduct: 'inmy-hub', leaseExpiresAt: null } })],
  }), /retention authority/);
});

test('reconciliation source has no filesystem, network, environment or process execution primitive', async () => {
  const source = await readFile(new URL('../lib/reconciliation.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram',
    'node:child_process', 'process.env', 'fetch(', 'spawn(', 'execFile(', 'readFile(', 'writeFile(', 'rm(', 'rename(',
  ]) {
    assert.equal(source.includes(forbidden), false, `reconciliation source contains forbidden primitive: ${forbidden}`);
  }
});

test('published reconciliation schema pins no automatic delete authority', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/artifact-reconciliation-report-v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.reportVersion.const, '1.0.0');
  assert.equal(schema.properties.automaticDeletesAllowed.const, false);
  assert.equal(schema.properties.gcCandidates.maxItems, 0);
  assert.deepEqual(schema.properties.status.enum, [
    'HEALTHY',
    'REVIEW_REQUIRED',
    'RESTORE_OR_RECONCILE_REQUIRED',
  ]);
});
