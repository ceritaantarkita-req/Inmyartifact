# Integration Preparation

Status: **prepared, not connected**.

Recommended future sequence:
1. Freeze `artifact://sha256/<hex>` and metadata contract in central governance.
2. Register read/write/verify capabilities with InMyHub, default off.
3. Add caller identity, quota, classification and retention policy.
4. Let InMySandbox import approved artifact refs into `/input` and export `/output` back as new refs.
5. Let InMyCache record artifact refs as dependencies, not copy artifact bytes.
6. Let InMyR&D reference datasets/results by digest.
7. Add GC only after reference ownership semantics are authoritative.

No direct cross-product database access should be introduced.
