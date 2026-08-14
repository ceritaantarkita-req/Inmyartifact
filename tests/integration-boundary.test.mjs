import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationReadiness } from '../lib/integration.mjs';

test('integration stays disconnected while exposing resolver and persistent binding registry foundations', () => {
  const readiness = integrationReadiness();
  assert.equal(readiness.status, 'phase3_resolver_registry_foundation');
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
    persistentBindingRegistry: true,
    ownerControlledRetentionState: true,
    leaseExpiryDeletesBytes: false,
    retentionEnforcement: false,
    backgroundGc: false,
  });
  assert.ok(readiness.activationRequirements.includes('InMyHub capability/authority registration'));
  assert.ok(readiness.activationRequirements.includes('retention/GC enforcement policy'));
  assert.ok(readiness.guarantees.includes('expired leases never authorize automatic byte deletion'));
});
