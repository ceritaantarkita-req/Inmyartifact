import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAllowed } from '../lib/http.mjs';

test('host guard rejects a non-loopback host', () => {
  assert.equal(requestAllowed({ headers: { host: 'remote.example:17432' } }, 17432), false);
});

test('loopback host requires the configured port', () => {
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1:17432' } }, 17432), true);
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1:17433' } }, 17432), false);
});

test('origin must use the same loopback authority', () => {
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1:17432', origin: 'http://127.0.0.1:17432' } }, 17432), true);
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1:17432', origin: 'http://127.0.0.1:17433' } }, 17432), false);
});
