import http from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './lib/store.mjs';
import { ArtifactService, DEFAULT_LIMITS, initialState, validateState } from './lib/artifact.mjs';
import { integrationReadiness } from './lib/integration.mjs';
import { assertLoopbackBind, json, requestAllowed, staticFile } from './lib/http.mjs';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInteger(process.env.PORT, 17432, { min: 1024, max: 65535, name: 'PORT' });
const MAX_UPLOAD = parseInteger(process.env.INMYARTIFACT_MAX_UPLOAD, 20 * 1024 * 1024, {
  min: 1,
  max: 100 * 1024 * 1024,
  name: 'INMYARTIFACT_MAX_UPLOAD',
});

assertLoopbackBind(HOST);
if (process.env.INMYARTIFACT_ECOSYSTEM_ENABLED === '1') {
  throw new Error('Ecosystem connection is intentionally disabled in standalone v0.1');
}

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataRoot = resolve(process.env.INMYARTIFACT_DATA || `${appRoot}/data`);
const limits = { ...DEFAULT_LIMITS };
const validator = (state) => validateState(state, limits);
const store = await new JsonStore(resolve(dataRoot, 'state.json'), initialState(), validator).init();
const artifacts = await new ArtifactService(store, dataRoot, { maxUploadBytes: MAX_UPLOAD, limits }).init();

function parseInteger(raw, fallback, { min, max, name }) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw))) throw new Error(`invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`invalid ${name}`);
  return value;
}

function uploadMetadata(req) {
  return {
    name: req.headers['x-artifact-name'],
    mediaType: req.headers['content-type'],
    sensitivity: req.headers['x-artifact-sensitivity'],
    syncClass: req.headers['x-artifact-sync-class'],
    producer: req.headers['x-artifact-producer'],
    producerRevision: req.headers['x-artifact-producer-revision'],
  };
}

function declaredLength(req) {
  const raw = req.headers['content-length'];
  if (raw === undefined) return null;
  if (!/^\d+$/.test(String(raw))) {
    const error = new Error('invalid content-length');
    error.status = 400;
    throw error;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error('invalid content-length');
    error.status = 400;
    throw error;
  }
  return value;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!requestAllowed(req, PORT)) return json(res, 403, { error: 'local request boundary rejected' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        product: 'InMyArtifact',
        version: '0.1.0',
        standalone: true,
        ecosystemConnected: false,
        maxUploadBytes: artifacts.maxUploadBytes,
        limits,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/integration-readiness') return json(res, 200, integrationReadiness());
    if (req.method === 'GET' && url.pathname === '/api/artifacts') return json(res, 200, artifacts.list());
    if (req.method === 'GET' && url.pathname === '/api/stats') return json(res, 200, artifacts.stats());
    if (req.method === 'GET' && url.pathname === '/api/activity') return json(res, 200, artifacts.activity());
    if (req.method === 'POST' && url.pathname === '/api/integrity/audit') return json(res, 200, await artifacts.auditIntegrity());

    if (req.method === 'POST' && url.pathname === '/api/artifacts') {
      const length = declaredLength(req);
      if (length !== null && length > artifacts.maxUploadBytes) return json(res, 413, { error: 'artifact too large' });
      return json(res, 201, await artifacts.ingest(req, uploadMetadata(req)));
    }

    const artifactMatch = url.pathname.match(/^\/api\/artifacts\/(artifact_[A-Za-z0-9-]+)$/);
    if (artifactMatch && req.method === 'GET') {
      const artifact = artifacts.get(artifactMatch[1]);
      return artifact ? json(res, 200, artifact) : json(res, 404, { error: 'not found' });
    }
    if (artifactMatch && req.method === 'DELETE') {
      const result = await artifacts.remove(artifactMatch[1]);
      return result ? json(res, 200, result) : json(res, 404, { error: 'not found' });
    }

    const verifyMatch = url.pathname.match(/^\/api\/artifacts\/(artifact_[A-Za-z0-9-]+)\/verify$/);
    if (verifyMatch && req.method === 'POST') {
      const result = await artifacts.verify(verifyMatch[1]);
      return result ? json(res, result.ok ? 200 : 409, result) : json(res, 404, { error: 'not found' });
    }

    const contentMatch = url.pathname.match(/^\/api\/artifacts\/(artifact_[A-Za-z0-9-]+)\/content$/);
    if (contentMatch && req.method === 'GET') {
      const prepared = await artifacts.prepareContent(contentMatch[1]);
      if (!prepared) return json(res, 404, { error: 'not found' });
      if (!prepared.ok) {
        return json(res, 409, {
          error: 'artifact integrity check failed',
          missing: prepared.missing,
          reason: prepared.reason,
          expected: prepared.artifact.digest,
          actual: prepared.actual,
          expectedSize: prepared.artifact.size,
          actualSize: prepared.size,
        });
      }
      const artifact = prepared.artifact;
      res.writeHead(200, {
        'content-type': artifact.mediaType,
        'content-length': artifact.size,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        'x-content-sha256': artifact.digest,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      });
      const stream = createReadStream(artifacts.pathFor(artifact));
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (await staticFile(res, resolve(appRoot, 'public'), url.pathname)) return;
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    if (res.headersSent) return res.destroy();
    return json(res, error.status || 500, { error: error.message || 'request failed' });
  }
});

server.listen(PORT, HOST, () => console.log(`InMyArtifact http://${HOST}:${PORT}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
