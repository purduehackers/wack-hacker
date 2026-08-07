# Supply-chain controls

The image workflow is the release record:

- Every GitHub Action is referenced by a full commit SHA; the adjacent comment
  names the reviewed release. Dependabot or a reviewed PR should update both.
- Both Docker stages use the same immutable `oven/bun` index digest. The human
  version remains in the reference for readability.
- The Bun and Vercel CLI versions are exact. The database workflow verifies the
  exact Turso CLI archive SHA-256 before execution.
- `bun install --frozen-lockfile`, format/type/lint/test, production dependency
  audit, migration validation, and a `linux/amd64` image build run in CI.
- BuildKit emits maximum SLSA provenance. A checksum-pinned Syft binary exports a
  reviewable SPDX JSON SBOM. Trivy blocks fixable HIGH/CRITICAL findings.
- Cosign signs the immutable VCR digest keylessly using the workflow's GitHub
  OIDC identity. Promotion checks that repository/workflow identity and issuer,
  rescans the digest, and never accepts a mutable tag.

Do not weaken a scan inline. A temporary exception needs an owner, expiry,
advisory/CVE, proof that the vulnerable path is absent, and a reviewed policy
file. The existing Bun-audit ignore is dev-only and documented in the root
README; it is not present in the runtime image.

Registry retention must preserve every production and rollback digest plus its
OCI attestations/signature. Deleting a tag is not rollback and does not alter an
immutable digest. If VCR garbage-collects an old digest, it is no longer a valid
rollback candidate and must be rebuilt, rescanned, resigned, and reviewed as a
new release.
