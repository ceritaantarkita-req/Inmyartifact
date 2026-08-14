import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../lib/store.mjs';
import { ArtifactResolverPilot } from '../lib/resolver.mjs';
import {
  ARTIFACT_RESOLVER_REGISTRY_VERSION,
  ArtifactResolverBindingRegistry,
  initialResolverRegistryState,
  validateResolverRegistryState,
} from '../lib/resolver-registry.mjs';

const LOCAL_ID = 'artifact_11111111-1111-4111-8111-111111111111';
const LOCAL_ID_2 = 'artifact_22222222-2222-4222-8222-222222222222';
const ART_ID = 'art_0123456789abcdef';
const ART_ID_2 = 'art_fedcba9876543210';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const DIGEST_2 = `sha256:${'b'.repeat(64)}`;

function artifact(overrides = {}) {
  return {
    id: LOCAL_ID,
    ref: `artifact://sha256/${'a'.repeat(64)}`,
    digest: DIGEST,
    name: 'evidence.json',
    mediaType: 'application/json',
    size: 128,
    sensitivity: 'INTERNAL',
    syncClass: 'LOCAL_ONLY',
    producer: 'inmy-rnd',
    producerRevision: 'rev-001',
    createdAt: '2026-08-14T05:00:00.000Z',
    verifiedAt: null,
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

function fullService(items = [artifact()]) {
  const byId = new Map(items.map((item) => [item.id, structuredClone(item)]));
  return {
    get(id) {
      const item = byId.get(id);
      return item ? structuredClone(item) : null;
    },
    async prepareContent(id) {
      const item = byId.get(id);
      if (!item) return null;
      return {
        artifact: structuredClone(item),
        ok: true,
        missing: false,
        size: item.size,
        actual: item.digest,
        reason: null,
      };
    },
  };
}

function memoryStore(seed = initialResolverRegistryState()) {
  let state = structuredClone(seed);
  return {
    snapshot() { return structuredClone(state); },
    async mutate(fn) {
      const draft = structuredClone(state);
      const result = await fn(draft);
      validateResolverRegistryState(draft);
      state = structuredClone(draft);
      return result;
    },
  };
}

test('persistent registry survives JsonStore restart without changing ecosystem artifact identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inmyartifact-resolver-registry-'));
  const file = join(dir, 'resolver-registry.json');
  const service = fullService();
  try {
    const store1 = await new JsonStore(file, initialResolverRegistryState(), validateResolverRegistryState).init();
    const registry1 = new ArtifactResolverBindingRegistry(store1, service, { now: () => new Date('2026-08-14T06:00:00.000Z') });
    await registry1.register({ ownerProduct: 'inmy-rnd', binding: binding() });

    const store2 = await new JsonStore(file, initialResolverRegistryState(), validateResolverRegistryState).init();
    const registry2 = new ArtifactResolverBindingRegistry(store2, service);
    assert.equal(registry2.get(ART_ID).artifactId, ART_ID);
    assert.equal(registry2.get(ART_ID).digest, DIGEST);
    assert.equal(registry2.get(ART_ID).localArtifactId, LOCAL_ID);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(persisted.schemaVersion, ARTIFACT_RESOLVER_REGISTRY_VERSION);
    assert.equal(persisted.bindings.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('only the owner product can register a binding and source truth must match', async () => {
  const service = fullService();
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), service);
  await assert.rejects(
    registry.register({ ownerProduct: 'inmy-sandbox', binding: binding() }),
    (error) => error.status === 403 && /owner product/.test(error.message),
  );

  const drifted = new ArtifactResolverBindingRegistry(memoryStore(), fullService([artifact({ producerRevision: 'rev-002' })]));
  await assert.rejects(
    drifted.register({ ownerProduct: 'inmy-rnd', binding: binding() }),
    (error) => error.status === 409 && /binding drift/.test(error.message),
  );
});

test('registry rejects duplicate ecosystem IDs, duplicate local bindings and over-limit growth', async () => {
  const secondArtifact = artifact({
    id: LOCAL_ID_2,
    ref: `artifact://sha256/${'b'.repeat(64)}`,
    digest: DIGEST_2,
    size: 64,
    producerRevision: 'rev-002',
  });
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), fullService([artifact(), secondArtifact]), { limits: { maxBindings: 1 } });
  await registry.register({ ownerProduct: 'inmy-rnd', binding: binding() });
  await assert.rejects(
    registry.register({ ownerProduct: 'inmy-rnd', binding: binding({ artifactId: ART_ID_2 }) }),
    /binding limit reached/,
  );

  const duplicateRegistry = new ArtifactResolverBindingRegistry(memoryStore(), fullService([artifact(), secondArtifact]));
  await duplicateRegistry.register({ ownerProduct: 'inmy-rnd', binding: binding() });
  await assert.rejects(
    duplicateRegistry.register({ ownerProduct: 'inmy-rnd', binding: binding() }),
    /artifactId already registered/,
  );
  await assert.rejects(
    duplicateRegistry.register({ ownerProduct: 'inmy-rnd', binding: binding({ artifactId: ART_ID_2 }) }),
    /local artifact is already bound/,
  );
});

test('retention changes are owner-controlled metadata only', async () => {
  let now = new Date('2026-08-14T06:00:00.000Z');
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), fullService(), { now: () => now });
  await registry.register({ ownerProduct: 'inmy-rnd', binding: binding() });
  now = new Date('2026-08-14T06:05:00.000Z');

  await assert.rejects(
    registry.setRetention({
      ownerProduct: 'inmy-sandbox',
      artifactId: ART_ID,
      retention: { mode: 'PRODUCT_LEASE', authorityProduct: 'inmy-rnd', leaseExpiresAt: '2026-08-15T00:00:00.000Z' },
    }),
    (error) => error.status === 403 && /owner product/.test(error.message),
  );

  const updated = await registry.setRetention({
    ownerProduct: 'inmy-rnd',
    artifactId: ART_ID,
    retention: { mode: 'PRODUCT_LEASE', authorityProduct: 'inmy-rnd', leaseExpiresAt: '2026-08-15T00:00:00.000Z' },
  });
  assert.equal(updated.retention.mode, 'PRODUCT_LEASE');
  assert.equal(updated.retention.leaseExpiresAt, '2026-08-15T00:00:00.000Z');
  assert.equal(registry.get(ART_ID).digest, DIGEST);
});

test('expired lease is review-required and never becomes automatic GC authority', async () => {
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), fullService(), {
    now: () => new Date('2026-08-14T06:00:00.000Z'),
  });
  await registry.register({
    ownerProduct: 'inmy-rnd',
    binding: binding({
      retention: {
        mode: 'PRODUCT_LEASE',
        authorityProduct: 'inmy-rnd',
        leaseExpiresAt: '2026-08-14T07:00:00.000Z',
      },
    }),
  });

  const active = registry.evaluateRetention({ artifactId: ART_ID, at: '2026-08-14T06:30:00.000Z' });
  assert.equal(active.state, 'LEASE_ACTIVE');
  assert.equal(active.eligibleForGc, false);
  assert.equal(active.requiresOwnerReview, false);

  const expired = registry.evaluateRetention({ artifactId: ART_ID, at: '2026-08-14T07:00:00.000Z' });
  assert.equal(expired.state, 'LEASE_EXPIRED_REVIEW_REQUIRED');
  assert.equal(expired.eligibleForGc, false);
  assert.equal(expired.requiresOwnerReview, true);
});

test('product pin is durable retention intent and never automatic deletion authority', async () => {
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), fullService());
  await registry.register({ ownerProduct: 'inmy-rnd', binding: binding() });
  const state = registry.evaluateRetention({ artifactId: ART_ID, at: '2030-01-01T00:00:00.000Z' });
  assert.deepEqual(state, {
    artifactId: ART_ID,
    state: 'PINNED',
    observedAt: '2030-01-01T00:00:00.000Z',
    leaseExpiresAt: null,
    eligibleForGc: false,
    requiresOwnerReview: false,
  });
});

test('persisted registry bindings can feed the accepted read-only resolver without exposing registry timestamps', async () => {
  const service = fullService();
  const registry = new ArtifactResolverBindingRegistry(memoryStore(), service);
  await registry.register({ ownerProduct: 'inmy-rnd', binding: binding() });
  const resolver = new ArtifactResolverPilot(service, {
    schemaVersion: '1.0.0',
    mode: 'pilot-read-only',
    enabled: true,
    bindings: registry.resolverBindings(),
    grants: [{
      callerId: 'inmy-governance-benchmark',
      operations: ['artifact.metadata.read'],
      ownerProducts: ['inmy-rnd'],
      maxSensitivity: 'INTERNAL',
      allowedSyncClasses: ['LOCAL_ONLY'],
      maxArtifactBytes: 1024,
    }],
  });
  const descriptor = resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID });
  assert.equal(descriptor.artifactId, ART_ID);
  assert.equal(descriptor.ownerProduct, 'inmy-rnd');
  assert.equal('registeredAt' in descriptor, false);
  assert.equal('updatedAt' in descriptor, false);
});

test('registry state validation is strict and keeps retention authority with product ownership', () => {
  const good = {
    schemaVersion: '1.0.0',
    bindings: [{
      ...binding(),
      registeredAt: '2026-08-14T06:00:00.000Z',
      updatedAt: '2026-08-14T06:00:00.000Z',
    }],
  };
  assert.equal(validateResolverRegistryState(good), true);
  assert.throws(() => validateResolverRegistryState({ ...good, unknown: true }), /unknown or missing fields/);
  assert.throws(() => validateResolverRegistryState({
    ...good,
    bindings: [{
      ...good.bindings[0],
      retention: { mode: 'PRODUCT_PIN', authorityProduct: 'inmy-hub', leaseExpiresAt: null },
    }],
  }), /retention authority/);
  assert.throws(() => validateResolverRegistryState({
    ...good,
    bindings: [{ ...good.bindings[0], updatedAt: '2026-08-14T05:59:59.000Z' }],
  }), /precedes registeredAt/);
});

test('registry source has no network, environment-secret, process execution or direct filesystem primitive', async () => {
  const source = await readFile(new URL('../lib/resolver-registry.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    'node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram', 'node:child_process', 'node:fs', 'node:fs/promises',
    'process.env', 'fetch(', 'execFile(', 'spawn(', 'readFile(', 'writeFile(', 'createReadStream(', 'rm(', 'rename(',
  ]) {
    assert.equal(source.includes(forbidden), false, `registry source contains forbidden primitive: ${forbidden}`);
  }
});

test('published registry schema parses and pins product-owned pin/lease state', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/artifact-resolver-registry-v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, '1.0.0');
  assert.equal(schema.properties.bindings.maxItems, 256);
  assert.equal(schema.properties.bindings.items.properties.artifactId.pattern, '^art_[A-Za-z0-9_-]{16,96}$');
  assert.deepEqual(schema.properties.bindings.items.properties.retention.properties.mode.enum, ['PRODUCT_PIN', 'PRODUCT_LEASE']);
});
