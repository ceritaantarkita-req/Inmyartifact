import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationReadiness } from '../lib/integration.mjs';

test('integration stays disconnected while exposing only a read-only resolver pilot foundation', () => {
  const readiness = integrationReadiness();
  assert.equal(readiness.status, 'phase3_resolver_pilot_foundation');
  assert.equal(readiness.ecosystemConnected, false);
  assert.equal(readiness.authorityProvider, null);
  assert.deepEqual(readiness.resolverPilot, {
    available: true,
    mode: 'pilot-read-only',
    defaultEnabled: false,
    productionAuthority: false,
    digestKnowledgeAuthorizes: false,
    directDatabaseAccess: false,
    directFilesystemPathExposure: false,
    writeOperations: false,
    retentionEnforcement: false,
    backgroundGc: false,
  });
});
