---
slug: lan-https
category: Hospedagem própria
title: Usar HTTPS na LAN com Akebi
description: Acesse o servidor com uma URL HTTPS derivada do endereço IP local.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Acessar pelo endereço IP da LAN {#lan-の-ip-アドレスからアクセスする}

O Akebi converte o IP privado do servidor em um nome de host acessível por HTTPS.

Configure o serviço compartilhado de certificados no assistente do LaTeX Renderer. Para oferecer seu próprio serviço, consulte [Administrar um serviço de certificados Akebi](/pt/docs/lan-https-authority/).

- **Exemplo IPv4.** Para o IP `192.168.1.50` e o domínio da LAN `lan.example.org`, a URL é `https://192-168-1-50.lan.example.org`.
- **IPv6.** O nome contém os oito grupos expandidos do endereço privado compatível. Use a URL exata exibida na configuração.

**Requisitos de rede e DNS**
O cliente precisa ter acesso à LAN do servidor. Se o nome não for resolvido, confira se o roteador ou o resolvedor DNS bloqueia respostas com IPs privados como **proteção contra DNS rebinding**. Se necessário, adicione uma exceção apenas para o domínio da LAN usado.

## Escolher o tipo de certificado {#証明書の方式を選ぶ}

| Método | Requisitos e características |
| --- | --- |
| **Serviço compartilhado, AC pública** | Configure o serviço compartilhado e aceite os termos da AC. A chave privada do certificado permanece no servidor. |
| **Serviço próprio, AC pública** | URL e domínio da LAN do [seu serviço Akebi](/pt/docs/lan-https-authority/) e código de convite, quando aplicável. |
| **Keyless** | Exige um serviço compatível ao qual se delega a assinatura durante a negociação TLS. |
| **Certificado existente ou AC privada** | Certificado correspondente ao nome do servidor e sua chave privada. Para uma AC privada, configure a confiança na raiz no servidor e em todos os clientes. |

> [!NOTE]
> - Com uma AC pública, os nomes de host dos certificados emitidos aparecem nos **registros públicos de transparência de certificados (CT)**.
> - Duas LANs em locais diferentes que usam o mesmo IP privado e o mesmo domínio de LAN são tratadas como **a mesma origem** pelo navegador e compartilham cookies e outros dados armazenados.

## Configurar o acesso pela LAN {#lan-向けに設定する}

1. Para uma nova instalação, [prepare o servidor](/pt/docs/self-hosting/#準備するもの) e use `sudo n624-latex server setup --web` para abrir o [assistente](/pt/docs/server-setup/#ブラウザで開く). Para alterar um servidor com HTTPS dedicado gerenciado, use `sudo n624-latex server setup --ingress --web`.
2. Selecione **LAN** como forma de acesso e informe a interface de rede, o IP privado, as sub-redes de clientes permitidas e a porta HTTPS.
3. Escolha o serviço e o método de certificado. No serviço compartilhado, a URL `https://akebi.n624.net` e o domínio da LAN `lan.n624.net` são configurados e o servidor é cadastrado quando você aplica as mudanças. O cadastro dispensa convite. Para uma AC pública, confira e aceite os termos dela. Para um serviço próprio com convites, digite o código fornecido pelo administrador.
4. Confira a URL HTTPS gerada e as sub-redes permitidas antes de aplicar. A autenticação da aplicação por senha ou OIDC continua em vigor.
5. De outro equipamento em uma sub-rede permitida, abra a URL, confira se não há avisos de certificado, entre e converta um documento de teste.

Para hospedar seu próprio serviço, consulte [Administrar um serviço de certificados Akebi](/pt/docs/lan-https-authority/).

## Verificar o estado do certificado {#証明書の状態を確認する}

Use os comandos a seguir para visualizar o serviço, o temporizador de renovação e os registros do namespace correspondente.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Se a emissão ou renovação falhar, confira o relógio do servidor, a conexão HTTPS com o serviço, o domínio, o IP e o horário de nova tentativa indicado pela AC. Uma falha temporária preserva o certificado válido. O temporizador retomará a emissão a partir do estado registrado. Se a chave e o estado divergirem, confira os arquivos de estado preservados da mesma geração.

Consulte o [projeto do Akebi e a solução de problemas](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
