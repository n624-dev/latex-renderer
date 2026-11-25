---
slug: self-hosting
category: Auto-hébergement
title: Administrer LaTeX Renderer sur son serveur
description: Choisissez une configuration compatible, préparez l’hôte et installez le service avec ses mises à jour et sauvegardes.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Options d’installation {#現在の提供状況}

Pour mettre en place un serveur, installez le [paquet APT](/fr/docs/client/#debian-ubuntu-の-apt-パッケージ) et exécutez l’assistant. Il configure HTTPS, la méthode de connexion et le premier propriétaire.

### Étapes de la première installation {#初回導入の順序}

1. **Préparez le serveur.** Vérifiez les [systèmes et modes d’accès compatibles](#対応する構成) et [installez Docker Engine et Nginx](#準備するもの).
2. **Installez le paquet APT.** Suivez les [instructions pour Debian et Ubuntu](/fr/docs/client/#debian-ubuntu-の-apt-パッケージ) pour installer `n624-latex`.
3. **Configurez le serveur.** Depuis un compte de déploiement non root, exécutez `sudo n624-latex server setup --plan`. Réglez les prérequis manquants et poursuivez avec la [configuration dans le navigateur](/fr/docs/server-setup/#ブラウザで開く).
4. **Créez votre premier PDF.** Ouvrez l’URL HTTPS configurée, [connectez-vous et convertissez un document de test](#導入完了の確認). L’assistant prépare le premier environnement TeX.

Pour un serveur existant, consultez [Mettre à jour depuis l’administration](/fr/docs/updates/). Pour installer depuis une archive tar, suivez les [instructions manuelles](#v1-6-9をダウンロードして検証).

## HTTPS automatique sur le réseau local {#lan-内の自動-https}

**Akebi** permet de configurer une URL HTTPS dérivée de l’IP privée du serveur. Vous pouvez commencer avec le service de certificats partagé. Consultez [Utiliser HTTPS sur le réseau local avec Akebi](/fr/docs/lan-https/).

## Configurations prises en charge {#対応する構成}

APT permet une nouvelle installation sur un seul hôte équipé de `systemd` et exécutant Debian 12 ou 13, ou Ubuntu 24.04 ou 26.04, en amd64 ou arm64. La compilation LaTeX utilise Docker sans privilèges root sous un compte dédié.

| Mode de déploiement (`DEPLOYMENT_MODE`) | Point d’entrée | Méthodes de connexion |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache ou HTTPS sur le réseau local (Akebi) | Mots de passe locaux, OIDC ou les deux |
| `cloudflare` | Cloudflare Tunnel et un Worker | Cloudflare Access ou authentification native (mots de passe, OIDC ou les deux) |

- **OIDC.** Permet d’utiliser le fournisseur d’identité (IdP) de votre organisation.
- **Cloudflare Access.** Préparez une application Access pour les utilisateurs dans Cloudflare.
- **Mots de passe locaux.** Inscrivez les utilisateurs depuis l’administration du serveur sans IdP externe.
- **Mots de passe et OIDC.** Activez les deux avec l’authentification native et `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` et `AUTH_OIDC_ENABLED=true`. Pour les anciennes configurations à méthode unique, utilisez `AUTH_MODE`.

## Préparer le serveur {#準備するもの}

- **Compte de travail.** Connectez-vous avec un compte non root et exécutez les commandes de configuration avec `sudo`.
- **Disque.** La vérification initiale exige **au moins 5 Gio libres** sur chaque système de fichiers qui contient `/opt` ou `/var/lib`. Prévoyez de l’espace supplémentaire pour les images TeX, les versions, les résultats et les sauvegardes chiffrées.
- **Docker Engine.** Installez Docker Engine et `docker-ce-rootless-extras` depuis le dépôt officiel. L’assistant configure Docker sans privilèges root pour la compilation. Consultez les instructions officielles pour [Debian](https://docs.docker.com/engine/install/debian/) ou [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installez-le avec `sudo apt install nginx`. Une nouvelle installation APT vérifie sa présence même si vous exposez le service via Caddy, Apache ou Cloudflare.
- **Accès et TLS.** Pour votre propre HTTPS, préparez le nom d’hôte, le certificat et la clé privée, et libérez l’adresse et le port nécessaires au HTTPS intégré. Pour Cloudflare, préparez le Tunnel, le DNS et le Worker. Consultez les [conditions pour HTTPS sur le réseau local](#lan-内の自動-https).
- **Identifiants**
  - OIDC nécessite l’URL de l’émetteur, l’identifiant et le secret du client ainsi que le `subject` stable du premier propriétaire.
  - Cloudflare Access nécessite les informations de l’application Access et le `subject` du propriétaire.
  - Pour les mots de passe, préparez le nom de connexion et le mot de passe initial du propriétaire.
- **Connectivité sortante.** Le serveur doit pouvoir accéder en HTTPS à GitHub Releases et Attestations, GHCR (`ghcr.io`), aux archives TeX Live et aux dépôts de paquets Debian ou Ubuntu.
- **Paquet APT.** Node.js est inclus. Consultez les [instructions APT](/fr/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Vérifier l’installation {#導入完了の確認}

1. Ouvrez `/admin/` sur l’URL HTTPS configurée et connectez-vous avec le propriétaire inscrit pendant l’installation.
2. Ouvrez `/app/` à la même adresse, sélectionnez le [`main.tex` d’exemple](/fr/docs/#最短でpdfを作る) et cliquez sur **Convertir en PDF**.
3. Ouvrez le PDF sur la page de résultats et vérifiez qu’il affiche le texte de l’exemple.

> [!DETAILS] Vérifications supplémentaires des services et des sorties
>
> Les administrateurs peuvent tester une conversion via l’URL publique. La clé d’API émise pour le test est révoquée immédiatement après.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Vous pouvez aussi vérifier l’accès d’un utilisateur ordinaire, les guides publics, les langues et l’image indiquées dans l’environnement TeX ainsi que les sorties que vous utilisez régulièrement, comme les documents en japonais ou les SVG.

### Inscrire des utilisateurs et émettre des clés {#利用者と-api-キーの発行}

Lorsque vous pouvez vous connecter en tant que propriétaire à `/admin/`, inscrivez les utilisateurs.

- **Web et Remote MCP.** Créez l’utilisateur dans **Utilisateurs**, enregistrez son identité pour la méthode de connexion choisie et transmettez-lui l’URL de l’application web.
- **CLI, Local MCP et API HTTP.** Créez un compte de service associé à l’utilisateur. Dans **Clés d’API → Émettre une clé d’API**, émettez une clé de rendu avec `render:create` et `render:read:own` (préfixe `lrk_...`) et transmettez-la par un canal sûr.

## Mises à jour et retour arrière {#更新とロールバック}

### Mettre à jour l’application {#アプリケーションを更新する}

- En tant que propriétaire, ouvrez **Administration → Mises à jour**. Consultez [Mettre à jour le serveur ou revenir à la version précédente](/fr/docs/updates/).
- Pour changer la version ou les langues de TeX Live, ouvrez **Administration → Environnement TeX**. Consultez [Configurer l’environnement TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migration et récupération particulières
>
> ### Migrer le programme de mise à jour root v1.2.x vers la séparation des privilèges {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Consultez les [instructions de migration du programme de mise à jour](/fr/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar interrompt l’extraction avec Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Consultez la [procédure en cas d’erreur d’extraction](/fr/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Le verrou des modifications est utilisé {#mutation-lockが使用中と表示される場合}
>
> Consultez la procédure pour [identifier le processus détenant le verrou](/fr/docs/reference/#mutation-lockが使用中と表示される場合).

## Sauvegardes {#バックアップ}

Pour les sauvegardes périodiques, les points de récupération avant mise à jour, les tests de restauration et la récupération, consultez [Créer, vérifier et restaurer des sauvegardes](/fr/docs/backups/). Si la position d’exportation de l’audit diverge après restauration, consultez [Récupérer les journaux d’audit](/fr/docs/reference/#監査ログの復旧).

## Dépannage {#問題が起きた場合}

| Symptôme | Première vérification |
| --- | --- |
| Impossible d’accéder à `/app/` | DNS, certificat TLS, configuration du Tunnel ou du proxy et ordre de démarrage des services locaux |
| Seuls les administrateurs ne peuvent pas se connecter | Identité ou identifiant explicite du propriétaire, `AUTH_MODE`, émetteur, audience et rôles |
| Impossible de récupérer l’image TeX | Accès HTTPS à `ghcr.io`, visibilité du paquet et architecture de l’étiquette |
| Une modification de TeX prend du temps | Identifiant de l’opération et journaux expurgés d’Image Manager |
| Une mise à jour est refusée | Immutabilité de la version, empreinte de l’archive, parcours de mise à jour et espace libre |
| La préparation de l’hôte s’arrête sur un chemin non sûr | Vérifiez que `/var/lib/latex-renderer` appartient à `root:latex-renderer` et possède le mode `2770` |
| Seule la page des mises à jour échoue | Présence de `client-dist/manifest.json` dans la distribution et état d’Admin Web |
| La conversion ne démarre pas | État de la file, au moins 5 Gio libres, service du processus de traitement et socket de Docker sans privilèges root |
| Des problèmes apparaissent juste après une mise à jour | Suspendez l’admission de nouvelles tâches et examinez les versions antérieure et actuelle de l’application et de l’environnement avant de décider d’un retour arrière |

Notez l’identifiant de l’opération, l’étape en échec et un code d’erreur que vous pouvez partager. Consultez [Dépannage](/fr/docs/troubleshooting/), [Sécurité des comptes et des documents](/fr/docs/security/) et [Paramètres de déploiement et fichiers de configuration (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Modifier l’environnement TeX {#tex環境の初期設定}

La configuration initiale prépare l’environnement de compilation. Pour ajouter des langues ou changer la version de TeX Live, ouvrez **Administration → Environnement TeX** (`/admin/tex-environment/`). L’exemple suivant prend en charge l’anglais et le japonais.

| Réglage | Valeur recommandée |
| --- | --- |
| Image | `latest` (pour une étiquette à date fixe, choisissez-en une qui correspond à votre architecture) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (désactivé par défaut) |

- Seule l’**image de base** sans langues est téléchargée depuis le paquet public sur GHCR et épinglée par son empreinte. Le serveur construit une **image d’exécution** avec les langues sélectionnées et le code actuel du moteur de rendu. Une image locale de même configuration est réutilisée. Les images d’exécution ne sont pas publiées à l’extérieur.
- La construction continue même si vous fermez le navigateur. Vérifiez ensuite l’environnement actif et les langues dans l’administration. Si le téléchargement échoue, vérifiez l’accès HTTPS à `ghcr.io` et la compatibilité de l’architecture.

### Nettoyage automatique du disque {#自動容量整理}

> [!DETAILS] Nettoyage des images inutilisées et du cache de construction
>
> Par défaut, Image Manager nettoie les images gérées inutilisées toutes les 24 heures. Il protège la base et l’environnement actifs, ceux conservés pour le retour arrière, ainsi que les images référencées dans la configuration. Les autres peuvent être supprimées 24 heures après leur création. Le nettoyage vise 2 Gio de cache de construction inutilisé, sans imposer de limite à Docker dans son ensemble.
>
> Ajustez les valeurs dans `/etc/latex-renderer/renderer.env` et appliquez-les avec `sudo systemctl restart latex-renderer-image-manager.service` en l’absence de mise à jour TeX en cours.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` accepte `0` pour désactiver le nettoyage ou un intervalle de `1` à `720` heures. À partir de 5 minutes après le démarrage, l’échéance de nettoyage est vérifiée toutes les 5 minutes. Un verrou commun diffère le nettoyage pendant les mises à jour et déploiements. Le nettoyage manuel via le web ou la CLI retire les éléments non protégés sans attendre la fin de la conservation.
> - `RETENTION_HOURS` accepte de `0` à `8760` heures et `BUILD_CACHE_MAX_GIB` de `0` à `1024` Gio.
> - Depuis `1.3.4-rc.2`, les métadonnées Buildx de Docker sans privilèges root sont isolées dans `.docker/buildx-worker` dans le dossier personnel du processus de traitement pour éviter les problèmes de permissions avec les constructions de root. Le nettoyage automatique ignore les images des anciennes configurations et les dossiers de récupération manuelle. Supprimez les éléments individuellement après avoir vérifié qu’ils sont inutiles. Ne supprimez jamais directement le répertoire de données de Docker.

## Privilèges d’installation et d’exploitation {#sudoと通常運用の境界}

L’installation initiale prépare les utilisateurs système, les répertoires, les unités `systemd`, Docker sans privilèges root et les fichiers de clés avec `sudo`. **En exploitation normale, le web et l’API d’administration ne reçoivent pas de privilèges `sudo`.**

- **Modifications de TeX.** Elles sont demandées à Image Manager, qui appartient à root, via un socket Unix aux permissions restreintes.
- **Mises à jour.** Un socket Unix donne accès au contrôleur Update Manager non root, qui délègue des opérations fixes à un auxiliaire root de courte durée.
- **Exclusion mutuelle.** Un verrou partagé sérialise les modifications de TeX et les mises à jour. Le web et l’API ne permettent pas de transmettre à root des commandes, chemins ou URL arbitraires.

## Configuration et secrets {#設定と秘密情報}

Les paramètres propres à l’hôte et les secrets sont stockés hors de l’application et de l’arbre de travail Git, par exemple dans `/etc/latex-renderer/`.

| Chemin | Contenu | Mode recommandé |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Profil d’accès, URL, limites et configuration non secrète de l’IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifiants et jetons propres au profil Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Compte de déploiement non root | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Liaisons et routes du Worker de production | `0600` |
| `/etc/cloudflared/config.yml` | Règles d’entrée du Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, clé des tickets et identifiants des gestionnaires | Selon le fichier |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Secret du client pour le profil OIDC | `0440` |

> [!WARNING]
> Ne versez pas dans Git et ne collez pas dans des tickets ou demandes d’assistance les fichiers `.env`, jetons Cloudflare, identifiants du Tunnel, clés d’API, bases SQLite, documents, PDF ou journaux réels non expurgés. Les `*.example` du dépôt servent de modèles pour consulter les champs.

## Installation manuelle depuis une archive tar et anciennes versions {#手動配置-旧版向けの構築手順-tarball-導入}

Avec APT et `sudo n624-latex server setup`, l’assistant réalise ou guide l’extraction, la préparation de l’hôte et l’inscription du propriétaire. Dépliez la section suivante si vous déployez manuellement `v1.7.1` ou devez examiner les limites d’accès ou le changement d’authentification.

> [!DETAILS] Télécharger, vérifier, déployer et inscrire le propriétaire avec la v1.7.1
>
> Pour une nouvelle installation manuelle, utilisez la version stable [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archive `latex-renderer-server-1.7.1.tar.gz`. Son étiquette et ses fichiers sont immuables après publication. Le déploiement direct depuis la branche de développement `main` et le `docker build` local de TeX ne sont pas pris en charge en exploitation.
>
> ### Télécharger et vérifier la v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Préparez `curl`, `jq`, `tar`, `sha256sum` et une CLI GitHub compatible avec `gh attestation verify`. Node.js et Corepack sont installés plus loin pendant la préparation de l’hôte.
>
> Avec un compte ordinaire, exécutez les étapes suivantes dans la même session Bash. Le SHA-256 de GitHub Releases et la signature de provenance de GitHub Actions sont vérifiés. Les données de provenance sont transmises de l’API publique à `gh` sans compte ni jeton GitHub. En cas d’échec d’une étape, `bundle_root` reste indéfini. Corrigez la cause et réessayez.
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
> ### Préparer l’hôte {#ホストを準備}
>
> Installez `setfacl` pour les permissions du stockage, `bsdtar` pour l’extraction dans le programme de mise à jour restreint et `unzip` pour contrôler les ZIP. Suivez les instructions officielles pour installer Node.js 26 ou 24 (`/usr/local/bin/node` et `/usr/local/bin/corepack`) et les outils Docker sans privilèges root. Pour `cloudflare`, installez également `cloudflared`. Update Manager installe et vérifie avec Corepack le pnpm indiqué pour l’utilisateur de déploiement.
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
> Depuis le compte habituel de déploiement, initialisez l’hôte et configurez Docker sans privilèges root pour `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Créer la configuration propre à l’hôte {#ホスト固有設定を作成}
>
> Créez `renderer.env` pour tous les profils et configurez `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` et `AUTH_MODE`. Il n’existe pas d’alias tel que `ADMIN_ALLOWED_ORIGINS`. L’origine autorisée pour les opérations du navigateur doit correspondre exactement à `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Remplacez `example.com`, `REPLACE_*`, tous les UUID et l’audience Access par les valeurs de votre installation. Pour un Tunnel géré à distance, omettez le `config.yml` local et vérifiez au préalable que le connecteur est actif.
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
> - **Profil `standalone`.** Installez Nginx, Caddy ou Apache, copiez un exemple de `deploy/reverse-proxy/` et indiquez le FQDN et les chemins des certificats. Le proxy retire les en-têtes `CF-Access-*` entrants et remplace l’adresse IP du client. N’exposez pas directement les services locaux sur les ports 3100 à 3105.
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
> - **Avec `AUTH_MODE=oidc`.** Inscrivez `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` auprès de l’IdP. Dans `renderer.env`, configurez `OIDC_ISSUER` et `OIDC_CLIENT_ID` et enregistrez le secret dans un fichier distinct sans saut de ligne final.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Déployer les services {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - L’amorçage télécharge à nouveau et vérifie l’archive publiée immuable, sépare l’arbre de contrôle de root de l’arbre de construction sans privilèges, construit `client-dist` et le déploie dans `/opt/latex-renderer/releases/$release_id`. Il refuse les machines ayant déjà une base de données ou un `current`. Après installation, utilisez la procédure normale de mise à jour.
> - Avant le déploiement, vérifiez `renderer.env` (propriétaire root, mode `0640`, sans clés en double), `PUBLIC_ORIGIN`, les paramètres d’authentification ainsi que le propriétaire, les permissions et la longueur du pepper et des secrets, sans afficher leurs valeurs.
> - Le programme de mise à jour est conservé séparément dans `/opt/latex-renderer/updater`, comme décrit par `docs/independent-updater.md` dans le dépôt. Seul le groupe principal du compte de déploiement peut traverser `/opt/latex-renderer/update-staging`. Chaque étape est isolée avec `0700` et nettoyée à la fin ou, si elle est interrompue, lors d’un démarrage ultérieur après 24 heures.
>
> ### Périmètre d’accès public {#公開境界}
>
> - **`cloudflare-access`.** Protégez `/auth/*`, `/app/`, `/admin/` et `/oauth/authorize` avec la même application Access pour utilisateurs humains et vérifiez également l’audience à l’origine. Avec Cloudflare et OIDC ou mot de passe, veillez à ce qu’Access ne bloque pas `/auth/*`. La documentation et les téléchargements sont publics. Les Worker Routes desservent uniquement la partie publique de l’API de rendu. Dans les règles d’entrée du Tunnel, placez d’abord les chemins précis de l’API et de l’administration, puis le web par défaut, et enfin `http_status:404`.
> - **`standalone`.** Un proxy inverse TLS répartit les requêtes par chemin entre les services locaux. Seules les petites opérations de tickets JSON sont relayées au Standalone Gateway sur le port 3105. L’exemple Nginx limite les connexions et la fréquence des connexions par mot de passe et des appels à l’API de tickets. Caddy et Apache sans extension n’offrent pas de limite équivalente par client. Il faut l’appliquer sur un répartiteur de charge ou chez le fournisseur. Gardez privés `/internal/*`, la base de données et les sockets de gestion.
>
> ### Premier propriétaire {#最初のowner}
>
> L’identité externe repose sur `provider + issuer + subject` et l’identité par mot de passe sur `login name`. L’adresse électronique sert uniquement à l’affichage. Les comptes ne sont ni associés par coïncidence d’adresse ni créés automatiquement lors de la connexion. Exécutez une seule fois la procédure correspondant à la méthode choisie.
>
> **Cloudflare Access ou OIDC**
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
> **Mot de passe local (exemple avec le nom `owner`)**
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
> ### Modifier AUTH_MODE ultérieurement {#後からauth-modeを変更する場合}
>
> Suivez cette procédure si l’[assistant du serveur](/fr/docs/server-setup/) est indisponible.
> Créez une sauvegarde chiffrée et arrêtez l’API d’administration. À l’aide de l’identifiant immuable obtenu dans l’administration ou avec `users list` (format `user_...`), ajoutez la nouvelle méthode d’authentification. L’écrasement d’un identifiant existant est refusé et les sessions en cours sont révoquées. Modifiez ensuite `renderer.env` et redémarrez l’API et le web. Gardez les anciens identifiants jusqu’à la réussite de la connexion dans une fenêtre privée.
>
> Exécutez d’abord les préparatifs suivants puis uniquement les commandes de la méthode cible.
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
> **Pour passer à OIDC ou Cloudflare Access**, saisissez `oidc` ou `cloudflare-access`.
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
> **Pour passer au mot de passe**, saisissez-le dans le champ masqué.
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
