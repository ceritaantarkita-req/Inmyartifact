const ARTIFACT_ID_RE = /^art_[A-Za-z0-9_-]{16,96}$/;
const LOCAL_ARTIFACT_ID_RE = /^artifact_[0-9a-f-]{36}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const ARTIFACT_RECONCILIATION_VERSION = '1.0.0';

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(`${name} must be an object`);
}

function assertArray(value, name, maxItems = 4096) {
  if (!Array.isArray(value) || value.length > maxItems) throw fail(`invalid ${name}`);
}

function assertRfc3339(value, name) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) throw fail(`invalid ${name}`);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateArtifact(artifact) {
  assertObject(artifact, 'artifact');
  if (typeof artifact.id !== 'string' || !LOCAL_ARTIFACT_ID_RE.test(artifact.id)) throw fail('invalid artifact.id');
  if (typeof artifact.digest !== 'string' || !DIGEST_RE.test(artifact.digest)) throw fail('invalid artifact.digest');
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) throw fail('invalid artifact.size');
  for (const field of ['mediaType', 'sensitivity', 'syncClass', 'producer', 'producerRevision']) {
    if (typeof artifact[field] !== 'string' || !artifact[field]) throw fail(`invalid artifact.${field}`);
  }
}

function validateBinding(binding) {
  assertObject(binding, 'binding');
  if (typeof binding.artifactId !== 'string' || !ARTIFACT_ID_RE.test(binding.artifactId)) throw fail('invalid binding.artifactId');
  if (typeof binding.localArtifactId !== 'string' || !LOCAL_ARTIFACT_ID_RE.test(binding.localArtifactId)) throw fail('invalid binding.localArtifactId');
  if (typeof binding.digest !== 'string' || !DIGEST_RE.test(binding.digest)) throw fail('invalid binding.digest');
  if (!Number.isSafeInteger(binding.size) || binding.size < 0) throw fail('invalid binding.size');
  for (const field of ['mediaType', 'ownerProduct', 'sensitivity', 'syncClass', 'producer', 'producerRevision']) {
    if (typeof binding[field] !== 'string' || !binding[field]) throw fail(`invalid binding.${field}`);
  }
  assertObject(binding.retention, 'binding.retention');
  if (!['PRODUCT_PIN', 'PRODUCT_LEASE'].includes(binding.retention.mode)) throw fail('invalid binding.retention.mode');
  if (binding.retention.authorityProduct !== binding.ownerProduct) throw fail('retention authority must equal artifact owner product');
  if (binding.retention.mode === 'PRODUCT_PIN') {
    if (binding.retention.leaseExpiresAt !== null) throw fail('PRODUCT_PIN must not have leaseExpiresAt');
  } else {
    assertRfc3339(binding.retention.leaseExpiresAt, 'binding.retention.leaseExpiresAt');
  }
}

function validateAudit(audit) {
  assertObject(audit, 'integrityAudit');
  assertArray(audit.missing, 'integrityAudit.missing');
  assertArray(audit.corrupt, 'integrityAudit.corrupt');
  assertArray(audit.orphan, 'integrityAudit.orphan');
  for (const item of [...audit.missing, ...audit.corrupt, ...audit.orphan]) {
    assertObject(item, 'integrityAudit item');
    if (typeof item.digest !== 'string' || !DIGEST_RE.test(item.digest)) throw fail('invalid integrityAudit digest');
  }
}

function finding({ code, severity, artifactId = null, digest = null, ownerProduct = null, action, detail }) {
  return { code, severity, artifactId, digest, ownerProduct, action, detail };
}

function retentionState(binding, observedAt) {
  if (binding.retention.mode === 'PRODUCT_PIN') return 'PINNED';
  return Date.parse(observedAt) >= Date.parse(binding.retention.leaseExpiresAt)
    ? 'LEASE_EXPIRED_REVIEW_REQUIRED'
    : 'LEASE_ACTIVE';
}

export function createArtifactReconciliationReport({ bindings, artifacts, integrityAudit, observedAt }) {
  assertArray(bindings, 'bindings', 4096);
  assertArray(artifacts, 'artifacts', 4096);
  assertRfc3339(observedAt, 'observedAt');
  validateAudit(integrityAudit);

  const artifactIds = new Set();
  const localIds = new Set();
  for (const binding of bindings) {
    validateBinding(binding);
    if (artifactIds.has(binding.artifactId)) throw fail('duplicate ecosystem artifactId');
    if (localIds.has(binding.localArtifactId)) throw fail('duplicate local artifact binding');
    artifactIds.add(binding.artifactId);
    localIds.add(binding.localArtifactId);
  }

  const artifactsById = new Map();
  for (const artifact of artifacts) {
    validateArtifact(artifact);
    if (artifactsById.has(artifact.id)) throw fail('duplicate local artifact id');
    artifactsById.set(artifact.id, artifact);
  }

  const missingDigests = new Set(integrityAudit.missing.map((item) => item.digest));
  const corruptDigests = new Set(integrityAudit.corrupt.map((item) => item.digest));
  const findings = [];
  const retained = [];

  for (const binding of bindings) {
    const artifact = artifactsById.get(binding.localArtifactId);
    const retention = retentionState(binding, observedAt);
    retained.push({
      artifactId: binding.artifactId,
      digest: binding.digest,
      ownerProduct: binding.ownerProduct,
      retentionState: retention,
    });

    if (!artifact) {
      findings.push(finding({
        code: 'BOUND_RECORD_MISSING',
        severity: 'BLOCKING',
        artifactId: binding.artifactId,
        digest: binding.digest,
        ownerProduct: binding.ownerProduct,
        action: 'RESTORE_OR_REBIND_REQUIRED',
        detail: 'The product-owned ecosystem binding points to a local Artifact record that is absent.',
      }));
      continue;
    }

    for (const field of ['digest', 'size', 'mediaType', 'sensitivity', 'syncClass', 'producer', 'producerRevision']) {
      if (artifact[field] !== binding[field]) {
        findings.push(finding({
          code: 'BINDING_DRIFT',
          severity: 'BLOCKING',
          artifactId: binding.artifactId,
          digest: binding.digest,
          ownerProduct: binding.ownerProduct,
          action: 'OWNER_RECONCILIATION_REQUIRED',
          detail: `Binding field ${field} differs from current Artifact source truth.`,
        }));
        break;
      }
    }

    if (missingDigests.has(binding.digest)) {
      findings.push(finding({
        code: 'BOUND_CONTENT_MISSING',
        severity: 'BLOCKING',
        artifactId: binding.artifactId,
        digest: binding.digest,
        ownerProduct: binding.ownerProduct,
        action: 'RESTORE_REQUIRED',
        detail: 'A retained ecosystem reference has no matching local content bytes.',
      }));
    } else if (corruptDigests.has(binding.digest)) {
      findings.push(finding({
        code: 'BOUND_CONTENT_CORRUPT',
        severity: 'BLOCKING',
        artifactId: binding.artifactId,
        digest: binding.digest,
        ownerProduct: binding.ownerProduct,
        action: 'RESTORE_OR_REPAIR_REQUIRED',
        detail: 'A retained ecosystem reference resolves to corrupt local content bytes.',
      }));
    }

    if (retention === 'LEASE_EXPIRED_REVIEW_REQUIRED') {
      findings.push(finding({
        code: 'LEASE_EXPIRED_OWNER_REVIEW',
        severity: 'REVIEW',
        artifactId: binding.artifactId,
        digest: binding.digest,
        ownerProduct: binding.ownerProduct,
        action: 'OWNER_REVIEW_NO_DELETE_AUTHORITY',
        detail: 'Lease expiry requests owner review but does not grant byte-deletion authority.',
      }));
    }
  }

  const boundLocalIds = new Set(bindings.map((binding) => binding.localArtifactId));
  for (const artifact of artifacts) {
    if (!boundLocalIds.has(artifact.id)) {
      findings.push(finding({
        code: 'UNBOUND_LOCAL_RECORD',
        severity: 'REVIEW',
        digest: artifact.digest,
        action: 'REVIEW_ONLY',
        detail: 'Local Artifact metadata exists without an ecosystem binding.',
      }));
    }
  }

  for (const orphan of integrityAudit.orphan) {
    findings.push(finding({
      code: 'ORPHAN_BLOB',
      severity: 'REVIEW',
      digest: orphan.digest,
      action: 'REVIEW_ONLY_NO_AUTO_DELETE',
      detail: 'Physical bytes are not referenced by current Artifact metadata; automatic deletion remains disabled.',
    }));
  }

  const blocking = findings.filter((item) => item.severity === 'BLOCKING').length;
  const review = findings.filter((item) => item.severity === 'REVIEW').length;
  const status = blocking > 0 ? 'RESTORE_OR_RECONCILE_REQUIRED' : review > 0 ? 'REVIEW_REQUIRED' : 'HEALTHY';

  return deepFreeze({
    reportVersion: ARTIFACT_RECONCILIATION_VERSION,
    observedAt,
    status,
    retainedReferencesIntact: blocking === 0,
    automaticDeletesAllowed: false,
    gcCandidates: [],
    counts: {
      bindings: bindings.length,
      localArtifacts: artifacts.length,
      blockingFindings: blocking,
      reviewFindings: review,
      integrityMissing: integrityAudit.missing.length,
      integrityCorrupt: integrityAudit.corrupt.length,
      integrityOrphans: integrityAudit.orphan.length,
    },
    retained,
    findings: clone(findings),
  });
}
