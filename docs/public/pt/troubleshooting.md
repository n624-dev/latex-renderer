---
slug: troubleshooting
category: Solução de problemas e segurança
title: Solução de problemas
description: Diagnostique falhas de login, instalação, conversão e download.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Por onde começar {#確認する順序}

1. **Consulte o [estado do serviço](/status/)** para verificar se há incidente geral ou manutenção.
2. **Confira o trabalho existente.** Se já iniciou uma conversão, abra o mesmo trabalho no **Histórico** ou execute `n624-latex jobs get <jobId>` na CLI.
3. **Consulte os diagnósticos e o registro.** Na web, abra os diagnósticos na página de resultados. Na CLI, consulte `.render/errors.json` e o registro detalhado `.render/compile.log`.

## Problemas frequentes {#代表的な問題}

### Instalação e login {#インストール-ログイン}

- **Não foi possível encontrar `n624-latex` ou `latex-render`.**
  Abra um novo terminal ou janela do PowerShell. Se o problema persistir, confira o [PATH no Linux ou no macOS](/pt/docs/client/#linux-macos) ou as [instruções de instalação no Windows](/pt/docs/windows/#インストール).
- **Não consegue entrar na aplicação web.**
  Use a conta registrada e o método indicado pelo administrador (senha, OIDC ou Cloudflare Access). Se uma conexão do ChatGPT ou Claude ficar travada, consulte [Verificar a conexão do Remote MCP](/pt/docs/mcp/#chatgptなどの接続を確認する).
- **A CLI retorna `401` ou `403`.**
  Execute `n624-latex auth status` para conferir a chave registrada. Peça ao administrador para confirmar se ela está ativa e tem as permissões `render:create` e `render:read:own`. Se necessário, [registre a chave novamente](/pt/docs/cli/#認証). Para um servidor próprio, confira também a [URL do servidor (`LATEX_RENDER_BASE_URL`)](/pt/docs/cli/#接続先サーバー).

### Envio e conversão {#アップロード-変換}

- **O documento principal não foi encontrado no ZIP.**
  A entrada padrão é `main.tex` na raiz. Verifique se você incluiu a pasta superior ou informe o caminho relativo do documento. Consulte [Preparar o ZIP](/pt/docs/projects/#構成).
- **O tamanho ou a extensão de um arquivo é rejeitado.**
  Remova os arquivos gerados desnecessários ou incompatíveis, ou configure `.latexrenderignore`. Confira os [arquivos aceitos e os limites](/pt/docs/projects/#制限).
- **A conversão continua na fila ou a conexão foi interrompida.**
  O servidor pode continuar processando. Reabra a mesma página de resultados ou consulte o mesmo ID de trabalho antes de criar outro.
- **Faltam pacotes ou fontes, ou o tempo se esgotou.**
  Pesquise os nomes disponíveis no [ambiente de renderização](/app/environment/). Se o tempo se esgotar, verifique as macros complexas, imagens grandes e diagramas TikZ próximos ao ponto em que o registro parou.

### Baixar arquivos {#成果物の取得}

- **Há um PDF, mas falta o SVG.**
  Se aparecer **Sucesso parcial**, salve primeiro o PDF e selecione **Tentar novamente apenas SVG**. Consulte [Repetir a extração de SVG](/pt/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **A prévia PNG continua em preparação.**
  Aguarde um pouco ou abra a mesma página novamente. O PDF final pode ser baixado sem aguardar a prévia.
- **O destino está em uso ou aparece `OUTPUT_BUSY`.**
  Feche o visualizador que está com o PDF de saída aberto ou aguarde a conclusão do processo que grava nesse diretório. Depois, tente baixar novamente.
- **Resultado expirado ou armazenamento insuficiente.**
  Para um resultado expirado, converta outra vez a revisão salva ou os arquivos locais. Se atingir sua cota, exclua trabalhos concluídos que já não sejam necessários. Se o disco do servidor estiver cheio, avise o administrador.

## Solicitar ajuda {#問い合わせ}

- **Administrador do servidor.** Informe o horário do problema, a operação interrompida, o código de erro e, se disponível, o ID do trabalho (`job_...`).
- **Relatório público no GitHub.** Forneça os passos mínimos para reproduzir o problema, sem segredos nem documentos pessoais. **Nunca publique chaves de API, cookies, o documento original, o PDF nem registros completos sem edição.**
