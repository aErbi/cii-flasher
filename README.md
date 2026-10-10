# CII Flasher

Installiert oder aktualisiert die Firmware von Sender und Empfänger direkt aus dem Browser, über ein USB-Kabel und
ohne Installation: https://aerbi.github.io/cii-flasher/

## Was die Seite macht

1. Du wählst das Gerät (Empfänger mit Display oder Sender ohne Display) und die Art: **Aktualisieren** schreibt nur das
   Programm, **Neu installieren** zusätzlich Bootloader, Partitionstabelle und beim Empfänger die Startauswahl.
2. Du lädst eine Firmware-Datei (`.ciifw`). Die Seite prüft sie vollständig im Browser: Format, Chip (ESP32-S3), Rolle,
   Lage jedes Teils gegen die feste Speicheraufteilung, Prüfsummen.
3. Nach dem Verbinden liest die Seite, welches Gerät angeschlossen ist und welche Firmware darauf läuft, und schreibt
   nur, wenn beides zur Datei passt. Danach startet sie das Gerät neu.

Nach dem Installieren eines Senders startet die Seite ihn neu, liest sein Setup-WLAN von der USB-Konsole und zeigt
WLAN-Name, Passwort (verdeckt, auf Knopfdruck sichtbar) und einen QR-Code. Mit **Etikett drucken** druckst du ein kleines
Etikett (50 × 30 mm) für den Sender. Für einen Sender, der schon läuft, gibt es den Knopf **WLAN-Daten des Senders
anzeigen**. Das Passwort bleibt in deinem Browser: kein Netz, kein Speicher, kein Protokoll; beim Schließen der Seite ist
es weg. Gilt am Sender ein eigenes Passwort, zeigt die Seite nur diesen Hinweis.

**Firmware-Dateien liegen nicht hier.** Die Seite enthält keine Firmware und lädt keine nach; die Pakete werden getrennt
bereitgestellt. Lade sie nur aus der Quelle, von der du dein Gerät hast: die Prüfsummen erkennen beschädigte
Dateien, aber keine gefälschten.

## Sicherheit

- Die Seite löscht nie etwas. Es gibt keinen Lösch-Befehl, geschrieben wird nur mit `eraseAll: false`.
- Der Bereich mit Einstellungen, Schlüsseln und Zählerständen (NVS) und der Datenspeicher des Empfängers werden nie
  beschrieben. Jede Datei wird beim Laden und noch einmal direkt vor dem Schreiben gegen diese Bereiche geprüft.
- WLAN, Passwörter, Kopplung und Zählerstände bleiben nach dem Aktualisieren erhalten.

## Voraussetzungen

| System | Browser | Hinweis |
|---|---|---|
| Windows 10 und 11 | Google Chrome, Chromium oder Microsoft Edge (ab 89) | kein Treiber nötig |
| macOS | Google Chrome, Chromium oder Microsoft Edge (ab 89) | kein Treiber nötig |
| Linux | Google Chrome, Chromium oder Microsoft Edge (ab 89) | Zugriff auf den USB-Anschluss nötig, siehe unten |

Firefox ab Version 151 funktioniert auch, die Auswahl des Geräts ist dort aber hakelig. Safari, ältere Firefox-Versionen
sowie Browser auf Tablets und Telefonen können keine Geräte über USB ansprechen (Web Serial fehlt).

Linux: Gruppe `dialout` (Debian, Ubuntu, Fedora) bzw. `uucp` (Arch), also `sudo usermod -aG dialout $USER` und neu
anmelden. Alternativ eine udev-Regel in `/etc/udev/rules.d/60-cii-flasher.rules`:

```
SUBSYSTEMS=="usb", ATTRS{idVendor}=="303a", MODE="0660", TAG+="uaccess"
```

danach `sudo udevadm control --reload` und das Gerät neu einstecken. Ein Browser aus einem Snap- oder Flatpak-Paket
braucht unter Umständen eine zusätzliche Freigabe für USB.

Lokal ausprobieren: Web Serial braucht https oder `http://localhost`, zum Beispiel `python3 -m http.server 8000` in
diesem Ordner, dann `http://localhost:8000/`.

## Lizenz

Apache-2.0, siehe `LICENSE` und `NOTICE`. Copyright 2026 Alexander Erber.

Enthält esptool-js 0.6.1 von Espressif (Apache-2.0, unverändert, mit pako 2.1.0 unter MIT und Zlib), siehe
`lib/esptool-js-0.6.1/LICENSE` und `lib/esptool-js-0.6.1/NOTICE`, und qrcode-generator 1.4.4 von Kazuhiko Arase
(MIT, unverändert), siehe `lib/qrcode-generator-1.4.4/`.

## English

CII Flasher installs or updates the firmware of the sender and the receiver from the browser over USB, with nothing to
install. You choose the device and the kind of installation (update writes the application only, new install also writes
bootloader, partition table and, on the receiver, otadata), then load a firmware package (`.ciifw`). The page validates
the package in the browser, identifies the connected device before writing and only writes if both match.

**Firmware packages are not hosted here**; they are provided separately. Checksums detect damaged files, not forged ones,
so only use packages from the source of your device.

After installing a sender, the page restarts it, reads its setup WiFi from the USB console and shows the network name,
the password (hidden until revealed) and a QR code, with a button to print a small 50 x 30 mm label. The password stays
in the browser: no network, no storage, no log.

Safety: the page never erases anything (no erase command, writes with `eraseAll: false`) and never writes the settings
area (NVS) or the receiver's data storage; WiFi, passwords, pairing and counters survive an update.

Browsers: Google Chrome, Chromium or Microsoft Edge (89 or later) on Windows, macOS or Linux; Firefox 151 or later works
too, but its port selection can be fiddly. Safari and mobile browsers lack Web Serial. On Linux your user needs access to
the USB serial device (group `dialout` or the udev rule above).

Licence: Apache-2.0, see `LICENSE` and `NOTICE`. Copyright 2026 Alexander Erber. Includes esptool-js 0.6.1 by Espressif
(Apache-2.0, bundling pako 2.1.0 under MIT and Zlib) and qrcode-generator 1.4.4 by Kazuhiko Arase (MIT).
