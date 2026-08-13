# InMyArtifact Integration Preparation

Status: **prepared_not_connected**.

Standalone v0.1 is not an ecosystem dependency. Its local `artifact://sha256/<hex>` content references are preparation artifacts only and grant no caller authority.

## Current standalone boundary

- no InMyHub registration;
- no ecosystem discovery;
- no cross-product calls;
- no direct cross-product database access;
- no remote synchronization;
- no production retention/pin/GC policy;
- `INMYARTIFACT_ECOSYSTEM_ENABLED=1` fails startup intentionally.

## Required future sequence

1. Reconcile ecosystem `art...` ownership/identity with digest-backed content-reference semantics.
2. Freeze a versioned central artifact reference/resolver contract.
3. Register exact read/write/verify/delete capabilities with InMyHub, default off.
4. Authorize every resolver operation independently from digest knowledge.
5. Define producer/product ownership and producer revision provenance.
6. Define sensitivity/export/sync rules and caller quotas.
7. Define pin/lease/retention/GC semantics before any background deletion exists.
8. Define backup/restore/reconciliation and corruption-recovery operations.
9. Pilot only new immutable outputs/evidence first; do not bulk-migrate historical data initially.
10. Add one bounded consumer at a time only after the resolver contract is accepted.

Candidate consumers after separate adoption gates may include:

- InMySandbox approved input/output artifact references;
- InMyCache dependency references without copying bytes;
- InMyR&D dataset/result references;
- other product outputs through an authorized resolver.

## Standalone retention rule is not the ecosystem policy

Standalone v0.1 keeps a blob while at least one local metadata record references it and attempts cleanup after the final explicit record deletion. There is no background/time-based GC.

That rule is deliberately conservative. It must not be promoted into a multi-product retention policy without authoritative ownership/pin semantics.

## Trust rule

A verified SHA-256 digest means the bytes match the referenced content identity. It does not mean the bytes are safe, approved, executable or authorized for a caller.

Do not enable integration simply by setting a URL or environment variable. Ecosystem adoption requires versioned contracts, Hub authority, tests, rollback/disable behavior and measured V2.x value.
