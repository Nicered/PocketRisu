<p align="center">
  <a href="../en/termux.md">English</a> | <a href="../ko/termux.md">한국어</a> | <strong>Deutsch</strong> | <a href="../cn/termux.md">简体中文</a> | <a href="../es/termux.md">Español</a> | <a href="../vi/termux.md">Tiếng Việt</a> | <a href="../zh-Hant/termux.md">繁體中文</a>
</p>

# Termux-Installationsanleitung

> 🌐 Diese Anleitung wurde maschinell übersetzt. Für die genauesten Informationen siehe die [englische](../en/termux.md) oder [koreanische](../ko/termux.md) Version.

Diese Anleitung erklärt, wie PocketRisu direkt auf einem Android-Telefon über Termux gebaut und ausgeführt wird. Das vorgesehene Nutzungsmuster ist das Öffnen von `http://localhost:6001` im Browser desselben Telefons.

- [1. Voraussetzungen](#1-voraussetzungen) — Termux und Systemanforderungen
- [2. Installation und Build](#2-installation-und-build) — Einrichtung mit einem einzigen Befehl
- [3. Ausführen und Verbinden](#3-ausführen-und-verbinden) — vom Browser des Telefons öffnen
- [4. Laufen lassen](#4-laufen-lassen) — auch bei ausgeschaltetem Bildschirm
- [5. Aktualisieren](#5-aktualisieren) — neueste Version holen
- [6. Einschränkungen](#6-einschränkungen) — Funktionen, die auf Termux nicht funktionieren


## Systemanforderungen

| Element            | Minimum         | Empfohlen                       |
| ------------------ | --------------- | ------------------------------- |
| **Android**        | 7.0 (API 24)    | 10 oder neuer                   |
| **CPU**            | ARM64           | ARM64                           |
| **RAM**            | 2 GB            | 4 GB oder mehr                  |
| **Freier Speicher** | 2 GB            | 4 GB oder mehr (mit Build)      |

PocketRisu liefert keine vorkompilierten Binärdateien für Termux, daher baut das Telefon alles selbst. Einschließlich nativer Module wie `better-sqlite3` dauert der Build etwa **10 bis 40 Minuten**, je nach Telefonleistung.


---

## 1. Voraussetzungen

### Termux installieren

Installieren Sie Termux von einer dieser Quellen:

- **F-Droid (empfohlen)**: https://f-droid.org/packages/com.termux/
- **GitHub Releases**: https://github.com/termux/termux-app/releases
- **Google Play**: https://play.google.com/store/apps/details?id=com.termux&hl=de&pli=1


---

## 2. Installation und Build

Öffnen Sie Termux und führen Sie diesen einzelnen Befehl aus:

```bash
pkg install -y git && \
  git clone https://github.com/PocketRisu/PocketRisu.git && \
  cd PocketRisu && \
  bash scripts/termux/build.sh
```

Der Befehl kümmert sich um:

1. Installation von `git`
2. Klonen des PocketRisu-Repositorys
3. Installation der Build-Abhängigkeiten (`nodejs-lts`, `python`, `make`, `clang`, `pnpm` usw.)
4. `pnpm install` — JavaScript-Abhängigkeiten und Kompilierung nativer Module
5. `pnpm build` — Frontend-Bundling

Wenn der Build abgeschlossen ist, sehen Sie:

```
Build OK. Start the server with:
  node server/node/server.cjs

Then open this address in the phone's own browser:
  http://localhost:6001
```


---

## 3. Ausführen und Verbinden

Starten Sie den Server aus demselben Verzeichnis:

```bash
node server/node/server.cjs
```

Sobald das Server-Boot-Protokoll erscheint, öffnen Sie den Browser des Telefons (Chrome, Firefox usw.) und navigieren Sie zu:

```
http://localhost:6001
```

Die PocketRisu-Benutzeroberfläche sollte geladen werden. `localhost` wird vom Browser automatisch als sicherer Kontext behandelt, sodass Zwischenablage, `crypto.subtle` und andere APIs, die einen sicheren Kontext erfordern, normal funktionieren.

Server stoppen mit `Strg + C`.


---

## 4. Laufen lassen

Um den Server am Leben zu halten, wenn der Bildschirm ausgeschaltet wird oder Sie zu anderen Apps wechseln, aktivieren Sie den Wake-Lock von Termux:

```bash
termux-wake-lock
```

Die Termux-Benachrichtigung zeigt den Wake-Lock-Indikator, und der Server läuft auch bei ausgeschaltetem Bildschirm weiter.

Freigeben mit: `termux-wake-unlock`

> Android kann Termux unter Speicherdruck dennoch beenden. Für langfristige Nutzung schließen Sie Termux aus den Batterieoptimierungseinstellungen Ihres Telefons aus.


---

## 5. Aktualisieren

Beenden Sie den laufenden Server mit `Ctrl + C` und führen Sie dann Folgendes aus:

```bash
cd ~/PocketRisu && \
  git pull --ff-only && \
  GYP_DEFINES="android_ndk_path=''" pnpm install --frozen-lockfile && \
  NODE_OPTIONS="--max-old-space-size=2048" pnpm build
```

Jeder Schritt wird nur ausgeführt, wenn der vorherige erfolgreich war. Bei einem Fehler bricht der Befehl an dieser Stelle ab, statt die alte Version ohne aktualisierten Quellcode erneut zu bauen. Starten Sie den Server nach Abschluss des Builds wieder mit `node server/node/server.cjs`.

- `pnpm install` übernimmt geänderte Abhängigkeiten der neuen Version. Führen Sie es bei jedem Update aus; ohne Änderungen ist es sofort fertig.
- `GYP_DEFINES` ist dieselbe Termux-Einstellung, die das Build-Skript verwendet. Sie wird benötigt, wenn native Module wie `better-sqlite3` neu kompiliert werden.

### Wenn `git pull` fehlschlägt

Bricht `git pull` mit `Your local changes to the following files would be overwritten by merge` oder `Not possible to fast-forward` ab, setzen Sie den Quellcode mit folgendem Befehl auf die neueste Version zurück und führen Sie den obigen Update-Befehl erneut aus:

```bash
cd ~/PocketRisu && git fetch origin && git reset --hard origin/main
```

Die Ordner `save/` und `backups/` werden nicht von git verwaltet, daher bleiben Chats, Charaktere und Einstellungen erhalten. Eigene Änderungen an Quelldateien (z. B. ein geänderter Port oder mit `pnpm add` geänderte Abhängigkeiten) gehen dabei verloren.


---

## 6. Einschränkungen

**Quick Tunnel (Cloudflare Auto-Tunnel) funktioniert nicht auf Termux.** Das `cloudflared`-Binary ist nicht mit der DNS- und TLS-Umgebung von Termux kompatibel.

PocketRisu erkennt die Termux-Umgebung automatisch und zeigt eine Warnung im Menü Fernzugriff an, wobei die Start-Schaltfläche ausgeblendet wird.


---

← [Zurück zur README](../../i18n/README.de.md)
