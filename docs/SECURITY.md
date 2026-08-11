# Security

- Loopback-only API with Host/Origin validation.
- Upload size is bounded before and during streaming.
- Filenames are metadata only and sanitized; they never determine storage paths.
- Blob path is derived only from validated SHA-256 digest.
- Blob bytes are opaque: no extraction, parsing or execution.
- Downloads force attachment and include digest metadata.
- Digest verification is explicit and auditable.
- No credentials, external network, shell, ecosystem calls, or arbitrary host path access.
- SHA-256 provides content identity/integrity evidence; it does not establish that content is safe or trustworthy.
