---
slug: server-setup
category: Self-hosting
title: Server setup wizard
description: Configure authentication, HTTPS, and execution limits on a prepared server from a browser or terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Choose a setup procedure {#どの手順を使うか}

For a new installation, [prepare the server](/en/docs/self-hosting/#準備するもの), then open the wizard in a **browser**. On an existing server, use the same wizard to change sign-in methods or execution limits.

- Run `sudo n624-latex server setup --plan` on the server to check required packages and free space. Address any missing requirements and rerun it.
- To change an existing dedicated HTTPS or LAN HTTPS (Akebi) installation, add `--ingress` to the launch command.
- If Docker reports missing kernel modules on a minimal host, follow the instructions shown and retry. For example, if `nf_tables` is required, an administrator runs `sudo modprobe nf_tables`.

## Open the wizard in a browser {#ブラウザで開く}

Connect over SSH using the non-root deployment account and run the command below. **Keep the terminal open until setup finishes.**

```sh
sudo n624-latex server setup --web
```

1. On a new installation, review the preparation plan and enter `PREPARE` to proceed. Wait for the signed release download, service setup, and initial TeX runtime build and verification.
2. Copy the one-time URL shown in the terminal. It is valid for **5 minutes**.
3. Open the URL on the server or use **SSH port forwarding** to reach the same port from your computer. For example, if setup shows port `41234`, run the following command in a second terminal on your computer, then open the wizard’s URL in your browser.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Keep the setup URL private. Do not expose the setup port to the internet or through a reverse proxy.

## Preview and apply settings {#プレビューから適用まで}

1. **Choose how to expose the service and sign in.** For a new installation, configure HTTPS and the first owner account. Enter passwords and OIDC client secrets in their dedicated hidden fields.
2. **Review the preview.** Check the public URL and sign-in method. If you are switching methods, prepare the owner identity for the new method while you can still sign in.
3. **Apply the settings.** Wait for services to start or restart.
4. **Sign in and create a PDF.** Use a separate browser window to [verify the installation](/en/docs/self-hosting/#導入完了の確認).

To enable both password and OIDC sign-in on a new installation, first register the owner with a password, then add the OIDC `issuer` and `subject` to that owner. In the execution limits, the memory startup threshold is the free RAM required before a job starts. The running memory limit is the RAM the container may use.

## Review an interrupted change {#中断した変更を確認する}

- If the browser or another connection drops after you start applying settings, first check the result of the same operation.
- If the wizard process itself stopped, restart it for the same target and choose **Recover** in the browser or **`RECOVER`** in the terminal. If the owner is already registered, setup uses the existing registration and resumes at confirmation. Configuration recovery does not roll the database back to a previous backup.
- Recovery files may contain TLS or OIDC secrets. Leave them unedited. When requesting support, provide only the displayed error code and the stage where it occurred.

## Open the wizard in a terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

To update an existing installation, enter each setting when prompted. Leave a field empty and press Enter to keep the current value. For automatic LAN HTTPS during initial setup, choose `LAN` and follow the prompts. To configure custom HTTPS on first installation or an existing Cloudflare route in the terminal, enter one line of JSON in the format shown. If this is your first time configuring that setup, [start in a browser](#ブラウザで開く).

### Change the queue limit on a running server {#稼働中のキュー上限を変更する}

Use the admin CLI to see the effective settings and their units. For example, to limit all unfinished jobs, including queued and running jobs, to 50, run these commands.

```sh
n624-latex admin system config
n624-latex admin system config set max_queue_length 50 --reason "Queue capacity review" --yes
```

Changing a setting requires write access to the admin API. The `system config` output lists the keys, minimums, and maximums.

### Older releases and manual installations {#旧版-手動配置の場合}

> [!DETAILS] Run server-setup.mjs directly
>
> For a server prepared without APT using a dedicated user, Node.js, rootless Docker, and a verified release manually installed at `/opt/latex-renderer/current`, invoke `server-setup.mjs` directly. See [manual self-hosting instructions](/en/docs/self-hosting/#現在の提供状況) for an unprepared server.
>
> | Task | Startup argument | Requirements |
> | --- | --- | --- |
> | Change existing authentication or execution limits | `--existing` | Registered owner and healthy running services |
> | Configure the installation and register its first owner | `--initial` | Prepared release and runtime, with no production configuration or database yet |
> | Change managed dedicated HTTPS | `--ingress` | Existing dedicated standalone HTTPS. Migration from shared Nginx is a separate operation. |
>
> - **Open the terminal interface**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Open the browser interface**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

For implementation details, see the [wizard input and recovery specification](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
