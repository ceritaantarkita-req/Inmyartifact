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

## V2.x Phase 3 resolver pilot candidate

The Phase 3 branch adds a deterministic **in-process, read-only resolver pilot foundation** over the accepted Artifact service.

It separates:

```text
ecosystem identity  art_<opaque>
local record id     artifact_<uuid>
content identity    sha256:<digest>
```

The resolver accepts only explicit `art_...` bindings and per-caller grants. Knowing a digest never authorizes access.

Pilot operations are limited to:

```text
artifact.metadata.read
artifact.bytes.prepare
```

Checks include exact caller/operation, owner product, sensitivity cap, allowed sync class, byte quota, binding drift and current content integrity. The returned descriptor does not expose the local Artifact record ID or any filesystem path.

Product-authoritative `PRODUCT_PIN` / `PRODUCT_LEASE` intent is represented in the pilot contract, but retention enforcement, lease expiry processing and GC remain disabled until a later Phase 3 gate.

See `docs/RESOLVER_PILOT_V1.md`.

## Still not implemented or adopted

- malware scanning or trust classification of bytes;
- archive extraction or package installation;
- artifact execution;
- remote sync or distributed storage;
- background/time-based garbage collection;
- production ecosystem callers or Hub authority;
- cross-product database access;
- credential storage;
- persistent ecosystem ownership/binding registry;
- enforced production retention/pin/lease policy;
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

The Phase 3 resolver pilot does not silently replace this rule. Multi-product pin/lease/retention/GC enforcement remains separately gated.

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

Exact-head Phase 3 acceptance uses the local Ubuntu/WSL procedure documented on the Phase 3 branch. GitHub-hosted Actions is not an acceptance dependency while hosted billing/runner constraints apply.

## Integration boundary

`INMYARTIFACT_ECOSYSTEM_ENABLED=1` remains intentionally unsupported by the standalone server. The resolver pilot is not exposed through the server or registered with InMyHub.

A later Phase 3 gate must separately accept persistent ownership bindings, Hub authority, retention enforcement/GC, backup/restore/reconciliation, bounded transport, one consumer pilot and measured storage value before ecosystem adoption can be declared.
