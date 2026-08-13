import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { JsonStore } from '../lib/store.mjs';
import {
  ArtifactService,
  DEFAULT_LIMITS,
  blobPath,
  initialState,
  normalizeMediaType,
  safeName,
  validateState,
} from '../lib/artifact.mjs';

async function setup(fn, options = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'artifact-test-'));
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  try {
    const store = await new JsonStore(
      join(dataRoot, 'state.json'),
      initialState(),
      (state) => validateState(state, limits),
    ).init();
    const service = await new ArtifactService(store, dataRoot, {
      maxUploadBytes: options.maxUploadBytes || 1024,
      limits,
    }).init();
    await fn(service, dataRoot, store);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

const request = (body) => Readable.from([Buffer.from(body)]);
const digestFor = (body) => `sha256:${createHash('sha256').update(body).digest('hex')}`;

test('safeName removes path separators', () => {
  assert.equal(safeName('../x\\y.txt'), '.._x_y.txt');
});

test('media type normalization rejects malformed values', () => {
  assert.equal(normalizeMediaType('Text/Plain; charset=utf-8'), 'text/plain');
  assert.throws(() => normalizeMediaType('not-a-type'), /invalid media type/);
});

test('same bytes deduplicate underlying blob and preserve classification metadata', () => setup(async (service) => {
  const first = await service.ingest(request('hello'), {
    name: 'a.txt',
    mediaType: 'text/plain',
    sensitivity: 'SENSITIVE',
    syncClass: 'LOCAL_ONLY',
    producer: 'unit-test',
    producerRevision: 'rev-1',
  });
  const second = await service.ingest(request('hello'), { name: 'b.txt', mediaType: 'text/plain' });
  assert.equal(first.digest, second.digest);
  assert.equal(second.deduplicated, true);
  assert.equal(first.sensitivity, 'SENSITIVE');
  assert.equal(first.producerRevision, 'rev-1');
  assert.equal(service.stats().uniqueBlobs, 1);
}));

test('identical upload repairs a corrupted existing digest path instead of reusing bad bytes', () => setup(async (service, dataRoot) => {
  const first = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  await writeFile(blobPath(dataRoot, first.digest), 'xxxxx');
  const second = await service.ingest(request('hello'), { name: 'b', mediaType: 'text/plain' });
  assert.equal(second.repaired, true);
  assert.equal(second.deduplicated, false);
  assert.equal((await service.verify(first.id)).ok, true);
  assert.equal((await service.verify(second.id)).ok, true);
}));

test('verify reports a missing blob as integrity failure instead of throwing', () => setup(async (service, dataRoot) => {
  const artifact = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  await rm(blobPath(dataRoot, artifact.digest));
  const result = await service.verify(artifact.id);
  assert.equal(result.ok, false);
  assert.equal(result.missing, true);
  assert.equal(result.reason, 'missing');
}));

test('prepareContent refuses corrupt bytes', () => setup(async (service, dataRoot) => {
  const artifact = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  await writeFile(blobPath(dataRoot, artifact.digest), 'xxxxx');
  const prepared = await service.prepareContent(artifact.id);
  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, 'digest-mismatch');
}));

test('last metadata delete removes blob while non-last delete preserves it', () => setup(async (service, dataRoot) => {
  const first = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  const second = await service.ingest(request('hello'), { name: 'b', mediaType: 'text/plain' });
  const one = await service.remove(first.id);
  assert.equal(one.blobDeleted, false);
  assert.equal(await readFile(blobPath(dataRoot, first.digest), 'utf8'), 'hello');
  const two = await service.remove(second.id);
  assert.equal(two.blobDeleted, true);
  await assert.rejects(() => readFile(blobPath(dataRoot, first.digest)));
}));

test('oversize upload fails and leaves no artifact record', () => setup(async (service) => {
  await assert.rejects(() => service.ingest(request('x'.repeat(2000)), { name: 'a', mediaType: 'text/plain' }), /exceeds/);
  assert.equal(service.stats().records, 0);
}));

test('delete and identical re-upload are serialized safely', () => setup(async (service) => {
  const first = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  const [removed, second] = await Promise.all([
    service.remove(first.id),
    service.ingest(request('hello'), { name: 'b', mediaType: 'text/plain' }),
  ]);
  assert.equal(removed.removed, true);
  assert.equal((await service.verify(second.id)).ok, true);
  assert.equal(service.stats().records, 1);
}));

test('record capacity fails explicitly instead of growing metadata without bound', () => setup(async (service) => {
  await service.ingest(request('one'), { name: 'one', mediaType: 'text/plain' });
  await assert.rejects(
    () => service.ingest(request('two'), { name: 'two', mediaType: 'text/plain' }),
    /artifact record limit reached/,
  );
}, { limits: { maxArtifacts: 1 } }));

test('activity history remains bounded across verify operations', () => setup(async (service, dataRoot, store) => {
  const artifact = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  await service.verify(artifact.id);
  await service.verify(artifact.id);
  await service.verify(artifact.id);
  assert.equal(store.snapshot().activity.length, 3);
}, { limits: { maxActivity: 3 } }));

test('integrity audit detects corrupt referenced blobs and unreferenced orphan blobs without deleting them', () => setup(async (service, dataRoot) => {
  const artifact = await service.ingest(request('hello'), { name: 'a', mediaType: 'text/plain' });
  await writeFile(blobPath(dataRoot, artifact.digest), 'xxxxx');

  const orphanDigest = digestFor('orphan');
  const orphanPath = blobPath(dataRoot, orphanDigest);
  await mkdir(dirname(orphanPath), { recursive: true });
  await writeFile(orphanPath, 'orphan');

  const result = await service.auditIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.corrupt.length, 1);
  assert.equal(result.orphan.length, 1);
  assert.equal(await readFile(orphanPath, 'utf8'), 'orphan');
}));
