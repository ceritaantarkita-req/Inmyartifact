# InMyArtifact

Repository: `Inmyartifact` (existing GitHub casing preserved). Product/UI name: **InMyArtifact**.

InMyArtifact v0.1 is a standalone, local-first content-addressed store for opaque artifact bytes.

## Current standalone scope

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

Not implemented:

- malware scanning or trust classification of bytes;
- archive extraction or package installation;
- artifact execution;
- remote sync or distributed storage;
- background/time-based garbage collection;
- ecosystem callers or Hub authority;
- cross-product database access;
- credential storage;
- production retention/pin policy;
- V2.x resolver/CAS adoption.

SHA-256 is content identity and integrity evidence. It is not authorization and does not establish that content is safe.

## Retention rule in standalone v0.1

The standalone policy is deliberately simple and fail-safe:

```text
metadata record persists until explicit delete
blob persists while at least one metadata record references its digest
last explicit reference deletion attempts blob cleanup
no background/time-based GC
integrity audit reports orphan blobs but does not delete them
```

Pins, product ownership, authoritative retention and GC are later V2.x ecosystem-pilot gates.

## Run

Requires Node.js 22+.

```bash
npm start
```

Open `http://127.0.0.1:17432`.

## QA

```bash
npm test
npm run smoke
```

Final standalone acceptance should use the clean exact-head WSL/local procedure in `docs/LOCAL_ACCEPTANCE.md`. GitHub-hosted Actions is not the default acceptance path while paid-hosted runner/billing constraints apply.

## Integration boundary

`INMYARTIFACT_ECOSYSTEM_ENABLED=1` intentionally fails startup in v0.1. See `docs/INTEGRATION.md`.

Standalone acceptance, if achieved, does not adopt InMyArtifact into the ecosystem. A later V2.x Artifact/CAS resolver pilot must separately define Hub authorization, `art...` ownership/reference semantics, retention/pins/GC, quotas, resolver contracts, backup/restore operations and measured benefit.
