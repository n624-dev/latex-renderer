---
slug: updates
category: Auto-hébergement
title: Mettre à jour le serveur ou revenir à la version précédente
description: Appliquez une version stable, vérifiez le résultat et choisissez une procédure de récupération en cas d’échec.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Avant la mise à jour {#更新する前に}

| Élément à modifier | Où intervenir |
| --- | --- |
| Application du serveur | **Administration → Mises à jour** |
| Version ou langues de TeX Live | **Administration → Environnement TeX**. Consultez [Modifier l’environnement TeX](/fr/docs/self-hosting/#tex環境の初期設定). |
| Paquet APT local `n624-latex` | [Mettre à jour le paquet APT](/fr/docs/client/#apt-版の更新) |

Avant de commencer, vérifiez les trois points suivants.

1. [Créez et vérifiez une sauvegarde chiffrée](/fr/docs/backups/#手動で作成する).
2. Choisissez un moment où peu de conversions sont en cours.
3. Laissez le mode de maintenance sur `normal`. Le programme de mise à jour arrête et démarre les services nécessaires et effectue une conversion de test.

## Appliquer une version stable {#正式版を適用する}

1. Connectez-vous en tant que propriétaire et ouvrez **Administration → Mises à jour** (`/admin/updates/`).
2. Laissez le champ de version vide et cliquez sur **Rechercher des mises à jour** pour afficher la version actuelle et la version stable disponible.
3. Sélectionnez **Télécharger, vérifier et mettre à jour**, indiquez le motif du changement et lancez la mise à jour.
4. Notez l’**identifiant de l’opération** et vérifiez que l’état indique qu’elle s’est terminée avec succès.
   - Si l’application est à jour mais que le programme de mise à jour doit changer, consultez le résultat de la même opération et les détails du programme.
   - L’opération continue même si vous fermez le navigateur. Si une erreur `502` apparaît lors d’un redémarrage, attendez la reconnexion de l’interface.
5. Connectez-vous dans un autre navigateur ou une fenêtre privée. Convertissez un document représentatif, vérifiez le téléchargement du PDF et les versions de l’application et du programme de mise à jour.

## Notifications et mises à jour automatiques {#通知と自動更新}

La politique de mise à jour permet de choisir entre la vérification avec notification (par défaut) et l’application automatique après vérification.

- Seules les versions stables sont appliquées automatiquement.
- Pour tester une version candidate dans un environnement de test dédié, indiquez son étiquette publiée au format `vX.Y.Z-rc.N`.

## En cas d’échec {#更新が失敗した場合}

Consultez l’identifiant de l’opération et l’étape en échec dans le journal détaillé. Vérifiez les versions de l’application et du programme de mise à jour, la connexion, la conversion et la nécessité d’examiner le point de récupération. Le numéro de version seul ne suffit pas.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Vérifiez si une maintenance est en cours et repassez au mode `normal` avant de lancer la mise à jour.
- **`RECOVERY_REVIEW_REQUIRED`.** Suivez la procédure pour [examiner le point de récupération après un échec](/fr/docs/backups/#更新失敗後の復旧点を確認する).

## Revenir à la version précédente {#前の版へ戻す}

- **Si rétablir la version précédente de l’application suffit**, vérifiez la cible dans **Administration → Mises à jour** et choisissez **Revenir à la version précédente** si l’option est disponible. Ensuite, testez la connexion et la conversion en PDF.
- **Si la modification de la base de données est incompatible**, restaurez la base et le stockage provenant du même point de récupération. Suivez la procédure de [restauration des données](/fr/docs/backups/#データを復旧する場合).

Consultez [Migration et récupération d’anciennes versions](/fr/docs/reference/#旧版からの移行と特殊復旧) et la [spécification et la politique de conservation du programme de mise à jour](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
