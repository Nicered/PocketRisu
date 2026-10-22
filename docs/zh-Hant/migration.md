<p align="center">
  <a href="../en/migration.md">English</a> | <a href="../ko/migration.md">한국어</a> | <a href="../de/migration.md">Deutsch</a> | <a href="../cn/migration.md">简体中文</a> | <a href="../es/migration.md">Español</a> | <a href="../vi/migration.md">Tiếng Việt</a> | <strong>繁體中文</strong>
</p>

# RisuAI 遷移指南

> 🌐 此指南由機器翻譯生成。如需獲取最準確的資訊,請參閱 [English](../en/migration.md) 或 [한국어](../ko/migration.md) 版本。

從現有 RisuAI 安裝(Web RisuAI、本地 RisuAI)遷移資料到 PocketRisu 有四種方式。根據您的來源環境和資料規模選擇。

- [1. 從 RisuAI 帳號匯入](#1-從-risuai-帳號匯入) — 使用帳號同步的 Web RisuAI。由伺服器直接下載帳號資料。
- [2. 本地備份檔案(.bin)](#2-本地備份檔案bin) — 在所有環境中可用。最常見的方法。
- [3. Save 資料夾 zip 上傳](#3-save-資料夾-zip-上傳) — 本地 RisuAI,小規模資料。
- [4. Save 資料夾直接複製](#4-save-資料夾直接複製) — 本地 RisuAI,大規模資料。


## 開始之前

> ⚠️ 遷移前**請備份現有資料**。可從 RisuAI 的 設定 > 備份 匯出 `.bin` 檔案。


---

## 1. 從 RisuAI 帳號匯入

由 PocketRisu 伺服器直接從 RisuAI 下載儲存在網頁版 RisuAI(risuai.xyz)帳號中的資料。會遷移帳號中的角色、對話、設定和圖片。

1. **在網頁版 RisuAI 中**(如果尚未使用帳號同步):在 設定 > 帳號 & 檔案 中登入,然後開啟"將資料儲存至帳號"。出現選擇視窗時選擇"將目前資料儲存至帳號",並在確認輸入框中輸入 `RISUAI`,目前的資料就會上傳到帳號。
2. **在 PocketRisu 中**:在 設定 > 資料遷移 > "從 RisuAI 帳號匯入" 中同意 RisuAI 服務條款並登入。
3. 確認要匯入的角色、對話、圖片數量和預計時間後,點擊"開始匯入"。
4. 匯入完成前,PocketRisu 只會顯示匯入畫面。完成後資料會被取代,頁面會自動重新整理。

> ⚠️ 匯入會將 PocketRisu 的**目前資料全部取代為帳號資料**(不會合併)。如有需要保留的資料,請先備份。

- 為避免造成 RisuAI 伺服器負擔,每秒只下載一項。圖片較多時可能需要數小時。
- 若伺服器重新啟動或 RisuAI 登入過期,重新登入後只會繼續下載剩餘部分。
- 插入對話中的圖片(內嵌圖片)只儲存在瀏覽器中,因此不會匯入。
- RisuAI 帳號的儲存空間有容量限制。


---

## 2. 本地備份檔案(.bin)

從現有 RisuAI 匯出 `.bin` 備份檔案,然後匯入 PocketRisu。無論來源環境(web / Tauri / Capacitor / 本地)如何均可使用。

1. **在現有 RisuAI 中**: 設定 > 備份 > "儲存本地備份" 匯出 `.bin` 檔案。
2. **在 PocketRisu 中**: 設定 > 資料遷移 > "匯入原版 Risu 本地備份" 匯入 `.bin` 檔案。

> ⚠️ **暫時性問題(截至 2026 年 10 月)**:在最新版網頁版 RisuAI(risuai.xyz)中,無論是否登入帳號,用"儲存本地備份"產生的檔案其資料庫都會被加密。匯入 PocketRisu 時會顯示「備份已加密」的提示並被拒絕。(在 RisuAI 桌面版或自架 Node 伺服器中產生的備份不受影響。)已向 RisuAI 請求修正([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681))。在問題解決之前,請透過網頁版 RisuAI 的帳號同步,使用 [1. 從 RisuAI 帳號匯入](#1-從-risuai-帳號匯入) 遷移資料。
>
> 如果您原本就在網頁版 RisuAI 中使用帳號同步("將資料儲存至帳號"),無論是否有此問題,備份都是加密的。這種情況也請使用方法 1。



---

## 3. Save 資料夾 zip 上傳

若您使用的是本地 RisuAI(Node 伺服器版),可將 `save` 資料夾壓縮為 zip 並上傳。

1. 將現有 RisuAI 專案的 `save` 資料夾壓縮為 zip 檔案。
2. 在 PocketRisu 中開啟 設定 > 資料遷移 > "從 NodeOnly Risu 匯入 save 資料夾" 摺疊面板。
3. 透過 "從 save 資料夾匯入(Zip 上傳)" 上傳 zip 檔案。

> 若 zip 檔案過大,上傳可能失敗。此時請使用 [4. Save 資料夾直接複製](#4-save-資料夾直接複製)。


---

## 4. Save 資料夾直接複製

適合大規模資料(數 GB 以上)。需要伺服器檔案系統的直接存取權限。

1. 停止 PocketRisu 伺服器。
2. 用現有 RisuAI 的 `save` 資料夾整體覆蓋 PocketRisu 的 `save` 資料夾。
3. 重啟 PocketRisu 伺服器 — 自動遷移開始。
    - 可在終端機或 PM2 日誌中檢視進度。
4. 遷移完成後,使用 設定 > 資料遷移 > "從 NodeOnly Risu 匯入 save 資料夾" 摺疊面板 > "清理已遷移的 save 檔案" 移除原始檔案並回收磁碟空間。


---

## 我該選擇哪種方式?

| 情況                                              | 推薦方式                          |
| ------------------------------------------------- | --------------------------------- |
| 從 Web RisuAI 遷移                                | 2. `.bin` 備份                    |
| 從 Web RisuAI 遷移,備份因加密被拒絕 | 1. 從 RisuAI 帳號匯入 |
| 從本地 RisuAI 遷移,資料小規模                    | 3. Zip 上傳                       |
| 從本地 RisuAI 遷移,資料大規模(10GB+)            | 4. Save 資料夾直接複製            |
| 不確定                                            | 2. `.bin` 備份                    |


---

← [返回 README](../../i18n/README.zh-Hant.md)
