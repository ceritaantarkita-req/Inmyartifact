# InMyArtifact Architecture

InMyArtifact is a local content-addressed store for opaque bytes.

`bytes -> SHA-256 -> immutable blob path -> artifact metadata/ref`

Identical bytes share one physical blob. Multiple metadata records may reference it. Deleting one record removes the blob only when it is the last reference. Verification rereads the blob and recomputes SHA-256.

V0.1 deliberately does not parse archives, execute packages, scan content, sync remotely, or contact other InMy services.
