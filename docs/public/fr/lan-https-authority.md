---
slug: lan-https-authority
category: Auto-hébergement
title: Administrer un service de certificats Akebi
description: Configurez la délégation DNS du domaine local, l’émission de certificats et l’inscription ouverte ou sur invitation.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Ce guide concerne les administrateurs qui exploitent leur propre service de certificats. Pour utiliser le service partagé avec LaTeX Renderer, consultez [Utiliser HTTPS sur le réseau local avec Akebi](/fr/docs/lan-https/).

Prévoyez une zone DNS que vous pouvez déléguer, un hôte Linux (amd64 ou arm64) capable de servir le DNS public et HTTPS, Node.js 24 ou 26 et un compte auprès de votre autorité de certification (AC). Utilisez une distribution du serveur dont vous avez vérifié la signature avec la [procédure de téléchargement manuel](/fr/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Déléguer le DNS {#dns-を委任する}

Configurez les enregistrements suivants dans la zone du domaine parent. Le DNS d’Akebi doit être accessible depuis Internet sur le **port 53 en UDP et en TCP**.

| Type | Nom | Valeur |
| --- | --- | --- |
| `A` | `ns1.example.org` | IPv4 publique du serveur DNS d’Akebi |
| `A` | `akebi.example.org` | IPv4 publique du proxy inverse HTTPS de l’API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Réservez `ns1.example.org` au DNS et placez l’hôte de l’API (`akebi.example.org`) en dehors de la zone des certificats du réseau local (`lan.example.org`).
- Après la délégation, Akebi répond dynamiquement avec les enregistrements `A` et `AAAA` dérivés des IP locales et les `TXT` de validation ACME. La zone parente ne nécessite pas d’enregistrement par IP.

## Déployer le service {#サービスを配置する}

1. **Créez l’utilisateur et les répertoires d’état.** Isolez les permissions de l’application avec un utilisateur et un groupe dédiés nommés `latex-renderer-lan-authority`. Créez `/var/lib/latex-renderer-lan-authority` et son sous-répertoire `keyless` avec ce propriétaire et le mode `0700` pour les deux.
2. **Préparez le répertoire de configuration.** Créez `/etc/latex-renderer-lan-authority` avec le propriétaire et le groupe `root:latex-renderer-lan-authority` et le mode `0750`. Copiez-y `deploy/lan-https/examples/authority.json` depuis la distribution vérifiée et attribuez-lui `root:latex-renderer-lan-authority` et le mode `0640`.
3. **Modifiez `authority.json`.**
   - `policy.serverOrigin` définit l’URL HTTPS de l’API, par exemple `https://akebi.example.org`.
   - `policy.lanDomain` définit le domaine local délégué, par exemple `lan.example.org`.
   - `dns.nameserver` et `dns.listeners` définissent l’hôte DNS public et ses adresses d’écoute. Si un autre DNS utilise le port 53, choisissez une IP publique sans conflit.
   - Liez `http` à l’interface de bouclage.
   - Configurez l’AC publique dans `issuers`. Si elle exige External Account Binding (EAB), utilisez le `eabFile` indiqué, appartenant à l’utilisateur du service et de mode `0600`, pour stocker `kid` et `hmacKey`. Si le domaine utilise des enregistrements CAA, autorisez l’AC choisie.
4. **Installez le code et l’unité systemd.** L’exemple suppose que les sources vérifiées appartiennent à root et se trouvent dans `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initialisez l’état et démarrez le service.** Exécutez `init` uniquement la première fois.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Obtenir le certificat HTTPS {#https-証明書を用意する}

L’exemple Nginx dans `deploy/lan-https/examples/authority.nginx.conf` publie l’API et relaie les requêtes vers son interface locale. Obtenez le certificat de l’API avant d’activer TLS dans Nginx.

Pour un renouvellement automatique avec Certbot, indiquez l’AC, le contact, l’acceptation des conditions et les données EAB requises dans `/etc/latex-renderer-lan-authority/certbot.ini`, accessible uniquement à root. Utilisez une clé ECDSA P-256. Attendez la propagation de la délégation DNS puis exécutez les commandes suivantes.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Après l’émission, ajustez le nom du serveur et les chemins des certificats dans Nginx, vérifiez la syntaxe avec `nginx -t`, appliquez les changements et vérifiez le minuteur de renouvellement de Certbot.

- **Pour proposer Keyless**, obtenez un autre certificat générique ECDSA P-256 contenant uniquement `*.lan.example.org`. Dans la commande ci-dessus, remplacez `--cert-name` par `akebi-keyless`, `-d` par `'*.lan.example.org'` et `--deploy-hook` par `"$hooks/operator-certificate-hook.sh"`. Ce certificat est facultatif si vous proposez uniquement le mode AC publique.

## Configurer l’inscription {#登録方法を設定する}

Dans `authority.json`, sélectionnez le mode d’inscription des serveurs clients au moyen de `policy.registration`.

- `"open"` permet l’inscription automatique.
- `"invite"` exige un code délivré par l’administrateur.

Pour l’inscription sur invitation, émettez avec la commande suivante un code limité en durée et en nombre d’utilisations. Transmettez-le exclusivement au destinataire par un canal sûr.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Dans les deux modes, des limites s’appliquent aux inscriptions, à la fréquence d’émission et aux éléments stockés, en plus des règles d’émission de l’AC.

## Vérifier depuis l’extérieur {#外部から確認する}

Depuis une machine externe, vérifiez la délégation DNS, les réponses SOA en UDP et TCP, la résolution des noms dérivés d’IP et la réponse de découverte HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Lorsque toutes les vérifications aboutissent, connectez un serveur de test LaTeX Renderer en suivant [Configurer l’accès depuis le réseau local](/fr/docs/lan-https/#lan-向けに設定する) et vérifiez l’émission du certificat et la connexion. Si l’AC indique une heure de nouvelle tentative, attendez cette échéance.

**Sauvegardes.** Incluez `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, les comptes auprès de l’AC et la configuration de renouvellement Certbot dans vos sauvegardes chiffrées. Pour une base active, utilisez la sauvegarde en ligne de SQLite.

Consultez les [exemples de configuration et la spécification d’Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
