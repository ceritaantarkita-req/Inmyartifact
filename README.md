# InMyArtifact

Repository: `Inmyartifact` (existing GitHub casing preserved). Product/UI name: **InMyArtifact**.

InMyArtifact began as a standalone, local-first content-addressed store for opaque artifact bytes. V2.x Phase 3 now evaluates a bounded resolver/CAS pilot without changing the accepted standalone storage semantics.

## Accepted standalone storage scope

Implemented:

- browser UI and loopback-only REST API;
- bounded streaming uploads;
- SHA-256 content addressing and physical blob deduplication;
- immutable digest-derived blob paths;
- local metadata records and explicit content references;
- strict media-type and metadata normalization;
- sensitivity metadata (`PUBLIC`, `INTERNAL`, `SENSITIVE`, `RESTRICTED`);
- sync-class metadata (`LOCAL_ONLY`, `SYNC_ENCRYPTED`, `CLOUD_ALLOWED`, `PUBLIC`) without enabling sync;
- producer and producer-revision provenance fields;
- explicit digest verification;
- integrity audit for missing/corrupt referenced blobs and non-destructive orphan discovery;
- digest-verified downloads that fail closed on missing/corrupt content;
- last-reference blob cleanup;
- serialized ingest/verify/delete lifecycle operations;
- validated atomic metadata persistence;
- bounded metadata/activity/unique-blob/physical-byte state;
- prepared-but-disabled ecosystem contracts;
- unit/boundary tests and full-stack smoke QA.

## V2.x Phase 3 resolver/CAS pilot

The Phase 3 branch contains a deterministic **in-process, read-only resolver foundation** over the accepted Artifact service.

It separates:

```text
ecosystem identity  art_<opaque>
local record id     artifact_<uuid>
content identity    sha256:<digest>
```

The resolver accepts only explicit `art_...` bindings and per-caller grants. Knowing a digest never authorizes access.

Pilot operations remain limited to:

```text
artifact.metadata.read
artifact.bytes.prepare
```

Checks include exact caller/operation, owner product, sensitivity cap, allowed sync class, byte quota, binding drift and current content integrity. Resolver output does not expose the local Artifact record ID or any filesystem path.

The branch also contains a **persistent product-owned binding registry foundation**. It persists bounded `art_...` -> local Artifact mappings and `PRODUCT_PIN` / `PRODUCT_LEASE` intent through the existing validated store abstraction. Only the owner product may register a binding or change retention intent, and a binding must match current Artifact source truth before registration.

Lease expiry remains diagnostic only:

```text
LEASE_EXPIRED_REVIEW_REQUIRED
eligibleForGc = false
```

The newest candidate slice adds **non-destructive reconciliation plus cold backup/restore and corruption-recovery evidence**. Reconciliation can classify retained-reference failure, binding drift, expired leases, unbound records and orphan blobs, but its contract fixes:

```text
automaticDeletesAllowed = false
gcCandidates = []
```

The recovery smoke treats `state.json`, `blobs/` and `resolver-registry.json` as one consistency unit, proves corruption is detected as restore-required, restores that unit into a clean runtime and verifies that the same `art_...` identity can again prepare verified content.

See:

- `docs/RESOLVER_PILOT_V1.md`;
- `docs/RESOLVER_REGISTRY_V1.md`;
- `docs/RECONCILIATION_RECOVERY_V1.md`.

## Still not implemented or adopted

- malware scanning or trust classification of bytes;
- archive extraction or package installation;
- artifact execution;
- remote sync or distributed storage;
- background/time-based garbage collection;
- production ecosystem callers or Hub authority;
- cross-product database access;
- credential storage;
- enforced production retention/pin/lease deletion policy;
- automatic deletion on lease expiry;
- production backup scheduling or remote backup transport;
- production restore endpoint;
- automatic V2.x resolver/CAS adoption.

SHA-256 is content identity and integrity evidence. It is not authorization and does not establish that content is safe.

## Standalone retention rule

The accepted standalone storage policy remains deliberately simple and fail-safe:

```text
metadata record persists until explicit delete
blob persists while at least one metadata record references its digest
last explicit reference deletion attempts blob cleanup
no background/time-based GC
integrity audit reports orphan blobs but does not delete them
```

The Phase 3 resolver, registry and reconciliation candidates do not silently replace this rule. Multi-product retention/GC enforcement remains separately gated.

## Run

Requires Node.js 22+.

```bash
npm start
```

Open `http://127.0.0.1:17432`.

## QA

```bash
npm run qa
```

The Phase 3 candidate QA includes syntax checks, full tests, standalone smoke and a local cold backup/restore corruption-recovery smoke.

Exact-head Phase 3 acceptance uses the local Ubuntu/WSL procedures documented on the Phase 3 branch. GitHub-hosted Actions is not an acceptance dependency while hosted billing/runner constraints apply.

## Integration boundary

`INMYARTIFACT_ECOSYSTEM_ENABLED=1` remains intentionally unsupported by the standalone server. The resolver, registry and reconciliation candidates are not exposed through the server or registered with InMyHub.

A later Phase 3 gate must separately make an explicit retention/GC decision, define Hub authority, add one bounded consumer pilot, and measure duplicate-content/storage value before ecosystem adoption can be declared.
