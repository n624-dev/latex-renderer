---
slug: reference
category: Exploitation et développement
title: Référence pour l’exploitation et le développement
description: Consultez les détails du stockage et de la récupération côté client, de l’authentification MCP et des procédures de migration.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Enregistrement et récupération des sorties {#成果物の保存-復旧の仕様}

> [!DETAILS] Spécifications et procédures
>
> - **Remplacement atomique du répertoire.** La CLI et Local MCP préservent les chemins tels que `.render/result.pdf`, `job.json` et ceux des aperçus. Ils vérifient la taille et le SHA-256 annoncés de chaque fichier avant de basculer le répertoire complet. Le répertoire peut disparaître brièvement lors de la bascule. Les programmes externes doivent le lire après la fin de la commande.
> - **Récupération automatique.** Un répertoire voisin de celui des sorties, nommé `<output-name>.latex-renderer-state`, conserve l’état de récupération et est exclu de la collecte des sources. Les données temporaires sont nettoyées en cas d’arrêt normal. Après un arrêt forcé, le téléchargement suivant rétablit l’ancien jeu si la bascule n’était pas validée, ou conserve le nouveau et nettoie l’ancien si elle l’était. Préservez le répertoire d’état pendant le traitement et avant la récupération.
> - **Exclusion mutuelle et anomalies.** Les écritures concurrentes vers la même destination s’arrêtent avec `OUTPUT_BUSY`. Le temps écoulé ne suffit pas à évincer un processus actif. En cas de réutilisation d’un PID, l’opération s’arrête par précaution. Des métadonnées endommagées, fichiers inconnus ou liens externes nécessitent un examen avant toute suppression.
> - **Fichiers de l’utilisateur et limites.** Les fichiers ordinaires de l’utilisateur sont copiés dans le nouveau jeu. Si une modification est détectée pendant le téléchargement, la publication est annulée et la modification est conservée. Préférez une destination dédiée. Chaque jeu accepte au plus 1 Gio et 10 000 entrées. Prévoyez de la place pour les deux jeux et les données temporaires. Seuls les systèmes de fichiers locaux sont pris en charge. Les chemins avec liens symboliques, liens physiques ou montages d’un autre système de fichiers sont refusés. Le verrouillage sur partage réseau et l’atomicité complète après coupure de courant ne sont pas garantis. Sous Windows, si un fichier ouvert bloque la bascule, l’ancien jeu est conservé.

## Périmètre de l’authentification web {#web認証の境界}

> [!DETAILS] Spécifications et procédures
>
> Les sessions du serveur protègent `/app/`, `/admin/` et leurs API. Ces espaces sont exclus de l’index de recherche public. Les utilisateurs ordinaires utilisent `/app/`. Seuls les administrateurs et propriétaires accèdent à `/admin/`. L’identité est établie avec `issuer + subject` du fournisseur externe ou le `login name` de l’authentification par mot de passe. L’adresse électronique et le nom affiché ne sont pas des clés d’authentification. L’envoi des ZIP, les tâches, les fichiers générés et la compilation TeX passent par le moteur de rendu du serveur.
>
> > [!NOTE]
> > Le navigateur ne stocke pas durablement les tickets de courte durée. La session du serveur les réémet selon les besoins. Gardez confidentiels les cookies de session, les jetons CSRF et les tickets.

## Inscription et diagnostic de Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Spécifications et procédures
>
> - **Enregistrement dynamique de clients (DCR).** Les inscriptions incomplètes ou inactives sont normalement nettoyées après 30 jours. Les inscriptions référencées par des codes d’autorisation valides ou des familles de jetons sont protégées. La limite globale est de 10 000. Si `invalid_client` apparaît après le nettoyage, réinscrivez le client. Les demandes DCR standard sans nom de client sont acceptées, avec maintien de la validation du nom et de l’URI de redirection.
> - **Demandes temporaires d’autorisation (schéma 20).** Si une connexion s’intercale, la demande est enregistrée sous un identifiant court aléatoire qui permet de la reprendre sans insérer le long `state` OAuth dans l’URL de retour. Elle dure 10 minutes et n’est utilisable qu’une fois, si le navigateur authentifié et le cookie dédié correspondent. Les onglets simultanés ont des identifiants distincts. La limite globale est de 1 000 demandes et chaque navigateur accepte au plus 8 cookies de continuation. À la limite, `503` est renvoyé et les demandes existantes sont conservées. La base ne contient que les empreintes de l’identifiant et du cookie. Un redémarrage ou une restauration ne prolonge pas leur validité.
> - **Limites par IP et en-têtes d’origine.** DCR accepte 10 inscriptions par IP d’origine fiable toutes les 15 minutes. Les clients derrière le même proxy sortant partagent le quota. Dès la 11e tentative, HTTP `429`, `temporarily_unavailable` et `Retry-After` sont renvoyés. Des métadonnées invalides ne consomment pas le quota. Une IP absente ou incorrecte renvoie `503` pour que l’exploitant vérifie le proxy, sans regrouper les clients non identifiés. Gardez le backend sur l’interface de bouclage et configurez le proxy pour remplacer `X-Latex-Renderer-Client-IP` par l’adresse réelle. Les valeurs arbitraires de `X-Forwarded-For` sont ignorées. Sur les routes Cloudflare, `CF-Connecting-IP` est également traité à l’intérieur du périmètre de confiance.
> - **Contrôle administratif de connectivité.** La commande suivante vérifie la découverte publique et le défi Bearer `401` sans transmettre d’identifiants, modifier la configuration, suivre de redirections ni afficher les corps, cookies ou secrets.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Isoler l’étape en échec.** Un `200` de découverte et un défi `401` corrects vérifient uniquement ces étapes. Recoupez l’étape, l’heure et le `X-Request-ID` avec les journaux `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` et `remote_mcp.rpc_result`. Gardez les codes OAuth, jetons, cookies, vérificateurs PKCE, sources et identifiants utilisateur hors des journaux et tickets.
> - **L’authentification réussit, mais la découverte des actions échoue.** Vérifiez séparément `initialize`, la notification d’initialisation et `tools/list` après émission du jeton. HTTP `200` peut aussi accompagner un `error` JSON-RPC. `remote_mcp.rpc_result` consigne l’état HTTP, la catégorie de résultat, la version du protocole, le nombre d’outils, le volume de la réponse et la structure sommaire de la liste. Le tampon d’inspection est limité à 256 Kio. Au-delà, seul `inspection_limited` est consigné et la réponse reste intacte. Une réponse SSE ou une requête `GET` qui renvoie `405` ne suffit pas à diagnostiquer un échec. Examinez `Accept`, `Content-Type`, la négociation du protocole et la transmission par le proxy. Vérifiez séparément en production l’OIDC externe, les règles Cloudflare et un véritable compte ChatGPT.

## Résultats et ressources MCP {#mcpの結果とresource}

> [!DETAILS] Spécifications et procédures
>
> Les réponses de Remote MCP se répartissent en trois couches.
> 1. **`content` standard.** Contient les identifiants de source et de tâche, l’état, le décalage, le curseur, la disponibilité et les diagnostics bornés nécessaires pour choisir et appeler l’outil suivant. Même les clients sans `structuredContent` ni ressources personnalisées peuvent créer des sources, les corriger et relancer le rendu.
> 2. **`structuredContent`.** Contient l’objet validé complet pour le traitement automatique.
> 3. **Ressources MCP (`latex-renderer://jobs/...`).** Contiennent les données volumineuses telles que le PDF, le `compile.log` complet, le JSON brut, `svg/manifest.json` et `svg/objects/*.svg`. Seul le même propriétaire OAuth peut les lire. Les mêmes limites de taille et de conservation que pour les fichiers ordinaires s’appliquent. Toutes les couches excluent clés d’API, jetons OAuth, tickets, texte source et base64 brut.

## Attente et nouvelles tentatives de la CLI {#cliの待機と再試行}

> [!DETAILS] Spécifications et procédures
>
> Si une consultation de l’état reçoit un HTTP transitoire `502`, `503`, `504` ou du JSON invalide, la CLI répète uniquement cette consultation de la même tâche, **jusqu’à 5 fois**, après des délais de 1, 2, 4, 8 et 8 secondes sans prolonger le délai total. La création de tâches, l’envoi, le renouvellement de jetons et la vérification de fichiers ne sont pas répétés automatiquement. Les erreurs d’authentification et de permission sont renvoyées immédiatement. Si la CLI cesse d’attendre, le serveur peut poursuivre le traitement.

## Format JSON de la CLI {#cliのjson形式}

> [!DETAILS] Spécifications et procédures
>
> Avec `--json`, la sortie standard utilise les formats suivants. La clé d’API, `uploadTicket` et `jobTicket` en sont exclus.
>
> - **Réussite (code de sortie `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Erreur de la CLI ou de l’API (code de sortie `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Tâche terminée en erreur, par exemple après un échec LaTeX (code de sortie `2`).** `result` contient les données de la tâche et les chemins enregistrés. La réponse comprend `success: false`.

## Migration et récupération d’anciennes versions {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrer un ancien programme de mise à jour et résoudre les erreurs d’extraction
>
> ### Migrer du programme de mise à jour root v1.2.x vers la séparation des privilèges {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Jusqu’à la v1.2.x, Update Manager s’exécutait en tant que démon root. Depuis la v1.3.0, le contrôleur permanent s’exécute sous `latex-renderer-update` et un auxiliaire root de courte durée accepte des opérations fixes. Une mise à jour web depuis l’ancien programme peut s’arrêter avec `Application Update Manager must use a separate non-root build tree`. Ne répétez pas la même opération web.
>
> Pour cette migration unique, utilisez la [distribution serveur v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Avec un compte ordinaire, suivez [Télécharger et vérifier la distribution](/fr/docs/self-hosting/#v1-6-9をダウンロードして検証) en remplaçant la première ligne `version=` par `version=1.3.6`. Gardez le même terminal pour conserver le `bundle_root` obtenu lors de la vérification et de l’extraction.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Le script télécharge à nouveau en tant que root la même version immuable et vérifie l’empreinte, l’étiquette/commit, le paquet Sigstore, les limites de l’archive et les métadonnées. Il accepte uniquement `gh` dans `/usr/local/bin/gh` ou `/usr/bin/gh`, appartenant à root et sans écriture pour le groupe ni les autres utilisateurs. Il sépare les arbres `verified` de root, `bootstrap-build` non root (pnpm épinglé avec un intermédiaire Corepack dédié) et `assembly` de root. Il arrête l’ancien gestionnaire seulement après l’acquisition du verrou partagé des modifications et le redémarre en cas d’échec. À la fin, vérifiez `User=latex-renderer-update` et l’état `active` de chaque service avec les commandes suivantes. Utilisez ensuite les mises à jour normales via le web ou la CLI d’administration.
> Le web et l’API ne reçoivent ni privilèges sudo ni jeton GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar interrompt l’extraction avec Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Sous Ubuntu, lorsque GNU `tar` utilise `openat2`, la restriction `RestrictSUIDSGID=true` du programme de mise à jour peut interrompre l’extraction des archives comportant des sous-répertoires avec `ENOSYS` (Function not implemented). Le programme corrigé conserve l’inspection avec GNU `tar` et la vérification des signatures. Seule l’extraction passe à `/usr/bin/bsdtar` dans un dossier temporaire privé vide, sans importer les propriétaires, ACL ni attributs étendus. `RestrictSUIDSGID` reste en place et le `tar` du système est conservé.
>
> L’ancien programme peut également échouer en extrayant sa propre correction. Vérifiez qu’aucune opération n’est en cours, que l’application et sa base sont saines et qu’une sauvegarde chiffrée a été vérifiée. Utilisez le `bootstrap-v1` installé pour **mettre d’abord à jour uniquement le programme de mise à jour indépendant** vers une version publiée contenant le correctif.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Vérifiez sa nouvelle version ainsi que `ready` et `pending=false`. Appliquez ensuite la même version à l’application via le web ou la commande normale `update apply` de la CLI d’administration.
>
> Le programme de mise à jour `v1.4.0-rc.3` présente un problème connu. La copie du paquet effectuée par root conserve le propriétaire non privilégié et échoue avec `Release extraction requires a private regular bundle`. Maintenez les contrôles, mettez d’abord le programme à jour vers une version publiée corrigeant la propriété puis appliquez l’application. Vous pouvez tester séparément l’extraction sous root et systemd avec `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Examiner les verrous de mise à jour et de modification de TeX
>
> ### Le verrou des modifications est utilisé {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` empêche le chevauchement d’une mise à jour de l’application avec un changement de TeX. Attendez la fin de l’opération active. **Ne supprimez jamais le fichier `/run/latex-renderer/mutation.lock`.** Sa suppression peut laisser coexister deux verrous indépendants. Si le problème survient lors de la restauration interne d’un environnement TeX pendant une mise à jour, l’opération peut être en conflit avec elle-même. Examinez les journaux et les services arrêtés avant de réessayer.
>
> Uniquement si aucune opération n’est active et que les journaux confirment la fin de la précédente, arrêtez les deux gestionnaires et examinez le processus qui détient le verrou.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Terminez ce processus et redémarrez les gestionnaires uniquement après avoir confirmé qu’il s’agit d’un auxiliaire de verrouillage orphelin d’une opération terminée.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Identité du moteur de rendu dans d’anciennes versions candidates {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Versions candidates de la v1.3.4
>
> La mise à jour de `v1.3.4-rc.3` vers `v1.3.4-rc.4` a échoué avant la bascule des services lorsque le nombre de fichiers du hachage d’identité du moteur est passé de 5 à 6. Pour cette migration, utilisez `v1.3.4-rc.5`, qui contient également les anciennes données de compatibilité. La somme de contrôle du paquet complet et la signature de provenance vérifient aussi le fichier ajouté.

## Environnements d’exécution du programme de mise à jour {#updaterの実行領域}

> [!DETAILS] Spécifications et procédures
>
> Update Manager sépare strictement l’arbre `verified` de root contenant la distribution vérifiée, `build` non root pour l’installation des dépendances et la construction, et `assembly` de root pour les résultats autorisés. Les scripts de déploiement exécutés par root utilisent toujours la copie vérifiée de `assembly`. Les étapes sous le compte de déploiement, par exemple la publication Cloudflare, utilisent une copie temporaire `deployment-build` après les contrôles de root. Il en va de même lors d’un retour arrière.

## Chemins d’installation et protections sous Windows {#windowsの配置と保護}

> [!DETAILS] Spécifications et procédures
>
> Lorsque vous changez l’emplacement d’installation sous Windows, le répertoire de commandes par défaut devient son sous-dossier `bin`. Si vous définissez `LATEX_RENDER_BIN_DIRECTORY`, les lanceurs gérés y sont placés et le PATH de l’utilisateur et Local MCP partagent le même chemin. Les autres lanceurs sont préservés. `setup repair` peut corriger le chemin précédemment enregistré. L’ancienne entrée de PATH reste disponible pour les autres applications. Utilisez des chemins absolus sans point-virgule, guillemet ni caractère de contrôle. Si `--open` ou l’interface graphique ne parvient pas à ouvrir le navigateur ou la visionneuse, le PDF enregistré est conservé.

## Partage et conservation des projets {#保存プロジェクトの共有-保持}

> [!DETAILS] Règles de partage et de conservation
>
> - Le web (`/app/`), la CLI, l’API publique, Local MCP et Remote MCP partagent les projets et l’historique de révisions immuables d’un utilisateur. Plusieurs clés d’API ou comptes de service du même utilisateur peuvent les consulter et les modifier. Il est également possible d’utiliser des sources et tâches temporaires sans les enregistrer dans un projet.
> - La combinaison des sources, du document principal, du moteur et des formats de sortie identifie la révision. Des révisions aux sorties différentes peuvent partager les mêmes sources. Les formats choisis dans **Convertir à nouveau** s’appliquent uniquement à cette exécution. Sélectionnez les réglages initiaux pour reprendre les formats enregistrés avec la révision.
> - Les sources référencées par une révision active sont conservées même après expiration du délai des sources orphelines et comptent dans le quota de l’utilisateur. Supprimer un projet masque son enregistrement. Lorsque le dernier projet qui référence les sources est supprimé et que les tâches associées disparaissent, la protection prend fin. Le nettoyage périodique supprime les sources après leur expiration. Pour un effacement complet immédiat, contactez l’administrateur.

## Langue de l’interface {#表示言語}

L’éditeur enregistre la **Langue d’affichage** dans le compte. Si elle n’est pas définie, il parcourt les langues du navigateur et utilise l’anglais si aucune n’est prise en charge. Le moteur et l’encodage du document sont réglés séparément.

| Domaine | Couverture des traductions |
| --- | --- |
| Web et configuration | Actions, états d’exécution, confirmations et diagnostics. |
| CLI et MCP | L’aide et les invites de la CLI suivent la langue du terminal. Les descriptions MCP distantes suivent la langue du compte. |
| Éditeur | L’édition, la recherche et le remplacement, l’enregistrement et les conflits, les états de compilation et les commandes d’aperçu sont disponibles en 18 langues. |
| Guides publics | Tous les guides sont disponibles dans les 18 langues ci-dessous. Pour changer de langue, utilisez le menu en haut de la page. |

L’éditeur prend en charge l’anglais, le japonais, le chinois simplifié, le coréen, l’espagnol, le portugais, le français, l’allemand, l’italien, le russe, le turc, le polonais, le tchèque, le néerlandais, le suédois, le norvégien bokmål, le danois et le finnois. Les journaux de TeX et des paquets externes gardent leur texte original pour faciliter le diagnostic.

## Récupérer les journaux d’audit {#監査ログの復旧}

Après restauration de la base, la position d’exportation (`export_database_id`, numéro de séquence de ligne `export_sequence` et `export_token`) peut diverger de son état. L’exportation et le nettoyage s’arrêtent alors pour protéger les données.

1. Arrêtez les services et minuteurs d’exportation et de nettoyage pendant l’examen et la récupération.
2. Conservez séparément la base restaurée, les exportations chiffrées existantes et tous les fichiers de points de contrôle actuels et anciens. Vérifiez l’intégrité, les clés étrangères et l’état de migration de la base restaurée.
3. Si aucun point de contrôle n’est compatible et que vous décidez de réexporter les lignes présentes, déplacez les fichiers de contrôle hors des chemins actifs. Vérifiez également le chemin de `AUDIT_EXPORT_CHECKPOINT` s’il est défini. Conservez les lignes d’audit, les séquences SQLite et `export.lock`.
4. Exécutez une exportation manuelle avec les identifiants du service de production. Vérifiez que la sortie peut être déchiffrée et qu’un nouveau point de contrôle de format 3 a été produit avant de redémarrer les minuteurs.

Seules les lignes présentes dans la base restaurée seront réexportées. Pour rapprocher des doublons, utilisez conjointement `export_database_id`, `export_sequence` et `export_token`. L’horodatage seul ne permet pas d’identifier une ligne.
