# InMyArtifact Reconciliation & Recovery v1

Status: **V2.x Phase 3 candidate — non-destructive recovery foundation**

This slice builds on the accepted read-only resolver foundation and accepted persistent product-owned binding registry.

It does not authorize automatic GC, byte deletion on lease expiry, Hub Artifact authority or production ecosystem connection.

## Objective

Phase 3 needs evidence that retained ecosystem references cannot silently lose required bytes and that a cold backup can restore both Artifact content and the product-owned `art_...` binding state.

The recovery boundary treats the following as one consistency unit:

```text
Artifact state.json
Artifact blobs/sha256/...
resolver-registry.json
```

The resolver registry must not be restored independently from the Artifact metadata/blob set that its bindings describe.

## Reconciliation model

`lib/reconciliation.mjs` is deterministic and non-destructive. It consumes:

- current persistent resolver bindings;
- current Artifact metadata records;
- current Artifact integrity-audit output;
- an explicit observation timestamp.

It emits a frozen `artifact-reconciliation-report-v1` report.

Possible top-level states:

```text
HEALTHY
REVIEW_REQUIRED
RESTORE_OR_RECONCILE_REQUIRED
```

The report is deliberately incapable of authorizing deletion:

```text
automaticDeletesAllowed = false
gcCandidates = []
```

### Blocking findings

A retained ecosystem reference is considered unsafe when any of these conditions is observed:

- its bound local Artifact metadata record is missing;
- current Artifact metadata has drifted from the binding;
- referenced content bytes are missing;
- referenced content bytes are corrupt.

Those findings produce `RESTORE_OR_RECONCILE_REQUIRED`.

### Review findings

These remain review-only:

- expired product lease;
- local Artifact metadata with no ecosystem binding;
- orphan physical blob discovered by integrity audit.

Expired lease behavior is intentionally conservative:

```text
LEASE_EXPIRED_OWNER_REVIEW
-> owner review required
-> no automatic delete authority
-> no GC candidate emitted
```

An orphan blob similarly does not become a delete candidate automatically. The existing standalone non-destructive integrity audit remains the source of orphan discovery.

## Cold backup/restore evidence model

`scripts/recovery-smoke.mjs` exercises a clean local recovery sequence:

1. create a temporary Artifact data root;
2. ingest immutable evidence bytes;
3. persist a product-owned `art_...` binding in `resolver-registry.json`;
4. verify reconciliation is healthy;
5. verify the read-only resolver can prepare the bound content;
6. copy the complete consistency unit to a cold backup directory;
7. corrupt the active blob;
8. prove integrity audit and reconciliation detect the retained-reference failure;
9. prove the failure does not produce delete authority or GC candidates;
10. restore the complete consistency unit from the cold backup into a clean location;
11. reinitialize Artifact storage and resolver registry;
12. prove the same ecosystem `art_...` identity and digest are preserved;
13. prove integrity audit returns healthy;
14. prove the read-only resolver again prepares verified content.

This is an evidence harness, not an online backup daemon. It does not introduce background copying, remote synchronization or privileged restoration endpoints.

## Corruption handling

Corruption detection remains fail closed.

A corrupt retained blob causes:

```text
BOUND_CONTENT_CORRUPT
RESTORE_OR_RECONCILE_REQUIRED
```

The resolver does not serve corrupt bytes, and reconciliation does not delete the corrupt blob automatically.

Recovery can use a separately verified backup or the existing explicit re-ingest repair behavior where the correct bytes are available. Choosing the operational recovery source remains outside this candidate module.

## Retention and GC boundary

This slice deliberately stops before deletion authority.

Current accepted intent remains:

```text
PRODUCT_PIN
-> retained

PRODUCT_LEASE active
-> retained

PRODUCT_LEASE expired
-> owner review required
-> not eligible for automatic GC
```

Before any future deletion/GC pilot can exist, governance must separately define:

- exact owner authorization for release;
- required evidence that no retained ecosystem reference still depends on the bytes;
- race/idempotency semantics;
- grace period or tombstone policy if adopted;
- rollback/recovery behavior for ambiguous deletion outcome;
- backup evidence before destructive cleanup where required;
- bounded batch size/quota;
- explicit disable path;
- target-runtime acceptance.

## Security boundary

The reconciliation module itself has no direct filesystem, network, environment-secret or process-execution primitive.

Filesystem copying exists only in the local recovery smoke harness used for target evidence.

No raw filesystem path is added to resolver output, ecosystem identity or cross-product contracts.

## Non-goals

This candidate does not provide:

- production backup scheduling;
- remote backup transport;
- distributed CAS replication;
- automated restore endpoints;
- automatic orphan deletion;
- automatic expired-lease deletion;
- malware/content trust scanning;
- Artifact execution/extraction;
- Hub capability activation;
- cross-product database access;
- production consumer adoption.

## Acceptance meaning

A successful exact-head run means only:

```text
PHASE3_BACKUP_RESTORE_RECONCILIATION = CANDIDATE_PASS
PHASE3_CORRUPTION_RECOVERY = CANDIDATE_PASS
```

It does not mean:

```text
ARTIFACT_GC_ENABLED = true
RETENTION_DELETE_AUTHORITY = true
INMYARTIFACT_ECOSYSTEM_ADOPTED = true
V2X_PHASE3 = CLOSED
```
