<p align="center">
  <a href="../en/migration.md">English</a> | <a href="../ko/migration.md">한국어</a> | <a href="../de/migration.md">Deutsch</a> | <strong>简体中文</strong> | <a href="../es/migration.md">Español</a> | <a href="../vi/migration.md">Tiếng Việt</a> | <a href="../zh-Hant/migration.md">繁體中文</a>
</p>

# RisuAI 迁移指南

> 🌐 此指南由机器翻译生成。如需获取最准确的信息,请参阅 [English](../en/migration.md) 或 [한국어](../ko/migration.md) 版本。

从现有 RisuAI 安装(Web RisuAI、本地 RisuAI)迁移数据到 PocketRisu 有四种方式。根据您的源环境和数据规模选择。

- [1. 从 RisuAI 账号导入](#1-从-risuai-账号导入) — 使用账号同步的 Web RisuAI。由服务器直接下载账号数据。
- [2. 本地备份文件(.bin)](#2-本地备份文件bin) — 在所有环境中工作。最常用的方法。
- [3. Save 文件夹 zip 上传](#3-save-文件夹-zip-上传) — 本地 RisuAI,小规模数据。
- [4. Save 文件夹直接复制](#4-save-文件夹直接复制) — 本地 RisuAI,大规模数据。


## 开始之前

> ⚠️ 迁移前**请备份现有数据**。可从 RisuAI 的 设置 > 备份 导出 `.bin` 文件。


---

## 1. 从 RisuAI 账号导入

由 PocketRisu 服务器直接从 RisuAI 下载保存在网页版 RisuAI(risuai.xyz)账号中的数据。会迁移账号中的角色、聊天、设置和图片。

1. **在网页版 RisuAI 中**(如果尚未使用账号同步):在 设置 > 账号 & 文件 中登录,然后开启"保存数据到账号"。出现选择窗口时选择"保存目前数据到账号",并在确认输入框中输入 `RISUAI`,当前数据就会上传到账号。
2. **在 PocketRisu 中**:在 设置 > 数据迁移 > "从 RisuAI 账号导入" 中同意 RisuAI 服务条款并登录。
3. 确认要导入的角色、聊天、图片数量和预计时间后,点击"开始导入"。
4. 导入完成前,PocketRisu 只显示导入界面。完成后数据会被替换,页面会自动刷新。

> ⚠️ 导入会将 PocketRisu 的**当前数据全部替换为账号数据**(不会合并)。如有需要保留的数据,请先备份。

- 为避免给 RisuAI 服务器造成负担,每秒只下载一项。图片较多时可能需要几个小时。
- 如果服务器重启或 RisuAI 登录过期,重新登录后只会继续下载剩余部分。
- 插入聊天中的图片(内嵌图片)只保存在浏览器中,因此不会导入。
- RisuAI 账号的存储空间有容量限制。


---

## 2. 本地备份文件(.bin)

从现有 RisuAI 导出 `.bin` 备份文件,然后导入 PocketRisu。无论源环境(web / Tauri / Capacitor / 本地)如何均可使用。

1. **在现有 RisuAI 中**: 设置 > 备份 > "保存本地备份" 导出 `.bin` 文件。
2. **在 PocketRisu 中**: 设置 > 数据迁移 > "导入原版 Risu 本地备份" 导入 `.bin` 文件。

> ⚠️ **临时问题(截至 2026 年 10 月)**:在最新版网页版 RisuAI(risuai.xyz)中,无论是否登录账号,用"保存本地备份"生成的文件其数据库都会被加密。导入 PocketRisu 时会显示"备份已加密"的提示并被拒绝。(在 RisuAI 桌面版或自建 Node 服务器中生成的备份不受影响。)已向 RisuAI 请求修复([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681))。在问题解决之前,请通过网页版 RisuAI 的账号同步,使用 [1. 从 RisuAI 账号导入](#1-从-risuai-账号导入) 迁移数据。
>
> 如果您原本就在网页版 RisuAI 中使用账号同步("保存数据到账号"),无论是否存在此问题,备份都是加密的。这种情况也请使用方法 1。



---

## 3. Save 文件夹 zip 上传

如果您使用的是本地 RisuAI(Node 服务器版),可以将 `save` 文件夹压缩为 zip 并上传。

1. 将现有 RisuAI 项目的 `save` 文件夹压缩为 zip 文件。
2. 在 PocketRisu 中打开 设置 > 数据迁移 > "从 NodeOnly Risu 导入 save 文件夹" 折叠面板。
3. 通过 "从 save 文件夹导入(Zip 上传)" 上传 zip 文件。

> 如果 zip 文件过大,上传可能失败。这种情况请使用 [4. Save 文件夹直接复制](#4-save-文件夹直接复制)。


---

## 4. Save 文件夹直接复制

适合大规模数据(数 GB 以上)。需要服务器文件系统的直接访问权限。

1. 停止 PocketRisu 服务器。
2. 用现有 RisuAI 的 `save` 文件夹整体覆盖 PocketRisu 的 `save` 文件夹。
3. 重启 PocketRisu 服务器 — 自动迁移开始。
    - 可在终端或 PM2 日志中查看进度。
4. 迁移完成后,使用 设置 > 数据迁移 > "从 NodeOnly Risu 导入 save 文件夹" 折叠面板 > "清理已迁移的 save 文件" 移除原始文件并回收磁盘空间。


---

## 该选择哪种方式?

| 情况                                              | 推荐方式                        |
| ------------------------------------------------- | ------------------------------- |
| 从 Web RisuAI 迁移                                | 2. `.bin` 备份                  |
| 从 Web RisuAI 迁移,备份因加密被拒绝 | 1. 从 RisuAI 账号导入 |
| 从本地 RisuAI 迁移,数据小规模                     | 3. Zip 上传                     |
| 从本地 RisuAI 迁移,数据大规模(10GB+)            | 4. Save 文件夹直接复制          |
| 不确定                                            | 2. `.bin` 备份                  |


---

← [返回 README](../../i18n/README.cn.md)
