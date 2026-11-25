---
slug: backups
category: Auto-hébergement
title: Créer, vérifier et restaurer des sauvegardes
description: Distinguez sauvegardes périodiques et points de récupération avant mise à jour, vérifiez une archive et restaurez les données.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Contenu des sauvegardes {#何が保存されるか}

| Type | Contenu | Usage |
| --- | --- | --- |
| **Sauvegarde périodique** | Base de données SQLite et ZIP d’entrée référencés par les révisions actives, les brouillons et les aperçus en cours | Protéger la base de données, les projets et les documents en cours de modification |
| **Point de récupération avant mise à jour** | SQLite juste avant la mise à jour, stockage complet de l’application et informations sur la version précédente | Enquêter sur un échec et restaurer l’état antérieur |
| **Sauvegarde distincte de la configuration de l’hôte** | Fichiers tels que `/etc/latex-renderer/`, clés privées, certificats TLS et état d’Akebi | Reconstruire l’hôte après une panne |

- Après restauration d’une sauvegarde périodique, ouvrez le projet dans l’éditeur pour régénérer son aperçu. Les sorties des tâches temporaires et les caches de travail sont exclus.
- Protégez séparément la configuration, les certificats et la clé de déchiffrement (identité age). **Conservez les sauvegardes chiffrées et la clé dans des emplacements sûrs et distincts pour éviter qu’un seul incident n’entraîne leur perte simultanée.**

## Créer une sauvegarde manuellement {#手動で作成する}

1. Connectez-vous en tant que propriétaire et ouvrez **Administration → Système → Sauvegardes**.
2. Cliquez sur **Créer une sauvegarde** et attendez la fin de l’opération.
3. Cliquez sur **Vérifier la dernière sauvegarde** et contrôlez le nom du fichier et l’heure de la dernière vérification. Le serveur doit disposer de la clé de déchiffrement.

### Créer et vérifier depuis la ligne de commande {#コマンドで作成-検証する}

1. Créez immédiatement une sauvegarde chiffrée sur le serveur. Dans `/etc/latex-renderer/backup.env`, `BACKUP_DIRECTORY` définit la destination, dont la valeur par défaut est `/var/lib/latex-renderer/backups`. Le minuteur `latex-renderer-backup.timer` effectue les sauvegardes périodiques.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Copiez le fichier `.tar.age` sur un hôte Linux de vérification. Prévoyez GNU `tar`, `age`, une version prise en charge de Node.js (24 ou 26) avec `node:sqlite` et la clé de déchiffrement. Pour un stockage durable, conservez l’archive et la clé séparément.
3. [Téléchargez, vérifiez et extrayez la distribution du serveur](/fr/docs/self-hosting/#v1-6-9をダウンロードして検証) correspondant à la version ayant créé la sauvegarde. Indiquez cette version dans le premier `version=`, affectez à `release_dir` le dossier extrait et exécutez le script de la distribution.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Le message `restore_test.completed` confirme la fin de la vérification. Le test vérifie la cohérence de SQLite et des ZIP d’entrée extraits dans un espace temporaire. Pour vérifier une sauvegarde externalisée, récupérez-la depuis son lieu de stockage.

## Examiner un point de récupération après un échec {#更新失敗後の復旧点を確認する}

Si `RECOVERY_REVIEW_REQUIRED` apparaît après l’échec d’une mise à jour, vérifiez l’état du point de récupération avec les privilèges d’administration.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Consulter l’état avec les anciennes versions
>
> Si `n624-latex server recovery status` n’existe pas, exécutez `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Recoupez l’identifiant du point (`POINT_ID`), les versions de l’application et du programme de mise à jour, le schéma de la base et l’état des services. Si une restauration des données est nécessaire, préservez d’abord l’archive et la configuration actuelle dans un autre emplacement.
2. Exécutez `acknowledge` uniquement après avoir vérifié que la restauration des données est inutile et que vous pouvez lever la protection du point.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` clôt l’examen et redémarre les services si les conditions sont remplies. Pour restaurer les données, gardez le point protégé et suivez la procédure ci-dessous.

## Restaurer les données {#データを復旧する場合}

Les modifications apportées depuis la sauvegarde seront perdues. Si la base est compatible et qu’il suffit de revenir à la version précédente de l’application, utilisez le [retour à la version précédente depuis Mises à jour](/fr/docs/updates/#前の版へ戻す). Répétez la restauration sur un hôte de test avant de l’appliquer en production.

1. **Identifiez la cible et conservez l’état actuel.** Identifiez l’archive et la version de l’application compatible avec son schéma. Avant toute intervention en production, conservez séparément la base, le stockage et la configuration actuels.
2. **Arrêtez les services.** Sous le verrou administratif partagé, arrêtez tous les services et minuteurs qui écrivent dans la base ou le stockage pour éviter les conflits avec les mises à jour ou le nettoyage.
3. **Extrayez et vérifiez.** Déchiffrez et extrayez l’archive dans un dossier privé vide, puis vérifiez son intégrité. Pour un point de mise à jour, comparez également `summary.json`, géré par root, avec le manifeste interne.
4. **Restaurez un même instant.** SQLite et le stockage des entrées et sorties doivent provenir du **même point de récupération**. Pour une sauvegarde périodique, replacez chaque ZIP à l’emplacement `storage_key` vérifié indiqué par la base restaurée. Respectez les versions, fichiers de configuration, propriétaires et permissions correspondants.
5. **Démarrez et vérifiez.** Testez la connexion, la conversion d’un projet enregistré, le téléchargement des résultats et la création d’une nouvelle sauvegarde. Si l’exportation d’audit s’arrête en raison d’une divergence de position, suivez la [récupération des journaux d’audit](/fr/docs/reference/#監査ログの復旧).

Consultez le [format et les contrôles des sauvegardes d’exploitation](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) ainsi que la [conception des points de récupération avant mise à jour](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
