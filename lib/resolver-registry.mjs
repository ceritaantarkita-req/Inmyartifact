const ARTIFACT_ID_RE = /^art_[A-Za-z0-9_-]{16,96}$/;
const LOCAL_ARTIFACT_ID_RE = /^artifact_[0-9a-f-]{36}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const PRINCIPAL_RE = /^[A-Za-z0-9._:-]{2,120}$/;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const SENSITIVITY = new Set(['PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED']);
const SYNC_CLASSES = new Set(['LOCAL_ONLY', 'SYNC_ENCRYPTED', 'CLOUD_ALLOWED', 'PUBLIC']);
const RETENTION_MODES = new Set(['PRODUCT_PIN', 'PRODUCT_LEASE']);

export const ARTIFACT_RESOLVER_REGISTRY_VERSION = '1.0.0';
export const DEFAULT_RESOLVER_REGISTRY_LIMITS = Object.freeze({ maxBindings: 256 });

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

function assertRfc3339(value, name) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value) || !Number.isFinite(Date.parse(value))) throw fail(`invalid ${name}`);
}

function clone(value) {
  return structuredClone(value);
}

function validateRetention(retention, ownerProduct) {
  assertObject(retention, 'retention');
  assertExactKeys(retention, ['mode', 'authorityProduct', 'leaseExpiresAt'], 'retention');
  if (!RETENTION_MODES.has(retention.mode)) throw fail('invalid retention.mode');
  assertPrincipal(retention.authorityProduct, 'retention.authorityProduct');
  if (retention.authorityProduct !== ownerProduct) throw fail('retention authority must equal artifact owner product');
  if (retention.mode === 'PRODUCT_PIN') {
    if (retention.leaseExpiresAt !== null) throw fail('PRODUCT_PIN must not have leaseExpiresAt');
  } else {
    assertRfc3339(retention.leaseExpiresAt, 'retention.leaseExpiresAt');
  }
}

function validateBindingShape(binding) {
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
  if (!SENSITIVITY.has(binding.sensitivity)) throw fail('invalid binding.sensitivity');
  if (!SYNC_CLASSES.has(binding.syncClass)) throw fail('invalid binding.syncClass');
  if (typeof binding.producer !== 'string' || binding.producer.length < 1 || binding.producer.length > 120) throw fail('invalid binding.producer');
  if (typeof binding.producerRevision !== 'string' || binding.producerRevision.length < 1 || binding.producerRevision.length > 200) throw fail('invalid binding.producerRevision');
  validateRetention(binding.retention, binding.ownerProduct);
  return true;
}

function validateRecord(record) {
  assertObject(record, 'registry binding');
  assertExactKeys(record, [
    'artifactId', 'localArtifactId', 'digest', 'size', 'mediaType', 'ownerProduct',
    'sensitivity', 'syncClass', 'producer', 'producerRevision', 'retention',
    'registeredAt', 'updatedAt',
  ], 'registry binding');
  const binding = { ...record };
  delete binding.registeredAt;
  delete binding.updatedAt;
  validateBindingShape(binding);
  assertRfc3339(record.registeredAt, 'registry binding.registeredAt');
  assertRfc3339(record.updatedAt, 'registry binding.updatedAt');
  if (Date.parse(record.updatedAt) < Date.parse(record.registeredAt)) throw fail('registry binding.updatedAt precedes registeredAt');
  return true;
}

export function initialResolverRegistryState() {
  return { schemaVersion: ARTIFACT_RESOLVER_REGISTRY_VERSION, bindings: [] };
}

export function validateResolverRegistryState(state, limits = DEFAULT_RESOLVER_REGISTRY_LIMITS) {
  assertObject(state, 'resolver registry state');
  assertExactKeys(state, ['schemaVersion', 'bindings'], 'resolver registry state');
  if (state.schemaVersion !== ARTIFACT_RESOLVER_REGISTRY_VERSION) throw fail('unsupported resolver registry schemaVersion');
  if (!limits || !Number.isSafeInteger(limits.maxBindings) || limits.maxBindings < 1 || limits.maxBindings > 4096) throw fail('invalid resolver registry limits');
  if (!Array.isArray(state.bindings) || state.bindings.length > limits.maxBindings) throw fail('invalid or over-limit resolver registry bindings');

  const artifactIds = new Set();
  const localIds = new Set();
  for (const record of state.bindings) {
    validateRecord(record);
    if (artifactIds.has(record.artifactId)) throw fail('duplicate ecosystem artifactId');
    if (localIds.has(record.localArtifactId)) throw fail('duplicate local artifact binding');
    artifactIds.add(record.artifactId);
    localIds.add(record.localArtifactId);
  }
  return true;
}

function bindingFromRecord(record) {
  const binding = clone(record);
  delete binding.registeredAt;
  delete binding.updatedAt;
  return binding;
}

function assertArtifactMatchesBinding(artifact, binding) {
  if (!artifact) throw fail('bound local artifact is missing', 409);
  const fields = ['digest', 'size', 'mediaType', 'sensitivity', 'syncClass', 'producer', 'producerRevision'];
  for (const field of fields) {
    if (artifact[field] !== binding[field]) throw fail(`artifact binding drift detected for ${field}`, 409);
  }
}

function normalizeNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail('invalid registry clock');
  return date.toISOString();
}

export class ArtifactResolverBindingRegistry {
  constructor(store, artifactService, { limits = DEFAULT_RESOLVER_REGISTRY_LIMITS, now = () => new Date() } = {}) {
    if (!store || typeof store.snapshot !== 'function' || typeof store.mutate !== 'function') throw fail('resolver registry store is required');
    if (!artifactService || typeof artifactService.get !== 'function') throw fail('artifact service adapter is required');
    if (typeof now !== 'function') throw fail('registry clock must be a function');
    this.store = store;
    this.artifactService = artifactService;
    this.limits = { ...DEFAULT_RESOLVER_REGISTRY_LIMITS, ...limits };
    this.now = now;
    validateResolverRegistryState(this.store.snapshot(), this.limits);
  }

  list() {
    return this.store.snapshot().bindings.map(bindingFromRecord);
  }

  get(artifactId) {
    const record = this.store.snapshot().bindings.find((item) => item.artifactId === artifactId);
    return record ? bindingFromRecord(record) : null;
  }

  async register({ ownerProduct, binding }) {
    assertPrincipal(ownerProduct, 'ownerProduct');
    validateBindingShape(binding);
    if (ownerProduct !== binding.ownerProduct) throw fail('only the artifact owner product may register a binding', 403);
    if (binding.retention.authorityProduct !== ownerProduct) throw fail('only the retention authority product may register a binding', 403);
    assertArtifactMatchesBinding(this.artifactService.get(binding.localArtifactId), binding);
    const timestamp = normalizeNow(this.now());

    return this.store.mutate((state) => {
      validateResolverRegistryState(state, this.limits);
      if (state.bindings.length >= this.limits.maxBindings) throw fail('resolver registry binding limit reached', 507);
      if (state.bindings.some((item) => item.artifactId === binding.artifactId)) throw fail('ecosystem artifactId already registered', 409);
      if (state.bindings.some((item) => item.localArtifactId === binding.localArtifactId)) throw fail('local artifact is already bound', 409);
      const record = { ...clone(binding), registeredAt: timestamp, updatedAt: timestamp };
      state.bindings.unshift(record);
      validateResolverRegistryState(state, this.limits);
      return bindingFromRecord(record);
    });
  }

  async setRetention({ ownerProduct, artifactId, retention }) {
    assertPrincipal(ownerProduct, 'ownerProduct');
    if (typeof artifactId !== 'string' || !ARTIFACT_ID_RE.test(artifactId)) throw fail('invalid artifactId');
    const timestamp = normalizeNow(this.now());
    return this.store.mutate((state) => {
      validateResolverRegistryState(state, this.limits);
      const record = state.bindings.find((item) => item.artifactId === artifactId);
      if (!record) throw fail('artifact binding not found', 404);
      if (record.ownerProduct !== ownerProduct) throw fail('only the artifact owner product may change retention', 403);
      validateRetention(retention, record.ownerProduct);
      record.retention = clone(retention);
      record.updatedAt = timestamp;
      validateResolverRegistryState(state, this.limits);
      return bindingFromRecord(record);
    });
  }

  evaluateRetention({ artifactId, at = this.now() }) {
    if (typeof artifactId !== 'string' || !ARTIFACT_ID_RE.test(artifactId)) throw fail('invalid artifactId');
    const record = this.store.snapshot().bindings.find((item) => item.artifactId === artifactId);
    if (!record) throw fail('artifact binding not found', 404);
    const observedAt = normalizeNow(at);
    if (record.retention.mode === 'PRODUCT_PIN') {
      return Object.freeze({
        artifactId,
        state: 'PINNED',
        observedAt,
        leaseExpiresAt: null,
        eligibleForGc: false,
        requiresOwnerReview: false,
      });
    }
    const expired = Date.parse(observedAt) >= Date.parse(record.retention.leaseExpiresAt);
    return Object.freeze({
      artifactId,
      state: expired ? 'LEASE_EXPIRED_REVIEW_REQUIRED' : 'LEASE_ACTIVE',
      observedAt,
      leaseExpiresAt: record.retention.leaseExpiresAt,
      eligibleForGc: false,
      requiresOwnerReview: expired,
    });
  }

  resolverBindings() {
    return this.store.snapshot().bindings.map(bindingFromRecord);
  }
}
