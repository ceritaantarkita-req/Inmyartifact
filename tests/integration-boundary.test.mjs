import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationReadiness } from '../lib/integration.mjs';

test('integration stays disconnected while exposing resolver, registry and recovery foundations', () => {
  const readiness = integrationReadiness();
  assert.equal(readiness.status, 'phase3_reconciliation_recovery_foundation');
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
    reconciliationPlanner: true,
    reconciliationAutomaticDeletesAllowed: false,
    coldBackupRestoreEvidence: 'candidate',
    corruptionRecoveryEvidence: 'candidate',
    retentionEnforcement: false,
    backgroundGc: false,
  });
  assert.ok(readiness.activationRequirements.includes('InMyHub capability/authority registration'));
  assert.ok(readiness.activationRequirements.includes('explicit retention/GC decision with owner authority and rollback'));
  assert.ok(readiness.activationRequirements.includes('measured duplicate-content/storage benefit'));
  assert.ok(readiness.guarantees.includes('expired leases never authorize automatic byte deletion'));
  assert.ok(readiness.guarantees.includes('reconciliation emits no GC candidates and grants no automatic deletion authority'));
});
