---
slug: self-hosting
category: Hospedagem própria
title: Administrar o LaTeX Renderer no seu servidor
description: Escolha uma configuração compatível, prepare o host e instale o serviço com atualizações e backups.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Opções de instalação {#現在の提供状況}

Você pode montar um servidor instalando o [pacote APT](/pt/docs/client/#debian-ubuntu-の-apt-パッケージ) e executando o assistente. Ele configura o HTTPS, o método de login e o primeiro proprietário.

### Passos da instalação inicial {#初回導入の順序}

1. **Prepare o servidor.** Confira os [sistemas e formas de acesso compatíveis](#対応する構成) e [instale o Docker Engine e o Nginx](#準備するもの).
2. **Instale o pacote APT.** Siga as [instruções para Debian e Ubuntu](/pt/docs/client/#debian-ubuntu-の-apt-パッケージ) para instalar `n624-latex`.
3. **Configure o servidor.** Usando uma conta de implantação sem privilégios de root, execute `sudo n624-latex server setup --plan`. Resolva os requisitos pendentes e continue com a [configuração no navegador](/pt/docs/server-setup/#ブラウザで開く).
4. **Crie seu primeiro PDF.** Abra a URL HTTPS configurada, [entre e converta um documento de teste](#導入完了の確認). O assistente prepara o primeiro ambiente TeX.

Para um servidor existente, consulte [Atualizar pela administração](/pt/docs/updates/). Para instalar a partir de um tarball, consulte as [instruções manuais](#v1-6-9をダウンロードして検証).

## HTTPS automático na LAN {#lan-内の自動-https}

O **Akebi** permite configurar uma URL HTTPS derivada do IP privado do servidor. Você pode começar com o serviço compartilhado de certificados. Consulte [Usar HTTPS na LAN com Akebi](/pt/docs/lan-https/).

## Configurações compatíveis {#対応する構成}

O APT permite novas instalações em um único host com `systemd` que execute Debian 12 ou 13 ou Ubuntu 24.04 ou 26.04, em amd64 ou arm64. A compilação LaTeX usa Docker sem root com usuário dedicado.

| Modo de implantação (`DEPLOYMENT_MODE`) | Entrada | Métodos de login |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache ou HTTPS na LAN (Akebi) | Senhas locais, OIDC ou ambos |
| `cloudflare` | Cloudflare Tunnel e um Worker | Cloudflare Access ou autenticação nativa (senhas, OIDC ou ambos) |

- **OIDC.** Permite usar o provedor de identidade (IdP) da sua organização.
- **Cloudflare Access.** Prepare uma aplicação Access para os usuários no Cloudflare.
- **Senhas locais.** Cadastre os usuários pela administração do servidor, sem um IdP externo.
- **Senhas e OIDC.** Habilite ambos na autenticação nativa com `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` e `AUTH_OIDC_ENABLED=true`. Nas configurações anteriores com método único, use `AUTH_MODE`.

## Preparar o servidor {#準備するもの}

- **Conta de trabalho.** Conecte-se com uma conta sem privilégios de root e execute os comandos de configuração com `sudo`.
- **Disco.** A verificação inicial exige **pelo menos 5 GiB livres** em cada sistema de arquivos que contenha `/opt` ou `/var/lib`. Reserve espaço adicional para imagens TeX, versões, resultados e backups criptografados.
- **Docker Engine.** Instale o Docker Engine e `docker-ce-rootless-extras` pelo repositório oficial. O assistente configura o Docker sem root para a compilação. Consulte as instruções oficiais para [Debian](https://docs.docker.com/engine/install/debian/) ou [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Instale-o com `sudo apt install nginx`. Novas instalações APT verificam a presença do Nginx mesmo se o acesso externo passar por Caddy, Apache ou Cloudflare.
- **Acesso e TLS.** Para HTTPS próprio, prepare o nome do host, o certificado e a chave privada e deixe livres o endereço e a porta do HTTPS integrado. Para o Cloudflare, prepare o Tunnel, o DNS e o Worker. Consulte os [requisitos de HTTPS na LAN](#lan-内の自動-https).
- **Credenciais**
  - O OIDC exige a URL do emissor, o ID e o segredo de cliente e o `subject` estável do primeiro proprietário.
  - O Cloudflare Access exige os dados da aplicação Access e o `subject` do proprietário.
  - Para senhas, prepare o nome de login e a senha inicial do proprietário.
- **Conectividade de saída.** O servidor precisa acessar por HTTPS o GitHub Releases e Attestations, o GHCR (`ghcr.io`), os arquivos do TeX Live e os repositórios de pacotes do Debian ou Ubuntu.
- **Pacote APT.** Inclui o Node.js. Consulte as [instruções de APT](/pt/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Verificar a instalação {#導入完了の確認}

1. Abra `/admin/` na URL HTTPS configurada e entre como o proprietário registrado durante a instalação.
2. Abra `/app/` na mesma URL, selecione o [`main.tex` de exemplo](/pt/docs/#最短でpdfを作る) e clique em **Converter para PDF**.
3. Abra o PDF na página de resultados e confira se ele exibe o texto do exemplo.

> [!DETAILS] Verificações adicionais de serviços e saídas
>
> Administradores podem testar a conversão pela URL pública. A chave de API emitida pelo teste é revogada imediatamente depois.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Você também pode verificar o acesso de um usuário comum, os guias públicos, os idiomas e a imagem indicados no ambiente TeX e saídas de uso frequente, como documentos em japonês ou SVGs.

### Cadastrar usuários e emitir chaves {#利用者と-api-キーの発行}

Assim que conseguir entrar como proprietário em `/admin/`, cadastre os usuários.

- **Web e Remote MCP.** Crie o usuário em **Usuários**, registre a identidade para o método de login escolhido e forneça a URL da aplicação web.
- **CLI, Local MCP e API HTTP.** Crie uma conta de serviço vinculada ao usuário. Em **Chaves de API → Emitir chave de API**, emita uma chave de renderização com `render:create` e `render:read:own` (prefixo `lrk_...`) e entregue-a por um canal seguro.

## Atualizações e reversão {#更新とロールバック}

### Atualizar a aplicação {#アプリケーションを更新する}

- Como proprietário, abra **Administração → Atualizações**. Consulte [Atualizar o servidor ou voltar à versão anterior](/pt/docs/updates/).
- Para mudar a versão ou os idiomas do TeX Live, abra **Administração → Ambiente TeX**. Consulte [Configurar o ambiente TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migração e recuperação especial
>
> ### Migrar o atualizador root v1.2.x para separação de privilégios {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Consulte as [instruções de migração do atualizador](/pt/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar interrompe a extração com Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Consulte o [procedimento para erros de extração](/pt/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### O bloqueio de alterações está em uso {#mutation-lockが使用中と表示される場合}
>
> Consulte como [identificar o processo que mantém o bloqueio](/pt/docs/reference/#mutation-lockが使用中と表示される場合).

## Backups {#バックアップ}

Para backups periódicos, pontos anteriores a uma atualização, testes de restauração e recuperação, consulte [Criar, verificar e restaurar backups](/pt/docs/backups/). Se a posição de exportação da auditoria divergir após a restauração, consulte [Recuperar registros de auditoria](/pt/docs/reference/#監査ログの復旧).

## Solução de problemas {#問題が起きた場合}

| Sintoma | O que verificar primeiro |
| --- | --- |
| Não consegue acessar `/app/` | DNS, certificado TLS, configuração do Tunnel ou proxy e ordem de inicialização dos serviços locais |
| Somente administradores não conseguem entrar | Identidade ou credencial explícita do proprietário, `AUTH_MODE`, emissor, público e funções |
| Não consegue obter a imagem TeX | Acesso HTTPS a `ghcr.io`, visibilidade do pacote e arquitetura da tag |
| Uma alteração de TeX demora muito | ID da operação e registros do Image Manager com dados sensíveis ocultos |
| Uma atualização é rejeitada | Imutabilidade da versão, digest do arquivo, caminho de atualização e espaço disponível |
| A preparação do host para devido a um caminho inseguro | Confira se `/var/lib/latex-renderer` pertence a `root:latex-renderer` e tem modo `2770` |
| Somente a tela de atualizações falha | Presença de `client-dist/manifest.json` na distribuição e estado do Admin Web |
| A conversão não começa | Estado da fila, pelo menos 5 GiB de espaço livre, serviço do trabalhador e socket do Docker sem root |
| Surgem problemas logo após uma atualização | Interrompa a admissão de novos trabalhos e confira as versões anterior e nova da aplicação e do ambiente antes de decidir se deve reverter |

Anote o ID da operação, a etapa da falha e um código de erro que possa compartilhar. Consulte [Solução de problemas](/pt/docs/troubleshooting/), [Segurança de contas e documentos](/pt/docs/security/) e [Configuração de implantação e arquivos de configuração (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Alterar o ambiente TeX {#tex環境の初期設定}

A configuração inicial prepara o ambiente de compilação. Para adicionar idiomas ou mudar a versão do TeX Live, abra **Administração → Ambiente TeX** (`/admin/tex-environment/`). O exemplo a seguir aceita inglês e japonês.

| Configuração | Valor recomendado |
| --- | --- |
| Image | `latest` (para tags com data fixa, escolha uma compatível com sua arquitetura) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (desativado por padrão) |

- Do pacote público no GHCR, baixa-se apenas a **imagem base** sem idiomas, fixada por digest. O servidor cria uma **imagem de execução** com os idiomas selecionados e o código atual do renderizador. Se existir uma imagem local com a mesma configuração, ela será reutilizada. As imagens de execução não são publicadas externamente.
- A criação da imagem continua mesmo se você fechar o navegador. Depois, confira o ambiente ativo e os idiomas na administração. Se o download falhar, verifique o acesso HTTPS a `ghcr.io` e a compatibilidade da arquitetura.

### Limpeza automática do disco {#自動容量整理}

> [!DETAILS] Limpeza de imagens não utilizadas e cache de compilação
>
> Por padrão, o Image Manager limpa as imagens gerenciadas sem uso a cada 24 horas. Protege a base e o ambiente atuais, suas versões anteriores para reversão e as imagens referenciadas na configuração. As demais podem ser removidas 24 horas após a criação. A limpeza usa 2 GiB como referência para o cache de compilação sem uso, sem impor um limite a todo o Docker.
>
> Ajuste os valores em `/etc/latex-renderer/renderer.env` e aplique-os com `sudo systemctl restart latex-renderer-image-manager.service` enquanto não houver atualização do TeX em andamento.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` aceita `0` para desativar a limpeza ou um intervalo de `1` a `720` horas. A partir de 5 minutos após a inicialização, verifica-se a cada 5 minutos se uma limpeza deve ocorrer. Um bloqueio comum adia a limpeza durante atualizações e implantações. A limpeza manual pela web ou CLI remove itens desprotegidos sem aguardar o prazo de retenção.
> - `RETENTION_HOURS` aceita de `0` a `8760` horas e `BUILD_CACHE_MAX_GIB`, de `0` a `1024` GiB.
> - Desde `1.3.4-rc.2`, os metadados do Buildx do Docker sem root ficam isolados em `.docker/buildx-worker` no diretório pessoal do trabalhador para evitar conflitos de permissões com compilações feitas por root. A limpeza automática ignora imagens de configurações antigas e diretórios de recuperação manual. Exclua itens individuais somente após confirmar que são dispensáveis. Nunca remova diretamente o diretório de dados do Docker.

## Privilégios de instalação e operação {#sudoと通常運用の境界}

A instalação inicial prepara usuários de sistema, diretórios, unidades `systemd`, Docker sem root e arquivos de chaves com `sudo`. **Durante a operação normal, a web e a API de administração não recebem privilégios de `sudo`.**

- **Alterações no TeX.** São solicitadas ao Image Manager pertencente ao root por um socket Unix de permissões restritas.
- **Atualizações.** Um socket Unix se comunica com o controlador do Update Manager sem root, que delega operações fixas a um auxiliar root de curta duração.
- **Exclusão mútua.** Um bloqueio compartilhado serializa as alterações no TeX e as atualizações. A web e a API não permitem passar comandos, caminhos ou URLs arbitrários ao root.

## Configuração e segredos {#設定と秘密情報}

As configurações e segredos do host são armazenados fora da aplicação e da árvore de trabalho do Git, por exemplo em `/etc/latex-renderer/`.

| Caminho | Conteúdo | Modo recomendado |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Perfil de acesso, URL, limites e configuração não secreta do IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Identificadores e tokens exclusivos do perfil Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Conta de implantação sem root | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Vinculações e rotas do Worker de produção | `0600` |
| `/etc/cloudflared/config.yml` | Ingresso do Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, chave de tíquetes e credenciais dos gerenciadores | Conforme o arquivo |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Segredo do cliente do perfil OIDC | `0440` |

> [!WARNING]
> Nunca envie ao Git nem cole em issues ou pedidos de ajuda arquivos `.env`, tokens Cloudflare, credenciais do Tunnel, chaves de API, bancos SQLite, documentos, PDFs ou registros reais sem edição. Os `*.example` do repositório são modelos para consultar os campos.

## Instalação manual a partir de tarball e versões anteriores {#手動配置-旧版向けの構築手順-tarball-導入}

Com APT e `sudo n624-latex server setup`, o assistente executa ou orienta a extração, a preparação do host e o registro do proprietário. Expanda a seção a seguir se implantar `v1.7.1` manualmente ou precisar conferir os limites de acesso ou a mudança de autenticação.

> [!DETAILS] Baixar, verificar, implantar e registrar o proprietário com a v1.7.1
>
> Para uma nova instalação manual, use a versão estável [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), arquivo `latex-renderer-server-1.7.1.tar.gz`. A tag e os arquivos são imutáveis após a publicação. A implantação direta a partir da ramificação de desenvolvimento `main` e o `docker build` local do TeX ficam fora da operação compatível.
>
> ### Baixar e verificar a v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Prepare `curl`, `jq`, `tar`, `sha256sum` e uma CLI do GitHub compatível com `gh attestation verify`. O Node.js e o Corepack são instalados ao preparar o host mais adiante.
>
> Como usuário comum, execute o procedimento a seguir na mesma sessão Bash. São verificados o SHA-256 do GitHub Releases e a assinatura de proveniência do GitHub Actions. Os dados de proveniência são passados pela API pública a `gh`, sem conta nem token do GitHub. Se uma etapa falhar, `bundle_root` ficará indefinido. Corrija a causa e tente novamente.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### Preparar o host {#ホストを準備}
>
> Instale `setfacl` para permissões de armazenamento, `bsdtar` para extração no atualizador restrito e `unzip` para verificar ZIPs. Siga as instruções oficiais para instalar o Node.js 26 ou 24 (`/usr/local/bin/node` e `/usr/local/bin/corepack`) e as ferramentas do Docker sem root. Para `cloudflare`, instale também `cloudflared`. O Update Manager instala e verifica com Corepack o pnpm especificado para o usuário de implantação.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> Na conta habitual de implantação, inicialize o host e configure o Docker sem root para `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Criar a configuração específica do host {#ホスト固有設定を作成}
>
> Crie `renderer.env` em todos os perfis e configure `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` e `AUTH_MODE`. Não existe um alias como `ADMIN_ALLOWED_ORIGINS`. A origem permitida para as operações do navegador deve coincidir exatamente com `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Perfil `cloudflare`.** Substitua `example.com`, `REPLACE_*`, todos os UUIDs e o público do Access pelos valores da instalação. Para um Tunnel gerenciado remotamente, omita o `config.yml` local e confirme antes se o conector está ativo.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **Perfil `standalone`.** Instale Nginx, Caddy ou Apache, copie um exemplo de `deploy/reverse-proxy/` e informe o FQDN e os caminhos dos certificados. O proxy remove os cabeçalhos `CF-Access-*` de entrada e substitui o IP do cliente. Não exponha diretamente os serviços locais nas portas 3100 a 3105.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **Com `AUTH_MODE=oidc`.** Registre `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` no IdP. Em `renderer.env`, configure `OIDC_ISSUER` e `OIDC_CLIENT_ID` e guarde o segredo em arquivo separado, sem quebra de linha no final.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Implantar os serviços {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - A inicialização baixa e verifica novamente o arquivo imutável publicado, separa a árvore de controle do root da árvore de compilação sem privilégios, compila `client-dist` e o implanta em `/opt/latex-renderer/releases/$release_id`. Rejeita máquinas com banco de dados ou `current` existente. Após a instalação, use a atualização normal.
> - Antes da implantação, confira `renderer.env` (propriedade do root, modo `0640`, sem chaves duplicadas), `PUBLIC_ORIGIN`, as configurações de autenticação e a propriedade, as permissões e o comprimento do pepper e dos segredos, sem mostrar os valores.
> - O atualizador é mantido separadamente em `/opt/latex-renderer/updater`, conforme descrito em `docs/independent-updater.md` no repositório. Somente o grupo principal do usuário de implantação pode atravessar `/opt/latex-renderer/update-staging`. Cada etapa é isolada com `0700` e limpa após a conclusão ou, em caso de interrupção, em uma inicialização posterior após 24 horas.
>
> ### Limites do acesso público {#公開境界}
>
> - **`cloudflare-access`.** Proteja `/auth/*`, `/app/`, `/admin/` e `/oauth/authorize` com a mesma aplicação Access para usuários humanos e verifique o público também na origem. Com Cloudflare e OIDC ou senha, evite que o Access bloqueie `/auth/*`. A documentação e os downloads são públicos. As Worker Routes atendem somente à parte pública da API de renderização. Ordene o ingresso do Tunnel colocando primeiro as rotas específicas de API e administração, depois a web por padrão e, por último, `http_status:404`.
> - **`standalone`.** Um proxy reverso TLS distribui as solicitações aos serviços locais por caminho. Somente pequenas operações de tíquetes JSON passam ao Standalone Gateway na porta 3105. O exemplo Nginx limita as conexões e a frequência de login por senha e da API de tíquetes. O Caddy e o Apache sem extensões não oferecem limite equivalente por cliente, portanto é obrigatório aplicá-lo no balanceador ou no provedor. Mantenha privados `/internal/*`, o banco e os sockets de gerenciamento.
>
> ### Primeiro proprietário {#最初のowner}
>
> A identidade externa é determinada por `provider + issuer + subject` e a identidade de senha por `login name`. O e-mail é apenas exibido. Contas não são vinculadas por coincidência de e-mail nem criadas automaticamente no login. Execute uma única vez o procedimento do método escolhido.
>
> **Cloudflare Access ou OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **Senha local (exemplo com o nome `owner`)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### Alterar AUTH_MODE posteriormente {#後からauth-modeを変更する場合}
>
> Use este procedimento quando o [assistente do servidor](/pt/docs/server-setup/) estiver indisponível.
> Crie um backup criptografado e pare a API de administração. Com o ID imutável obtido na administração ou com `users list` (formato `user_...`), adicione o novo método de autenticação. Uma credencial existente não pode ser sobrescrita e as sessões atuais são revogadas. Depois, altere `renderer.env` e reinicie a API e a web. Preserve as credenciais antigas até verificar o novo login em uma janela privada.
>
> Execute primeiro a preparação abaixo e depois apenas os comandos do método de destino.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **Para mudar para OIDC ou Cloudflare Access**, informe `oidc` ou `cloudflare-access`.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **Para mudar para senha**, digite-a no campo oculto.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
