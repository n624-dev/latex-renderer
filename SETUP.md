# Self-hosting setup

The canonical general-user self-hosting guide is published in Japanese at:

- [Self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/)
- [Markdown source](docs/public/self-hosting.md)

The guide describes the supported Cloudflare Tunnel + Access Linux profile,
sudo boundaries, host-local configuration, initial administration, TeX image
selection, verification, updates, rollback, and backups.

Self-hosted installation starts with the immutable
[`v1.1.3` release](https://github.com/n624-dev/latex-renderer/releases/tag/v1.1.3).
It includes `latex-renderer-server-1.1.3.tar.gz`, with a SHA-256 digest reported
by the GitHub API and matching embedded release metadata. Do not deploy the
changeable `main` branch as a substitute. This file remains a short entry point;
the executable installation and verification steps live in the Web-visible
canonical guide.

Development setup is documented separately in [CONTRIBUTING.md](CONTRIBUTING.md).
Detailed deployment internals remain in [DEPLOYMENT.md](DEPLOYMENT.md).
