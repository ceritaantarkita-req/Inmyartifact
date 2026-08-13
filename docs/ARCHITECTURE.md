# InMyArtifact Architecture

Status: **standalone implementation v0.1 — candidate hardening**

## Role

InMyArtifact is a local content-addressed store for opaque bytes.

```text
bytes -> SHA-256 -> immutable digest path -> artifact metadata/content ref
```

Identical bytes share one physical blob. Multiple local metadata records may reference the same digest. `artifact://sha256/<hex>` is a content reference, not an authorization token and not yet the final ecosystem `art...` ownership identity.

## Runtime boundary

- Node.js 22 standard library only.
- Loopback-only HTTP service.
- Exact configured-port Host/Origin request boundary.
- No outbound network calls.
- No shell/process execution of artifact content.
- No archive extraction or package installation.
- No arbitrary caller-supplied filesystem paths.
- No cross-product database access.
- `INMYARTIFACT_ECOSYSTEM_ENABLED=1` fails startup intentionally.

## Storage model

The service owns one local data root:

```text
state.json
blobs/sha256/<prefix>/<64-hex>
tmp/*.part
```

Blob paths are derived only from validated SHA-256 digests. Filenames remain metadata and never select storage paths.

Lifecycle-mutating operations are serialized within the standalone service so ingest, verify and delete cannot race one another inside one process.

### Durable metadata

State schema version `1` is validated before use. Metadata includes:

- local artifact record ID;
- content reference and SHA-256 digest;
- sanitized display filename;
- canonical media type;
- byte size;
- sensitivity class;
- sync class metadata;
- producer and producer revision;
- creation and last successful verification timestamps.

The sync class is metadata only in standalone v0.1; no synchronization is enabled.

### Safety bounds

Default standalone bounds:

```text
max upload:       20 MiB
artifact records: 1000
unique blobs:     500
physical bytes:   1 GiB
activity records: 500
```

The upload environment override is itself bounded to 100 MiB and must be a positive integer. Port configuration must be an integer from 1024 through 65535.

## Integrity semantics

- New bytes are hashed while streaming.
- Existing digest-path content is rechecked before being treated as a dedup hit.
- If a digest-path blob is corrupt and the caller uploads the correct bytes for that digest, the service replaces the corrupt local blob under the serialized lifecycle boundary.
- Explicit verification hashes the retained blob again.
- Download prepares content only after size/digest verification; missing/corrupt bytes fail closed rather than being served.
- The integrity audit reports missing, corrupt and orphan blobs without deleting anything.

SHA-256 establishes identity/integrity evidence only. It does not establish trustworthiness or authorization.

## Persistence ordering

Metadata mutations are validated and durably persisted before the in-memory committed state advances. A failed persistence attempt does not intentionally publish the draft as committed memory state.

Blob creation precedes metadata commit because metadata must never reference bytes that were never stored. If new-blob metadata commit fails and no accepted record references that digest, the service attempts to remove the newly written orphan.

Last-reference deletion persists removal of the metadata record first and then attempts blob cleanup. If cleanup cannot complete, the safe failure mode is an orphan blob rather than metadata pointing to missing bytes. Integrity audit can surface such orphans; standalone v0.1 does not auto-delete them.

## Retention / GC boundary

Standalone v0.1 has no background or time-based GC.

```text
record retained until explicit delete
blob retained while >= 1 record references digest
last explicit reference delete attempts blob removal
orphan audit is non-destructive
```

Authoritative product ownership, pins, leases, retention windows and ecosystem GC remain a later V2.x resolver-pilot contract. This standalone rule must not be presented as the final ecosystem retention policy.

## Backup / restore principle

The whole data root is one consistency unit. For manual standalone backup/restore, stop the service, copy `state.json` plus `blobs/` together, restore them together, then run the integrity audit before relying on restored content.

A later ecosystem pilot needs explicit operational backup/restore/reconciliation procedures and target evidence.

## Integration boundary

Standalone storage does not create ecosystem authority. Future adoption requires a reviewed resolver/API layer, Hub capability checks, product ownership/reference semantics, classification/export policy, quotas and retention/GC rules. Products must not gain direct access to this store's metadata database or filesystem merely because they know a digest.
