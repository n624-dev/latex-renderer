---
slug: updates
category: Alojamiento propio
title: Actualizar el servidor o volver a una versión anterior
description: Aplica una versión estable, comprueba el resultado y elige una vía de recuperación si falla.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Antes de actualizar {#更新する前に}

| Qué quieres cambiar | Dónde hacerlo |
| --- | --- |
| Aplicación del servidor | **Administración → Actualizaciones** |
| Versión o idiomas de TeX Live | **Administración → Entorno TeX**. Consulta [Cambiar el entorno TeX](/es/docs/self-hosting/#tex環境の初期設定). |
| Paquete APT local `n624-latex` | [Actualizar el paquete APT](/es/docs/client/#apt-版の更新) |

Antes de empezar, comprueba estos tres puntos.

1. [Crea y verifica una copia de seguridad cifrada](/es/docs/backups/#手動で作成する).
2. Elige un momento con pocos trabajos de conversión activos.
3. Mantén el modo de mantenimiento en `normal`. El actualizador detiene e inicia los servicios necesarios y realiza una conversión de prueba.

## Aplicar una versión estable {#正式版を適用する}

1. Inicia sesión como propietario y abre **Administración → Actualizaciones** (`/admin/updates/`).
2. Deja vacío el campo de versión y pulsa **Buscar actualizaciones** para ver la versión actual y la estable disponible.
3. Selecciona la opción de descargar, verificar y actualizar, indica el motivo del cambio e inicia la actualización.
4. Anota el **ID de operación** y comprueba que el estado indique que finalizó correctamente.
   - Si la aplicación ya está actualizada pero falta cambiar el actualizador, consulta el resultado de la misma operación y los detalles del actualizador.
   - La operación continúa aunque cierres el navegador. Si aparece un `502` durante un reinicio, espera a que la interfaz se vuelva a conectar.
5. Inicia sesión con otro navegador o una ventana privada. Convierte un documento representativo, comprueba la descarga del PDF y verifica las versiones de la aplicación y del actualizador.

## Notificaciones y actualizaciones automáticas {#通知と自動更新}

En la política de actualización puedes escoger entre comprobar y notificar (opción predeterminada) o aplicar automáticamente después de verificar.

- La aplicación automática solo abarca versiones estables.
- Para probar una versión candidata en un entorno de pruebas dedicado, especifica su etiqueta publicada con el formato `vX.Y.Z-rc.N`.

## Si falla la actualización {#更新が失敗した場合}

Revisa el ID de operación y la fase del fallo en el registro detallado. Comprueba las versiones de la aplicación y del actualizador, el inicio de sesión, la conversión y si se requiere una revisión de recuperación. El número de versión por sí solo no basta.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Comprueba si hay mantenimiento en curso y vuelve al modo `normal` antes de iniciar la actualización.
- **`RECOVERY_REVIEW_REQUIRED`.** Sigue las instrucciones para [revisar el punto de recuperación tras un fallo](/es/docs/backups/#更新失敗後の復旧点を確認する).

## Volver a la versión anterior {#前の版へ戻す}

- **Si basta con revertir la aplicación**, consulta el destino en **Administración → Actualizaciones** y elige la opción de volver a la versión anterior si está disponible. Al terminar, prueba el inicio de sesión y la conversión a PDF.
- **Si el cambio de base de datos es incompatible**, hay que restaurar la base de datos y el almacenamiento del mismo punto de recuperación. Sigue el procedimiento de [restauración de datos](/es/docs/backups/#データを復旧する場合).

Consulta [Migración y recuperación de versiones anteriores](/es/docs/reference/#旧版からの移行と特殊復旧) y la [especificación y política de conservación del actualizador](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
