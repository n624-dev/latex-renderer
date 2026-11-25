---
slug: self-hosting
category: Self-hosting
title: Run LaTeX Renderer on your own server
description: Choose a supported server configuration, prepare the host, and set up updates and backups.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installation options {#現在の提供状況}

Install the [APT package](/en/docs/client/#debian-ubuntu-の-apt-パッケージ) and use the setup wizard to build a new server. The wizard configures HTTPS, sign-in, and the first owner account.

### Set up a new server {#初回導入の順序}

1. **Prepare the host.** Check the [supported operating systems and ingress options](#対応する構成), then [install Docker Engine and Nginx](#準備するもの).
2. **Install the APT package.** Follow the [Debian and Ubuntu instructions](/en/docs/client/#debian-ubuntu-の-apt-パッケージ) to install `n624-latex`.
3. **Run setup.** From a non-root deployment account, run `sudo n624-latex server setup --plan`. Resolve any missing requirements, then [continue setup in a browser](/en/docs/server-setup/#ブラウザで開く).
4. **Create your first PDF.** Open the configured HTTPS URL, [sign in, and compile a test document](#導入完了の確認). Setup prepares the initial TeX runtime.

For an existing server, [update from the administration interface](/en/docs/updates/). To install from a tarball, see [manual deployment](#v1-6-9をダウンロードして検証).

## Automatic HTTPS on a LAN {#lan-内の自動-https}

**Akebi** provides a LAN HTTPS URL derived from the server’s private IP address. You can start with the shared certificate service. See [Use HTTPS on your LAN with Akebi](/en/docs/lan-https/).

## Supported configurations {#対応する構成}

APT supports new installations on a single `systemd` host running Debian 12 or 13 or Ubuntu 24.04 or 26.04 on amd64 or arm64. LaTeX compilation uses rootless Docker under a dedicated user.

| Deployment mode (`DEPLOYMENT_MODE`) | Ingress | Sign-in methods |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache, or LAN HTTPS (Akebi) | Local password, OIDC, or both |
| `cloudflare` | Cloudflare Tunnel and a Worker | Cloudflare Access or native authentication (password, OIDC, or both) |

- **OIDC.** Use an existing organizational identity provider (IdP).
- **Cloudflare Access.** Configure an Access Application for your users in Cloudflare.
- **Local passwords.** Register users in the administration interface without an external IdP.
- **Passwords and OIDC together.** Enable both through native authentication with `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true`, and `AUTH_OIDC_ENABLED=true`. For a legacy single-method setup, use `AUTH_MODE`.

## Prepare the server {#準備するもの}

- **Account.** Connect as a non-root user and run server setup commands using `sudo`.
- **Disk space.** Initial checks require **at least 5 GiB free** on each filesystem containing `/opt` or `/var/lib`. Allow additional space for TeX images, releases, artifacts, and encrypted backups.
- **Docker Engine.** Install Docker Engine and `docker-ce-rootless-extras` from the official repository. The wizard configures rootless Docker for compilation. See the official instructions for [Debian](https://docs.docker.com/engine/install/debian/) or [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Install it with `sudo apt install nginx`. New APT installations check for Nginx even if you plan to expose the service through Caddy, Apache, or Cloudflare.
- **Ingress and TLS.** For custom HTTPS, prepare the hostname, certificate, and private key, and free the address and port needed for built-in HTTPS. For Cloudflare, prepare the Tunnel, DNS, and Worker. See also [LAN HTTPS requirements](#lan-内の自動-https).
- **Authentication settings**
  - OIDC requires the issuer URL, client ID, client secret, and the first owner’s stable `subject`.
  - Cloudflare Access requires the Access Application details and the owner’s `subject`.
  - Password authentication requires an owner login name and initial password.
- **Outbound connectivity.** The host needs HTTPS access to GitHub Releases and Attestations, GHCR (`ghcr.io`), the TeX Live archive, and Debian or Ubuntu package repositories.
- **APT package.** Node.js is bundled with the package. See [APT installation instructions](/en/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Verify the installation {#導入完了の確認}

1. Open `/admin/` on the configured HTTPS URL and sign in as the owner registered during setup.
2. Open `/app/` on the same HTTPS URL, choose the [sample `main.tex`](/en/docs/#最短でpdfを作る), and select **Convert to PDF**.
3. Open the PDF from the results page and check that it displays the sample text.

> [!DETAILS] Additional service and output checks
>
> Administrators can run a smoke test that compiles through the public URL. The test revokes the API key it issues immediately afterward.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> You can also check ordinary user sign-in, the public guides, the languages and image shown in the TeX environment, and outputs you expect to use, such as Japanese documents and SVGs.

### Register users and issue API keys {#利用者と-api-キーの発行}

After signing in to `/admin/` as an owner, register your users.

- **Web and Remote MCP users.** Create the account under **Users**, register the identity information required by its sign-in method, and give the user the web app URL.
- **CLI, Local MCP, and HTTP API users.** Create a **Service account** associated with the user. Under **API keys → Issue API key**, issue a rendering key (`lrk_...`) with `render:create` and `render:read:own` and deliver it through a secure channel.

## Updates and rollback {#更新とロールバック}

### Update the application {#アプリケーションを更新する}

- To update the application, sign in as an owner and open **Administration → Updates**. See [Update or roll back the server](/en/docs/updates/).
- To change the TeX Live version or languages, open **Administration → TeX environment**. See [Configure the TeX environment](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migration and special recovery procedures
>
> ### Migrate the v1.2.x root updater to the privilege-separated updater {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> See the [updater migration instructions](/en/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar extraction stops with Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> See [Troubleshoot extraction errors](/en/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### The mutation lock is busy {#mutation-lockが使用中と表示される場合}
>
> See [Identify the process holding the lock](/en/docs/reference/#mutation-lockが使用中と表示される場合).

## Backups {#バックアップ}

See [Create, verify, and restore backups](/en/docs/backups/) for scheduled backups, pre-update recovery points, restore tests, and data recovery. If the audit export position no longer matches after restoration, see [Recover audit logs](/en/docs/reference/#監査ログの復旧).

## Troubleshoot a deployment {#問題が起きた場合}

| Symptom | Check first |
| --- | --- |
| `/app/` is unreachable | DNS, TLS certificate, Tunnel or reverse-proxy configuration, and loopback service startup order |
| Only administrators cannot sign in | Explicit owner identity or credential, `AUTH_MODE`, issuer and audience, and role configuration |
| Cannot retrieve the TeX image | HTTPS connectivity to `ghcr.io`, package visibility, and tagged image support for the host architecture |
| A TeX change takes a long time | Operation ID and redacted Image Manager logs |
| Application update rejected | Target release immutability, asset digest, supported upgrade path, and free disk space |
| Host bootstrap stops with an unsafe path error | Verify that `/var/lib/latex-renderer` is owned by `root:latex-renderer` with mode `2770` |
| Only the updates screen fails to start | Presence of `client-dist/manifest.json` in the release and Admin Web service status |
| Rendering does not start | Queue state, at least 5 GiB free disk space, worker service, and rootless Docker socket |
| A problem appears immediately after an update | Stop accepting new jobs. Check the old and new release and runtime before deciding whether to roll back. |

When investigating, record the operation ID, failed stage, and a safe error code. See [Troubleshooting](/en/docs/troubleshooting/), [Account and document security](/en/docs/security/), and [Deployment configuration and configuration files](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Configure the TeX environment {#tex環境の初期設定}

Initial setup prepares the TeX runtime. To add languages or change the TeX Live version, open **Administration → TeX environment** (`/admin/tex-environment/`). The following example supports English and Japanese.

| Setting | Recommended value |
| --- | --- |
| Image | `latest` (for a date-pinned tag, choose one supporting your host architecture) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (default) |

- The server pulls only the **base image**, which has no languages, from the public GHCR package and pins it by digest. It builds a **runtime image** locally using the selected languages and current renderer code. It reuses a matching local runtime when available. Runtime images are never published externally.
- The build continues if you close the browser. When it finishes, check the active runtime and selected languages in the administration interface. If the pull fails, check HTTPS connectivity to `ghcr.io` and architecture support.

### Automatic disk cleanup {#自動容量整理}

> [!DETAILS] Automatic cleanup of unused images and build cache
>
> By default, Image Manager cleans unused managed images every 24 hours. It protects the current and previous rollback base and runtime images and any images referenced in configuration. Other managed images become eligible 24 hours after creation. Cleanup targets about 2 GiB of unused build cache. This is not a limit on total Docker storage.
>
> Configure cleanup in `/etc/latex-renderer/renderer.env` and apply with `sudo systemctl restart latex-renderer-image-manager.service` when no TeX update is running.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` accepts `0` to disable automatic cleanup or `1`–`720` hours. Starting 5 minutes after startup, the manager checks every 5 minutes whether cleanup is due. A shared lock defers cleanup during updates and deployments. Manual cleanup in the web interface or CLI removes unprotected items without waiting for the retention period.
> - `RETENTION_HOURS` accepts `0`–`8760` hours. `BUILD_CACHE_MAX_GIB` accepts `0`–`1024` GiB.
> - Since `1.3.4-rc.2`, non-root Docker Buildx metadata is isolated at `.docker/buildx-worker` under the worker’s home directory to avoid permission conflicts with root builds. Automatic cleanup excludes images from older configurations and manual recovery directories. Remove individual items only once verified unnecessary. Never delete the Docker data directory directly.

## Privileges during setup and normal operation {#sudoと通常運用の境界}

First-time setup uses `sudo` to prepare dedicated system users, directories, `systemd` units, rootless Docker, and secret key files. **During normal operation, the web interface and Admin API receive no `sudo` privileges.**

- **TeX changes** go through a permission-restricted Unix socket to the root-owned Image Manager.
- **Application updates** go over a Unix socket to the non-root Update Manager controller, which delegates fixed operations to a short-lived root helper.
- **Mutual exclusion.** A shared host lock serializes TeX changes and application updates. The web interface and API cannot pass arbitrary commands, paths, or URLs to root.

## Settings and secrets {#設定と秘密情報}

Host-specific settings and secrets are stored outside the application and Git working tree, for example under `/etc/latex-renderer/`.

| Path | Contents | Recommended mode |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Ingress mode, URL, limits, and non-secret IdP settings | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifiers and tokens for the Cloudflare profile only | `0600` |
| `/etc/latex-renderer/update-manager.env` | Non-root deployment user settings | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Production Worker bindings and routes | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel ingress configuration | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, ticket key, and manager credentials | Per file |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC client secret for the OIDC profile | `0440` |

> [!WARNING]
> Keep `.env` files, Cloudflare tokens, Tunnel credentials, API keys, SQLite databases, user documents, PDFs, and unredacted production logs out of Git commits, issues, and support requests. Repository `*.example` files are templates for checking which fields are required.

## Manual tarball installation and older releases {#手動配置-旧版向けの構築手順-tarball-導入}

For a standard APT installation, `sudo n624-latex server setup` guides you through or handles extraction, host preparation, and owner registration. Expand the following procedure to install manually from the `v1.7.1` distribution or review the ingress and authentication-change details.

> [!DETAILS] Download, verify, deploy, and register an owner manually with v1.7.1
>
> Use stable release [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) (`latex-renderer-server-1.7.1.tar.gz`) for a new manual installation. Its published tag and artifacts are immutable. Standard operation does not support deployment directly from the development `main` branch or local `docker build` for TeX.
>
> ### Download and verify v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Prepare `curl`, `jq`, `tar`, `sha256sum`, and a GitHub CLI supporting `gh attestation verify`. The host preparation below installs Node.js and Corepack for the server.
>
> As an ordinary user, run the following in the same Bash session. It verifies the GitHub Releases SHA-256 and the GitHub Actions build provenance attestation. It passes public API attestation data to `gh`, so no GitHub login or token is required. If a step fails, `bundle_root` remains unset. Fix the cause and try again.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### Prepare the host {#ホストを準備}
>
> Install `setfacl` for storage permissions, `bsdtar` for extraction in the restricted updater, and `unzip` for checking distribution ZIPs. Follow the official instructions to prepare Node.js 26 or 24 (`/usr/local/bin/node`, `/usr/local/bin/corepack`) and rootless Docker tools. For `cloudflare` also install `cloudflared`. Update Manager uses Corepack to install and verify the specified pnpm version for the deployment user.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> From the regular deployment account, initialize the host and configure rootless Docker for `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Create host-specific configuration {#ホスト固有設定を作成}
>
> For all profiles, create `renderer.env` and set `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE`, and `AUTH_MODE`. Browser operations require an exact `PUBLIC_ORIGIN` match. There is no alternate setting such as `ADMIN_ALLOWED_ORIGINS`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **`cloudflare` profile.** Replace all `example.com`, `REPLACE_*`, UUID, and Access audience placeholders with your own values. For a remotely managed Tunnel, omit local `config.yml` and check that the connector is active before proceeding.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **`standalone` profile.** Install Nginx, Caddy, or Apache. Copy a configuration example from `deploy/reverse-proxy/` and set the FQDN and certificate paths. The proxy strips incoming `CF-Access-*` headers and overwrites the client IP header. Keep loopback services on ports 3100–3105 inaccessible directly from outside.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **`AUTH_MODE=oidc`.** Register `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` with your IdP. Set `OIDC_ISSUER` and `OIDC_CLIENT_ID` in `renderer.env` and store the client secret in a separate file without a trailing newline.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Deploy the services {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - First-install bootstrap retrieves the published immutable artifact again and verifies its signature. It separates a root-owned control tree from a non-root build tree, builds `client-dist`, and deploys it at `/opt/latex-renderer/releases/$release_id`. Bootstrap refuses a host with an existing database or `current`. Use the normal update mechanism after installation.
> - Before deployment, it checks `renderer.env` (root-owned, `0640`, no duplicate keys), `PUBLIC_ORIGIN`, authentication settings, and the owners, permissions, and lengths of peppers and secrets. It keeps secret values out of output.
> - The updater is stored separately at `/opt/latex-renderer/updater`, as described in the repository’s `docs/independent-updater.md`. Only the deployment user’s primary group can traverse `/opt/latex-renderer/update-staging`. Each stage is private with mode `0700`. Stages are removed at completion or, after interruption, on startup once 24 hours have passed.
>
> ### Public access boundaries {#公開境界}
>
> - **`cloudflare-access`.** Protect `/auth/*`, `/app/`, `/admin/`, and `/oauth/authorize` with the same human-user Access Application and validate the audience at the origin. For Cloudflare with OIDC or password authentication, leave `/auth/*` accessible without an Access block. Public docs and downloads need no authentication. Only the public Renderer API surface uses Worker Routes. Order Tunnel ingress rules as specific API and admin paths, then the web fallback, then `http_status:404`.
> - **`standalone`.** The TLS reverse proxy routes paths to loopback, sending only small JSON ticket operations to the Standalone Gateway on port 3105. The Nginx example limits connections and the rate of password login and ticket API requests. Standard Caddy and Apache lack equivalent per-client request limits, so rate limiting at the upstream load balancer or hosting layer is required. Keep `/internal/*`, the database, and manager sockets private.
>
> ### Register the first owner {#最初のowner}
>
> External authentication uses the unique key `provider + issuer + subject`. Password authentication uses `login name`. Email is a display attribute, with no automatic email-based linking or just-in-time account creation. Run only the procedure for your chosen method, once.
>
> **Cloudflare Access or OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **Local password (example login name `owner`)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### Change AUTH_MODE later {#後からauth-modeを変更する場合}
>
> Use this procedure if the [server setup wizard](/en/docs/server-setup/) is unavailable.
> Make an encrypted backup, stop the Admin API, and add the new method to the immutable `user_...` ID obtained from the administration interface or `users list`. Attempts to overwrite an existing credential are rejected, and existing browser sessions are revoked. After adding the credential, update `renderer.env` and restart the Admin API and web service. Keep the previous credentials until you verify the new sign-in method in a private browser window.
>
> Run the preparation commands below, then run only the commands for the target method.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **For OIDC or Cloudflare Access**, enter `oidc` or `cloudflare-access`.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **For password authentication**, enter the password at the hidden prompt.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
