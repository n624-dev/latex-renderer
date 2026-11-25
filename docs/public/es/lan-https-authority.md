---
slug: lan-https-authority
category: Alojamiento propio
title: Administrar un servicio de certificados Akebi
description: Configura la delegación DNS del dominio LAN, la emisión de certificados y el registro abierto o por invitación.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Esta guía se dirige a administradores que operan su propio servicio de certificados. Para usar el servicio compartido con LaTeX Renderer, consulta [Usar HTTPS en la LAN con Akebi](/es/docs/lan-https/).

Prepara una zona DNS que puedas delegar, un host Linux (amd64 o arm64) capaz de servir DNS público y HTTPS, Node.js 24 o 26 y una cuenta con tu CA. Usa una distribución de servidor cuya firma hayas verificado con el [procedimiento de descarga manual](/es/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegar el DNS {#dns-を委任する}

Configura estos registros en la zona del dominio superior. El DNS de Akebi debe ser accesible desde Internet en el **puerto 53 tanto por UDP como por TCP**.

| Tipo | Nombre | Valor |
| --- | --- | --- |
| `A` | `ns1.example.org` | IPv4 pública del servidor DNS de Akebi |
| `A` | `akebi.example.org` | IPv4 pública del proxy inverso HTTPS de la API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Dedica `ns1.example.org` a DNS y sitúa el host de la API (`akebi.example.org`) fuera de la zona de certificados LAN (`lan.example.org`).
- Tras delegar la zona, Akebi responde dinámicamente con los registros `A` y `AAAA` derivados de las IP de la LAN y los `TXT` de validación ACME. La zona superior no necesita un registro por IP.

## Desplegar el servicio {#サービスを配置する}

1. **Crea el usuario y los directorios de estado.** Separa los permisos de la aplicación con un usuario y grupo dedicados llamados `latex-renderer-lan-authority`. Crea `/var/lib/latex-renderer-lan-authority` y su subdirectorio `keyless` bajo esa propiedad, ambos con modo `0700`.
2. **Prepara el directorio de configuración.** Crea `/etc/latex-renderer-lan-authority` con propietario y grupo `root:latex-renderer-lan-authority` y modo `0750`. Copia allí `deploy/lan-https/examples/authority.json` desde la distribución verificada y asígnale `root:latex-renderer-lan-authority` y modo `0640`.
3. **Edita `authority.json`.**
   - `policy.serverOrigin` indica la URL HTTPS de la API, por ejemplo `https://akebi.example.org`.
   - `policy.lanDomain` indica el dominio LAN delegado, por ejemplo `lan.example.org`.
   - `dns.nameserver` y `dns.listeners` indican el host DNS público y sus direcciones de escucha. Si otro DNS usa el puerto 53, elige una IP pública que no entre en conflicto.
   - Vincula `http` a la interfaz de bucle local.
   - Configura la CA pública en `issuers`. Si exige External Account Binding (EAB), usa el `eabFile` especificado, propiedad del usuario del servicio y con modo `0600`, para guardar `kid` y `hmacKey`. Si el dominio usa registros CAA, autoriza a la CA elegida.
4. **Instala el código y la unidad de systemd.** El ejemplo supone que las fuentes verificadas, propiedad de root, están en `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Inicializa el estado e inicia el servicio.** Ejecuta `init` solo la primera vez.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Obtener el certificado HTTPS {#https-証明書を用意する}

El ejemplo de Nginx para publicar la API está en `deploy/lan-https/examples/authority.nginx.conf` y reenvía a la API en la interfaz local. Obtén el certificado de la API antes de activar TLS en Nginx.

Si usas renovación automática con Certbot, indica la CA, el contacto, la aceptación de las condiciones y los datos EAB necesarios en `/etc/latex-renderer-lan-authority/certbot.ini`, accesible solo para root. Usa una clave ECDSA P-256. Espera a que se propague la delegación DNS y ejecuta lo siguiente.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Tras la emisión, ajusta el nombre del servidor y las rutas de certificados en Nginx, verifica la sintaxis con `nginx -t`, aplica los cambios y comprueba el temporizador de renovación de Certbot.

- **Para ofrecer Keyless**, obtén otro certificado comodín ECDSA P-256 que contenga únicamente `*.lan.example.org`. En el comando anterior cambia `--cert-name` a `akebi-keyless`, `-d` a `'*.lan.example.org'` y `--deploy-hook` a `"$hooks/operator-certificate-hook.sh"`. No hace falta si solo ofreces el modo de CA pública.

## Configurar el registro {#登録方法を設定する}

En `authority.json`, selecciona el método de registro de los servidores cliente mediante `policy.registration`.

- `"open"` permite el registro automático.
- `"invite"` exige un código emitido por el administrador.

Para el registro por invitación, emite un código limitado en usos y tiempo con el siguiente comando y entrégalo solo a su destinatario por un canal seguro.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

En ambos modos se aplican límites de registros, frecuencia de emisión y elementos almacenados, además de las políticas de emisión de la CA.

## Verificar desde el exterior {#外部から確認する}

Desde un equipo externo, comprueba la delegación DNS, las respuestas SOA por UDP y TCP, la resolución de nombres derivados de IP y la respuesta de descubrimiento por HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Una vez que respondan todos, conecta un servidor de prueba de LaTeX Renderer mediante [Configurar el acceso desde la LAN](/es/docs/lan-https/#lan-向けに設定する) y comprueba la emisión del certificado y el inicio de sesión. Si la CA indica una hora de reintento, espera hasta entonces.

**Copias de seguridad.** Incluye `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, las cuentas de CA y la configuración de renovación de Certbot en las copias cifradas. Usa la función de copia en línea de SQLite para una base de datos activa.

Consulta los [ejemplos de configuración y la especificación de Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
