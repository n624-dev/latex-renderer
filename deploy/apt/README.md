# Signed APT distribution

The `n624-latex` package installs the client, its private Node.js runtime and the
server setup entry point. A package installation or upgrade does not start the
server or modify an existing deployment. System administrators use
`sudo n624-latex server setup` to start server provisioning.

## Publication

1. Enable GitHub Pages with GitHub Actions as the deployment source for the
   repository.
2. Create a dedicated OpenPGP signing key. Store the signing material as the
   `APT_SIGNING_KEY` secret on the `github-pages` environment, and its full
   fingerprint as `APT_SIGNING_FINGERPRINT`. Store the HTTPS repository origin
   as `APT_ORIGIN`. Protect the environment and keep an offline copy of the key.
3. After publishing a Stable server release with the matching version and
   completing release acceptance, run **publish-apt** on `main` with the Stable
   tag. It builds and runs the packaged client on both runner architectures and
   signs the repository containing the current release.
4. Verify an install and upgrade on an enrolled Debian or Ubuntu host before
   publishing the link to `n624-latex.sources` in the [client guide](../../docs/public/client.md).
   Share the signing fingerprint through the same release announcement so
   administrators can verify the enrollment file.

The archive generator accepts up to three complete version pairs, with at most
90 MiB per package and 600 MiB for the package pool. The Pages workflow publishes
only the current pair. The existing application Updater and its rollback
retention manage deployed server versions separately.

## APT and the server

The server launcher uses the immutable Stable asset and its GitHub
attestation. Install Docker Engine with its rootless extras on the server
before running setup. Under `--plan`, the launcher inspects the existing
installation, host prerequisites and available space. HTTPS and identity
provider setup instructions appear in the wizard.

## Test a release candidate

On a disposable host, use the package built from the exact published RC tag
with `node client/build-client.mjs` and
`node deploy/apt/build-package.mjs amd64 packages-out` (use `arm64` on ARM).
Install the resulting local package. For example, for `v1.7.0-rc.1` on amd64:

```sh
sudo apt install './packages-out/n624-latex_1.7.0~rc.1_amd64.deb'
sudo n624-latex server setup --candidate v1.7.0-rc.1 --plan
sudo n624-latex server setup --candidate v1.7.0-rc.1
```

Use the same package and tag to resume an interrupted initial setup. The
bootstrap checks the exact version, immutable GitHub release, asset SHA-256 and
attestation before installing the application. The public APT repository
accepts Stable packages only. Use the managed Updater to test upgrading an
existing server to a candidate.

## Maintain repository trust

When retiring or rotating the repository key, distribute an updated enrollment
file through a trusted channel before retiring the previous key. If metadata or
a package fails verification, retain the running application and investigate the
publication job. Keep repository signing, `Signed-By` and package hash checks
enabled.
