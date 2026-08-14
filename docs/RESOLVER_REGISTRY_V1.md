# InMyArtifact Resolver Binding Registry v1

Status: **V2.x Phase 3 candidate foundation; persistent metadata state only; ecosystem disconnected.**

## Purpose

The registry gives the Phase 3 read-only resolver a persistent, product-owned mapping between ecosystem artifact identity and the accepted local InMyArtifact record/content identity.

It separates three identities:

```text
art_<opaque>       ecosystem artifact identity
artifact_<uuid>    local InMyArtifact metadata record identity
sha256:<digest>    content identity and integrity evidence
```

Digest knowledge remains non-authoritative.

## Persistent state

The registry state contract is versioned as `1.0.0` and contains only bounded binding metadata. Each binding stores:

- ecosystem `art_...` ID;
- local Artifact record ID;
- digest and byte size;
- media type;
- owner product;
- sensitivity and sync class;
- producer and producer revision;
- product-owned retention intent;
- registration/update timestamps.

The default total binding limit is 256.

The registry uses the injected validated store abstraction. The registry core itself does not open files, use network primitives, read environment secrets, or execute child processes.

## Registration authority

A binding may be registered only when:

- the declared actor is exactly the binding `ownerProduct`;
- retention authority is exactly the same owner product;
- the referenced local Artifact record exists;
- digest, size, media type, sensitivity, sync class, producer and producer revision all still match current Artifact source truth;
- neither the ecosystem `artifactId` nor the local record is already bound;
- the bounded registry capacity has not been reached.

This is a product-ownership foundation, not Hub authorization. InMyHub capability/authority registration remains a later gate.

## Retention intent

Two metadata states are represented:

```text
PRODUCT_PIN
PRODUCT_LEASE
```

Only the artifact owner product may change retention intent.

A pin evaluates to:

```text
PINNED
eligibleForGc = false
```

A lease evaluates to either:

```text
LEASE_ACTIVE
```

or, after its expiry timestamp:

```text
LEASE_EXPIRED_REVIEW_REQUIRED
```

An expired lease **does not authorize deletion**. The candidate always reports:

```text
eligibleForGc = false
```

until a later retention/GC authority and recovery gate is explicitly accepted.

No background expiry worker exists.

## Resolver handoff

`registry.resolverBindings()` returns the exact binding shape consumed by the accepted read-only `ArtifactResolverPilot`.

Registry-internal timestamps are not part of the public resolver descriptor.

The resolver still applies its own caller/operation/owner/sensitivity/sync/byte authorization and source-drift/integrity checks. Persistence does not weaken those defenses.

## Explicit non-goals

This slice does not add or authorize:

- ecosystem server activation;
- Hub authority or capability registration;
- remote clients;
- cross-product DB/filesystem access;
- Artifact byte writes through the resolver;
- Artifact delete through the resolver;
- background lease processing;
- GC eligibility or deletion;
- malware scanning or execution trust;
- backup/restore completion;
- automatic consumer adoption.

## Next gate

After exact-head local acceptance of this registry foundation, Phase 3 can define a separate retention/GC **decision and recovery contract**. That gate must prove that retained references cannot silently lose required bytes and that corruption/restore/reconciliation paths work before any automatic deletion is considered.
