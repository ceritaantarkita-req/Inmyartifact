import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DIGEST_RE = /^sha256:([a-f0-9]{64})$/;
export const DEFAULT_MAX_UPLOAD = 20 * 1024 * 1024;

export function safeName(name) {
  const normalized = String(name || 'artifact.bin')
    .normalize('NFKC')
    .replace(/[\r\n\\/\0]/g, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  return (normalized || 'artifact.bin').slice(0, 160);
}

export function blobPath(root, digest) {
  const match = DIGEST_RE.exec(digest);
  if (!match) throw new Error('invalid digest');
  return join(root, 'blobs', 'sha256', match[1].slice(0, 2), match[1]);
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export class ArtifactService {
  constructor(store, dataRoot, { maxUploadBytes = DEFAULT_MAX_UPLOAD } = {}) {
    this.store = store;
    this.dataRoot = dataRoot;
    this.maxUploadBytes = maxUploadBytes;
    this.operations = Promise.resolve();
  }

  async init() {
    await mkdir(join(this.dataRoot, 'tmp'), { recursive: true });
    await mkdir(join(this.dataRoot, 'blobs', 'sha256'), { recursive: true });
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
    const unique = new Map();
    for (const artifact of state.artifacts) unique.set(artifact.digest, artifact.size);
    return {
      ...state.stats,
      records: state.artifacts.length,
      uniqueBlobs: unique.size,
      logicalBytes: state.artifacts.reduce((total, item) => total + item.size, 0),
      physicalBytes: [...unique.values()].reduce((total, size) => total + size, 0),
    };
  }

  ingest(req, metadata) {
    return this.#exclusive(() => this.#ingest(req, metadata));
  }

  async #ingest(req, { name, mediaType }) {
    const clean = safeName(name);
    const type = (String(mediaType || 'application/octet-stream').split(';')[0] || 'application/octet-stream').slice(0, 120);
    const tmp = join(this.dataRoot, 'tmp', `${process.pid}-${Date.now()}-${randomUUID()}.part`);
    const handle = await open(tmp, 'wx', 0o600);
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > this.maxUploadBytes) {
          const error = new Error(`artifact exceeds ${this.maxUploadBytes} bytes`);
          error.status = 413;
          throw error;
        }
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
    const target = blobPath(this.dataRoot, digest);
    await mkdir(dirname(target), { recursive: true });
    let deduplicated = false;
    try {
      await stat(target);
      deduplicated = true;
      await rm(tmp, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await rename(tmp, target);
    }

    const now = new Date().toISOString();
    const artifact = {
      id: `artifact_${randomUUID()}`,
      ref: `artifact://sha256/${digest.slice(7)}`,
      digest,
      name: clean,
      mediaType: type,
      size: bytes,
      createdAt: now,
      verifiedAt: null,
    };
    await this.store.mutate((state) => {
      state.artifacts.unshift(artifact);
      state.stats.uploads++;
      if (deduplicated) state.stats.dedupHits++;
      state.activity.unshift({ id: randomUUID(), at: now, type: deduplicated ? 'artifact.referenced_existing_blob' : 'artifact.stored', subject: artifact.id, digest, size: bytes });
      state.activity = state.activity.slice(0, 500);
    });
    return { ...artifact, deduplicated };
  }

  verify(id) {
    return this.#exclusive(() => this.#verify(id));
  }

  async #verify(id) {
    const artifact = this.get(id);
    if (!artifact) return null;
    const actual = await hashFile(blobPath(this.dataRoot, artifact.digest));
    const ok = actual === artifact.digest;
    const at = new Date().toISOString();
    await this.store.mutate((state) => {
      const item = state.artifacts.find((value) => value.id === id);
      if (item && ok) item.verifiedAt = at;
      state.stats.verifications++;
      state.activity.unshift({ id: randomUUID(), at, type: ok ? 'artifact.verified' : 'artifact.corrupt', subject: id, expected: artifact.digest, actual });
    });
    return { ok, artifactId: id, expected: artifact.digest, actual, verifiedAt: at };
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
      state.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), type: 'artifact.record_deleted', subject: id, digest: removed.digest, lastReference });
    });
    if (removed && lastReference) await rm(blobPath(this.dataRoot, removed.digest), { force: true });
    return removed ? { removed: true, blobDeleted: lastReference, digest: removed.digest } : null;
  }

  pathFor(artifact) { return blobPath(this.dataRoot, artifact.digest); }
  activity() { return this.store.snapshot().activity.slice(0, 100); }
}
