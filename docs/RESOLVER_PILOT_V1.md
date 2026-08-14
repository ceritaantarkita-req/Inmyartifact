# InMyArtifact Resolver Pilot v1

Status: **V2.x Phase 3 implementation candidate — read-only pilot foundation; ecosystem adoption not yet authorized.**

Accepted standalone base entering Phase 3:

```text
InMyArtifact main: 7879db9965032bd260ed3e7c6736d1632dd0a710
Governance main:   7bc3a40752c3de82d466445cdbf739d368ef0dc7
```

## Purpose

Phase 3 evaluates whether InMyArtifact can become a governed resolver/CAS substrate for new immutable outputs and evidence without turning digest knowledge into authority or making products depend directly on Artifact storage internals.

The first slice deliberately adds only a bounded **in-process read-only resolver pilot foundation**. It does not expose a network API, register Hub capabilities, enable ecosystem callers, perform remote sync, mutate product ownership, or run garbage collection.

## Identity separation

Three identities remain distinct:

```text
ecosystem artifact identity: art_<opaque>
local standalone metadata id: artifact_<uuid>
content identity:             sha256:<64 hex>
```

The ecosystem `art_...` identity follows the governance `prefix_opaque` foundation rule. A digest identifies bytes and supports integrity verification, but knowing a digest never authorizes metadata or byte access.

The resolver has no `resolveByDigest` operation.

## Read-only operations

Pilot v1 exposes only two in-process operations:

```text
artifact.metadata.read
artifact.bytes.prepare
```

There is no resolver put, delete, retention mutation, pin mutation, lease mutation, GC, execute, extract or remote-transfer operation.

`artifact.bytes.prepare` verifies the current retained bytes through the accepted Artifact service before returning an authorized descriptor. It does not expose a filesystem path or local metadata identifier.

## Authorization boundary

Authorization is supplied as an explicit bounded pilot grant per caller. Every call is checked against:

- exact caller ID;
- exact operation;
- allowed owner product(s);
- maximum sensitivity;
- allowed sync class(es);
- maximum artifact byte size.

The resolver then checks that the bound local Artifact record still matches the immutable binding fields. Binding drift fails closed.

The pilot is default-disabled. `enabled=true` is benchmark/pilot configuration only and does not mean ecosystem connection or production authority.

## Ownership and provenance

Each pilot binding carries:

- ecosystem `artifactId`;
- local Artifact metadata ID used only inside the resolver adapter;
- digest, size and media type;
- owner product;
- sensitivity and sync class;
- producer and producer revision;
- product-authoritative retention intent.

The public resolver descriptor omits the local metadata ID and any filesystem path.

## Retention intent boundary

Pilot v1 models two product-authoritative retention intents:

```text
PRODUCT_PIN
PRODUCT_LEASE
```

`authorityProduct` must equal `ownerProduct`.

This is contract metadata only in the first slice. **Retention enforcement, lease expiry processing, background GC and deletion remain disabled.** That is intentional: a resolver contract must exist before bytes can be deleted under a multi-product policy.

## Integrity and corruption behavior

The accepted Artifact service remains source truth for local metadata and retained bytes.

Before a prepared read is accepted, the resolver requires:

- the bound local record still exists;
- immutable binding fields still match;
- the accepted Artifact integrity check reports matching digest and size.

Missing, corrupt or drifted content fails closed. The resolver does not repair, execute, extract or reinterpret content.

## Direct-access prohibition

Pilot v1 does not provide:

- direct Artifact database access;
- raw store/state access;
- caller-supplied filesystem paths;
- local blob paths;
- cross-product database calls;
- network transport;
- environment-secret access;
- process execution.

Consumers must eventually use an accepted resolver/API seam rather than reaching into Artifact storage because they know a digest.

## Phase 3 work still required after this slice

This first slice is not Phase 3 closure. Later gates still require evidence-backed implementation of:

1. persistent product-authoritative artifact binding/ownership state;
2. Hub capability/authority registration, default off;
3. bounded write/ingest path for approved new immutable outputs;
4. pin/lease/retention enforcement before any GC exists;
5. quota and transfer accounting at the accepted transport seam;
6. backup/restore/reconciliation procedures and target evidence;
7. corruption/recovery behavior under the resolver seam;
8. explicit disable/fallback behavior with an existing legacy/source path;
9. measured duplicate-content/storage value;
10. one bounded consumer pilot before broader adoption.

## Non-authorization

Passing this slice means only:

```text
PHASE3_RESOLVER_READONLY_FOUNDATION = CANDIDATE_PASS
```

It does not mean:

```text
INMYARTIFACT_ECOSYSTEM_ADOPTED = true
HUB_ARTIFACT_AUTHORITY_ENABLED = true
ARTIFACT_GC_ENABLED = true
PRODUCTS_MUST_USE_ARTIFACT = true
V2X_PHASE3 = CLOSED
```
