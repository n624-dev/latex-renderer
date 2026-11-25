---
slug: updates
category: Hospedagem própria
title: Atualizar o servidor ou voltar à versão anterior
description: Aplique uma versão estável, confira o resultado e escolha uma forma de recuperação se a atualização falhar.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Antes de atualizar {#更新する前に}

| O que você quer alterar | Onde alterar |
| --- | --- |
| Aplicação do servidor | **Administração → Atualizações** |
| Versão ou idiomas do TeX Live | **Administração → Ambiente TeX**. Consulte [Alterar o ambiente TeX](/pt/docs/self-hosting/#tex環境の初期設定). |
| Pacote APT local `n624-latex` | [Atualizar o pacote APT](/pt/docs/client/#apt-版の更新) |

Antes de começar, confira os três pontos abaixo.

1. [Crie e verifique um backup criptografado](/pt/docs/backups/#手動で作成する).
2. Escolha um horário com poucos trabalhos de conversão ativos.
3. Mantenha o modo de manutenção em `normal`. O atualizador para e inicia os serviços necessários e executa uma conversão de teste.

## Aplicar uma versão estável {#正式版を適用する}

1. Entre como proprietário e abra **Administração → Atualizações** (`/admin/updates/`).
2. Deixe o campo da versão vazio e clique em **Verificar atualizações** para ver a versão atual e a versão estável disponível.
3. Selecione a opção de baixar, verificar e atualizar, informe o motivo da alteração e inicie a atualização.
4. Anote o **ID da operação** e confira se o estado indica conclusão com êxito.
   - Se a aplicação já estiver atualizada, mas o atualizador precisar de uma atualização, confira o resultado da mesma operação e os detalhes do atualizador.
   - A operação continua mesmo se você fechar o navegador. Se aparecer `502` durante uma reinicialização, aguarde a reconexão da interface.
5. Entre em outro navegador ou janela privada. Converta um documento representativo, teste o download do PDF e confira as versões da aplicação e do atualizador.

## Notificações e atualizações automáticas {#通知と自動更新}

Na política de atualização, escolha verificar e notificar (padrão) ou aplicar automaticamente após a verificação.

- A atualização automática abrange somente versões estáveis.
- Para testar uma versão candidata em um ambiente dedicado, informe a tag publicada no formato `vX.Y.Z-rc.N`.

## Se a atualização falhar {#更新が失敗した場合}

No registro detalhado, confira o ID da operação e em que etapa ela falhou. Verifique as versões da aplicação e do atualizador, o login, a conversão e a necessidade de analisar o ponto de recuperação. O número da versão por si só é insuficiente.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Confira se há manutenção em andamento e volte ao modo `normal` antes de iniciar a atualização.
- **`RECOVERY_REVIEW_REQUIRED`.** Siga as instruções para [examinar o ponto de recuperação após uma falha](/pt/docs/backups/#更新失敗後の復旧点を確認する).

## Voltar à versão anterior {#前の版へ戻す}

- **Se bastar reverter a aplicação**, confira o destino em **Administração → Atualizações** e, se disponível, escolha voltar à versão anterior. Ao concluir, teste o login e a conversão para PDF.
- **Se a alteração do banco for incompatível**, restaure o banco e o armazenamento do mesmo ponto de recuperação. Siga o procedimento de [restauração de dados](/pt/docs/backups/#データを復旧する場合).

Consulte [Migração e recuperação de versões anteriores](/pt/docs/reference/#旧版からの移行と特殊復旧) e a [especificação e a política de retenção do atualizador](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
