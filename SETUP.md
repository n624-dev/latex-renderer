# Self-hosting setup

The canonical general-user self-hosting guide is published in Japanese at:

- [Self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/)
- [Markdown source](docs/public/self-hosting.md)

The guide describes the supported Cloudflare Tunnel + Access Linux profile,
sudo boundaries, host-local configuration, initial administration, TeX image
selection, verification, updates, rollback, and backups.

General server installation is not yet available: the current `v1.0.0` release
contains client assets but no server bundle whose tag and files are locked
against replacement after publication. The updater requires that protection.
Do not deploy the changeable `main` branch as a substitute. This file will
remain a short entry point; executable installation steps belong in the
Web-visible canonical guide after the server release path is verified on a new
host.

Development setup is documented separately in [CONTRIBUTING.md](CONTRIBUTING.md).
Detailed deployment internals remain in [DEPLOYMENT.md](DEPLOYMENT.md).
