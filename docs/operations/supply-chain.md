# Supply-chain controls

The image workflow is the release record:

- Every GitHub Action is referenced by a full commit SHA; the adjacent comment
  names the reviewed release. Dependabot or a reviewed PR should update both.
- Both Docker stages use the same immutable `oven/bun` index digest. The human
  version remains in the reference for readability.
- The Bun and Vercel CLI versions are exact, and the Syft archive is checked
  against a pinned SHA-256 before execution. The database workflow no longer
  installs the Turso CLI: it recorded a restore point instead of cloning, and
  the clone was the only thing that needed it.
- `bun install --frozen-lockfile`, format/type/lint, production dependency audit,
  migration validation, and a `linux/amd64` image build run in CI. There is no
  automated test suite, so an attested image is backed by static checks and
  builds only, never by a passing test run.
- BuildKit emits maximum SLSA provenance. A checksum-pinned Syft binary exports a
  reviewable SPDX JSON SBOM. Trivy blocks fixable HIGH/CRITICAL findings.
- Provenance and the SBOM are attested to **GitHub's attestation store**,
  keyless, under this workflow's GitHub OIDC identity. They are not attached to
  the image in VCR: the registry rejects cosign's signature layer
  (`MANIFEST_INVALID: unsupported layer mediaType;
application/vnd.dev.cosign.simplesigning.v1+json`), and `cosign attest` has no
  `--registry-referrers-mode`, so OCI 1.1 referrers cannot carry the SBOM or
  provenance either. The release verifies both predicate types against this
  repository's `image.yml` before pinning, and never accepts a mutable tag.

Do not weaken a scan inline. A temporary exception needs an owner, expiry,
advisory/CVE, proof that the vulnerable path is absent, and a reviewed policy
file. The existing Bun-audit ignore is dev-only and documented in the root
README; it is not present in the runtime image.

Registry retention must preserve every production and rollback digest; its
attestations live in GitHub and are keyed by that digest. Deleting a tag is not rollback and does not alter an
immutable digest. If VCR garbage-collects an old digest, it is no longer a valid
rollback candidate and must be rebuilt, rescanned, reattested, and shipped as a
new release.
