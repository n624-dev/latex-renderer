---
slug: server-setup
category: Alojamiento propio
title: Asistente de configuración del servidor
description: Configura la autenticación, HTTPS y los límites de ejecución en un servidor preparado desde un navegador o una terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Elegir un procedimiento {#どの手順を使うか}

Para una instalación nueva, [prepara el servidor](/es/docs/self-hosting/#準備するもの) y abre el asistente en un **navegador**. En una instalación existente, el mismo asistente permite cambiar el inicio de sesión y los límites de ejecución.

- Ejecuta `sudo n624-latex server setup --plan` en el servidor para comprobar los paquetes necesarios y el espacio libre. Resuelve las carencias indicadas y repite la comprobación.
- Para cambiar una instalación existente con HTTPS dedicado o HTTPS en la LAN (Akebi), añade `--ingress` al comando de inicio.
- Si Docker indica que faltan módulos del kernel en un host mínimo, sigue las instrucciones y vuelve a intentarlo. Por ejemplo, si requiere `nf_tables`, un administrador debe ejecutar `sudo modprobe nf_tables`.

## Abrir en un navegador {#ブラウザで開く}

Conéctate por SSH con la cuenta de despliegue sin privilegios de root y ejecuta lo siguiente. **Mantén la terminal abierta hasta finalizar la configuración.**

```sh
sudo n624-latex server setup --web
```

1. En la instalación inicial, revisa las tareas de preparación y escribe `PREPARE` para continuar. Espera a que termine la descarga de la versión firmada, la preparación de los servicios y la creación y verificación del primer entorno TeX.
2. Localiza en la terminal la URL de un solo uso. Es válida durante **5 minutos**.
3. Ábrela en el servidor o usa el **reenvío de puertos SSH** para acceder al mismo puerto desde tu equipo. Si el puerto mostrado es `41234`, ejecuta lo siguiente en otra terminal local y abre en el navegador la URL indicada por el asistente.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> No compartas la URL de configuración ni publiques su puerto en Internet o en un proxy inverso.

## Revisar y aplicar la configuración {#プレビューから適用まで}

1. **Elige el método de acceso y de inicio de sesión.** En una instalación nueva, configura HTTPS y el primer propietario. Introduce las contraseñas y los secretos de cliente OIDC en sus campos ocultos.
2. **Revisa la vista previa.** Comprueba la URL pública y el método de acceso. Si cambias de método, prepara la identidad de propietario para el nuevo mientras todavía puedas iniciar sesión.
3. **Aplica los cambios.** Espera a que se inicien o reinicien los servicios.
4. **Inicia sesión y crea un PDF.** Usa otra ventana del navegador para [verificar la instalación](/es/docs/self-hosting/#導入完了の確認).

Si habilitas contraseñas y OIDC en una instalación nueva, registra primero al propietario con contraseña y añade a esa cuenta los valores `issuer` y `subject` de OIDC. En los límites de ejecución, el umbral de inicio indica la RAM libre antes de iniciar el trabajo y el límite en ejecución indica la RAM que puede usar el contenedor.

## Revisar un cambio interrumpido {#中断した変更を確認する}

- Si se pierde la conexión después de empezar a aplicar cambios, comprueba primero el resultado de la misma operación.
- Si terminó el proceso del asistente, vuelve a iniciarlo para el mismo destino y elige **Recover** en la web o **`RECOVER`** en la terminal. Si ya se registró un propietario, el asistente reutiliza el registro y continúa hasta la confirmación. Esta recuperación de configuración no restaura una copia anterior de la base de datos.
- Los archivos de recuperación pueden contener secretos TLS u OIDC. Evita editarlos manualmente. Al solicitar ayuda, facilita solo el código de error mostrado y la fase.

## Abrir en una terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Para cambiar un servidor existente, introduce cada ajuste o pulsa Enter con el campo vacío para conservarlo. Para HTTPS automático en la LAN durante la instalación, elige `LAN` y sigue las indicaciones. Si configuras por terminal HTTPS propio por primera vez o una ruta Cloudflare existente, introduce en una sola línea el JSON del formato indicado. Si te estrenas con esta configuración, [empieza en el navegador](#ブラウザで開く).

### Versiones anteriores e instalaciones manuales {#旧版-手動配置の場合}

> [!DETAILS] Ejecutar server-setup.mjs directamente
>
> Si preparaste tu servidor sin APT, con un usuario dedicado, Node.js y Docker sin root, y colocaste una versión verificada en `/opt/latex-renderer/current`, llama directamente a `server-setup.mjs`. Para preparar un host nuevo consulta las [instrucciones manuales](/es/docs/self-hosting/#現在の提供状況).
>
> | Tarea | Argumento de inicio | Condiciones |
> | --- | --- | --- |
> | Cambiar autenticación o límites existentes | `--existing` | Propietario registrado y servicios operativos |
> | Configurar y registrar al primer propietario | `--initial` | Distribución y entorno preparados, sin configuración operativa ni base de datos previa |
> | Cambiar HTTPS dedicado administrado | `--ingress` | HTTPS standalone dedicado. Migrar desde Nginx compartido es una operación aparte. |
>
> - **Interfaz de terminal**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Interfaz de navegador**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Consulta la [especificación de entrada y recuperación del asistente](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
