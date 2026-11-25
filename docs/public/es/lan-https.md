---
slug: lan-https
category: Alojamiento propio
title: Usar HTTPS en la LAN con Akebi
description: Accede al servidor con una URL HTTPS derivada de su dirección IP local.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Acceder a través de la dirección IP de la LAN {#lan-の-ip-アドレスからアクセスする}

Akebi convierte la IP privada del servidor en un nombre de host accesible por HTTPS.

Configura el servicio compartido de certificados en el asistente de LaTeX Renderer. Para proporcionar tu propio servicio, consulta [Administrar un servicio de certificados Akebi](/es/docs/lan-https-authority/).

- **Ejemplo IPv4.** Para la IP `192.168.1.50` y el dominio LAN `lan.example.org`, la URL es `https://192-168-1-50.lan.example.org`.
- **IPv6.** El nombre contiene los ocho grupos expandidos de la dirección privada compatible. Usa la URL exacta que muestre la configuración.

**Requisitos de red y DNS**
El cliente debe poder alcanzar la LAN del servidor. Si el nombre no se resuelve, comprueba si el router o el resolvedor DNS bloquea respuestas con IP privadas como **protección contra DNS rebinding**. Si es necesario, añade una excepción únicamente para el dominio LAN utilizado.

## Elegir el tipo de certificado {#証明書の方式を選ぶ}

| Método | Requisitos y características |
| --- | --- |
| **Servicio compartido, CA pública** | Configura el servicio compartido y acepta las condiciones de la CA. La clave privada del certificado permanece en el servidor. |
| **Servicio propio, CA pública** | URL y dominio LAN de [tu servicio Akebi](/es/docs/lan-https-authority/) y código de invitación si corresponde. |
| **Keyless** | Requiere un servicio compatible al que se delega la firma durante la negociación TLS. |
| **Certificado existente o CA privada** | Certificado que coincida con el nombre del servidor y su clave privada. Para una CA privada, configura la confianza en la raíz en el servidor y en todos los clientes. |

> [!NOTE]
> - Si usas una CA pública, los nombres de host de los certificados emitidos aparecen en los **registros públicos de transparencia de certificados (CT)**.
> - Dos LAN de ubicaciones distintas que usen la misma IP privada y el mismo dominio LAN se consideran **el mismo origen** en el navegador y comparten cookies y otros datos almacenados.

## Configurar el acceso desde la LAN {#lan-向けに設定する}

1. Para una instalación nueva, [prepara el servidor](/es/docs/self-hosting/#準備するもの) y usa `sudo n624-latex server setup --web` para abrir el [asistente](/es/docs/server-setup/#ブラウザで開く). Para cambiar un servidor con HTTPS dedicado administrado, usa `sudo n624-latex server setup --ingress --web`.
2. Selecciona **LAN** como vía de acceso e indica la interfaz de red, la IP privada, las subredes de clientes permitidas y el puerto HTTPS.
3. Elige el servicio y método de certificados. Con el servicio compartido se configuran la URL `https://akebi.n624.net` y el dominio LAN `lan.n624.net` y se registra el servidor al aplicar los cambios. No hace falta invitación. Para una CA pública, revisa y acepta sus condiciones. Si usas un servicio propio con invitaciones, introduce el código del administrador.
4. Revisa la URL HTTPS generada y las subredes admitidas antes de aplicar. La autenticación de la aplicación mediante contraseña u OIDC sigue en vigor.
5. Desde otro equipo en una subred admitida, abre la URL, comprueba que no haya advertencias de certificado, inicia sesión y convierte un documento de prueba.

Para montar tu propio servicio, consulta [Administrar un servicio de certificados Akebi](/es/docs/lan-https-authority/).

## Comprobar el estado del certificado {#証明書の状態を確認する}

Usa estos comandos para ver el servicio, el temporizador de renovación y los registros de su espacio de nombres.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Si la emisión o renovación falla, comprueba el reloj del servidor, la conexión HTTPS al servicio, el dominio, la IP y la hora de reintento indicada por la CA. Un fallo temporal mantiene el certificado válido. El temporizador reanudará la emisión a partir del estado registrado. Si no coinciden la clave y el estado, comprueba los archivos de estado conservados de la misma generación.

Consulta el [diseño de Akebi y la solución de problemas](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
