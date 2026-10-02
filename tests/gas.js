'use strict';
/* Nachbau der Apps-Script-Dienste, damit Code.gs unverändert unter Node
   läuft. Nachgebaut ist nur, was Code.gs aufruft.

   Das Blatt deutet Eingaben wie Sheets um — sonst könnten die Tests die
   Fehler nicht sehen, gegen die Code.gs sich schützt:
     - "'…"            Apostroph: Text, das Apostroph ist nicht Teil des Werts
     - "=…"            Formel, vorsichtshalber auch in Textzellen (@)
     - "+…" "-…" "@…"  Formel, ausser in Textzellen (@)
     - "0700", "12.5"  Zahl, ausser in Textzellen (@)
   Eine Formel liest sich wie in Sheets als Fehlerwert (#ERROR!) und
   wird in blatt.formeln gezählt. appendRow und setValues ohne Format
   schreiben in Zellen mit automatischem Format. */

const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const CODE = path.join(__dirname, '..', 'apps-script', 'Code.gs');

function eingabe(v, format) {
  if (typeof v !== 'string') return { wert: v };
  if (v.charAt(0) === "'") return { wert: v.slice(1) };
  if (v.charAt(0) === '=') return { formel: v };
  if (format === '@') return { wert: v };
  if (/^[+-]?\d+(\.\d+)?$/.test(v.trim())) return { wert: Number(v) };
  if (/^[+\-@]/.test(v)) return { formel: v };
  return { wert: v };
}

class Blatt {
  constructor(zeilen) {
    this.zeilen  = zeilen.map(z => z.slice());   // gelesene Werte
    this.formate = {};                           // "z:s" → "@"
    this.formeln = [];                           // geschriebene Formeln
  }
  breite() { return Math.max(0, ...this.zeilen.map(z => z.length)); }
  zelle(r, c) { const z = this.zeilen[r - 1]; return z && c <= z.length && z[c - 1] !== undefined ? z[c - 1] : ''; }
  schreiben(r, c, v) {
    while (this.zeilen.length < r) this.zeilen.push([]);
    const e = eingabe(v, this.formate[r + ':' + c]);
    if (e.formel !== undefined) this.formeln.push({ zeile: r, spalte: c, formel: e.formel });
    this.zeilen[r - 1][c - 1] = e.formel !== undefined ? '#ERROR!' : e.wert;
  }

  getDataRange() {
    // wie Sheets: rechteckig, kurze Zeilen mit '' aufgefüllt
    const b = this.breite();
    return { getValues: () => this.zeilen.map(z => Array.from({ length: b }, (_, i) => z[i] === undefined ? '' : z[i])) };
  }
  getLastRow() { return this.zeilen.length; }
  getLastColumn() { return this.breite(); }
  getRange(r, c, nr = 1, nc = 1) {
    const b = this;
    const bereich = {
      getValues() {
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => b.zelle(r + i, c + j)));
      },
      getValue() { return b.zelle(r, c); },
      getFormulas() {
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
          const f = b.formeln.filter(x => x.zeile === r + i && x.spalte === c + j).pop();
          return f ? f.formel : '';
        }));
      },
      setValues(werte) { werte.forEach((z, i) => z.forEach((x, j) => b.schreiben(r + i, c + j, x))); return bereich; },
      setValue(x) { b.schreiben(r, c, x); return bereich; },
      setNumberFormat(f) {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) b.formate[(r + i) + ':' + (c + j)] = f;
        return bereich;
      }
    };
    return bereich;
  }
  appendRow(z) { const r = this.zeilen.length + 1; z.forEach((x, j) => this.schreiben(r, j + 1, x)); return this; }
  deleteRow(r) { this.zeilen.splice(r - 1, 1); }
}

/* Drive: Dateien und Ordner in Maps, IDs im Drive-Format (33 Zeichen) */
function neueId() { return '1' + crypto.randomBytes(24).toString('base64url').slice(0, 32); }

function drive() {
  const dateien = new Map(), ordner = new Map();
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

  function neuerOrdner(id, name, eltern) {
    const o = {
      getId: () => id, getName: () => name,
      getParents: () => iter(eltern ? [eltern] : []),
      getFoldersByName: n => iter([...ordner.values()].filter(x => x._eltern === o && x.getName() === n)),
      createFolder: n => neuerOrdner(neueId(), n, o),
      createFile: blob => {
        const fid = neueId();
        const d = {
          getId: () => fid, getName: () => blob.getName(), getMimeType: () => blob.getContentType(),
          getUrl: () => 'https://drive.google.com/file/d/' + fid + '/view?usp=drivesdk',
          getParents: () => iter([o]),
          getBlob: () => blob,
          setSharing() {}
        };
        dateien.set(fid, d);
        return d;
      },
      _eltern: eltern
    };
    ordner.set(id, o);
    return o;
  }

  return {
    dateien, ordner,
    wurzel: id => neuerOrdner(id, 'Belegfotos', null),
    dienst: {
      getFileById: id => { if (!dateien.has(id)) throw new Error('nicht gefunden'); return dateien.get(id); },
      getFolderById: id => { if (!ordner.has(id)) throw new Error('nicht gefunden'); return ordner.get(id); },
      Access: { ANYONE_WITH_LINK: 'a' }, Permission: { VIEW: 'v' }
    }
  };
}

const bytes = x => [...(Buffer.isBuffer(x) ? x : Buffer.from(Array.isArray(x) ? x.map(b => b & 255) : String(x), 'utf8'))];

function blob(daten, typ, name) {
  const b = Buffer.from(daten.map(x => x & 255));
  return { getBytes: () => [...b], getContentType: () => typ, getName: () => name };
}

function formatDate(datum, zone, muster) {
  const t = new Intl.DateTimeFormat('de-CH', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(datum).reduce((o, p) => (o[p.type] = p.value, o), {});
  return muster.replace('yyyy', t.year).replace('MM', t.month).replace('dd', t.day)
               .replace('HH', t.hour).replace('mm', t.minute);
}

/**
 * Lädt Code.gs mit den gegebenen Blättern.
 * optionen.uuid: eigene Funktion für Utilities.getUuid (für feste Salts)
 * Rückgabe: gs (Funktionen aus Code.gs), konst(name) (Konstanten aus
 * Code.gs), blatt(name), drive, mails, props, zaehler.
 */
function laden(blaetter, optionen = {}) {
  const sheets = {};
  for (const [name, zeilen] of Object.entries(blaetter)) sheets[name] = new Blatt(zeilen);

  const props = {}, cache = {}, mails = [], konsole = [];
  const zaehler = { openById: 0, sperren: 0, digest: 0 };
  const dr = drive();

  const ctx = {
    console: {   // Code.gs protokolliert Fehler; im Test mitschreiben statt ausgeben
      log:   (...a) => konsole.push(a.join(' ')),
      warn:  (...a) => konsole.push(a.join(' ')),
      error: (...a) => konsole.push(a.join(' '))
    },
    SpreadsheetApp: { openById: () => {
      zaehler.openById++;
      return {
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = new Blatt([])),
        deleteSheet: sh => { for (const n in sheets) if (sheets[n] === sh) delete sheets[n]; }
      };
    } },
    ContentService: {
      createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }),
      MimeType: { JSON: 'json', CSV: 'csv', TEXT: 'text' }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({
      get: k => cache[k] || null, put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { zaehler.sperren++; }, releaseLock() {} }) },
    Logger: { log: m => (ctx.__log = (ctx.__log || []).concat(String(m))) },
    MailApp: { sendEmail: m => mails.push(m) },
    DriveApp: dr.dienst,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: optionen.uuid || (() => crypto.randomUUID()),
      computeDigest: (alg, s) => { zaehler.digest++; return [...crypto.createHash('sha256').update(String(s), 'utf8').digest()]; },
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', String(k)).update(String(v)).digest()],
      base64Encode: x => Buffer.from(bytes(x)).toString('base64'),
      base64EncodeWebSafe: x => Buffer.from(bytes(x)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => [...Buffer.from(String(s), 'base64')],
      newBlob: (daten, typ, name) => blob(daten, typ, name),
      formatDate,
      sleep() {}
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CODE, 'utf8'), ctx, { filename: 'Code.gs' });

  const konst = name => vm.runInContext(name, ctx);       // Konstante aus Code.gs lesen
  const ausfuehren = code => vm.runInContext(code, ctx);  // z. B. Math.random ersetzen
  dr.wurzel(konst('BILD_ORDNER'));   // Wurzelordner wie in Code.gs eingestellt

  return { gs: ctx, konst, ausfuehren, blatt: n => sheets[n], loeschen: n => { delete sheets[n]; },
           drive: dr, mails, props, cache, zaehler, konsole, log: () => ctx.__log || [] };
}

/** JSON aus einer ContentService-Antwort */
const json = antwort => JSON.parse(antwort.getContent());

module.exports = { laden, json, eingabe };
