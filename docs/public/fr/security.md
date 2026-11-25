---
slug: security
category: Dépannage et sécurité
title: Sécurité des comptes et des documents
description: Protégez vos identifiants et vos fichiers et découvrez les limites d’accès au moteur de rendu et à l’administration.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Si une clé d’API est divulguée, demandez immédiatement à l’administrateur de la révoquer et d’en émettre une autre.
- Signalez les vulnérabilités au moyen du [formulaire privé de GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Évitez de publier les détails dans un ticket public.

## Identifiants {#資格情報}

- Ne placez aucune clé d’API dans les arguments de commande (visibles notamment avec `ps`), les URL, les dépôts Git, les journaux ou les conversations avec une IA.
- Pour les stocker localement, utilisez DPAPI sous Windows ou un fichier de mode `0600` lisible uniquement par son propriétaire sous Linux et macOS.
- Réservez les mots de passe du navigateur, les secrets OIDC et les cookies de session à leur usage prévu. Gardez les clés de la CLI et de l’API distinctes (`lrk_` et `lra_`).

## Projets {#プロジェクト}

Toutes les sources LaTeX et pièces jointes sont traitées comme des entrées non fiables. Les liens symboliques, l’accès au shell depuis TeX, l’exécution de commandes externes et les connexions réseau hors du conteneur sont désactivés. Respectez l’isolation, les délais et les limites applicables aux fichiers.

## Espaces publics et administration {#公開領域と管理領域}

La documentation et les téléchargements publics, les pages authentifiées (`/app/` et `/admin/`) et l’API de rendu possèdent des routes distinctes sous une même origine HTTPS canonique.

- **Périmètre réseau.** Le seul point d’entrée du profil Cloudflare est Tunnel/Workers. Pour le profil standalone, il s’agit d’un proxy inverse TLS. Tous les services applicatifs écoutent sur l’interface de bouclage. L’API interne, SQLite et les sockets d’administration restent privés. Les espaces authentifiés sont exclus des index des moteurs de recherche.
- **Authentification et sessions du navigateur.** L’identification via un IdP externe exige une correspondance exacte de `provider + issuer + subject`. L’adresse électronique et le nom affiché ne permettent pas d’associer automatiquement des comptes. Le serveur peut révoquer immédiatement une session. Les requêtes qui modifient l’état exigent une correspondance exacte de `Origin` et un jeton CSRF propre à la session. Les mots de passe sont protégés par `scrypt` et un secret supplémentaire (pepper) appartenant à root. Pour les déploiements publics, ajoutez des limites de connexion et de fréquence sur le proxy ainsi que la protection DDoS du fournisseur.
- **Remote MCP.** `/mcp`, le point de terminaison des jetons OAuth et les métadonnées de découverte sont accessibles publiquement. L’exécution d’outils exige un jeton Bearer de courte durée, d’audience et de portée limitées. L’autorisation utilise la session du navigateur de `/app/` et lie explicitement l’accès à un utilisateur existant et actif.
  - La réponse standard (`content`) ne contient que les identifiants limités au propriétaire, les états, les curseurs et les diagnostics bornés nécessaires pour continuer. Les chemins et diagnostics fournis par l’utilisateur sont renvoyés en tant que données non fiables, sans caractères de contrôle et avec des limites de longueur et de nombre.
  - Le contenu standard `content` et les journaux de diagnostic excluent les jetons OAuth, les clés d’API, les tickets, le base64 brut, les sources complètes, les journaux intégraux, les traces de pile, les identifiants subject d’Access et les chemins internes du serveur. Les PDF et journaux complets sont disponibles uniquement en lisant les ressources, avec un nouveau contrôle de propriété.

## Interface web de configuration locale {#local-setup-web-ui}

`n624-latex setup --gui` (anciennement `latex-render setup --gui`) écoute uniquement sur un port aléatoire de `127.0.0.1` sur la machine locale.

- Le fragment (`#...`) de l’URL ouverte par la CLI contient un jeton de démarrage à usage unique. Le navigateur l’efface immédiatement de l’historique et l’échange contre une session de courte durée.
- Toutes les opérations de l’API exigent une correspondance exacte de `Origin`, une session Bearer et un jeton CSRF distinct. CORS est désactivé, l’en-tête Host et l’adresse de bouclage du client sont vérifiés et une CSP stricte, `frame-ancestors 'none'` et `no-store` sont appliqués.
- La clé saisie est transmise uniquement à l’opération d’enregistrement et est exclue des réponses d’état, de diagnostic et de conversion de test. L’interface se ferme après 30 minutes d’inactivité ou 2 heures après le démarrage.
