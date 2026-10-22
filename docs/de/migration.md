<p align="center">
  <a href="../en/migration.md">English</a> | <a href="../ko/migration.md">한국어</a> | <strong>Deutsch</strong> | <a href="../cn/migration.md">简体中文</a> | <a href="../es/migration.md">Español</a> | <a href="../vi/migration.md">Tiếng Việt</a> | <a href="../zh-Hant/migration.md">繁體中文</a>
</p>

# RisuAI-Migrationsleitfaden

> 🌐 Diese Anleitung wurde maschinell übersetzt. Für die genauesten Informationen siehe die [englische](../en/migration.md) oder [koreanische](../ko/migration.md) Version.

Es gibt vier Möglichkeiten, Daten von einer bestehenden RisuAI-Installation (Web-RisuAI, Lokales RisuAI) zu PocketRisu zu migrieren. Wählen Sie je nach Quellumgebung und Datenmenge.

- [1. Aus RisuAI-Konto importieren](#1-aus-risuai-konto-importieren) — Web-RisuAI mit Kontosynchronisierung. Der Server lädt die Kontodaten direkt herunter.
- [2. Lokale Backup-Datei (.bin)](#2-lokale-backup-datei-bin) — Funktioniert in allen Umgebungen. Die häufigste Methode.
- [3. Save-Ordner Zip-Upload](#3-save-ordner-zip-upload) — Lokales RisuAI, kleine Datenmengen.
- [4. Save-Ordner direkt kopieren](#4-save-ordner-direkt-kopieren) — Lokales RisuAI, große Datenmengen.


## Bevor Sie beginnen

> ⚠️ **Sichern Sie Ihre vorhandenen Daten** vor der Migration. Sie können eine `.bin`-Datei aus den Einstellungen > Backup von RisuAI exportieren.


---

## 1. Aus RisuAI-Konto importieren

Der PocketRisu-Server lädt die im Konto von Web-RisuAI (risuai.xyz) gespeicherten Daten direkt von RisuAI herunter. Übertragen werden die Charaktere, Chats, Einstellungen und Bilder des Kontos.

1. **In Web-RisuAI** (falls Sie die Kontosynchronisierung noch nicht nutzen): Melden Sie sich unter Einstellungen > Konto & Daten an und aktivieren Sie "Daten im Konto speichern". Wenn eine Auswahl erscheint, wählen Sie "Aktuelle Daten im Konto speichern" und geben Sie zur Bestätigung `RISUAI` ein. Ihre aktuellen Daten werden dann ins Konto hochgeladen.
2. **In PocketRisu**: Unter Einstellungen > Datenmigration > "Aus RisuAI-Konto importieren" den Nutzungsbedingungen von RisuAI zustimmen und anmelden.
3. Anzahl der Charaktere, Chats und Bilder sowie die geschätzte Dauer prüfen und auf "Import starten" klicken.
4. Bis zum Ende zeigt PocketRisu nur den Importbildschirm. Danach werden die Daten ersetzt und die Seite lädt automatisch neu.

> ⚠️ Der Import **ersetzt alle aktuellen Daten in PocketRisu durch die Kontodaten** (es wird nichts zusammengeführt). Sichern Sie vorher, was Sie behalten möchten.

- Um den RisuAI-Server nicht zu belasten, wird ein Element pro Sekunde heruntergeladen. Bei vielen Bildern kann das mehrere Stunden dauern.
- Wenn der Server neu startet oder die RisuAI-Anmeldung abläuft, wird nach erneuter Anmeldung nur der Rest heruntergeladen.
- In Chats eingefügte Bilder (Inlays) werden nur im Browser gespeichert und daher nicht importiert.
- Der Speicherplatz in einem RisuAI-Konto ist begrenzt.


---

## 2. Lokale Backup-Datei (.bin)

Exportieren Sie eine `.bin`-Backup-Datei aus dem bestehenden RisuAI und importieren Sie sie dann in PocketRisu. Funktioniert unabhängig von der Quellumgebung (Web / Tauri / Capacitor / lokal).

1. **Im bestehenden RisuAI**: Einstellungen > Backup > "Lokales Backup speichern", um eine `.bin`-Datei zu exportieren.
2. **In PocketRisu**: Einstellungen > Datenmigration > "Original Risu Local Backup importieren", um die `.bin`-Datei zu importieren.

> ⚠️ **Vorübergehendes Problem (Stand: Oktober 2026)**: In der aktuellen Version von Web-RisuAI (risuai.xyz) ist die Datenbank in einer mit "Lokales Backup speichern" erstellten Datei verschlüsselt, unabhängig davon, ob Sie in einem Konto angemeldet sind. PocketRisu lehnt eine solche Datei mit einem Hinweis auf ein verschlüsseltes Backup ab. (Backups aus der RisuAI-Desktop-App oder einem selbst gehosteten Node-Server sind nicht betroffen.) Eine Korrektur wurde bei RisuAI angefragt ([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681)). Bis dahin übertragen Sie Ihre Daten bitte über die Kontosynchronisierung von Web-RisuAI mit [1. Aus RisuAI-Konto importieren](#1-aus-risuai-konto-importieren).
>
> Wenn Sie in Web-RisuAI bereits die Kontosynchronisierung ("Daten im Konto speichern") genutzt haben, sind Ihre Backups unabhängig von diesem Problem verschlüsselt. Nutzen Sie auch dann Methode 1.



---

## 3. Save-Ordner Zip-Upload

Wenn Sie Lokales RisuAI (die Node-Server-Version) verwendet haben, können Sie Ihren `save`-Ordner zippen und hochladen.

1. Komprimieren Sie den `save`-Ordner Ihres bestehenden RisuAI-Projekts als Zip-Datei.
2. Öffnen Sie in PocketRisu Einstellungen > Datenmigration > "Save-Ordner von NodeOnly Risu importieren"-Akkordeon.
3. Laden Sie die Zip über "Aus Save-Ordner importieren (Zip-Upload)" hoch.

> Wenn die Zip-Datei zu groß ist, kann der Upload fehlschlagen. Verwenden Sie in diesem Fall [4. Save-Ordner direkt kopieren](#4-save-ordner-direkt-kopieren).


---

## 4. Save-Ordner direkt kopieren

Geeignet für große Datenmengen (mehrere GB oder mehr). Erfordert direkten Dateisystemzugriff auf den Server.

1. Stoppen Sie den PocketRisu-Server.
2. Überschreiben Sie den `save`-Ordner von PocketRisu mit dem `save`-Ordner des bestehenden RisuAI.
3. Starten Sie den PocketRisu-Server neu — die automatische Migration beginnt.
    - Überwachen Sie den Fortschritt im Terminal oder in den PM2-Logs.
4. Nach Abschluss der Migration verwenden Sie Einstellungen > Datenmigration > "Save-Ordner von NodeOnly Risu importieren"-Akkordeon > "Migrierte Save-Dateien aufräumen", um die Originaldateien zu entfernen und Speicherplatz freizugeben.


---

## Welche Methode soll ich wählen?

| Situation                                                  | Empfohlene Methode                |
| ---------------------------------------------------------- | --------------------------------- |
| Migration von Web-RisuAI                                   | 2. `.bin`-Backup                  |
| Migration von Web-RisuAI, Backup wird als verschlüsselt abgelehnt | 1. Aus RisuAI-Konto importieren |
| Migration von Lokalem RisuAI, kleine Datenmenge            | 3. Zip-Upload                     |
| Migration von Lokalem RisuAI, große Datenmenge (10GB+)     | 4. Save-Ordner direkt kopieren    |
| Unsicher                                                   | 2. `.bin`-Backup                  |


---

← [Zurück zur README](../../i18n/README.de.md)
