---
slug: reference
category: Operações e desenvolvimento
title: Referência de operações e desenvolvimento
description: Consulte detalhes de armazenamento e recuperação do cliente, autenticação MCP e procedimentos de migração.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Armazenar e recuperar resultados {#成果物の保存-復旧の仕様}

> [!DETAILS] Especificações e procedimentos
>
> - **Substituição atômica de diretórios.** A CLI e o Local MCP preservam caminhos como `.render/result.pdf`, `job.json` e os das prévias. Verificam o tamanho e o SHA-256 anunciados para cada arquivo e trocam o diretório quando o conjunto está completo. O diretório pode desaparecer brevemente durante a troca. Programas externos devem lê-lo após o término do comando.
> - **Recuperação automática.** Um diretório ao lado do diretório de saída, chamado `<output-name>.latex-renderer-state`, guarda o estado de recuperação e é excluído da coleta de entradas. Ao sair normalmente, os dados temporários são removidos. Após um encerramento forçado, o próximo download restaura o conjunto anterior se a troca ainda não havia sido confirmada. Caso já tivesse sido confirmada, mantém o novo e limpa o anterior. Preserve o diretório de estado durante a operação e antes da recuperação.
> - **Exclusão mútua e anomalias.** Gravações simultâneas no mesmo destino são interrompidas com `OUTPUT_BUSY`. O tempo decorrido por si só não destitui um processo ativo. Se houver reutilização de PID, a operação é interrompida por segurança. Metadados danificados, arquivos desconhecidos ou links externos exigem inspeção antes de qualquer exclusão.
> - **Arquivos do usuário e limites.** Arquivos comuns do usuário são copiados para o novo conjunto. Se uma edição for detectada durante o download, a publicação é cancelada e a edição é preservada. Prefira um destino dedicado. Cada conjunto aceita até 1 GiB e 10.000 entradas. Reserve espaço para os dois conjuntos e os dados temporários. Somente sistemas de arquivos locais são compatíveis. Caminhos com links simbólicos, links físicos ou montagens de outro sistema de arquivos são rejeitados. O bloqueio em compartilhamentos de rede e a atomicidade completa diante de queda de energia ficam fora das garantias. No Windows, se um arquivo aberto impedir a troca, o conjunto anterior é preservado.

## Limites de autenticação na web {#web認証の境界}

> [!DETAILS] Especificações e procedimentos
>
> Sessões no servidor protegem `/app/`, `/admin/` e suas APIs. Essas áreas ficam fora do índice de busca público. Usuários comuns usam `/app/` e somente administradores e proprietários podem acessar `/admin/`. A identidade é estabelecida por `issuer + subject` do provedor externo ou pelo `login name` da autenticação por senha. O e-mail e o nome de exibição não são chaves de autenticação. O envio de ZIPs, os trabalhos, os arquivos de saída e a compilação TeX passam pelo renderizador do servidor.
>
> > [!NOTE]
> > O navegador não armazena de forma persistente os tíquetes de curta duração. A sessão do servidor os reemite quando necessário. Mantenha privados os cookies de sessão, tokens CSRF e tíquetes.

## Registro e diagnóstico do Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Especificações e procedimentos
>
> - **Registro dinâmico de clientes (DCR).** Registros incompletos ou inativos normalmente são removidos após 30 dias. São protegidos aqueles referenciados por códigos de autorização válidos ou famílias de tokens. O limite global é de 10.000. Se aparecer `invalid_client` após a limpeza, registre o cliente novamente. São aceitas solicitações DCR padrão sem nome de cliente, mantendo a validação do nome e da URI de redirecionamento.
> - **Solicitações temporárias de autorização (esquema 20).** Se for preciso fazer login durante o fluxo, a solicitação é armazenada com um ID aleatório curto que permite retomá-la sem inserir o longo `state` do OAuth na URL de retorno. Vale por 10 minutos e pode ser usada somente uma vez, quando coincidem o navegador autenticado e o cookie dedicado. Abas simultâneas recebem IDs distintos. O limite global é de 1.000 solicitações e cada navegador aceita até 8 cookies de continuação. Ao atingir o limite, retorna-se `503` preservando as solicitações existentes. O banco armazena somente os hashes do ID e do cookie. Reiniciar ou restaurar backups não prolonga a validade.
> - **Limites por IP e cabeçalhos de origem.** O DCR permite 10 registros por IP de origem confiável a cada 15 minutos. Clientes do mesmo proxy de saída compartilham a cota. A partir da 11ª tentativa, são retornados HTTP `429`, `temporarily_unavailable` e `Retry-After`. Metadados inválidos não consomem cota. Se o IP estiver ausente ou inválido, retorna-se `503` para que o operador confira o proxy, sem agrupar os clientes não identificados. Mantenha o backend na interface de loopback e configure o proxy para substituir `X-Latex-Renderer-Client-IP` pelo endereço real. Valores arbitrários de `X-Forwarded-For` são ignorados. Nas rotas Cloudflare, `CF-Connecting-IP` também é tratado dentro do limite de confiança.
> - **Verificação administrativa de conectividade.** O comando abaixo verifica a descoberta pública e o desafio Bearer `401` sem enviar credenciais, alterar configurações, seguir redirecionamentos nem exibir corpos de resposta, cookies ou segredos.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Isolar a falha por etapa.** Um `200` de descoberta e um desafio `401` bem-sucedidos verificam apenas essas etapas. Compare a etapa, o horário e o `X-Request-ID` com os registros `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` e `remote_mcp.rpc_result`. Mantenha códigos OAuth, tokens, cookies, verificadores PKCE, fontes e IDs de usuários fora de registros e issues.
> - **A autenticação funciona, mas a descoberta de ações falha.** Verifique separadamente `initialize`, a notificação de inicialização e `tools/list` após emitir o token. Um HTTP `200` também pode vir acompanhado de `error` do JSON-RPC. `remote_mcp.rpc_result` registra o estado HTTP, a classificação do resultado, a versão do protocolo, a quantidade de ferramentas, os bytes de resposta e a estrutura básica da lista. O buffer de inspeção é limitado a 256 KiB. Acima desse tamanho, registra-se apenas `inspection_limited` e a resposta é preservada intacta. Uma resposta SSE ou uma solicitação `GET` que retorna `405` não bastam para diagnosticar falha. Confira `Accept`, `Content-Type`, a negociação do protocolo e a chegada de solicitações pelo proxy. Teste separadamente em produção o OIDC externo, as políticas Cloudflare e uma conta real do ChatGPT.

## Resultados e recursos MCP {#mcpの結果とresource}

> [!DETAILS] Especificações e procedimentos
>
> As respostas do Remote MCP têm três camadas.
> 1. **`content` padrão.** Inclui IDs de entrada e trabalho, estado, deslocamento, cursor, disponibilidade e diagnósticos limitados para decidir a próxima ação e chamar outra ferramenta. Mesmo sem `structuredContent` nem recursos personalizados, os clientes podem criar, corrigir e renderizar novamente.
> 2. **`structuredContent`.** Contém o objeto validado completo para processamento automático.
> 3. **Recursos MCP (`latex-renderer://jobs/...`).** Contêm dados volumosos, como o PDF, `compile.log` completo, JSON bruto, `svg/manifest.json` e `svg/objects/*.svg`. Somente o mesmo proprietário OAuth pode lê-los. Aplicam-se os mesmos limites de tamanho e retenção dos arquivos comuns. Todas as camadas omitem chaves de API, tokens OAuth, tíquetes, texto-fonte e base64 bruto.

## Espera e novas tentativas na CLI {#cliの待機と再試行}

> [!DETAILS] Especificações e procedimentos
>
> Se uma consulta de estado receber um HTTP transitório `502`, `503`, `504` ou JSON inválido, a CLI repete somente a consulta do mesmo trabalho **até 5 vezes**, com esperas de 1, 2, 4, 8 e 8 segundos, sem prolongar o tempo total. Criação de trabalhos, envios, renovação de tokens e verificação de arquivos não se repetem automaticamente. Erros de autenticação e permissão são retornados de imediato. Se a CLI parar de aguardar, o trabalho pode continuar no servidor.

## Formato JSON da CLI {#cliのjson形式}

> [!DETAILS] Especificações e procedimentos
>
> Com `--json`, a saída padrão usa os seguintes formatos e omite a chave de API, `uploadTicket` e `jobTicket`.
>
> - **Sucesso (código de saída `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Erro da CLI ou API (código de saída `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Trabalho concluído com erro, por exemplo uma falha do LaTeX (código de saída `2`).** `result` contém os dados do trabalho e os caminhos salvos. A resposta inclui `success: false`.

## Migração e recuperação de versões anteriores {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrar um atualizador antigo e resolver erros de extração
>
> ### Migrar do atualizador root v1.2.x para o atualizador com separação de privilégios {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Até a v1.2.x, o Update Manager era executado como daemon root. Desde a v1.3.0, o controlador permanente é executado como `latex-renderer-update` e um auxiliar root de curta duração aceita operações fixas. Uma atualização web a partir do atualizador antigo pode parar com `Application Update Manager must use a separate non-root build tree`. Não repita a mesma operação pela web.
>
> Para essa migração única, use a [distribuição de servidor v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Como usuário comum, siga [Baixar e verificar a distribuição](/pt/docs/self-hosting/#v1-6-9をダウンロードして検証) trocando a primeira linha `version=` por `version=1.3.6`. Mantenha o mesmo terminal para conservar o `bundle_root` obtido durante a verificação e extração.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> O script baixa novamente como root a mesma versão imutável e verifica o digest, a tag/commit, o pacote Sigstore, os limites do arquivo e os metadados. Aceita `gh` somente em `/usr/local/bin/gh` ou `/usr/bin/gh`, pertencente ao root e sem permissão de gravação para grupo ou outros usuários. Separa as árvores `verified` do root, `bootstrap-build` sem root (pnpm fixado por um intermediário Corepack dedicado) e `assembly` do root. Só para o gerenciador antigo depois de obter o bloqueio compartilhado de alterações e o reinicia em caso de falha. Ao concluir, verifique `User=latex-renderer-update` e o estado `active` de cada serviço com os comandos a seguir. Depois, use os mecanismos normais de atualização pela web ou pela Admin CLI.
> A web e a API não recebem privilégios sudo nem tokens do GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar interrompe a extração com Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> No Ubuntu, se o GNU `tar` usar `openat2`, a restrição `RestrictSUIDSGID=true` do atualizador pode interromper a extração de arquivos com subdiretórios com `ENOSYS` (Function not implemented). O atualizador corrigido mantém a inspeção pelo GNU `tar` e a verificação de assinaturas. Somente a extração passa a usar `/usr/bin/bsdtar`, em um diretório temporário privado vazio, sem importar proprietários, ACLs ou atributos estendidos. Mantém-se `RestrictSUIDSGID` e preserva-se o `tar` do sistema.
>
> O atualizador antigo também pode falhar ao extrair a própria correção. Confira se não há operações ativas, se a aplicação e o banco estão íntegros e se um backup criptografado foi verificado. Use o `bootstrap-v1` instalado para **atualizar primeiro apenas o atualizador independente** para uma versão publicada que inclua a correção.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Confira a nova versão do atualizador e os valores `ready` e `pending=false`. Depois, aplique a mesma versão à aplicação pela web ou pelo comando normal `update apply` da Admin CLI.
>
> O atualizador `v1.4.0-rc.3` tem um problema conhecido. A cópia do pacote feita por root preserva o proprietário sem privilégios e falha com `Release extraction requires a private regular bundle`. Mantenha as verificações, atualize primeiro o atualizador para uma versão publicada com a correção de propriedade e depois aplique a aplicação. É possível testar a extração sob root e systemd separadamente com `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Investigar bloqueios de atualizações ou alterações do TeX
>
> ### O bloqueio de alterações está em uso {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` impede a sobreposição de uma atualização da aplicação com uma alteração do TeX. Aguarde a operação ativa terminar. **Nunca remova o arquivo `/run/latex-renderer/mutation.lock`.** Isso pode criar dois bloqueios independentes. Se o problema ocorrer durante a restauração interna de um ambiente TeX em uma atualização, pode haver disputa com a própria operação. Confira os registros e os serviços interrompidos antes de repetir.
>
> Somente se não houver operações em andamento e os registros confirmarem o término da operação anterior, pare ambos os gerenciadores e inspecione o processo que mantém o bloqueio.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Encerre esse processo e reinicie os gerenciadores somente após confirmar que ele é um auxiliar de bloqueio órfão de uma operação já concluída.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Identidade do renderizador em versões candidatas anteriores {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Versões candidatas da v1.3.4
>
> A atualização de `v1.3.4-rc.3` para `v1.3.4-rc.4` falhou antes da troca dos serviços quando o número de arquivos no hash de identidade do renderizador aumentou de 5 para 6. Nessa migração, use `v1.3.4-rc.5`, que também inclui os dados de compatibilidade anteriores. A soma de verificação do pacote completo e a assinatura de proveniência também verificam o arquivo adicionado.

## Ambientes de execução do atualizador {#updaterの実行領域}

> [!DETAILS] Especificações e procedimentos
>
> O Update Manager separa estritamente a árvore `verified` do root com a distribuição verificada, `build` sem root para instalar dependências e compilar e `assembly` do root com os resultados permitidos. Os scripts de implantação executados como root sempre usam a cópia verificada de `assembly`. Etapas executadas com o usuário de implantação, como publicar no Cloudflare, usam uma cópia temporária `deployment-build` depois das verificações do root. O mesmo se aplica à reversão.

## Caminhos de instalação e proteção no Windows {#windowsの配置と保護}

> [!DETAILS] Especificações e procedimentos
>
> Ao alterar o local de instalação no Windows, o diretório padrão dos comandos passa a ser seu subdiretório `bin`. Se você definir `LATEX_RENDER_BIN_DIRECTORY`, os inicializadores gerenciados serão colocados nesse local e compartilharão o caminho entre o PATH do usuário e o Local MCP. Inicializadores alternativos são preservados. `setup repair` pode corrigir o caminho registrado anteriormente. A entrada antiga do PATH é mantida para outras aplicações. Use caminhos absolutos sem pontos e vírgulas, aspas ou caracteres de controle. Se `--open` ou a interface gráfica não conseguirem abrir o navegador ou visualizador, o PDF salvo é preservado.

## Compartilhamento e retenção de projetos {#保存プロジェクトの共有-保持}

> [!DETAILS] Regras de compartilhamento e retenção
>
> - A web (`/app/`), a CLI, a API pública, o Local MCP e o Remote MCP compartilham os projetos e o histórico de revisões imutáveis de cada usuário. Várias chaves de API ou contas de serviço do mesmo usuário podem visualizá-los e atualizá-los. Também é possível usar entradas e trabalhos temporários sem salvá-los em um projeto.
> - A combinação de entrada, documento principal, motor e formatos de saída identifica a revisão. Revisões com saídas diferentes podem compartilhar a entrada. Os formatos escolhidos em **Converter novamente** se aplicam apenas àquela execução. Selecione a configuração inicial para usar as saídas salvas na revisão.
> - Uma entrada referenciada por uma revisão ativa é mantida mesmo após o prazo para entradas órfãs e conta para a cota do usuário. Excluir um projeto oculta o registro. Quando o último projeto que referencia a entrada for excluído e os trabalhos associados desaparecerem, a entrada perderá a proteção e será removida na limpeza periódica após expirar. Para exclusão completa imediata, contate o administrador.

## Idioma da interface {#表示言語}

O editor salva **Idioma da interface** na conta. Se não estiver definido, percorre a lista de idiomas do navegador e usa inglês se nenhum for compatível. O motor e a codificação do documento são configurados separadamente.

| Área | Cobertura da tradução |
| --- | --- |
| Web e configuração | Ações, estado da operação, confirmações e diagnósticos. |
| CLI e MCP | A ajuda e as mensagens da CLI usam o idioma do terminal. As descrições do MCP remoto usam o idioma da conta. |
| Editor | Edição, busca e substituição, salvamento e conflitos, estados de compilação e controles de prévia estão disponíveis em 18 idiomas. |
| Guias públicos | Todos os guias estão disponíveis nos 18 idiomas listados abaixo. Use o menu de idioma no topo da página. |

O editor aceita inglês, japonês, chinês simplificado, coreano, espanhol, português, francês, alemão, italiano, russo, turco, polonês, tcheco, neerlandês, sueco, norueguês bokmål, dinamarquês e finlandês. Os registros do TeX e de pacotes externos preservam o texto original para facilitar o diagnóstico.

## Recuperar os registros de auditoria {#監査ログの復旧}

Após restaurar o banco de dados, a posição de exportação (`export_database_id`, sequência da linha `export_sequence` e `export_token`) pode deixar de corresponder ao estado do banco. Nesse caso, a exportação e a limpeza são interrompidas para proteger os dados.

1. Pare os serviços e temporizadores de exportação e limpeza durante a investigação e a recuperação.
2. Preserve separadamente o banco restaurado, as exportações criptografadas existentes e todos os arquivos de pontos de controle atuais e antigos. Verifique a integridade, as chaves estrangeiras e o estado de migração do banco restaurado.
3. Se não houver um ponto de controle compatível e você decidir reexportar os registros presentes, mova os arquivos de controle para fora dos caminhos ativos. Verifique também o caminho de `AUDIT_EXPORT_CHECKPOINT` se estiver definido. Preserve as linhas de auditoria, as sequências SQLite e `export.lock`.
4. Execute uma exportação manual com as credenciais do serviço de produção. Confira se é possível descriptografar a saída e se foi gerado um novo ponto de controle de formato 3 antes de reiniciar os temporizadores.

Somente as linhas presentes no banco restaurado serão reexportadas. Para comparar duplicatas, use em conjunto `export_database_id`, `export_sequence` e `export_token`. A data e a hora sozinhas não identificam uma linha.
