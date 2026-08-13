import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DIGEST_RE = /^sha256:([a-f0-9]{64})$/;
const HEX_RE = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const ARTIFACT_ID_RE = /^artifact_[0-9a-f-]{36}$/;
const SENSITIVITY_CLASSES = new Set(['PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED']);
const SYNC_CLASSES = new Set(['LOCAL_ONLY', 'SYNC_ENCRYPTED', 'CLOUD_ALLOWED', 'PUBLIC']);

export const DEFAULT_MAX_UPLOAD = 20 * 1024 * 1024;
export const DEFAULT_LIMITS = Object.freeze({
  maxArtifacts: 1000,
  maxActivity: 500,
  maxUniqueBlobs: 500,
  maxPhysicalBytes: 1024 * 1024 * 1024,
});

export function initialState() {
  return {
    schemaVersion: 1,
    artifacts: [],
    activity: [],
    stats: { uploads: 0, dedupHits: 0, verifications: 0, deletes: 0 },
  };
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, fallback, max, name) {
  const candidate = String(value ?? fallback).trim();
  if (!candidate) return fallback;
  if (candidate.length > max) throw fail(`${name} is too long`);
  if (/[\r\n\0]/.test(candidate)) throw fail(`${name} contains invalid characters`);
  return candidate;
}

export function safeName(name) {
  const normalized = String(name || 'artifact.bin')
    .normalize('NFKC')
    .replace(/[\r\n\\/\0]/g, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  return (normalized || 'artifact.bin').slice(0, 160);
}

export function normalizeMediaType(value) {
  const raw = String(value || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!MEDIA_TYPE_RE.test(raw)) throw fail('invalid media type');
  return raw;
}

function enumValue(value, fallback, allowed, name) {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!allowed.has(normalized)) throw fail(`invalid ${name}`);
  return normalized;
}

export function normalizeMetadata(input = {}) {
  return {
    name: safeName(input.name),
    mediaType: normalizeMediaType(input.mediaType),
    sensitivity: enumValue(input.sensitivity, 'INTERNAL', SENSITIVITY_CLASSES, 'sensitivity'),
    syncClass: enumValue(input.syncClass, 'LOCAL_ONLY', SYNC_CLASSES, 'sync class'),
    producer: text(input.producer, 'local-standalone', 120, 'producer'),
    producerRevision: text(input.producerRevision, 'unknown', 200, 'producer revision'),
  };
}

export function blobPath(root, digest) {
  const match = DIGEST_RE.exec(digest);
  if (!match) throw fail('invalid digest');
  return join(root, 'blobs', 'sha256', match[1].slice(0, 2), match[1]);
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

function validateArtifactRecord(item) {
  assertObject(item, 'artifact');
  if (!ARTIFACT_ID_RE.test(item.id)) throw new Error('invalid artifact id');
  if (!DIGEST_RE.test(item.digest)) throw new Error('invalid artifact digest');
  if (item.ref !== `artifact://sha256/${item.digest.slice(7)}`) throw new Error('artifact ref/digest mismatch');
  if (typeof item.name !== 'string' || !item.name || item.name.length > 160) throw new Error('invalid artifact name');
  normalizeMediaType(item.mediaType);
  assertNonNegativeInteger(item.size, 'artifact size');
  if (item.size > DEFAULT_MAX_UPLOAD * 5) throw new Error('artifact size exceeds durable-state safety bound');
  if (typeof item.createdAt !== 'string' || !item.createdAt) throw new Error('invalid artifact createdAt');
  if (item.verifiedAt !== null && (typeof item.verifiedAt !== 'string' || !item.verifiedAt)) throw new Error('invalid artifact verifiedAt');
  if (!SENSITIVITY_CLASSES.has(item.sensitivity)) throw new Error('invalid artifact sensitivity');
  if (!SYNC_CLASSES.has(item.syncClass)) throw new Error('invalid artifact sync class');
  if (typeof item.producer !== 'string' || !item.producer || item.producer.length > 120) throw new Error('invalid artifact producer');
  if (typeof item.producerRevision !== 'string' || !item.producerRevision || item.producerRevision.length > 200) throw new Error('invalid artifact producer revision');
}

export function validateState(state, limits = DEFAULT_LIMITS) {
  assertObject(state, 'state');
  if (state.schemaVersion !== 1) throw new Error('unsupported artifact state schemaVersion');
  if (!Array.isArray(state.artifacts) || state.artifacts.length > limits.maxArtifacts) throw new Error('invalid or over-limit artifacts collection');
  if (!Array.isArray(state.activity) || state.activity.length > limits.maxActivity) throw new Error('invalid or over-limit activity collection');
  assertObject(state.stats, 'stats');
  for (const key of ['uploads', 'dedupHits', 'verifications', 'deletes']) assertNonNegativeInteger(state.stats[key], `stats.${key}`);

  const ids = new Set();
  const unique = new Map();
  for (const artifact of state.artifacts) {
    validateArtifactRecord(artifact);
    if (ids.has(artifact.id)) throw new Error('duplicate artifact id');
    ids.add(artifact.id);
    const previous = unique.get(artifact.digest);
    if (previous !== undefined && previous !== artifact.size) throw new Error('same digest has conflicting sizes');
    unique.set(artifact.digest, artifact.size);
  }
  if (unique.size > limits.maxUniqueBlobs) throw new Error('unique blob limit exceeded');
  const physicalBytes = [...unique.values()].reduce((sum, size) => sum + size, 0);
  if (physicalBytes > limits.maxPhysicalBytes) throw new Error('physical byte limit exceeded');

  for (const event of state.activity) {
    assertObject(event, 'activity item');
    if (typeof event.id !== 'string' || !event.id) throw new Error('invalid activity id');
    if (typeof event.at !== 'string' || !event.at) throw new Error('invalid activity timestamp');
    if (typeof event.type !== 'string' || !event.type || event.type.length > 120) throw new Error('invalid activity type');
  }
  return true;
}

function uniqueUsage(state) {
  const unique = new Map();
  for (const artifact of state.artifacts) unique.set(artifact.digest, artifact.size);
  return {
    digests: unique,
    uniqueBlobs: unique.size,
    physicalBytes: [...unique.values()].reduce((sum, size) => sum + size, 0),
  };
}

function pushActivity(state, event, maxActivity) {
  state.activity.unshift(event);
  state.activity = state.activity.slice(0, maxActivity);
}

async function inspectBlob(path, expectedDigest, expectedSize) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { ok: false, missing: false, size: info.size, actual: null, reason: 'not-file' };
    const actual = await hashFile(path);
    return {
      ok: info.size === expectedSize && actual === expectedDigest,
      missing: false,
      size: info.size,
      actual,
      reason: info.size !== expectedSize ? 'size-mismatch' : actual !== expectedDigest ? 'digest-mismatch' : null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, missing: true, size: null, actual: null, reason: 'missing' };
    throw error;
  }
}

async function replaceCorruptBlob(target, tmp) {
  const backup = `${target}.${process.pid}.${randomUUID()}.corrupt`;
  await rename(target, backup);
  try {
    await rename(tmp, target);
    await rm(backup, { force: true });
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    await rename(backup, target).catch(() => {});
    throw error;
  }
}

export class ArtifactService {
  constructor(store, dataRoot, { maxUploadBytes = DEFAULT_MAX_UPLOAD, limits = DEFAULT_LIMITS } = {}) {
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) throw fail('invalid maxUploadBytes');
    this.store = store;
    this.dataRoot = dataRoot;
    this.maxUploadBytes = maxUploadBytes;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.operations = Promise.resolve();
  }

  async init() {
    await mkdir(join(this.dataRoot, 'tmp'), { recursive: true });
    await mkdir(join(this.dataRoot, 'blobs', 'sha256'), { recursive: true });
    validateState(this.store.snapshot(), this.limits);
    return this;
  }

  #exclusive(fn) {
    const operation = this.operations.then(fn);
    this.operations = operation.catch(() => {});
    return operation;
  }

  list() { return this.store.snapshot().artifacts; }
  get(id) { return this.store.snapshot().artifacts.find((item) => item.id === id) || null; }

  stats() {
    const state = this.store.snapshot();
    const usage = uniqueUsage(state);
    return {
      ...state.stats,
      records: state.artifacts.length,
      uniqueBlobs: usage.uniqueBlobs,
      logicalBytes: state.artifacts.reduce((total, item) => total + item.size, 0),
      physicalBytes: usage.physicalBytes,
      limits: { ...this.limits, maxUploadBytes: this.maxUploadBytes },
    };
  }

  ingest(req, metadata) {
    return this.#exclusive(() => this.#ingest(req, metadata));
  }

  async #ingest(req, metadata) {
    const current = this.store.snapshot();
    if (current.artifacts.length >= this.limits.maxArtifacts) throw fail('artifact record limit reached', 507);
    const normalized = normalizeMetadata(metadata);
    const tmp = join(this.dataRoot, 'tmp', `${process.pid}-${Date.now()}-${randomUUID()}.part`);
    const handle = await open(tmp, 'wx', 0o600);
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > this.maxUploadBytes) throw fail(`artifact exceeds ${this.maxUploadBytes} bytes`, 413);
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(tmp, { force: true });
      throw error;
    }
    await handle.close();

    const digest = `sha256:${hash.digest('hex')}`;
    const usage = uniqueUsage(current);
    const newlyReferencedDigest = !usage.digests.has(digest);
    if (newlyReferencedDigest) {
      if (usage.uniqueBlobs >= this.limits.maxUniqueBlobs) {
        await rm(tmp, { force: true });
        throw fail('unique blob limit reached', 507);
      }
      if (usage.physicalBytes + bytes > this.limits.maxPhysicalBytes) {
        await rm(tmp, { force: true });
        throw fail('physical byte limit reached', 507);
      }
    }

    const target = blobPath(this.dataRoot, digest);
    await mkdir(dirname(target), { recursive: true });
    const existing = await inspectBlob(target, digest, bytes);
    let deduplicated = false;
    let repaired = false;
    let wroteTarget = false;

    if (existing.ok) {
      deduplicated = true;
      await rm(tmp, { force: true });
    } else if (existing.missing) {
      await rename(tmp, target);
      wroteTarget = true;
    } else {
      await replaceCorruptBlob(target, tmp);
      repaired = true;
      wroteTarget = true;
    }

    const now = new Date().toISOString();
    const artifact = {
      id: `artifact_${randomUUID()}`,
      ref: `artifact://sha256/${digest.slice(7)}`,
      digest,
      name: normalized.name,
      mediaType: normalized.mediaType,
      size: bytes,
      sensitivity: normalized.sensitivity,
      syncClass: normalized.syncClass,
      producer: normalized.producer,
      producerRevision: normalized.producerRevision,
      createdAt: now,
      verifiedAt: repaired ? now : null,
    };

    try {
      await this.store.mutate((state) => {
        if (state.artifacts.length >= this.limits.maxArtifacts) throw fail('artifact record limit reached', 507);
        state.artifacts.unshift(artifact);
        state.stats.uploads++;
        if (deduplicated) state.stats.dedupHits++;
        pushActivity(state, {
          id: randomUUID(),
          at: now,
          type: repaired ? 'artifact.corrupt_blob_repaired' : deduplicated ? 'artifact.referenced_existing_blob' : 'artifact.stored',
          subject: artifact.id,
          digest,
          size: bytes,
        }, this.limits.maxActivity);
      });
    } catch (error) {
      if (wroteTarget && !this.store.snapshot().artifacts.some((item) => item.digest === digest)) {
        await rm(target, { force: true }).catch(() => {});
      }
      throw error;
    }
    return { ...artifact, deduplicated, repaired };
  }

  verify(id) {
    return this.#exclusive(() => this.#verify(id));
  }

  async #verify(id) {
    const artifact = this.get(id);
    if (!artifact) return null;
    const inspection = await inspectBlob(blobPath(this.dataRoot, artifact.digest), artifact.digest, artifact.size);
    const at = new Date().toISOString();
    await this.store.mutate((state) => {
      const item = state.artifacts.find((value) => value.id === id);
      if (item && inspection.ok) item.verifiedAt = at;
      state.stats.verifications++;
      pushActivity(state, {
        id: randomUUID(),
        at,
        type: inspection.ok ? 'artifact.verified' : inspection.missing ? 'artifact.missing' : 'artifact.corrupt',
        subject: id,
        expected: artifact.digest,
        actual: inspection.actual,
        reason: inspection.reason,
      }, this.limits.maxActivity);
    });
    return {
      ok: inspection.ok,
      missing: inspection.missing,
      reason: inspection.reason,
      artifactId: id,
      expected: artifact.digest,
      actual: inspection.actual,
      expectedSize: artifact.size,
      actualSize: inspection.size,
      verifiedAt: at,
    };
  }

  prepareContent(id) {
    return this.#exclusive(async () => {
      const artifact = this.get(id);
      if (!artifact) return null;
      const inspection = await inspectBlob(blobPath(this.dataRoot, artifact.digest), artifact.digest, artifact.size);
      return { artifact, ...inspection };
    });
  }

  remove(id) {
    return this.#exclusive(() => this.#remove(id));
  }

  async #remove(id) {
    let removed = null;
    let lastReference = false;
    await this.store.mutate((state) => {
      const index = state.artifacts.findIndex((item) => item.id === id);
      if (index < 0) return;
      removed = state.artifacts[index];
      state.artifacts.splice(index, 1);
      lastReference = !state.artifacts.some((item) => item.digest === removed.digest);
      state.stats.deletes++;
      pushActivity(state, {
        id: randomUUID(),
        at: new Date().toISOString(),
        type: 'artifact.record_deleted',
        subject: id,
        digest: removed.digest,
        lastReference,
      }, this.limits.maxActivity);
    });
    if (!removed) return null;
    if (!lastReference) return { removed: true, blobDeleted: false, cleanupPending: false, digest: removed.digest };
    try {
      await rm(blobPath(this.dataRoot, removed.digest), { force: true });
      return { removed: true, blobDeleted: true, cleanupPending: false, digest: removed.digest };
    } catch {
      return { removed: true, blobDeleted: false, cleanupPending: true, digest: removed.digest };
    }
  }

  auditIntegrity() {
    return this.#exclusive(() => this.#auditIntegrity());
  }

  async #auditIntegrity() {
    const state = this.store.snapshot();
    const expected = uniqueUsage(state).digests;
    const missing = [];
    const corrupt = [];
    for (const [digest, size] of expected) {
      const inspection = await inspectBlob(blobPath(this.dataRoot, digest), digest, size);
      if (inspection.missing) missing.push({ digest, expectedSize: size });
      else if (!inspection.ok) corrupt.push({ digest, expectedSize: size, actualSize: inspection.size, actual: inspection.actual, reason: inspection.reason });
    }

    const orphan = [];
    const shaRoot = join(this.dataRoot, 'blobs', 'sha256');
    let prefixes = [];
    try { prefixes = await readdir(shaRoot, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const prefix of prefixes) {
      if (!prefix.isDirectory()) continue;
      const prefixPath = join(shaRoot, prefix.name);
      for (const entry of await readdir(prefixPath, { withFileTypes: true })) {
        if (!entry.isFile() || !HEX_RE.test(entry.name)) continue;
        const digest = `sha256:${entry.name}`;
        if (!expected.has(digest)) {
          const info = await stat(join(prefixPath, entry.name));
          orphan.push({ digest, size: info.size });
        }
      }
    }
    return {
      ok: missing.length === 0 && corrupt.length === 0,
      expectedBlobs: expected.size,
      missing,
      corrupt,
      orphan,
      policy: 'records-persist-until-explicit-delete; blobs-persist-while-referenced; no-background-gc',
    };
  }

  pathFor(artifact) { return blobPath(this.dataRoot, artifact.digest); }
  activity() { return this.store.snapshot().activity.slice(0, 100); }
}
