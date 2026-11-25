---
slug: server-setup
category: Auto-hébergement
title: Assistant de configuration du serveur
description: Configurez l’authentification, HTTPS et les limites d’exécution sur un serveur préparé depuis un navigateur ou un terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Choisir une procédure {#どの手順を使うか}

Pour une nouvelle installation, [préparez le serveur](/fr/docs/self-hosting/#準備するもの) et ouvrez l’assistant dans un **navigateur**. Sur une installation existante, le même assistant permet de modifier la connexion et les limites d’exécution.

- Exécutez `sudo n624-latex server setup --plan` sur le serveur pour vérifier les paquets nécessaires et l’espace disponible. Corrigez les points signalés puis relancez la vérification.
- Pour modifier une installation existante avec HTTPS dédié ou HTTPS sur le réseau local (Akebi), ajoutez `--ingress` à la commande de lancement.
- Si Docker signale des modules du noyau manquants sur un hôte minimal, suivez les instructions puis réessayez. Par exemple, si `nf_tables` est requis, un administrateur doit exécuter `sudo modprobe nf_tables`.

## Ouvrir dans le navigateur {#ブラウザで開く}

Connectez-vous en SSH avec le compte de déploiement non root et exécutez la commande suivante. **Gardez le terminal ouvert jusqu’à la fin de la configuration.**

```sh
sudo n624-latex server setup --web
```

1. À la première installation, examinez les tâches de préparation et saisissez `PREPARE` pour poursuivre. Attendez le téléchargement de la version signée, la préparation des services et la création et vérification du premier environnement TeX.
2. Repérez l’URL à usage unique dans le terminal. Elle est valable **5 minutes**.
3. Ouvrez-la sur le serveur ou configurez une **redirection de port SSH** pour accéder au même port depuis votre machine. Si le port affiché est `41234`, exécutez la commande suivante dans un autre terminal local et ouvrez dans le navigateur l’URL indiquée par l’assistant.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Gardez l’URL de configuration confidentielle et n’exposez son port ni sur Internet ni via un proxy inverse.

## Vérifier et appliquer la configuration {#プレビューから適用まで}

1. **Choisissez le mode d’accès et la méthode de connexion.** Pour une nouvelle installation, configurez HTTPS et le premier propriétaire. Saisissez les mots de passe et secrets de client OIDC dans les champs masqués prévus à cet effet.
2. **Examinez l’aperçu.** Vérifiez l’URL publique et la méthode de connexion. Si vous changez de méthode, préparez l’identité du propriétaire pour la nouvelle méthode pendant que votre accès actuel fonctionne encore.
3. **Appliquez les modifications.** Attendez le démarrage ou le redémarrage des services.
4. **Connectez-vous et créez un PDF.** Utilisez une autre fenêtre du navigateur pour [vérifier l’installation](/fr/docs/self-hosting/#導入完了の確認).

Si vous activez les mots de passe et OIDC lors d’une nouvelle installation, inscrivez d’abord le propriétaire par mot de passe et ajoutez les valeurs OIDC `issuer` et `subject` à ce compte. Dans les limites d’exécution, le seuil de démarrage correspond à la mémoire libre requise avant de lancer une tâche, et la limite d’exécution à la mémoire utilisable par le conteneur.

## Examiner une modification interrompue {#中断した変更を確認する}

- Si la connexion est coupée après le début de l’application des changements, vérifiez d’abord le résultat de la même opération.
- Si le processus de l’assistant s’est arrêté, relancez-le pour la même cible et choisissez **Recover** sur le web ou **`RECOVER`** dans le terminal. Si un propriétaire est déjà inscrit, l’assistant réutilise son inscription et poursuit jusqu’à la confirmation. Cette récupération de la configuration ne restaure pas une ancienne sauvegarde de la base.
- Les fichiers de récupération peuvent contenir des secrets TLS ou OIDC. Évitez de les modifier manuellement. Si vous demandez de l’aide, fournissez uniquement l’étape et le code d’erreur affiché.

## Ouvrir dans un terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Pour modifier un serveur existant, saisissez chaque réglage ou appuyez sur Entrée dans un champ vide pour conserver sa valeur. Pour configurer le HTTPS automatique sur le réseau local lors de l’installation, choisissez `LAN` et suivez les instructions. Pour configurer par terminal un premier HTTPS dédié ou une route Cloudflare existante, saisissez sur une seule ligne le JSON au format indiqué. Pour une première utilisation, [commencez dans le navigateur](#ブラウザで開く).

### Anciennes versions et installations manuelles {#旧版-手動配置の場合}

> [!DETAILS] Exécuter directement server-setup.mjs
>
> Si vous avez préparé votre serveur sans APT avec un utilisateur dédié, Node.js et Docker sans privilèges root, et placé une version vérifiée dans `/opt/latex-renderer/current`, appelez `server-setup.mjs` directement. Pour préparer un nouvel hôte, consultez les [instructions manuelles](/fr/docs/self-hosting/#現在の提供状況).
>
> | Tâche | Argument de lancement | Conditions |
> | --- | --- | --- |
> | Modifier l’authentification ou les limites existantes | `--existing` | Propriétaire inscrit et services opérationnels |
> | Configurer et inscrire le premier propriétaire | `--initial` | Distribution et environnement préparés, sans configuration opérationnelle ni base de données antérieure |
> | Modifier le HTTPS dédié géré | `--ingress` | HTTPS standalone dédié. La migration depuis un Nginx partagé est une opération distincte. |
>
> - **Interface en terminal**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Interface du navigateur**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Consultez la [spécification des entrées et de la récupération de l’assistant](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
