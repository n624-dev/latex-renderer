---
slug: troubleshooting
category: Dépannage et sécurité
title: Dépannage
description: Diagnostiquez les problèmes de connexion, d’installation, de conversion et de téléchargement.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Premières vérifications {#確認する順序}

1. **Consultez l’[état du service](/status/)** pour vérifier s’il existe un incident général ou une maintenance.
2. **Vérifiez la tâche existante.** Si la conversion est déjà lancée, ouvrez la même tâche dans l’**historique** ou exécutez `n624-latex jobs get <jobId>` avec la CLI.
3. **Lisez les diagnostics et le journal.** Sur le web, ouvrez les diagnostics de la page de résultats. Avec la CLI, consultez `.render/errors.json` et le journal détaillé `.render/compile.log`.

## Problèmes fréquents {#代表的な問題}

### Installation et connexion {#インストール-ログイン}

- **La commande `n624-latex` ou `latex-render` est introuvable.**
  Ouvrez un nouveau terminal ou une nouvelle fenêtre PowerShell. Si le problème persiste, vérifiez le [PATH sous Linux ou macOS](/fr/docs/client/#linux-macos) ou consultez les [instructions d’installation sous Windows](/fr/docs/windows/#インストール).
- **La connexion à l’application web échoue.**
  Utilisez le compte enregistré et la méthode indiquée par l’administrateur (mot de passe, OIDC ou Cloudflare Access). Pour une connexion bloquée depuis ChatGPT ou Claude, consultez [Vérifier la connexion à Remote MCP](/fr/docs/mcp/#chatgptなどの接続を確認する).
- **La CLI renvoie `401` ou `403`.**
  Exécutez `n624-latex auth status` pour vérifier la clé enregistrée. Demandez à l’administrateur de confirmer qu’elle est active et possède les autorisations `render:create` et `render:read:own`. Si nécessaire, [enregistrez à nouveau la clé](/fr/docs/cli/#認証). Pour un serveur auto-hébergé, vérifiez également l’[URL du serveur (`LATEX_RENDER_BASE_URL`)](/fr/docs/cli/#接続先サーバー).

### Envoi et conversion {#アップロード-変換}

- **Le document principal est introuvable dans le ZIP.**
  Le point d’entrée par défaut est `main.tex` à la racine. Vérifiez si vous avez inclus le dossier parent ou indiquez le chemin relatif du document. Consultez [Préparer le ZIP](/fr/docs/projects/#構成).
- **La taille ou l’extension d’un fichier est refusée.**
  Retirez les fichiers générés inutiles ou non admis, ou configurez `.latexrenderignore`. Consultez les [fichiers acceptés et les limites](/fr/docs/projects/#制限).
- **La conversion reste en file d’attente ou la connexion est interrompue.**
  Le serveur peut poursuivre le traitement. Rouvrez la même page de résultats ou consultez le même identifiant de tâche avant d’en créer une autre.
- **Il manque des paquets ou des polices, ou le délai est dépassé.**
  Recherchez les noms disponibles dans l’[environnement de rendu](/app/environment/). En cas de dépassement du délai, examinez les macros complexes, images volumineuses et schémas TikZ près de l’endroit où le journal s’est arrêté.

### Télécharger les fichiers {#成果物の取得}

- **Le PDF est présent mais les SVG manquent.**
  Si **Réussite partielle** apparaît, enregistrez d’abord le PDF et sélectionnez **Réessayer uniquement le SVG**. Consultez [Relancer l’extraction des SVG](/fr/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **L’aperçu PNG est toujours en préparation.**
  Patientez ou rouvrez la même page. Vous pouvez télécharger le PDF définitif sans attendre.
- **La destination est occupée ou `OUTPUT_BUSY` apparaît.**
  Fermez la visionneuse qui utilise le PDF de sortie ou attendez que le processus en train d’écrire dans ce dossier se termine, puis relancez le téléchargement.
- **Le résultat a expiré ou l’espace de stockage est insuffisant.**
  Pour un résultat expiré, reconvertissez la révision enregistrée ou vos fichiers locaux. Si votre quota est atteint, supprimez les tâches terminées devenues inutiles. Si le disque du serveur est plein, prévenez l’administrateur.

## Demander de l’aide {#問い合わせ}

- **Administrateur du serveur.** Indiquez l’heure du problème, l’opération interrompue, le code d’erreur et, si disponible, l’identifiant de tâche (`job_...`).
- **Signalement public sur GitHub.** Fournissez le minimum d’étapes pour reproduire le problème, sans secrets ni documents personnels. **Ne publiez jamais de clés d’API, de cookies, de document original, de PDF ni de journaux complets non expurgés.**
