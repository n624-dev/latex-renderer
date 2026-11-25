---
slug: lan-https-authority
category: Hospedagem própria
title: Administrar um serviço de certificados Akebi
description: Configure a delegação DNS do domínio da LAN, a emissão de certificados e o cadastro aberto ou por convite.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Este guia se destina a quem administra seu próprio serviço de certificados. Para usar o serviço compartilhado com o LaTeX Renderer, consulte [Usar HTTPS na LAN com Akebi](/pt/docs/lan-https/).

Prepare uma zona DNS que possa delegar, um host Linux (amd64 ou arm64) capaz de servir DNS público e HTTPS, Node.js 24 ou 26 e uma conta na sua autoridade certificadora (AC). Use uma distribuição do servidor cuja assinatura tenha verificado pelo [procedimento de download manual](/pt/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegar o DNS {#dns-を委任する}

Configure os registros abaixo na zona do domínio pai. O DNS do Akebi deve estar acessível pela internet na **porta 53, tanto por UDP quanto por TCP**.

| Tipo | Nome | Valor |
| --- | --- | --- |
| `A` | `ns1.example.org` | IPv4 público do servidor DNS do Akebi |
| `A` | `akebi.example.org` | IPv4 público do proxy reverso HTTPS da API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reserve `ns1.example.org` para o DNS e mantenha o host da API (`akebi.example.org`) fora da zona de certificados da LAN (`lan.example.org`).
- Após a delegação, o Akebi responde dinamicamente com os registros `A` e `AAAA` derivados dos IPs da LAN e com os registros `TXT` para validação ACME. A zona pai dispensa registros individuais por IP.

## Implantar o serviço {#サービスを配置する}

1. **Crie o usuário e os diretórios de estado.** Isole as permissões da aplicação com usuário e grupo dedicados chamados `latex-renderer-lan-authority`. Crie `/var/lib/latex-renderer-lan-authority` e seu subdiretório `keyless` sob essa propriedade e com modo `0700` em ambos.
2. **Prepare o diretório de configuração.** Crie `/etc/latex-renderer-lan-authority` com proprietário e grupo `root:latex-renderer-lan-authority` e modo `0750`. Copie `deploy/lan-https/examples/authority.json` da distribuição verificada para esse diretório e atribua `root:latex-renderer-lan-authority` e modo `0640`.
3. **Edite `authority.json`.**
   - `policy.serverOrigin` define a URL HTTPS da API, por exemplo `https://akebi.example.org`.
   - `policy.lanDomain` define o domínio delegado da LAN, por exemplo `lan.example.org`.
   - `dns.nameserver` e `dns.listeners` definem o host de DNS público e os endereços em que ele escuta. Se outro DNS usar a porta 53, escolha um IP público sem conflito.
   - Vincule `http` à interface de loopback.
   - Configure a AC pública em `issuers`. Se ela exigir External Account Binding (EAB), use o `eabFile` especificado, pertencente ao usuário do serviço e com modo `0600`, para guardar `kid` e `hmacKey`. Se o domínio usar registros CAA, autorize a AC escolhida.
4. **Instale o código e a unidade do systemd.** O exemplo presume que os arquivos verificados pertencem ao root e estão em `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Inicialize o estado e inicie o serviço.** Execute `init` apenas na primeira vez.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Obter o certificado HTTPS {#https-証明書を用意する}

O exemplo do Nginx que publica a API está em `deploy/lan-https/examples/authority.nginx.conf` e encaminha as solicitações à API na interface local. Obtenha o certificado da API antes de ativar o TLS no Nginx.

Para renovar automaticamente com Certbot, informe a AC, o contato, a aceitação dos termos e os dados EAB necessários em `/etc/latex-renderer-lan-authority/certbot.ini`, acessível apenas pelo root. Use uma chave ECDSA P-256. Aguarde a propagação da delegação DNS e execute os comandos a seguir.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Após a emissão, ajuste o nome do servidor e os caminhos dos certificados no Nginx, verifique a sintaxe com `nginx -t`, aplique as mudanças e confira o temporizador de renovação do Certbot.

- **Para oferecer Keyless**, obtenha outro certificado curinga ECDSA P-256 contendo apenas `*.lan.example.org`. No comando acima, altere `--cert-name` para `akebi-keyless`, `-d` para `'*.lan.example.org'` e `--deploy-hook` para `"$hooks/operator-certificate-hook.sh"`. Se oferecer somente o modo de AC pública, esse certificado é dispensável.

## Configurar o cadastro {#登録方法を設定する}

Em `authority.json`, escolha o método de cadastro dos servidores clientes com `policy.registration`.

- `"open"` permite o cadastro automático.
- `"invite"` exige um código emitido pelo administrador.

Para cadastro por convite, emita um código com limites de uso e validade por meio do comando abaixo e entregue-o apenas ao destinatário por um canal seguro.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Ambos os modos aplicam limites de cadastros, frequência de emissão e itens armazenados, além das políticas de emissão da AC.

## Verificar de uma rede externa {#外部から確認する}

De um equipamento externo, confira a delegação DNS, as respostas SOA por UDP e TCP, a resolução de nomes derivados de IP e a resposta de descoberta por HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Após confirmar todas as respostas, conecte um servidor de teste do LaTeX Renderer seguindo [Configurar o acesso pela LAN](/pt/docs/lan-https/#lan-向けに設定する) e confira a emissão do certificado e o login. Se a AC indicar um horário para tentar novamente, aguarde até lá.

**Backups.** Inclua `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, as contas da AC e a configuração de renovação do Certbot nos backups criptografados. Use o recurso de backup online do SQLite se o banco estiver em uso.

Consulte os [exemplos de configuração e a especificação do Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
