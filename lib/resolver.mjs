const ARTIFACT_ID_RE = /^art_[A-Za-z0-9_-]{16,96}$/;
const LOCAL_ARTIFACT_ID_RE = /^artifact_[0-9a-f-]{36}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const PRINCIPAL_RE = /^[A-Za-z0-9._:-]{2,120}$/;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const ARTIFACT_RESOLVER_PILOT_VERSION = '1.0.0';
export const ARTIFACT_RESOLVER_PILOT_MODE = 'pilot-read-only';
export const ARTIFACT_RESOLVER_OPERATIONS = Object.freeze([
  'artifact.metadata.read',
  'artifact.bytes.prepare',
]);

const OPERATIONS = new Set(ARTIFACT_RESOLVER_OPERATIONS);
const SENSITIVITY = Object.freeze(['PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED']);
const SENSITIVITY_RANK = new Map(SENSITIVITY.map((value, index) => [value, index]));
const SYNC_CLASSES = new Set(['LOCAL_ONLY', 'SYNC_ENCRYPTED', 'CLOUD_ALLOWED', 'PUBLIC']);
const RETENTION_MODES = new Set(['PRODUCT_PIN', 'PRODUCT_LEASE']);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(`${name} must be an object`);
}

function assertExactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw fail(`${name} contains unknown or missing fields`);
  }
}

function assertPrincipal(value, name) {
  if (typeof value !== 'string' || !PRINCIPAL_RE.test(value)) throw fail(`invalid ${name}`);
}

function assertUniqueStrings(values, allowed, name, maxItems) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maxItems) throw fail(`invalid ${name}`);
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || (allowed && !allowed.has(value)) || seen.has(value)) throw fail(`invalid ${name}`);
    seen.add(value);
  }
}

function assertRfc3339(value, name) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) throw fail(`invalid ${name}`);
}

function validateRetention(retention, ownerProduct) {
  assertObject(retention, 'binding.retention');
  assertExactKeys(retention, ['mode', 'authorityProduct', 'leaseExpiresAt'], 'binding.retention');
  if (!RETENTION_MODES.has(retention.mode)) throw fail('invalid binding.retention.mode');
  assertPrincipal(retention.authorityProduct, 'binding.retention.authorityProduct');
  if (retention.authorityProduct !== ownerProduct) throw fail('retention authority must equal artifact owner product');
  if (retention.mode === 'PRODUCT_PIN') {
    if (retention.leaseExpiresAt !== null) throw fail('PRODUCT_PIN must not have leaseExpiresAt');
  } else {
    assertRfc3339(retention.leaseExpiresAt, 'binding.retention.leaseExpiresAt');
  }
}

function validateBinding(binding) {
  assertObject(binding, 'binding');
  assertExactKeys(binding, [
    'artifactId', 'localArtifactId', 'digest', 'size', 'mediaType', 'ownerProduct',
    'sensitivity', 'syncClass', 'producer', 'producerRevision', 'retention',
  ], 'binding');
  if (typeof binding.artifactId !== 'string' || !ARTIFACT_ID_RE.test(binding.artifactId)) throw fail('invalid binding.artifactId');
  if (typeof binding.localArtifactId !== 'string' || !LOCAL_ARTIFACT_ID_RE.test(binding.localArtifactId)) throw fail('invalid binding.localArtifactId');
  if (typeof binding.digest !== 'string' || !DIGEST_RE.test(binding.digest)) throw fail('invalid binding.digest');
  if (!Number.isSafeInteger(binding.size) || binding.size < 0 || binding.size > 100 * 1024 * 1024) throw fail('invalid binding.size');
  if (typeof binding.mediaType !== 'string' || !MEDIA_TYPE_RE.test(binding.mediaType)) throw fail('invalid binding.mediaType');
  assertPrincipal(binding.ownerProduct, 'binding.ownerProduct');
  if (!SENSITIVITY_RANK.has(binding.sensitivity)) throw fail('invalid binding.sensitivity');
  if (!SYNC_CLASSES.has(binding.syncClass)) throw fail('invalid binding.syncClass');
  if (typeof binding.producer !== 'string' || binding.producer.length < 1 || binding.producer.length > 120) throw fail('invalid binding.producer');
  if (typeof binding.producerRevision !== 'string' || binding.producerRevision.length < 1 || binding.producerRevision.length > 200) throw fail('invalid binding.producerRevision');
  validateRetention(binding.retention, binding.ownerProduct);
}

function validateGrant(grant) {
  assertObject(grant, 'grant');
  assertExactKeys(grant, ['callerId', 'operations', 'ownerProducts', 'maxSensitivity', 'allowedSyncClasses', 'maxArtifactBytes'], 'grant');
  assertPrincipal(grant.callerId, 'grant.callerId');
  assertUniqueStrings(grant.operations, OPERATIONS, 'grant.operations', 2);
  assertUniqueStrings(grant.ownerProducts, null, 'grant.ownerProducts', 32);
  for (const owner of grant.ownerProducts) assertPrincipal(owner, 'grant.ownerProducts item');
  if (!SENSITIVITY_RANK.has(grant.maxSensitivity)) throw fail('invalid grant.maxSensitivity');
  assertUniqueStrings(grant.allowedSyncClasses, SYNC_CLASSES, 'grant.allowedSyncClasses', 4);
  if (!Number.isSafeInteger(grant.maxArtifactBytes) || grant.maxArtifactBytes < 0 || grant.maxArtifactBytes > 100 * 1024 * 1024) {
    throw fail('invalid grant.maxArtifactBytes');
  }
}

export function validateResolverPilotConfig(config) {
  assertObject(config, 'resolver config');
  assertExactKeys(config, ['schemaVersion', 'mode', 'enabled', 'bindings', 'grants'], 'resolver config');
  if (config.schemaVersion !== ARTIFACT_RESOLVER_PILOT_VERSION) throw fail('unsupported resolver schemaVersion');
  if (config.mode !== ARTIFACT_RESOLVER_PILOT_MODE) throw fail('unsupported resolver mode');
  if (typeof config.enabled !== 'boolean') throw fail('resolver enabled must be boolean');
  if (!Array.isArray(config.bindings) || config.bindings.length > 256) throw fail('invalid resolver bindings');
  if (!Array.isArray(config.grants) || config.grants.length > 256) throw fail('invalid resolver grants');

  const artifactIds = new Set();
  const localIds = new Set();
  for (const binding of config.bindings) {
    validateBinding(binding);
    if (artifactIds.has(binding.artifactId)) throw fail('duplicate ecosystem artifactId');
    if (localIds.has(binding.localArtifactId)) throw fail('duplicate local artifact binding');
    artifactIds.add(binding.artifactId);
    localIds.add(binding.localArtifactId);
  }

  const callers = new Set();
  for (const grant of config.grants) {
    validateGrant(grant);
    if (callers.has(grant.callerId)) throw fail('duplicate caller grant');
    callers.add(grant.callerId);
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function publicDescriptor(binding, artifact, integrity = null) {
  const descriptor = {
    artifactId: binding.artifactId,
    digest: artifact.digest,
    size: artifact.size,
    mediaType: artifact.mediaType,
    name: artifact.name,
    ownerProduct: binding.ownerProduct,
    sensitivity: artifact.sensitivity,
    syncClass: artifact.syncClass,
    provenance: {
      producer: artifact.producer,
      producerRevision: artifact.producerRevision,
      createdAt: artifact.createdAt,
    },
    retention: structuredClone(binding.retention),
  };
  if (integrity) descriptor.integrity = integrity;
  return deepFreeze(descriptor);
}

export class ArtifactResolverPilot {
  constructor(artifactService, config) {
    if (!artifactService || typeof artifactService.get !== 'function' || typeof artifactService.prepareContent !== 'function') {
      throw fail('artifact service adapter is required');
    }
    validateResolverPilotConfig(config);
    this.artifactService = artifactService;
    this.config = structuredClone(config);
    this.bindings = new Map(this.config.bindings.map((binding) => [binding.artifactId, binding]));
    this.grants = new Map(this.config.grants.map((grant) => [grant.callerId, grant]));
  }

  describePolicy() {
    return deepFreeze({
      schemaVersion: ARTIFACT_RESOLVER_PILOT_VERSION,
      mode: ARTIFACT_RESOLVER_PILOT_MODE,
      enabled: this.config.enabled,
      ecosystemConnected: false,
      productionAuthority: false,
      digestKnowledgeAuthorizes: false,
      directDatabaseAccess: false,
      directFilesystemPathExposure: false,
      writeOperations: false,
      retentionEnforcement: false,
      backgroundGc: false,
    });
  }

  #authorize(callerId, artifactId, operation) {
    if (!this.config.enabled) throw fail('artifact resolver pilot is disabled', 503);
    assertPrincipal(callerId, 'callerId');
    if (typeof artifactId !== 'string' || !ARTIFACT_ID_RE.test(artifactId)) throw fail('invalid artifactId');
    if (!OPERATIONS.has(operation)) throw fail('unsupported resolver operation');

    const binding = this.bindings.get(artifactId);
    if (!binding) throw fail('artifact binding not found', 404);
    const grant = this.grants.get(callerId);
    if (!grant) throw fail('caller is not authorized', 403);
    if (!grant.operations.includes(operation)) throw fail('operation is not authorized', 403);
    if (!grant.ownerProducts.includes(binding.ownerProduct)) throw fail('artifact owner is not authorized', 403);
    if (SENSITIVITY_RANK.get(binding.sensitivity) > SENSITIVITY_RANK.get(grant.maxSensitivity)) throw fail('artifact sensitivity exceeds caller grant', 403);
    if (!grant.allowedSyncClasses.includes(binding.syncClass)) throw fail('artifact sync class is not authorized', 403);
    if (binding.size > grant.maxArtifactBytes) throw fail('artifact exceeds caller byte quota', 403);
    return { binding, grant };
  }

  #currentArtifact(binding) {
    const artifact = this.artifactService.get(binding.localArtifactId);
    if (!artifact) throw fail('bound local artifact is missing', 409);
    const fields = ['digest', 'size', 'mediaType', 'sensitivity', 'syncClass', 'producer', 'producerRevision'];
    for (const field of fields) {
      if (artifact[field] !== binding[field]) throw fail(`artifact binding drift detected for ${field}`, 409);
    }
    return artifact;
  }

  resolveMetadata({ callerId, artifactId }) {
    const { binding } = this.#authorize(callerId, artifactId, 'artifact.metadata.read');
    return publicDescriptor(binding, this.#currentArtifact(binding));
  }

  async prepareRead({ callerId, artifactId }) {
    const { binding } = this.#authorize(callerId, artifactId, 'artifact.bytes.prepare');
    const artifact = this.#currentArtifact(binding);
    const prepared = await this.artifactService.prepareContent(binding.localArtifactId);
    if (!prepared) throw fail('bound local artifact disappeared', 409);
    if (!prepared.ok) throw fail(`artifact content integrity failure: ${prepared.reason || 'unknown'}`, 409);
    if (prepared.artifact.digest !== binding.digest || prepared.artifact.size !== binding.size) throw fail('artifact changed during read preparation', 409);
    return publicDescriptor(binding, artifact, {
      verified: true,
      expectedDigest: binding.digest,
      actualDigest: prepared.actual,
      expectedSize: binding.size,
      actualSize: prepared.size,
      storageAccess: 'internal-artifact-service-only',
    });
  }
}
