# CLI guide

The canonical user-facing CLI documentation is [`docs/public/cli.md`](docs/public/cli.md). Keep command inventory, options, setup behavior, output layout, and examples there so the repository does not maintain two independent CLI specifications.

Install from `https://latex-render.n624.jp/downloads/` and configure the canonical origin when using a non-default environment:

```text
LATEX_RENDER_BASE_URL=https://latex-render.n624.jp
```

Typical flow:

```bash
latex-render auth login --api-key-stdin
latex-render render /path/to/project
latex-render jobs get job_...
latex-render jobs download job_... --output .render
```

`main.tex` is only the default when no entrypoint is specified. Any valid relative `.tex` path can be selected with `--entrypoint`. For multiple documents from the same directory or ZIP, upload the Source once and reuse its ID:

```bash
latex-render source upload ./project.zip --json
latex-render render --source source_... --entrypoint reports/a.tex --output .render/a
latex-render render --source source_... --entrypoint reports/b.tex --output .render/b
```

Symlinks are rejected when packaging local projects. Use `--output` to select the artifact directory; `.render` is the default, not a fixed destination.

For the complete and current command reference, setup/repair flow, JSON contract, and artifact layout, use [`docs/public/cli.md`](docs/public/cli.md).

For administrator uploads, run `latex-render-admin sources create ./project --key <apiKeyId> --yes --json`.
The command accepts a directory or ZIP and returns `sourceId`. The selected key
identifies the Source's owner. Add `--render` to queue a Job for that key and
include `jobId` in the result. See [administrator Source registration](ADMIN_GUIDE.md#register-and-render-tex-inputs).

For owner commands that create, verify, and manage backup retention, see the
[administrator guide](ADMIN_GUIDE.md#backups).
