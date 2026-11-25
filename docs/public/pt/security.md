---
slug: security
category: Solução de problemas e segurança
title: Segurança de contas e documentos
description: Proteja as credenciais e os arquivos enviados e conheça os limites de acesso do renderizador e da administração.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Se uma chave de API vazar, peça ao administrador que a revogue imediatamente e emita outra.
- Comunique vulnerabilidades pelo [formulário privado do GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Evite divulgar os detalhes em uma issue pública.

## Credenciais {#資格情報}

- Evite incluir chaves de API em argumentos de linha de comando (visíveis com `ps`, entre outros), URLs, repositórios Git, registros ou conversas com assistentes de IA.
- Para armazená-las localmente, use DPAPI no Windows ou um arquivo de modo `0600`, legível somente pelo proprietário, no Linux e no macOS.
- Use senhas de acesso pelo navegador, segredos OIDC e cookies de sessão apenas para as finalidades previstas. Mantenha separadas as chaves da CLI e da API (`lrk_` e `lra_`).

## Projetos {#プロジェクト}

O sistema trata todas as fontes LaTeX e anexos como entradas não confiáveis. Links simbólicos, acesso do TeX ao shell, execução de comandos externos e conexões de rede para fora do contêiner ficam desativados. Respeite o isolamento, os tempos limite e os limites de arquivos.

## Áreas públicas e administrativas {#公開領域と管理領域}

A documentação e os downloads públicos, as páginas autenticadas (`/app/` e `/admin/`) e a API de renderização têm rotas separadas sob uma única origem HTTPS canônica.

- **Limite de rede.** O único ponto de entrada do perfil Cloudflare é o Tunnel/Workers. No perfil standalone, é um proxy reverso TLS. Todos os serviços da aplicação escutam na interface de loopback. A API interna, o SQLite e os sockets administrativos permanecem privados. As áreas autenticadas ficam fora dos índices dos mecanismos de busca.
- **Autenticação e sessões do navegador.** A identificação por IdP externo exige correspondência exata de `provider + issuer + subject`. O e-mail e o nome de exibição não vinculam contas automaticamente. O servidor pode revogar uma sessão imediatamente. Solicitações que alteram o estado exigem correspondência exata de `Origin` e um token CSRF específico da sessão. As senhas são protegidas por `scrypt` e um segredo adicional (pepper) pertencente ao root. Em instalações públicas, aplique também limites de conexões e frequência no proxy e proteção contra DDoS do provedor.
- **Remote MCP.** `/mcp`, o endpoint de tokens OAuth e os metadados de descoberta são acessíveis publicamente. Para executar ferramentas, exige-se um token Bearer de curta duração, com público e escopo restritos. A autorização usa a sessão do navegador de `/app/` e vincula explicitamente o acesso a um usuário existente e ativo.
  - A resposta padrão (`content`) inclui apenas identificadores limitados ao proprietário, estados, cursores e diagnósticos limitados ao necessário para continuar. Caminhos e diagnósticos fornecidos pelo usuário são retornados como dados não confiáveis, sem caracteres de controle e com limites de comprimento e quantidade.
  - O conteúdo padrão `content` e os registros de diagnóstico excluem tokens OAuth, chaves de API, tíquetes, base64 bruto, fontes completas, registros integrais, rastreamentos de pilha, identidades subject do Access e caminhos internos do servidor. PDFs e registros completos só ficam disponíveis por leituras de recursos que verificam novamente a propriedade.

## Interface web de configuração local {#local-setup-web-ui}

`n624-latex setup --gui` (anteriormente `latex-render setup --gui`) escuta apenas em uma porta aleatória de `127.0.0.1` na máquina local.

- O fragmento (`#...`) da URL aberta pela CLI contém um token de inicialização de uso único. O navegador o remove imediatamente do histórico e o troca por uma sessão de curta duração.
- Todas as operações da API exigem correspondência exata de `Origin`, sessão Bearer e token CSRF separado. O CORS é desativado, o Host e o endereço de loopback do cliente são verificados e aplicam-se uma CSP estrita, `frame-ancestors 'none'` e `no-store`.
- A chave informada é passada somente à operação de salvamento e fica fora das respostas de estado, diagnóstico e conversão de teste. A interface se encerra após 30 minutos de inatividade ou 2 horas desde o início.
