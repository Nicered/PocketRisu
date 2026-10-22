<p align="center">
  <a href="../en/migration.md">English</a> | <a href="../ko/migration.md">한국어</a> | <a href="../de/migration.md">Deutsch</a> | <a href="../cn/migration.md">简体中文</a> | <strong>Español</strong> | <a href="../vi/migration.md">Tiếng Việt</a> | <a href="../zh-Hant/migration.md">繁體中文</a>
</p>

# Guía de migración desde RisuAI

> 🌐 Esta guía está traducida por máquina. Para obtener la información más precisa, consulte la versión en [inglés](../en/migration.md) o [coreano](../ko/migration.md).

Hay cuatro formas de migrar datos desde una instalación existente de RisuAI (RisuAI Web, RisuAI Local) a PocketRisu. Elija según su entorno de origen y el tamaño de los datos.

- [1. Importar desde la cuenta de RisuAI](#1-importar-desde-la-cuenta-de-risuai) — RisuAI Web con sincronización de cuenta. El servidor descarga los datos de la cuenta directamente.
- [2. Archivo de copia de seguridad local (.bin)](#2-archivo-de-copia-de-seguridad-local-bin) — Funciona en todos los entornos. El método más común.
- [3. Subida zip de la carpeta save](#3-subida-zip-de-la-carpeta-save) — RisuAI Local, datos pequeños.
- [4. Copia directa de la carpeta save](#4-copia-directa-de-la-carpeta-save) — RisuAI Local, datos grandes.


## Antes de comenzar

> ⚠️ **Haga una copia de seguridad de sus datos existentes** antes de migrar. Puede exportar un archivo `.bin` desde Configuración > Copia de seguridad en RisuAI.


---

## 1. Importar desde la cuenta de RisuAI

El servidor de PocketRisu descarga directamente de RisuAI los datos guardados en la cuenta de RisuAI web (risuai.xyz). Se trasladan los personajes, chats, ajustes e imágenes de la cuenta.

1. **En RisuAI web** (si aún no usa la sincronización de cuenta): inicie sesión en Configuración > Cuenta & Archivos y active "Guardar Datos en la Cuenta". Si aparece una selección, elija "Guardar Datos Actuales en la Cuenta" y escriba `RISUAI` en el campo de confirmación. Sus datos actuales se suben a la cuenta.
2. **En PocketRisu**: en Configuración > Migración de datos > "Importar desde la cuenta de RisuAI", acepte los términos de servicio de RisuAI e inicie sesión.
3. Revise el número de personajes, chats e imágenes y el tiempo estimado, y pulse "Iniciar importación".
4. Hasta que termine, PocketRisu solo muestra la pantalla de importación. Al terminar, los datos se reemplazan y la página se recarga sola.

> ⚠️ La importación **reemplaza todos los datos actuales de PocketRisu por los de la cuenta** (no los combina). Si hay datos que quiera conservar, haga antes una copia de seguridad.

- Para no sobrecargar el servidor de RisuAI, se descarga un elemento por segundo. Con muchas imágenes puede tardar varias horas.
- Si el servidor se reinicia o la sesión de RisuAI caduca, al volver a iniciar sesión solo se descarga lo que falta.
- Las imágenes insertadas en los chats (inlays) se guardan solo en el navegador, por lo que no se importan.
- El almacenamiento de una cuenta de RisuAI tiene un límite de tamaño.


---

## 2. Archivo de copia de seguridad local (.bin)

Exporte un archivo de copia de seguridad `.bin` desde RisuAI existente y luego impórtelo en PocketRisu. Funciona independientemente del entorno de origen (web / Tauri / Capacitor / local).

1. **En RisuAI existente**: Configuración > Copia de seguridad > "Guardar copia local" para exportar un archivo `.bin`.
2. **En PocketRisu**: Configuración > Migración de datos > "Importar copia local de Risu original" para importar el archivo `.bin`.

> ⚠️ **Problema temporal (a octubre de 2026)**: En la versión actual de RisuAI web (risuai.xyz), la base de datos de un archivo creado con "Guardar copia local" se cifra tanto si ha iniciado sesión en una cuenta como si no. PocketRisu rechaza ese archivo con un aviso de copia cifrada. (Las copias creadas en la aplicación de escritorio de RisuAI o en un servidor Node propio no se ven afectadas.) Se ha solicitado una corrección a RisuAI ([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681)). Hasta que se resuelva, traslade sus datos mediante la sincronización de cuenta de RisuAI web con [1. Importar desde la cuenta de RisuAI](#1-importar-desde-la-cuenta-de-risuai).
>
> Si ya usaba la sincronización de cuenta ("Guardar Datos en la Cuenta") en RisuAI web, sus copias están cifradas independientemente de este problema. Use también el método 1 en ese caso.



---

## 3. Subida zip de la carpeta save

Si estaba usando RisuAI Local (la versión de servidor Node), puede comprimir su carpeta `save` y subirla.

1. Comprima la carpeta `save` de su proyecto RisuAI existente como un archivo zip.
2. En PocketRisu, vaya a Configuración > Migración de datos > acordeón "Importar carpeta save de NodeOnly Risu".
3. Suba el zip a través de "Importar desde carpeta save (Subir Zip)".

> Si el archivo zip es demasiado grande, la subida puede fallar. En ese caso, use [4. Copia directa de la carpeta save](#4-copia-directa-de-la-carpeta-save).


---

## 4. Copia directa de la carpeta save

Apropiado para grandes conjuntos de datos (varios GB o más). Requiere acceso directo al sistema de archivos del servidor.

1. Detenga el servidor PocketRisu.
2. Sobrescriba la carpeta `save` de PocketRisu con la carpeta `save` del RisuAI existente.
3. Reinicie el servidor PocketRisu — la migración automática comienza.
    - Monitoree el progreso en el terminal o en los logs de PM2.
4. Después de que se complete la migración, use Configuración > Migración de datos > acordeón "Importar carpeta save de NodeOnly Risu" > "Limpiar archivos save migrados" para eliminar los archivos originales y recuperar espacio en disco.


---

## ¿Qué método debo elegir?

| Situación                                                       | Método recomendado                       |
| --------------------------------------------------------------- | ---------------------------------------- |
| Migrar desde RisuAI Web                                         | 2. Copia `.bin`                          |
| Migrar desde RisuAI Web, la copia se rechaza por estar cifrada | 1. Importar desde la cuenta de RisuAI |
| Migrar desde RisuAI Local, datos pequeños                       | 3. Subida zip                            |
| Migrar desde RisuAI Local, datos grandes (10GB+)                | 4. Copia directa de la carpeta save      |
| No estoy seguro                                                 | 2. Copia `.bin`                          |


---

← [Volver al README](../../i18n/README.es.md)
