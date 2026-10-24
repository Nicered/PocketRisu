<p align="center">
  <a href="../en/termux.md">English</a> | <a href="../ko/termux.md">한국어</a> | <a href="../de/termux.md">Deutsch</a> | <a href="../cn/termux.md">简体中文</a> | <a href="../es/termux.md">Español</a> | <a href="../vi/termux.md">Tiếng Việt</a> | <strong>繁體中文</strong>
</p>

# Termux 安裝指南

> 🌐 此指南由機器翻譯生成。如需獲取最準確的資訊,請參閱 [English](../en/termux.md) 或 [한국어](../ko/termux.md) 版本。

本指南介紹如何透過 Termux 在 Android 手機上直接建置並執行 PocketRisu。預期使用方式是在同一支手機的瀏覽器中開啟 `http://localhost:6001`。

- [1. 準備工作](#1-準備工作) — Termux 與系統需求
- [2. 安裝與建置](#2-安裝與建置) — 一條命令完成
- [3. 執行與連線](#3-執行與連線) — 從手機瀏覽器開啟
- [4. 保持執行](#4-保持執行) — 螢幕關閉時也保持執行
- [5. 更新](#5-更新) — 取得最新版本
- [6. 限制](#6-限制) — 在 Termux 上無法使用的功能


## 系統需求

| 項目         | 最低         | 建議                      |
| ------------ | ------------ | ------------------------- |
| **Android**  | 7.0 (API 24) | 10 或更新版本             |
| **CPU**      | ARM64        | ARM64                     |
| **記憶體**   | 2 GB         | 4 GB 或以上               |
| **可用空間** | 2 GB         | 4 GB 或以上(含建置產物)   |

PocketRisu 不為 Termux 提供預先編譯的二進位檔,因此由手機自行建置。包括 `better-sqlite3` 等原生模組在內,建置大約需要 **10 至 40 分鐘**,具體取決於手機效能。


---

## 1. 準備工作

### 安裝 Termux

請從以下任一來源安裝 Termux:

- **F-Droid(建議)**: https://f-droid.org/packages/com.termux/
- **GitHub Releases**: https://github.com/termux/termux-app/releases
- **Google Play**: https://play.google.com/store/apps/details?id=com.termux&hl=zh-TW&pli=1


---

## 2. 安裝與建置

開啟 Termux 並執行以下單一命令:

```bash
pkg install -y git && \
  git clone https://github.com/PocketRisu/PocketRisu.git && \
  cd PocketRisu && \
  bash scripts/termux/build.sh
```

該命令會自動完成:

1. 安裝 `git`
2. 複製 PocketRisu 儲存庫
3. 安裝建置相依套件(`nodejs-lts`、`python`、`make`、`clang`、`pnpm` 等)
4. `pnpm install` — JavaScript 相依套件與原生模組編譯
5. `pnpm build` — 前端打包

建置完成後會顯示:

```
Build OK. Start the server with:
  node server/node/server.cjs

Then open this address in the phone's own browser:
  http://localhost:6001
```


---

## 3. 執行與連線

從相同目錄啟動伺服器:

```bash
node server/node/server.cjs
```

伺服器啟動日誌出現後,在手機瀏覽器(Chrome、Firefox 等)中開啟:

```
http://localhost:6001
```

PocketRisu UI 應當正常載入。瀏覽器自動將 `localhost` 視為安全內容(secure context),因此剪貼簿、`crypto.subtle` 等需要安全內容的 API 均可正常運作。

使用 `Ctrl + C` 停止伺服器。


---

## 4. 保持執行

為了在螢幕關閉或切換到其他應用程式時保持伺服器執行,請啟用 Termux 的喚醒鎖:

```bash
termux-wake-lock
```

Termux 通知列會顯示喚醒鎖指示器,即使螢幕關閉伺服器也會繼續執行。

釋放命令: `termux-wake-unlock`

> 在記憶體壓力下 Android 仍可能終止 Termux。為了長時間執行,請在手機的電池最佳化設定中將 Termux 排除。


---

## 5. 更新

先使用 `Ctrl + C` 停止執行中的伺服器,然後執行:

```bash
cd ~/PocketRisu && \
  git pull --ff-only && \
  GYP_DEFINES="android_ndk_path=''" pnpm install --frozen-lockfile && \
  NODE_OPTIONS="--max-old-space-size=2048" pnpm build
```

每個步驟只有在前一步成功後才會執行。一旦出錯,指令會在該處停止,而不會在原始碼未更新的情況下重新建置舊版本。建置完成後,請使用 `node server/node/server.cjs` 重新啟動伺服器。

- `pnpm install` 會套用新版本中的相依套件變更。每次更新都需要執行,沒有變更時會立即完成。
- `GYP_DEFINES` 與建置腳本使用的 Termux 設定相同,重新編譯 `better-sqlite3` 等原生模組時需要它。

### `git pull` 失敗時

如果 `git pull` 因 `Your local changes to the following files would be overwritten by merge` 或 `Not possible to fast-forward` 而停止,請先使用以下指令將原始碼重設為最新版本,再重新執行上面的更新指令:

```bash
cd ~/PocketRisu && git fetch origin && git reset --hard origin/main
```

`save/` 與 `backups/` 資料夾不受 git 管理,因此聊天、角色與設定等資料會保留。但對原始檔所做的修改(例如變更連接埠、透過 `pnpm add` 變更的相依套件等)會被捨棄。


---

## 6. 限制

**Quick Tunnel(Cloudflare 自動隧道)在 Termux 上無法使用。** `cloudflared` 二進位檔與 Termux 的 DNS 和 TLS 環境不相容。

PocketRisu 會自動偵測 Termux 環境,在遠端存取選單中顯示警告並隱藏啟動按鈕。


---

← [返回 README](../../i18n/README.zh-Hant.md)
