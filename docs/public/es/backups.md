---
slug: backups
category: Alojamiento propio
title: Crear, verificar y restaurar copias de seguridad
description: Compara copias periódicas y puntos de recuperación de actualizaciones, verifica un archivo y restaura datos.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Qué se guarda {#何が保存されるか}

| Tipo | Contenido | Uso |
| --- | --- | --- |
| **Copia periódica** | Base de datos SQLite y ZIP de entrada referenciados por revisiones activas, borradores y vistas previas en curso | Proteger la base de datos, los proyectos y los documentos en edición |
| **Punto de recuperación de actualización** | SQLite inmediatamente antes de actualizar, todo el almacenamiento de la aplicación e información de versión previa | Investigar fallos y restaurar el estado anterior |
| **Copia separada de configuración del host** | Archivos como `/etc/latex-renderer/`, claves privadas, certificados TLS y estado de Akebi | Reconstruir el host tras una avería |

- Tras restaurar una copia periódica, abre el proyecto en el editor para regenerar su vista previa. Los resultados de trabajos temporales y las cachés de trabajo no se incluyen.
- Protege por separado la configuración, los certificados y la clave de descifrado (identidad age). **Guarda las copias cifradas y la clave en ubicaciones seguras diferentes para evitar perder ambas en un único incidente.**

## Crear una copia manualmente {#手動で作成する}

1. Inicia sesión como propietario y abre **Administración → Sistema → Copias de seguridad**.
2. Pulsa **Crear copia de seguridad** y espera a que termine.
3. Pulsa **Verificar la última copia de seguridad** y comprueba el nombre del archivo y la hora en la última verificación. Se necesita la clave de descifrado en el servidor.

### Crear y verificar desde la línea de comandos {#コマンドで作成-検証する}

1. Crea una copia cifrada de inmediato en el servidor. En `/etc/latex-renderer/backup.env`, `BACKUP_DIRECTORY` especifica el destino, que por defecto es `/var/lib/latex-renderer/backups`. El temporizador `latex-renderer-backup.timer` realiza las copias periódicas.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Copia el archivo `.tar.age` en un host Linux de verificación. Prepara GNU `tar`, `age`, una versión compatible de Node.js (24 o 26) con `node:sqlite` y la clave de descifrado. Para conservarlo a largo plazo, almacena el archivo y la clave por separado.
3. [Descarga, verifica y extrae la distribución del servidor](/es/docs/self-hosting/#v1-6-9をダウンロードして検証) correspondiente a la versión que creó la copia. Indica esa versión en el primer `version=`, asigna a `release_dir` la carpeta extraída y ejecuta el script de la distribución.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

La aparición de `restore_test.completed` indica que se ha completado la verificación. La prueba comprueba la coherencia de SQLite y los ZIP de entrada extraídos en espacio temporal. También puedes verificar una copia externa recuperándola desde su ubicación de almacenamiento.

## Revisar un punto de recuperación tras un fallo {#更新失敗後の復旧点を確認する}

Si aparece `RECOVERY_REVIEW_REQUIRED` después de fallar una actualización, comprueba el estado del punto de recuperación con privilegios administrativos.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Consultar el estado en versiones anteriores
>
> Si no existe `n624-latex server recovery status`, ejecuta `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Contrasta el ID del punto (`POINT_ID`), las versiones de la aplicación y del actualizador, el esquema de la base de datos y los servicios en ejecución. Si necesitas restaurar datos, conserva primero el archivo y la configuración actual en otro lugar.
2. Ejecuta `acknowledge` solo después de investigar y confirmar que no necesitas restaurar los datos y que puedes retirar la protección del punto.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` termina la revisión y reanuda los servicios si se cumplen las condiciones. Si vas a restaurar datos, conserva el punto protegido y continúa con el siguiente procedimiento.

## Restaurar datos {#データを復旧する場合}

Se perderán los cambios posteriores a la copia. Si la base de datos es compatible y basta con volver a la aplicación anterior, usa la [reversión desde Actualizaciones](/es/docs/updates/#前の版へ戻す). Ensaya la restauración de datos en un host de prueba antes de realizarla en producción.

1. **Identifica el destino y conserva el estado actual.** Localiza la copia y la versión de la aplicación compatible con su esquema. Guarda por separado la base de datos, el almacenamiento y la configuración actuales antes de intervenir en producción.
2. **Detén los servicios.** Con el bloqueo administrativo compartido, detén todos los servicios y temporizadores que escriban en la base de datos o el almacenamiento para evitar conflictos con actualizaciones o limpieza.
3. **Extrae y verifica.** Descifra y extrae el archivo en una carpeta privada vacía y comprueba su integridad. Si usas un punto de actualización, contrasta también `summary.json`, administrado por root, con el manifiesto interno.
4. **Restaura un único punto temporal.** SQLite y el almacenamiento de entradas y resultados deben corresponder al **mismo punto de recuperación**. En una copia periódica, coloca cada ZIP en la ubicación `storage_key` verificada que indica la base de datos restaurada. Usa las versiones, los archivos de configuración, los propietarios y los permisos correspondientes.
5. **Inicia y verifica.** Comprueba inicio de sesión, conversión de un proyecto guardado, descarga de resultados y creación de otra copia. Si la exportación de auditoría se detiene por una discrepancia de posición, sigue la [recuperación de registros de auditoría](/es/docs/reference/#監査ログの復旧).

Consulta el [formato y las comprobaciones de las copias operativas](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) y el [diseño de los puntos de recuperación de actualización](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
