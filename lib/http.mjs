import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';

function loopbackAuthorities(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function assertLoopbackBind(host) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('InMyArtifact v0.1 is loopback-only');
}

export function requestAllowed(req, port) {
  const authority = String(req.headers.host || '').toLowerCase();
  const allowedAuthorities = loopbackAuthorities(port);
  if (!allowedAuthorities.has(authority)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && allowedAuthorities.has(parsed.host.toLowerCase()) && parsed.pathname === '/';
  } catch {
    return false;
  }
}

export async function readJson(req, max = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid JSON');
    error.status = 400;
    throw error;
  }
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export async function staticFile(res, root, path) {
  const rel = path === '/' ? 'index.html' : path.replace(/^\//, '');
  const safe = normalize(rel);
  const rootPath = resolve(root);
  const file = resolve(rootPath, safe);
  if (file !== rootPath && !file.startsWith(`${rootPath}${sep}`)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': data.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(data);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return false;
    throw error;
  }
}
