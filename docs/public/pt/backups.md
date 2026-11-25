---
slug: backups
category: Hospedagem própria
title: Criar, verificar e restaurar backups
description: Conheça as diferenças entre backups periódicos e pontos de recuperação de atualizações, verifique um arquivo e restaure os dados.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## O que é salvo {#何が保存されるか}

| Tipo | Conteúdo | Finalidade |
| --- | --- | --- |
| **Backup periódico** | Banco de dados SQLite e ZIPs de entrada referenciados por revisões ativas, rascunhos e prévias em andamento | Proteger o banco, os projetos e os documentos em edição |
| **Ponto de recuperação de atualização** | SQLite imediatamente antes da atualização, todo o armazenamento da aplicação e informações sobre a versão anterior | Investigar falhas e restaurar o estado anterior |
| **Backup separado da configuração do host** | Arquivos como `/etc/latex-renderer/`, chaves privadas, certificados TLS e estado do Akebi | Reconstruir o host após uma falha |

- Depois de restaurar um backup periódico, abra o projeto no editor para gerar a prévia novamente. Os resultados de trabalhos temporários e os caches de trabalho ficam fora do backup.
- Proteja separadamente as configurações, os certificados e a chave de descriptografia (identidade age). **Guarde os backups criptografados e a chave em locais seguros diferentes para evitar perder ambos em um único incidente.**

## Criar um backup manual {#手動で作成する}

1. Entre como proprietário e abra **Administração → Sistema → Backups**.
2. Clique em **Criar backup** e aguarde a conclusão.
3. Clique em **Verificar backup mais recente** e confira o nome do arquivo e o horário da última verificação. O servidor precisa da chave de descriptografia.

### Criar e verificar pela linha de comando {#コマンドで作成-検証する}

1. Crie um backup criptografado no servidor. Em `/etc/latex-renderer/backup.env`, `BACKUP_DIRECTORY` define o destino, cujo padrão é `/var/lib/latex-renderer/backups`. O temporizador `latex-renderer-backup.timer` executa os backups periódicos.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Copie o arquivo `.tar.age` para um host Linux de verificação. Prepare GNU `tar`, `age`, uma versão compatível do Node.js (24 ou 26) com `node:sqlite` e a chave de descriptografia. Para guarda de longo prazo, mantenha o arquivo e a chave separados.
3. [Baixe, verifique e extraia a distribuição do servidor](/pt/docs/self-hosting/#v1-6-9をダウンロードして検証) correspondente à versão que criou o backup. Informe a versão no primeiro `version=`, configure `release_dir` com o diretório extraído e execute o script da distribuição.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

A mensagem `restore_test.completed` indica que a verificação terminou. O teste verifica a consistência do SQLite e dos ZIPs de entrada extraídos em um diretório temporário. Para testar um backup externo, recupere o arquivo do local onde ele está armazenado.

## Examinar um ponto de recuperação após uma falha {#更新失敗後の復旧点を確認する}

Se uma atualização falhar e aparecer `RECOVERY_REVIEW_REQUIRED`, consulte o estado do ponto de recuperação com privilégios administrativos.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Consultar o estado em versões anteriores
>
> Se `n624-latex server recovery status` não existir, execute `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Confira o ID do ponto (`POINT_ID`), as versões da aplicação e do atualizador, o esquema do banco e os serviços em execução. Se precisar restaurar os dados, preserve uma cópia do arquivo e da configuração atual em outro lugar.
2. Execute `acknowledge` somente após investigar e confirmar que os dados dispensam restauração e que você pode retirar a proteção do ponto.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` encerra a análise e retoma os serviços se as condições forem atendidas. Para restaurar dados, mantenha o ponto protegido e siga o procedimento abaixo.

## Restaurar dados {#データを復旧する場合}

As alterações posteriores ao backup serão perdidas. Se o banco for compatível e bastar voltar à versão anterior da aplicação, use a [reversão na página de atualizações](/pt/docs/updates/#前の版へ戻す). Ensaie a restauração dos dados em um host de teste antes de executá-la em produção.

1. **Identifique o destino e preserve o estado atual.** Localize o backup e a versão da aplicação compatível com o esquema. Antes de alterar o ambiente de produção, guarde separadamente o banco, o armazenamento e a configuração atuais.
2. **Pare os serviços.** Sob o bloqueio administrativo compartilhado, pare todos os serviços e temporizadores que gravam no banco ou no armazenamento para evitar conflitos com atualizações e limpeza.
3. **Extraia e verifique.** Descriptografe e extraia o arquivo em um diretório privado vazio e verifique sua integridade. Se usar um ponto de atualização, compare também `summary.json`, gerenciado por root, com o manifesto interno.
4. **Restaure um único instante.** O SQLite e o armazenamento das entradas e saídas devem pertencer ao **mesmo ponto de recuperação**. Em um backup periódico, coloque cada ZIP no local verificado `storage_key` indicado pelo banco restaurado. Use as versões, os arquivos de configuração, os proprietários e as permissões correspondentes.
5. **Inicie e verifique.** Teste o login, a conversão de um projeto salvo, o download dos resultados e a criação de outro backup. Se a exportação da auditoria parar por divergência de posição, siga a [recuperação dos registros de auditoria](/pt/docs/reference/#監査ログの復旧).

Consulte o [formato dos backups operacionais e as verificações](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) e o [projeto dos pontos de recuperação de atualização](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
