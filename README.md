# InMyArtifact

Repository: `Inmyartifact` (existing GitHub casing preserved). Product/UI name: **InMyArtifact**.

Standalone full-stack content-addressed artifact store.

Implemented: browser UI, REST API, streaming bounded uploads, SHA-256 addressing, deduplicated blobs, metadata records, download, explicit integrity verification, last-reference cleanup, atomic metadata persistence, integration contracts, tests and smoke QA.

Not implemented: malware scanning, archive extraction, remote sync, distributed storage, ecosystem callers, credential storage, artifact execution, automatic garbage collection beyond last-record deletion.

Node 22+: run `npm test`, `npm run smoke`, `npm start`, then open `http://127.0.0.1:17432`.
