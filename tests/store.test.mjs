import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../lib/store.mjs';

const seed = { schemaVersion: 1, value: 0 };
const validate = (state) => {
  if (!state || state.schemaVersion !== 1 || !Number.isInteger(state.value) || state.value < 0) {
    throw new Error('invalid test state');
  }
};

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-store-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('store initializes a missing file with a validated seed', () => withDir(async (dir) => {
  const file = join(dir, 'state.json');
  const store = await new JsonStore(file, seed, validate).init();
  assert.deepEqual(store.snapshot(), seed);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), seed);
}));

test('store fails closed on corrupt JSON', () => withDir(async (dir) => {
  const file = join(dir, 'state.json');
  await writeFile(file, '{bad');
  await assert.rejects(() => new JsonStore(file, seed, validate).init());
}));

test('invalid update is rejected without changing the in-memory state', () => withDir(async (dir) => {
  const file = join(dir, 'state.json');
  const store = await new JsonStore(file, seed, validate).init();
  await assert.rejects(() => store.mutate((draft) => { draft.value = -1; }), /invalid test state/);
  assert.equal(store.snapshot().value, 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).value, 0);
}));
