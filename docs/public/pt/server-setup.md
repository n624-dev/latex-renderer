---
slug: server-setup
category: Hospedagem própria
title: Assistente de configuração do servidor
description: Configure autenticação, HTTPS e limites de execução em um servidor preparado usando um navegador ou terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Escolher o procedimento {#どの手順を使うか}

Para uma nova instalação, [prepare o servidor](/pt/docs/self-hosting/#準備するもの) e abra o assistente em um **navegador**. Em instalações existentes, o mesmo assistente permite alterar o login e os limites de execução.

- Execute `sudo n624-latex server setup --plan` no servidor para verificar os pacotes necessários e o espaço livre. Resolva as pendências indicadas e repita a verificação.
- Para alterar uma instalação existente com HTTPS dedicado ou HTTPS na LAN (Akebi), acrescente `--ingress` ao comando de inicialização.
- Se o Docker informar que faltam módulos do kernel em um host mínimo, siga as instruções e tente novamente. Por exemplo, se exigir `nf_tables`, um administrador deve executar `sudo modprobe nf_tables`.

## Abrir no navegador {#ブラウザで開く}

Conecte-se por SSH com a conta de implantação sem privilégios de root e execute o comando abaixo. **Mantenha o terminal aberto até o fim da configuração.**

```sh
sudo n624-latex server setup --web
```

1. Na instalação inicial, confira as tarefas de preparação e digite `PREPARE` para continuar. Aguarde o download da versão assinada, a preparação dos serviços e a criação e verificação do primeiro ambiente TeX.
2. Localize no terminal a URL de uso único. Ela vale por **5 minutos**.
3. Abra-a no servidor ou use **encaminhamento de porta por SSH** para acessar a mesma porta do seu computador. Se a porta exibida for `41234`, execute o comando abaixo em outro terminal local e abra no navegador a URL indicada pelo assistente.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Mantenha a URL de configuração privada e evite expor a porta à internet ou a um proxy reverso.

## Revisar e aplicar a configuração {#プレビューから適用まで}

1. **Escolha a forma de acesso e o método de login.** Em instalações novas, configure o HTTPS e o primeiro proprietário. Digite as senhas e os segredos de cliente OIDC nos campos ocultos correspondentes.
2. **Confira a prévia.** Verifique a URL pública e o método de acesso. Ao mudar de método, prepare a identidade de proprietário para o novo método enquanto ainda conseguir entrar.
3. **Aplique as alterações.** Aguarde o início ou a reinicialização dos serviços.
4. **Entre e crie um PDF.** Use outra janela do navegador para [verificar a instalação](/pt/docs/self-hosting/#導入完了の確認).

Se habilitar senhas e OIDC em uma instalação nova, cadastre primeiro o proprietário com senha e acrescente a essa conta os valores `issuer` e `subject` do OIDC. Nos limites de execução, o limite para iniciar indica a RAM livre antes de começar o trabalho, e o limite durante a execução indica a RAM que o contêiner pode usar.

## Revisar uma alteração interrompida {#中断した変更を確認する}

- Se perder a conexão depois de começar a aplicar as alterações, primeiro confira o resultado da mesma operação.
- Se o processo do assistente tiver terminado, reinicie-o para o mesmo destino e selecione **Recover** na web ou **`RECOVER`** no terminal. Caso um proprietário já tenha sido registrado, o assistente reutilizará o registro e continuará até a confirmação. Esse procedimento recupera a configuração e não restaura um backup anterior do banco.
- Os arquivos de recuperação podem conter segredos TLS ou OIDC. Evite editá-los manualmente. Ao pedir ajuda, informe apenas o código de erro exibido e a etapa.

## Abrir no terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Para alterar um servidor existente, informe cada configuração ou pressione Enter com o campo vazio para manter o valor atual. Para HTTPS automático na LAN durante a instalação, selecione `LAN` e siga as instruções. Para configurar pelo terminal o HTTPS próprio pela primeira vez ou uma rota Cloudflare existente, digite em uma linha o JSON no formato indicado. Se for sua primeira configuração, [comece pelo navegador](#ブラウザで開く).

### Versões anteriores e instalações manuais {#旧版-手動配置の場合}

> [!DETAILS] Executar server-setup.mjs diretamente
>
> Se você preparou o servidor sem APT, com usuário dedicado, Node.js e Docker sem root, e colocou uma versão verificada em `/opt/latex-renderer/current`, chame `server-setup.mjs` diretamente. Para preparar um novo host, consulte as [instruções manuais](/pt/docs/self-hosting/#現在の提供状況).
>
> | Tarefa | Argumento de inicialização | Condições |
> | --- | --- | --- |
> | Alterar autenticação ou limites existentes | `--existing` | Proprietário registrado e serviços em funcionamento |
> | Configurar e registrar o primeiro proprietário | `--initial` | Distribuição e ambiente preparados, sem configuração operacional nem banco anterior |
> | Alterar o HTTPS dedicado gerenciado | `--ingress` | HTTPS standalone dedicado. A migração de um Nginx compartilhado é uma operação à parte. |
>
> - **Interface de terminal**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Interface do navegador**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Consulte a [especificação de entrada e recuperação do assistente](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
