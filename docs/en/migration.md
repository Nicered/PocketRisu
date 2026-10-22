<p align="center">
  <strong>English</strong> | <a href="../ko/migration.md">한국어</a> | <a href="../de/migration.md">Deutsch</a> | <a href="../cn/migration.md">简体中文</a> | <a href="../es/migration.md">Español</a> | <a href="../vi/migration.md">Tiếng Việt</a> | <a href="../zh-Hant/migration.md">繁體中文</a>
</p>

# RisuAI Migration Guide

There are four ways to migrate data from an existing RisuAI installation (Web RisuAI, Local RisuAI) to PocketRisu. Choose based on your source environment and data size.

- [1. Import from RisuAI Account](#1-import-from-risuai-account) — Web RisuAI with account sync. The server downloads the account data directly.
- [2. Local Backup File (.bin)](#2-local-backup-file-bin) — Works in all environments. The most common method.
- [3. Save Folder Zip Upload](#3-save-folder-zip-upload) — Local RisuAI, small datasets.
- [4. Save Folder Direct Copy](#4-save-folder-direct-copy) — Local RisuAI, large datasets.


## Before You Start

> ⚠️ **Back up your existing data** before migrating. You can export a `.bin` file from RisuAI's Settings > Backup.


---

## 1. Import from RisuAI Account

The PocketRisu server downloads the data saved in your web RisuAI (risuai.xyz) account directly from RisuAI. It moves the characters, chats, settings and images in the account.

1. **In web RisuAI** (if you have not been using account sync): log in under Settings > Account & Files and turn on "Save Data in Account". If a choice appears, pick "Save Current Data to Account", then type `RISUAI` in the confirmation box. Your current data is uploaded to the account.
2. **In PocketRisu**: Settings > Data Migration > "Import from RisuAI account", accept RisuAI's Terms of Service and log in.
3. Check the number of characters, chats and images and the estimated time, then press "Start import".
4. Until it ends, PocketRisu shows only the import screen. When it ends, your data is replaced and the page reloads by itself.

> ⚠️ The import **replaces all current data in PocketRisu with the account data** (nothing is merged). Back up anything you want to keep first.

- To avoid straining RisuAI's server, one item is downloaded per second. With many images this can take several hours.
- If the server restarts or the RisuAI login expires, logging in again downloads only what is left.
- Images inserted into chats (inlays) are stored only in the browser, so they are not imported.
- Storage in a RisuAI account has a size limit.


---

## 2. Local Backup File (.bin)

Export a `.bin` backup file from existing RisuAI, then import it into PocketRisu. Works regardless of the source environment (web / Tauri / Capacitor / local).

1. **In existing RisuAI**: Settings > Backup > "Save Local Backup" to export a `.bin` file.
2. **In PocketRisu**: Settings > Data Migration > "Import Original Risu Local Backup" to import the `.bin` file.

> ⚠️ **Temporary issue (as of October 2026)**: In the latest web RisuAI (risuai.xyz), the database in a "Save Local Backup" file is encrypted whether or not you are logged in to an account. PocketRisu rejects such a file with an "encrypted backup" message. (Backups made in the RisuAI desktop app or a self-hosted Node server are not affected.) A fix has been requested from RisuAI ([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681)). Until it is resolved, move your data through web RisuAI's account sync with [1. Import from RisuAI Account](#1-import-from-risuai-account).
>
> If you already used account sync ("Save Data in Account") on web RisuAI, your backups are encrypted regardless of this issue. Use method 1 in that case too.



---

## 3. Save Folder Zip Upload

If you were using Local RisuAI (the Node server version), you can zip your `save` folder and upload it.

1. Compress the `save` folder of your existing RisuAI project as a zip file.
2. In PocketRisu, go to Settings > Data Migration > "Import save folder from NodeOnly Risu" accordion.
3. Upload the zip via "Import from Save Folder (Zip Upload)".

> If the zip file is too large, the upload may fail. In that case, use [4. Save Folder Direct Copy](#4-save-folder-direct-copy).


---

## 4. Save Folder Direct Copy

Suitable for large datasets (several GB or more). Requires direct filesystem access to the server.

1. Stop the PocketRisu server.
2. Overwrite PocketRisu's `save` folder with the existing RisuAI's `save` folder.
3. Restart the PocketRisu server — automatic migration begins.
    - Monitor progress in the terminal or PM2 logs.
4. After migration completes, use Settings > Data Migration > "Import save folder from NodeOnly Risu" accordion > "Clean Up Migrated Save Files" to remove the original files and reclaim disk space.


---

## Which Method Should I Choose?

| Situation                                            | Recommended Method                |
| ---------------------------------------------------- | --------------------------------- |
| Migrating from Web RisuAI                            | 2. `.bin` backup                  |
| Migrating from Web RisuAI, backup rejected as encrypted | 1. Import from RisuAI Account |
| Migrating from Local RisuAI, small data              | 3. Zip upload                     |
| Migrating from Local RisuAI, large data (10GB+)      | 4. Save folder direct copy        |
| Not sure                                             | 2. `.bin` backup                  |


---

← [Back to README](../../README.md)
