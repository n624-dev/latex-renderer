# Renderer build provenance

The renderer image uses the dated TeX Live network snapshot
`https://texlive.info/tlnet-archive/2026/08/12/tlnet`. The Dockerfile pins the
installer SHA-512, pins the TeX Live signing-key file SHA-256, verifies the
signed checksum, and leaves the repository URL and installer digest in OCI
labels and `/opt/renderer/build-provenance.json`.

Changing the snapshot, installer digest, or signing key is a reviewed supply
chain update. A release build must still pass the representative LuaLaTeX PDF
and PNG smoke test under `deploy/security/seccomp.json`.
