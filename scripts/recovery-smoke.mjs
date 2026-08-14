import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ArtifactService, DEFAULT_LIMITS, initialState, validateState } from '../lib/artifact.mjs';
import { JsonStore } from '../lib/store.mjs';
import { ArtifactResolverPilot } from '../lib/resolver.mjs';
import {
  ArtifactResolverBindingRegistry,
  initialResolverRegistryState,
  validateResolverRegistryState,
} from '../lib/resolver-registry.mjs';
import { createArtifactReconciliationReport } from '../lib/reconciliation.mjs';

const ownerProduct = 'inmy-rnd';
const ecosystemArtifactId = 'art_recoverysmokepilot001';
const payload = Buffer.from('phase3-artifact-recovery-smoke-evidence');
const observedAt = '2026-08-14T09:00:00.000Z';

async function openRuntime(root) {
  const artifactStore = await new JsonStore(
    join(root, 'state.json'),
    initialState(),
    (state) => validateState(state, DEFAULT_LIMITS),
  ).init();
  const artifacts = await new ArtifactService(artifactStore, root, { limits: DEFAULT_LIMITS }).init();
  const registryStore = await new JsonStore(
    join(root, 'resolver-registry.json'),
    initialResolverRegistryState(),
    validateResolverRegistryState,
  ).init();
  const registry = new ArtifactResolverBindingRegistry(registryStore, artifacts, {
    now: () => new Date(observedAt),
  });
  return { artifacts, registry };
}

function bindingFor(artifact) {
  return {
    artifactId: ecosystemArtifactId,
    localArtifactId: artifact.id,
    digest: artifact.digest,
    size: artifact.size,
    mediaType: artifact.mediaType,
    ownerProduct,
    sensitivity: artifact.sensitivity,
    syncClass: artifact.syncClass,
    producer: artifact.producer,
    producerRevision: artifact.producerRevision,
    retention: {
      mode: 'PRODUCT_PIN',
      authorityProduct: ownerProduct,
      leaseExpiresAt: null,
    },
  };
}

function resolverFor(runtime) {
  return new ArtifactResolverPilot(runtime.artifacts, {
    schemaVersion: '1.0.0',
    mode: 'pilot-read-only',
    enabled: true,
    bindings: runtime.registry.resolverBindings(),
    grants: [{
      callerId: 'inmy-governance-recovery-smoke',
      operations: ['artifact.metadata.read', 'artifact.bytes.prepare'],
      ownerProducts: [ownerProduct],
      maxSensitivity: 'INTERNAL',
      allowedSyncClasses: ['LOCAL_ONLY'],
      maxArtifactBytes: 1024 * 1024,
    }],
  });
}

function reconcile(runtime, integrityAudit) {
  return createArtifactReconciliationReport({
    bindings: runtime.registry.resolverBindings(),
    artifacts: runtime.artifacts.list(),
    integrityAudit,
    observedAt,
  });
}

const temp = await mkdtemp(join(tmpdir(), 'inmyartifact-phase3-recovery-'));
const activeRoot = join(temp, 'active');
const backupRoot = join(temp, 'backup');
const restoredRoot = join(temp, 'restored');

try {
  const active = await openRuntime(activeRoot);
  const stored = await active.artifacts.ingest(Readable.from([payload]), {
    name: 'recovery-evidence.bin',
    mediaType: 'application/octet-stream',
    sensitivity: 'INTERNAL',
    syncClass: 'LOCAL_ONLY',
    producer: ownerProduct,
    producerRevision: 'recovery-smoke-v1',
  });
  await active.registry.register({ ownerProduct, binding: bindingFor(stored) });

  const beforeAudit = await active.artifacts.auditIntegrity();
  const beforeReport = reconcile(active, beforeAudit);
  if (!beforeAudit.ok || beforeReport.status !== 'HEALTHY' || !beforeReport.retainedReferencesIntact) {
    throw new Error('pre-backup reconciliation is not healthy');
  }

  const beforeResolver = resolverFor(active);
  const preparedBefore = await beforeResolver.prepareRead({
    callerId: 'inmy-governance-recovery-smoke',
    artifactId: ecosystemArtifactId,
  });
  if (!preparedBefore.integrity.verified || preparedBefore.digest !== stored.digest) {
    throw new Error('pre-backup resolver verification failed');
  }

  await cp(activeRoot, backupRoot, { recursive: true, errorOnExist: true, force: false });

  await writeFile(active.artifacts.pathFor(stored), Buffer.from('corrupt-active-copy'));
  const corruptAudit = await active.artifacts.auditIntegrity();
  const corruptReport = reconcile(active, corruptAudit);
  if (corruptAudit.ok || corruptReport.status !== 'RESTORE_OR_RECONCILE_REQUIRED') {
    throw new Error('corruption was not detected as restore-required');
  }
  if (!corruptReport.findings.some((item) => item.code === 'BOUND_CONTENT_CORRUPT')) {
    throw new Error('corrupt retained content finding missing');
  }
  if (corruptReport.automaticDeletesAllowed || corruptReport.gcCandidates.length !== 0) {
    throw new Error('corruption must not create delete authority');
  }

  await cp(backupRoot, restoredRoot, { recursive: true, errorOnExist: true, force: false });
  const restored = await openRuntime(restoredRoot);
  const restoredBinding = restored.registry.get(ecosystemArtifactId);
  if (!restoredBinding || restoredBinding.digest !== stored.digest) {
    throw new Error('restored persistent ecosystem binding mismatch');
  }

  const restoredAudit = await restored.artifacts.auditIntegrity();
  const restoredReport = reconcile(restored, restoredAudit);
  if (!restoredAudit.ok || restoredReport.status !== 'HEALTHY' || !restoredReport.retainedReferencesIntact) {
    throw new Error('restored reconciliation is not healthy');
  }

  const restoredResolver = resolverFor(restored);
  const preparedAfter = await restoredResolver.prepareRead({
    callerId: 'inmy-governance-recovery-smoke',
    artifactId: ecosystemArtifactId,
  });
  if (!preparedAfter.integrity.verified || preparedAfter.digest !== stored.digest) {
    throw new Error('restored resolver verification failed');
  }

  console.log(JSON.stringify({
    recoverySmoke: 'PASS',
    artifactId: ecosystemArtifactId,
    digest: stored.digest,
    preBackupStatus: beforeReport.status,
    corruptStatus: corruptReport.status,
    restoredStatus: restoredReport.status,
    retainedReferencePreserved: restoredBinding.artifactId === ecosystemArtifactId,
    automaticDeletesAllowed: restoredReport.automaticDeletesAllowed,
    gcCandidates: restoredReport.gcCandidates.length,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
