import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ARTIFACT_RESOLVER_OPERATIONS,
  ARTIFACT_RESOLVER_PILOT_MODE,
  ARTIFACT_RESOLVER_PILOT_VERSION,
  ArtifactResolverPilot,
  validateResolverPilotConfig,
} from '../lib/resolver.mjs';

const LOCAL_ID = 'artifact_11111111-1111-4111-8111-111111111111';
const ART_ID = 'art_0123456789abcdef';
const DIGEST = `sha256:${'a'.repeat(64)}`;

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

function grant(overrides = {}) {
  return {
    callerId: 'inmy-governance-benchmark',
    operations: [...ARTIFACT_RESOLVER_OPERATIONS],
    ownerProducts: ['inmy-rnd'],
    maxSensitivity: 'INTERNAL',
    allowedSyncClasses: ['LOCAL_ONLY'],
    maxArtifactBytes: 1024,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    schemaVersion: ARTIFACT_RESOLVER_PILOT_VERSION,
    mode: ARTIFACT_RESOLVER_PILOT_MODE,
    enabled: true,
    bindings: [binding()],
    grants: [grant()],
    ...overrides,
  };
}

function fakeService(current = artifact(), preparedOverrides = {}) {
  return {
    get(id) {
      return id === current.id ? structuredClone(current) : null;
    },
    async prepareContent(id) {
      if (id !== current.id) return null;
      return {
        artifact: structuredClone(current),
        ok: true,
        missing: false,
        size: current.size,
        actual: current.digest,
        reason: null,
        ...preparedOverrides,
      };
    },
  };
}

test('resolver pilot publishes a bounded read-only policy and stays ecosystem-disconnected', () => {
  const resolver = new ArtifactResolverPilot(fakeService(), config());
  assert.deepEqual(resolver.describePolicy(), {
    schemaVersion: '1.0.0',
    mode: 'pilot-read-only',
    enabled: true,
    ecosystemConnected: false,
    productionAuthority: false,
    digestKnowledgeAuthorizes: false,
    directDatabaseAccess: false,
    directFilesystemPathExposure: false,
    writeOperations: false,
    retentionEnforcement: false,
    backgroundGc: false,
  });
});

test('resolver is fail-closed when pilot activation is disabled', () => {
  const resolver = new ArtifactResolverPilot(fakeService(), config({ enabled: false }));
  assert.throws(
    () => resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 503 && /disabled/.test(error.message),
  );
});

test('ecosystem artifact identity is independent from digest knowledge', () => {
  const resolver = new ArtifactResolverPilot(fakeService(), config());
  assert.throws(
    () => resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: DIGEST }),
    /invalid artifactId/,
  );
  assert.equal(typeof resolver.resolveByDigest, 'undefined');
});

test('metadata resolution requires exact caller operation and owner authorization', () => {
  const resolver = new ArtifactResolverPilot(fakeService(), config({
    grants: [grant({ operations: ['artifact.bytes.prepare'] })],
  }));
  assert.throws(
    () => resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 403 && /operation/.test(error.message),
  );

  const ownerBlocked = new ArtifactResolverPilot(fakeService(), config({
    grants: [grant({ ownerProducts: ['inmy-sandbox'] })],
  }));
  assert.throws(
    () => ownerBlocked.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 403 && /owner/.test(error.message),
  );
});

test('caller cannot widen sensitivity, sync class or byte quota', () => {
  const highSensitivity = new ArtifactResolverPilot(
    fakeService(artifact({ sensitivity: 'SENSITIVE' })),
    config({ bindings: [binding({ sensitivity: 'SENSITIVE' })] }),
  );
  assert.throws(
    () => highSensitivity.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 403 && /sensitivity/.test(error.message),
  );

  const syncBlocked = new ArtifactResolverPilot(
    fakeService(artifact({ syncClass: 'SYNC_ENCRYPTED' })),
    config({ bindings: [binding({ syncClass: 'SYNC_ENCRYPTED' })] }),
  );
  assert.throws(
    () => syncBlocked.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 403 && /sync class/.test(error.message),
  );

  const byteBlocked = new ArtifactResolverPilot(fakeService(), config({
    grants: [grant({ maxArtifactBytes: 64 })],
  }));
  assert.throws(
    () => byteBlocked.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 403 && /byte quota/.test(error.message),
  );
});

test('binding metadata is checked against current Artifact source truth before resolution', () => {
  const resolver = new ArtifactResolverPilot(fakeService(artifact({ producerRevision: 'rev-002' })), config());
  assert.throws(
    () => resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 409 && /binding drift/.test(error.message),
  );
});

test('authorized metadata descriptor preserves ownership, provenance and retention without local storage identifiers', () => {
  const resolver = new ArtifactResolverPilot(fakeService(), config());
  const result = resolver.resolveMetadata({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID });
  assert.equal(result.artifactId, ART_ID);
  assert.equal(result.digest, DIGEST);
  assert.equal(result.ownerProduct, 'inmy-rnd');
  assert.equal(result.provenance.producerRevision, 'rev-001');
  assert.equal(result.retention.mode, 'PRODUCT_PIN');
  assert.equal('localArtifactId' in result, false);
  assert.equal('path' in result, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.provenance));
  assert.ok(Object.isFrozen(result.retention));
});

test('prepareRead fails closed on corrupt content and exposes no filesystem path', async () => {
  const corrupt = new ArtifactResolverPilot(fakeService(artifact(), {
    ok: false,
    actual: `sha256:${'b'.repeat(64)}`,
    reason: 'digest-mismatch',
  }), config());
  await assert.rejects(
    corrupt.prepareRead({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID }),
    (error) => error.status === 409 && /integrity failure/.test(error.message),
  );

  const resolver = new ArtifactResolverPilot(fakeService(), config());
  const prepared = await resolver.prepareRead({ callerId: 'inmy-governance-benchmark', artifactId: ART_ID });
  assert.equal(prepared.integrity.verified, true);
  assert.equal(prepared.integrity.storageAccess, 'internal-artifact-service-only');
  assert.equal('path' in prepared, false);
  assert.equal('localArtifactId' in prepared, false);
});

test('config validation is strict, bounded and keeps retention authority with the owner product', () => {
  assert.equal(validateResolverPilotConfig(config()), true);
  assert.throws(() => validateResolverPilotConfig({ ...config(), unknown: true }), /unknown or missing/);
  assert.throws(() => validateResolverPilotConfig(config({ bindings: [binding(), binding()] })), /duplicate ecosystem artifactId/);
  assert.throws(() => validateResolverPilotConfig(config({
    bindings: [binding({ retention: { mode: 'PRODUCT_PIN', authorityProduct: 'inmy-hub', leaseExpiresAt: null } })],
  })), /retention authority/);
  assert.throws(() => validateResolverPilotConfig(config({
    bindings: [binding({ retention: { mode: 'PRODUCT_LEASE', authorityProduct: 'inmy-rnd', leaseExpiresAt: null } })],
  })), /leaseExpiresAt/);
});

test('resolver source contains no network, environment-secret, process execution or direct filesystem primitive', async () => {
  const source = await readFile(new URL('../lib/resolver.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    "node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:child_process", "node:fs", "node:fs/promises",
    'process.env', 'fetch(', 'execFile(', 'spawn(', 'readFile(', 'writeFile(', 'createReadStream(',
  ]) {
    assert.equal(source.includes(forbidden), false, `resolver source contains forbidden primitive: ${forbidden}`);
  }
});

test('published resolver pilot schema parses and pins the read-only contract surface', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/artifact-resolver-pilot-v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, '1.0.0');
  assert.equal(schema.properties.mode.const, 'pilot-read-only');
  assert.deepEqual(schema.properties.grants.items.properties.operations.items.enum, [
    'artifact.metadata.read',
    'artifact.bytes.prepare',
  ]);
  assert.equal(schema.properties.bindings.items.properties.artifactId.pattern, '^art_[A-Za-z0-9_-]{16,96}$');
});
