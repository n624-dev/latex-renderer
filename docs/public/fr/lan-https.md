---
slug: lan-https
category: Auto-hébergement
title: Utiliser HTTPS sur le réseau local avec Akebi
description: Accédez au serveur avec une URL HTTPS dérivée de son adresse IP locale.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Accéder au serveur via l’adresse IP du réseau local {#lan-の-ip-アドレスからアクセスする}

Akebi transforme l’adresse IP privée du serveur en nom d’hôte accessible en HTTPS.

Configurez le service de certificats partagé dans l’assistant de LaTeX Renderer. Pour fournir votre propre service, consultez [Administrer un service de certificats Akebi](/fr/docs/lan-https-authority/).

- **Exemple IPv4.** Pour l’adresse `192.168.1.50` et le domaine de réseau local `lan.example.org`, l’URL est `https://192-168-1-50.lan.example.org`.
- **IPv6.** Le nom contient les huit groupes développés de l’adresse privée prise en charge. Utilisez l’URL exacte affichée par l’assistant.

**Conditions réseau et DNS**
Le client doit pouvoir joindre le réseau local du serveur. Si le nom ne se résout pas, vérifiez si le routeur ou le résolveur DNS bloque les réponses contenant des IP privées au titre de la **protection contre le DNS rebinding**. Si nécessaire, ajoutez une exception pour le seul domaine local utilisé.

## Choisir le type de certificat {#証明書の方式を選ぶ}

| Méthode | Prérequis et caractéristiques |
| --- | --- |
| **Service partagé, AC publique** | Configurez le service partagé et acceptez les conditions de l’autorité de certification (AC). La clé privée du certificat reste sur le serveur. |
| **Service dédié, AC publique** | URL et domaine local de [votre service Akebi](/fr/docs/lan-https-authority/), et code d’invitation si nécessaire. |
| **Keyless** | Nécessite un service compatible auquel la signature est déléguée durant la négociation TLS. |
| **Certificat existant ou AC privée** | Certificat correspondant au nom du serveur et clé privée associée. Pour une AC privée, configurez la confiance dans sa racine sur le serveur et tous les clients. |

> [!NOTE]
> - Avec une AC publique, les noms d’hôte des certificats délivrés apparaissent dans les **journaux publics de transparence des certificats (CT)**.
> - Deux réseaux locaux distincts utilisant la même IP privée et le même domaine local correspondent à **la même origine** pour le navigateur et partagent les cookies et autres données stockées.

## Configurer l’accès depuis le réseau local {#lan-向けに設定する}

1. Pour une nouvelle installation, [préparez le serveur](/fr/docs/self-hosting/#準備するもの) et utilisez `sudo n624-latex server setup --web` pour ouvrir l’[assistant](/fr/docs/server-setup/#ブラウザで開く). Pour modifier un serveur utilisant un HTTPS dédié géré, utilisez `sudo n624-latex server setup --ingress --web`.
2. Sélectionnez **LAN** comme mode d’accès et indiquez l’interface réseau, l’adresse IP privée, les sous-réseaux clients autorisés et le port HTTPS.
3. Choisissez le service et le type de certificat. Avec le service partagé, l’URL `https://akebi.n624.net` et le domaine local `lan.n624.net` sont configurés, et le serveur est inscrit à l’application des changements. Aucune invitation n’est nécessaire. Pour une AC publique, lisez et acceptez ses conditions. Si vous utilisez un service dédié sur invitation, saisissez le code de l’administrateur.
4. Vérifiez l’URL HTTPS produite et les sous-réseaux autorisés avant d’appliquer. L’authentification de l’application par mot de passe ou OIDC reste en vigueur.
5. Depuis une autre machine d’un sous-réseau autorisé, ouvrez l’URL, vérifiez qu’aucun avertissement de certificat n’apparaît, connectez-vous et convertissez un document de test.

Pour héberger votre propre service, consultez [Administrer un service de certificats Akebi](/fr/docs/lan-https-authority/).

## Vérifier l’état du certificat {#証明書の状態を確認する}

Ces commandes affichent le service, le minuteur de renouvellement et les journaux de son espace de noms.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Si l’émission ou le renouvellement échoue, vérifiez l’horloge du serveur, la connexion HTTPS au service, le domaine, l’adresse IP et l’heure de nouvelle tentative indiquée par l’AC. Un échec temporaire préserve le certificat valide. Le minuteur reprend l’émission à partir de l’état enregistré. Si la clé et l’état divergent, vérifiez les fichiers d’état conservés de la même génération.

Consultez la [conception d’Akebi et le dépannage](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
