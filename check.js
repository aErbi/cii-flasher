// Pruefung eines hochgeladenen Firmware-Pakets (.ciifw) vor dem Flashen. Rein (kein DOM, kein
// Port), damit sie ohne Browser pruefbar bleibt. Das Paket ist Nutzereingabe: nichts darin wird geglaubt, was hier nicht
// gegen die feste Lage unten nachgerechnet wird. sha256 sichert nur die Unversehrtheit; die Herkunft sichert die
// ECDSA-P-256-Signatur (R10) ueber das Manifest im Paket, das wiederum Lage, Groesse und sha256 jedes Teils nennt.

// Partitionstabellen beider Images (Sender, Empfaenger), gleich den partitions.csv der Firmware. Ein Host-Check
// vergleicht diesen JSON-Block mit den CSV-Dateien: bei einer Aenderung beide anpassen.
export const LAYOUT = /*LAYOUT*/{
  "sender": {"project": "smw_sender", "table": [
    ["nvs", "data", "0x9000", "0x6000"],
    ["phy_init", "data", "0xf000", "0x1000"],
    ["factory", "app", "0x10000", "0x1f0000"]]},
  "receiver": {"project": "smw_receiver", "table": [
    ["nvs", "data", "0x9000", "0x6000"],
    ["phy_init", "data", "0xf000", "0x1000"],
    ["otadata", "data", "0x10000", "0x2000"],
    ["ota_0", "app", "0x20000", "0x300000"],
    ["ota_1", "app", "0x320000", "0x300000"],
    ["storage", "data", "0x620000", "0x200000"]]}
}/*END*/;

// Oeffentliche Schluessel, denen die Seite traut: {"id": erste 8 Byte von sha256(pub) als Hex, "pub": Base64 des
// unkomprimierten Punkts (65 Byte)}. Leer = noch kein Signierschluessel: unsignierte Pakete gehen nur nach Bestaetigung.
// Steht hier ein Schluessel, lehnt die Seite jedes unsignierte Release-Paket ab. Eintrag liefert make_web_flasher.
export const TRUSTED_KEYS = /*KEYS*/[{"id": "871755c436424248", "pub": "BD//otkR2yDyYCTIc5zhyR52P76qsObpmNk50dpZ+H053IMQvCEny8NmS6dN9xHIalSyNF5fz2P+QtM4Y0KsKGQ="}]/*END*/;

export const FORMAT_VERSION = 1;
const MANIFEST_SCHEMA = 1;
const MANIFEST_MAX = 2048;
export const NVS = [0x9000, 0xf000];  // halboffen; wird nie geschrieben und nie geloescht
const CHIP_ID_ESP32S3 = 9;
const APP_DESC_MAGIC = 0xabcd5432;
const RELEASE_MARK = "SMW-BUILD:release\0";
const DEV_MARK = "SMW-BUILD:dev\0";

export class PackageError extends Error {}
const fail = (msg) => { throw new PackageError(msg); };
const overlaps = (off, size, lo, hi) => off < hi && lo < off + size;
// Der Flasher loescht und schreibt je 4-KB-Sektor: jeder Teil belegt seine Groesse aufgerundet auf 4 KB.
const sectors = (n) => Math.ceil(n / 4096) * 4096;
const hex = (s) => parseInt(s, 16);
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const cstr = (d, o, n) => { let s = ""; for (let i = o; i < o + n && d[i]; i++) s += String.fromCharCode(d[i]); return s; };
const latin1 = (d) => { let s = ""; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); return s; };

// Erlaubter Bereich je Teil und verbotene Bereiche (jede Datenpartition ausser otadata), aus LAYOUT abgeleitet.
export function regions(role) {
  const t = LAYOUT[role].table.map(([name, type, off, size]) => ({ name, type, off: hex(off), size: hex(size) }));
  const app = t.filter((r) => r.type === "app").sort((a, b) => a.off - b.off)[0];
  const allowed = { "bootloader": [0x0, 0x8000], "partition-table": [0x8000, NVS[0]], "app": [app.off, app.off + app.size] };
  const ota = t.find((r) => r.name === "otadata");
  if (ota) allowed.otadata = [ota.off, ota.off + ota.size];
  const forbidden = t.filter((r) => r.type === "data" && r.name !== "otadata").map((r) => [r.off, r.off + r.size, r.name]);
  return { table: t, allowed, forbidden };
}

function keysOf(o, out = []) {
  if (Array.isArray(o)) o.forEach((v) => keysOf(v, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out.push(k); keysOf(v, out); }
  return out;
}

function b64(s) {
  let bin;
  try { bin = atob(s); } catch { fail("Das Paket ist beschädigt (Daten nicht lesbar)."); }
  const d = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  return d;
}

async function sha256(d) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", d));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

function checkImage(name, d) {
  if (d.length < 24 || d[0] !== 0xe9) fail(`Teil "${name}" ist kein ESP-Image.`);
  if (u16(d, 12) !== CHIP_ID_ESP32S3) fail(`Teil "${name}" ist nicht für den ESP32-S3 gebaut.`);
}

// Eintraege einer Partitionstabelle (0x8000): {name, type ("app"|"data"), subtype, off, size}.
export function parseTable(d) {
  const out = [];
  for (let i = 0; i + 32 <= d.length && d[i] === 0xaa && d[i + 1] === 0x50; i += 32) {
    out.push({ name: cstr(d, i + 12, 16), type: d[i + 2] === 0 ? "app" : "data", subtype: d[i + 3], off: u32(d, i + 4), size: u32(d, i + 8) });
  }
  return out;
}

export function sameTable(role, got) {
  const want = regions(role).table;
  return got.length === want.length && got.every((g, i) =>
    g.name === want[i].name && g.type === want[i].type && g.off === want[i].off && g.size === want[i].size);
}

function checkTable(role, d) {
  if (!sameTable(role, parseTable(d))) fail("Die Partitionstabelle im Paket passt nicht zu diesem Gerät. Nichts wurde geschrieben.");
}

const ROLE_ACC = { sender: "den Sender", receiver: "den Empfänger" };
const ROLE_NOM = { sender: "der Sender", receiver: "der Empfänger" };

const b64bytes = (s, what) => {
  if (typeof s !== "string") fail(`Das Paket ist beschädigt (${what}).`);
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { fail(`Das Paket ist beschädigt (${what}).`); }
};

// Signatur (r||s, 64 Byte) ueber die exakten Bytes des Manifests mit einem Schluessel aus keys. Liefert die Kennung.
async function checkSignature(pkg, keys) {
  const sig = pkg.signature;
  if (!sig || typeof sig !== "object" || sig.alg !== "ES256" || typeof sig.key !== "string") fail("Die Signatur des Pakets ist unlesbar.");
  const key = keys.find((k) => k && k.id === sig.key);
  if (!key) fail("Das Paket ist mit einem unbekannten Schlüssel signiert. Nichts wurde geschrieben.");
  const raw = b64bytes(sig.sig, "Signatur");
  const pub = b64bytes(key.pub, "Schlüssel");
  if (raw.length !== 64 || pub.length !== 65 || pub[0] !== 4) fail("Die Signatur des Pakets ist unlesbar.");
  let ok = false;
  try {
    const k = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, raw, new TextEncoder().encode(pkg.manifest));
  } catch { ok = false; }
  if (!ok) fail("Die Signatur des Pakets stimmt nicht. Das Paket wurde verändert oder stammt nicht vom Hersteller.");
  return sig.key;
}

// Das (signierte) Manifest muss genau die Teile des Pakets nennen, mit Lage, Groesse und sha256.
function checkManifest(pkg, lay) {
  if (typeof pkg.manifest !== "string" || pkg.manifest.length > MANIFEST_MAX || !/^[\x20-\x7e]*$/.test(pkg.manifest)) fail("Das Manifest des Pakets ist unlesbar.");
  let m;
  try { m = JSON.parse(pkg.manifest); } catch { fail("Das Manifest des Pakets ist unlesbar."); }
  if (!m || typeof m !== "object" || Array.isArray(m) || m.schema !== MANIFEST_SCHEMA) fail("Das Manifest hat ein anderes Format. Bitte die neueste Version dieser Seite verwenden.");
  if (m.project !== lay.project || m.chip !== "ESP32-S3") fail("Das Manifest passt nicht zu diesem Gerät.");
  if (m.build !== pkg.build) fail("Das Manifest widerspricht dem Paket (Bauart).");
  if (!Number.isInteger(m.version) || m.version < 1) fail("Das Manifest des Pakets ist unlesbar.");
  const want = {};
  for (const p of pkg.parts) {
    want[p.name + "_offset"] = p.offset; want[p.name + "_size"] = p.size; want[p.name + "_sha256"] = String(p.sha256).toLowerCase();
  }
  const got = Object.entries(m).filter(([k]) => /_(offset|size|sha256)$/.test(k));
  if (got.length !== Object.keys(want).length || got.some(([k, v]) => want[k] !== v)) fail("Das Manifest widerspricht den Teilen im Paket. Nichts wurde geschrieben.");
  return m;
}

// text: Inhalt der .ciifw-Datei; role: "sender" | "receiver" (Wahl des Nutzers); mode: "new" | "update";
// keys: vertraute Schluessel (Vorgabe TRUSTED_KEYS, die Tests geben eigene).
// Liefert { parts: [{name, address, data}], dev, version, appVersion, signed, keyId, seq } oder wirft PackageError
// (Text fuer den Nutzer). signed == false: die Seite verlangt eine Bestaetigung.
export async function validatePackage(text, role, mode, keys = TRUSTED_KEYS) {
  if (!LAYOUT[role]) fail("Unbekanntes Gerät.");
  if (mode !== "new" && mode !== "update") fail("Unbekannte Art der Installation.");
  let pkg;
  try { pkg = JSON.parse(text); } catch { fail("Diese Datei ist kein Firmware-Paket (.ciifw)."); }
  if (!pkg || typeof pkg !== "object" || pkg.format !== "ciifw") fail("Diese Datei ist kein Firmware-Paket (.ciifw).");
  if (pkg.format_version !== FORMAT_VERSION) fail("Dieses Paket hat ein anderes Format. Bitte die neueste Version dieser Seite verwenden.");
  if (pkg.chip !== "ESP32-S3") fail("Dieses Paket ist nicht für den ESP32-S3.");
  const lay = LAYOUT[role];
  if (pkg.role !== role || pkg.project !== lay.project) {
    fail(LAYOUT[pkg.role] ? `Dieses Paket ist für ${ROLE_ACC[pkg.role]}, ausgewählt ist aber ${ROLE_NOM[role]}.` : "Dieses Paket passt zu keinem Gerät.");
  }
  if (keysOf(pkg).some((k) => k.toLowerCase().includes("erase"))) fail("Das Paket verlangt ein Löschen. Das macht dieser Flasher nie.");
  if (!Array.isArray(pkg.parts)) fail("Das Paket ist beschädigt (keine Teile).");

  const { allowed, forbidden } = regions(role);
  const byName = new Map();
  for (const p of pkg.parts) {
    if (!p || !Object.hasOwn(allowed, p.name)) fail(`Das Paket enthält einen unbekannten Teil (${p && p.name}).`);
    if (byName.has(p.name)) fail(`Das Paket enthält "${p.name}" doppelt.`);
    const [lo, hi] = allowed[p.name];
    if (!Number.isInteger(p.offset) || !Number.isInteger(p.size) || p.size <= 0) fail("Das Paket ist beschädigt (Lage).");
    if (p.offset !== lo || p.offset + sectors(p.size) > hi) fail(`Teil "${p.name}" liegt außerhalb seines Bereichs.`);
    if (overlaps(p.offset, sectors(p.size), NVS[0], NVS[1])) fail(`Teil "${p.name}" würde die Einstellungen (NVS) überschreiben.`);
    for (const [flo, fhi, fname] of forbidden) {
      if (overlaps(p.offset, sectors(p.size), flo, fhi)) fail(`Teil "${p.name}" würde den Bereich "${fname}" überschreiben.`);
    }
    if (typeof p.data !== "string" || typeof p.sha256 !== "string") fail("Das Paket ist beschädigt (Daten).");
    const data = b64(p.data);
    if (data.length !== p.size) fail(`Teil "${p.name}" hat die falsche Größe.`);
    if ((await sha256(data)) !== p.sha256.toLowerCase()) fail(`Teil "${p.name}" ist beschädigt (Prüfsumme).`);
    byName.set(p.name, { name: p.name, address: p.offset, data });
  }

  const want = mode === "new" ? Object.keys(allowed) : ["app"];
  for (const n of want) if (!byName.has(n)) fail(`Im Paket fehlt der Teil "${n}".`);

  const app = byName.get("app").data;
  checkImage("app", app);
  if (!appInfo(app)) fail("Die App im Paket hat keinen App-Deskriptor.");
  const project = appInfo(app).project;
  if (project !== lay.project) fail(`Die App im Paket ist nicht die Firmware für ${ROLE_ACC[role]}.`);
  if (byName.has("bootloader")) checkImage("bootloader", byName.get("bootloader").data);
  if (byName.has("partition-table")) checkTable(role, byName.get("partition-table").data);

  const s = latin1(app);
  const release = s.includes(RELEASE_MARK) && !s.includes(DEV_MARK);
  if (pkg.build === "release" && !release) fail("Das Paket gibt sich als Release aus, enthält aber einen Entwicklerstand.");

  // Echtheit: erst die Signatur ueber die Manifest-Bytes, dann das Manifest gegen die (schon gehashten) Teile.
  let keyId = null, seq = null;
  if (pkg.signature !== null && pkg.signature !== undefined) {
    if (typeof pkg.manifest !== "string") fail("Das Manifest des Pakets ist unlesbar.");
    keyId = await checkSignature(pkg, Array.isArray(keys) ? keys : []);
    seq = checkManifest(pkg, lay).version;
  } else {
    if (release && Array.isArray(keys) && keys.length) fail("Dieses Release-Paket ist nicht signiert. Nichts wurde geschrieben.");
    if (pkg.manifest !== undefined) seq = checkManifest(pkg, lay).version;
  }

  return {
    parts: want.map((n) => byName.get(n)).sort((a, b) => a.address - b.address),
    dev: !release,
    version: String(pkg.version || "?"),
    appVersion: appInfo(app).version,
    signed: keyId !== null,
    keyId,
    seq,
  };
}

// ---- Was läuft auf dem angeschlossenen Gerät? (Im Auswahldialog des Browsers sehen beide Geräte gleich aus) ----

// Projektname und Version aus dem Kopf eines App-Images (ab Offset 0, mindestens 112 Bytes), sonst null.
export function appInfo(d) {
  if (!d || d.length < 112 || d[0] !== 0xe9 || u32(d, 32) !== APP_DESC_MAGIC) return null;
  return { project: cstr(d, 80, 32), version: cstr(d, 48, 32) };
}

function crc32(d) {  // wie esp_rom_crc32_le(UINT32_MAX, ...), also zlib.crc32(d, 0xffffffff)
  let c = 0;
  for (const b of d) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}

// Die App, die der Bootloader startet: mit gültigem otadata die OTA-Partition (seq - 1) % Anzahl, sonst factory, sonst
// ota_0 (wie ESP-IDF). otadata: zwei 4-KB-Sektoren mit {seq u32, label[20], state u32, crc u32}.
export function runningApp(table, otadata) {
  const apps = table.filter((e) => e.type === "app");
  const ota = apps.filter((e) => e.subtype >= 0x10 && e.subtype < 0x20).sort((a, b) => a.subtype - b.subtype);
  let seq = 0;
  if (otadata && ota.length) {
    for (const o of [0, 0x1000]) {
      if (otadata.length < o + 32) continue;
      const s = u32(otadata, o), st = u32(otadata, o + 24);
      if (s !== 0xffffffff && s > seq && st !== 3 && st !== 4 && crc32(otadata.subarray(o, o + 4)) === u32(otadata, o + 28)) seq = s;
    }
  }
  if (seq) return ota[(seq - 1) % ota.length];
  return apps.find((e) => e.subtype === 0) || ota[0] || null;
}

export const macSuffix = (mac) => String(mac).toLowerCase().replace(/[^0-9a-f]/g, "").slice(-6);
const PROJECT_ROLE = { smw_sender: "sender", smw_receiver: "receiver" };
export const ROLE_DE = { sender: "Sender", receiver: "Empfänger" };

// Entscheidung vor dem Schreiben. dev: {mac, project (oder null), table (parseTable), app (runningApp)}.
// Liefert {label, refuse} (refuse: Text, nichts schreiben) oder {label, confirm} (Text, nur nach Bestätigung) oder {label}.
export function deviceVerdict(role, mode, dev) {
  const suffix = macSuffix(dev.mac);
  const devRole = PROJECT_ROLE[dev.project];
  const label = `${devRole ? ROLE_DE[devRole] : "Gerät"} …${suffix}`;
  if (devRole && devRole !== role) {
    return { label, refuse: `Angeschlossen ist ${ROLE_NOM[devRole]} …${suffix}, die Firmware ist aber für ${ROLE_ACC[role]}. ` +
      `Bitte das richtige Gerät anschließen oder die passende Firmware wählen.` };
  }
  if (!devRole) {
    const found = dev.project ? `„${dev.project}“` : "keine erkennbare Firmware";
    if (mode !== "new") {
      return { label, refuse: `Auf dem Gerät …${suffix} läuft keine passende Firmware (gefunden: ${found}). ` +
        `Für ein solches Gerät bitte „Neu installieren“ wählen.` };
    }
    return { label, confirm: `Auf dem Gerät mit der MAC-Adresse ${dev.mac} läuft keine passende Firmware (gefunden: ${found}).\n\n` +
      `Soll dort die Firmware für ${ROLE_ACC[role]} neu installiert werden? Einstellungen (NVS) bleiben unberührt.` };
  }
  if (mode === "update") {
    const first = regions(role).table.filter((r) => r.type === "app").sort((a, b) => a.off - b.off)[0];
    if (!sameTable(role, dev.table) || !dev.app || dev.app.off !== first.off) {
      return { label, refuse: "Die Speicheraufteilung auf dem Gerät passt nicht zum Aktualisieren. Bitte „Neu installieren“ wählen, " +
        "Einstellungen und Kopplung bleiben dabei erhalten." };
    }
  }
  return { label };
}
