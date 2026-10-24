<p align="center">
  <a href="../en/termux.md">English</a> | <a href="../ko/termux.md">한국어</a> | <a href="../de/termux.md">Deutsch</a> | <a href="../cn/termux.md">简体中文</a> | <strong>Español</strong> | <a href="../vi/termux.md">Tiếng Việt</a> | <a href="../zh-Hant/termux.md">繁體中文</a>
</p>

# Guía de instalación de Termux

> 🌐 Esta guía está traducida por máquina. Para obtener la información más precisa, consulte la versión en [inglés](../en/termux.md) o [coreano](../ko/termux.md).

Esta guía explica cómo compilar y ejecutar PocketRisu directamente en un teléfono Android usando Termux. El patrón de uso previsto es abrir `http://localhost:6001` en el navegador del propio teléfono.

- [1. Requisitos previos](#1-requisitos-previos) — Termux y requisitos del sistema
- [2. Instalación y compilación](#2-instalación-y-compilación) — configuración con un solo comando
- [3. Ejecución y conexión](#3-ejecución-y-conexión) — abrir desde el navegador del teléfono
- [4. Mantener en ejecución](#4-mantener-en-ejecución) — sobrevivir con la pantalla apagada
- [5. Actualización](#5-actualización) — obtener la última versión
- [6. Limitaciones](#6-limitaciones) — funciones que no funcionan en Termux


## Requisitos del sistema

| Elemento              | Mínimo        | Recomendado                            |
| --------------------- | ------------- | -------------------------------------- |
| **Android**           | 7.0 (API 24)  | 10 o más reciente                      |
| **CPU**               | ARM64         | ARM64                                  |
| **RAM**               | 2 GB          | 4 GB o más                             |
| **Espacio libre**     | 2 GB          | 4 GB o más (incluida la compilación)   |

PocketRisu no proporciona binarios precompilados para Termux, por lo que el teléfono compila todo por sí mismo. Incluyendo módulos nativos como `better-sqlite3`, la compilación tarda aproximadamente **de 10 a 40 minutos**, dependiendo del rendimiento del teléfono.


---

## 1. Requisitos previos

### Instale Termux

Instale Termux desde una de las siguientes fuentes:

- **F-Droid (recomendado)**: https://f-droid.org/packages/com.termux/
- **GitHub Releases**: https://github.com/termux/termux-app/releases
- **Google Play**: https://play.google.com/store/apps/details?id=com.termux&hl=es&pli=1


---

## 2. Instalación y compilación

Abra Termux y ejecute este único comando:

```bash
pkg install -y git && \
  git clone https://github.com/PocketRisu/PocketRisu.git && \
  cd PocketRisu && \
  bash scripts/termux/build.sh
```

El comando se encarga de:

1. Instalar `git`
2. Clonar el repositorio de PocketRisu
3. Instalar las dependencias de compilación (`nodejs-lts`, `python`, `make`, `clang`, `pnpm`, etc.)
4. `pnpm install` — dependencias de JavaScript y compilación de módulos nativos
5. `pnpm build` — empaquetado del frontend

Cuando termine la compilación, verá:

```
Build OK. Start the server with:
  node server/node/server.cjs

Then open this address in the phone's own browser:
  http://localhost:6001
```


---

## 3. Ejecución y conexión

Desde el mismo directorio, inicie el servidor:

```bash
node server/node/server.cjs
```

Una vez que aparezca el registro de arranque del servidor, abra el navegador del teléfono (Chrome, Firefox, etc.) y navegue a:

```
http://localhost:6001
```

La interfaz de PocketRisu debería cargarse. El navegador trata automáticamente a `localhost` como contexto seguro, por lo que el portapapeles, `crypto.subtle` y otras API que requieren contexto seguro funcionan con normalidad.

Detenga el servidor con `Ctrl + C`.


---

## 4. Mantener en ejecución

Para mantener el servidor activo cuando la pantalla se apaga o cambia a otras aplicaciones, active el bloqueo de activación (wake lock) de Termux:

```bash
termux-wake-lock
```

La notificación de Termux mostrará el indicador de wake lock, y el servidor continuará ejecutándose incluso con la pantalla apagada.

Libere con: `termux-wake-unlock`

> Android aún puede terminar Termux bajo presión de memoria. Para uso prolongado, excluya Termux de la configuración de optimización de batería de su teléfono.


---

## 5. Actualización

Detenga el servidor en ejecución con `Ctrl + C` y luego ejecute:

```bash
cd ~/PocketRisu && \
  git pull --ff-only && \
  GYP_DEFINES="android_ndk_path=''" pnpm install --frozen-lockfile && \
  NODE_OPTIONS="--max-old-space-size=2048" pnpm build
```

Cada paso solo se ejecuta si el anterior tuvo éxito, así que el comando se detiene en el primer error en lugar de volver a compilar la versión anterior sin el código actualizado. Cuando termine la compilación, vuelva a iniciar el servidor con `node server/node/server.cjs`.

- `pnpm install` aplica los cambios de dependencias de la nueva versión. Ejecútelo en cada actualización; termina de inmediato si no hubo cambios.
- `GYP_DEFINES` es el mismo ajuste de Termux que usa el script de compilación. Es necesario cuando se recompilan módulos nativos como `better-sqlite3`.

### Si `git pull` falla

Si `git pull` se detiene con `Your local changes to the following files would be overwritten by merge` o `Not possible to fast-forward`, restablezca el código fuente a la última versión con el siguiente comando y vuelva a ejecutar el comando de actualización anterior:

```bash
cd ~/PocketRisu && git fetch origin && git reset --hard origin/main
```

Las carpetas `save/` y `backups/` no están controladas por git, por lo que los chats, personajes y ajustes se conservan. Se descartan los cambios que haya hecho en los archivos fuente (un puerto modificado, dependencias cambiadas con `pnpm add`, etc.).


---

## 6. Limitaciones

**Quick Tunnel (túnel automático de Cloudflare) no funciona en Termux.** El binario `cloudflared` no es compatible con el entorno DNS y TLS de Termux.

PocketRisu detecta automáticamente el entorno Termux y muestra una advertencia en el menú de Acceso Remoto, ocultando el botón de inicio.


---

← [Volver al README](../../i18n/README.es.md)
