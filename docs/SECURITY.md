# InMyArtifact Security Boundary

Status: **standalone v0.1 candidate hardening**

## Defaults

- Loopback-only listener.
- Exact configured-port Host/Origin validation.
- Port and upload-limit environment values are strictly bounded before listen.
- Upload size is bounded before and during streaming.
- Filenames are metadata only and sanitized; they never determine storage paths.
- Media types are normalized to a bounded MIME token shape before reuse as response headers.
- Blob paths derive only from validated SHA-256 digests.
- Downloads force attachment, include digest metadata and verify retained content before serving it.
- Blob bytes remain opaque: no extraction, package installation or execution.
- No credentials, external network calls, shell, arbitrary host paths or cross-product DB access.
- Ecosystem enablement fails closed in standalone v0.1.

## Integrity and corruption

SHA-256 provides content identity/integrity evidence, not content safety and not authorization.

The standalone service:

- checks an existing digest-path blob before treating it as a dedup hit;
- can replace a corrupt digest-path blob when the correct bytes are uploaded under the serialized lifecycle boundary;
- reports missing/corrupt retained blobs explicitly;
- refuses download of missing/corrupt retained content;
- provides a non-destructive integrity audit that also reports orphan blobs.

## Persistence and bounds

Durable state is schema/shape validated before use and before commit. Metadata collections, activity history, unique blobs and physical-byte accounting are bounded.

Metadata commit failure does not intentionally advance committed in-memory state. New-blob metadata failure attempts orphan cleanup when no accepted metadata record references the new digest.

Last-reference cleanup prefers metadata safety over aggressive deletion: if physical cleanup cannot complete after metadata deletion, an orphan may remain and is surfaced by integrity audit. Standalone v0.1 does not run destructive background GC.

## Retention and authorization

Standalone retention is explicit-record/reference-count based only. There is no product-authoritative pin/lease/retention policy yet.

Knowing `artifact://sha256/<hex>` or a SHA-256 digest grants **no authority**. Any later ecosystem resolver must authorize the caller independently from digest knowledge and preserve product ownership, sensitivity/export policy, quotas and audit evidence.

## Opaque content

InMyArtifact does not claim uploaded bytes are safe. Consumers must apply their own accepted content-handling policy rather than trusting an artifact solely because its digest verifies.
