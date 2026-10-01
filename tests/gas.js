'use strict';
/* Minimaler Nachbau der Apps-Script-Dienste, damit Code.gs unverändert
   unter Node läuft. Nachgebaut ist nur, was Code.gs tatsächlich aufruft.
   Blätter sind Arrays von Zeilen; Zeile 1 ist die Kopfzeile wie in Sheets. */

const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const CODE = path.join(__dirname, '..', 'apps-script', 'Code.gs');

class Blatt {
  constructor(zeilen) { this.zeilen = zeilen.map(z => z.slice()); this.formate = {}; }
  getDataRange() { return { getValues: () => this.zeilen.map(z => z.slice()) }; }
  getLastRow() { return this.zeilen.length; }
  getLastColumn() { return Math.max(0, ...this.zeilen.map(z => z.length)); }
  getRange(r, c, nr = 1, nc = 1) {
    const b = this;
    const bereich = {
      getValues() {
        const o = [];
        for (let i = 0; i < nr; i++) {
          const z = [];
          for (let j = 0; j < nc; j++) z.push((b.zeilen[r - 1 + i] || [])[c - 1 + j] ?? '');
          o.push(z);
        }
        return o;
      },
      getValue() { return bereich.getValues()[0][0]; },
      setValues(werte) {
        werte.forEach((z, i) => z.forEach((x, j) => {
          while (b.zeilen.length < r + i) b.zeilen.push([]);
          b.zeilen[r - 1 + i][c - 1 + j] = x;
        }));
        return bereich;
      },
      setValue(x) { return bereich.setValues([[x]]); },
      setNumberFormat(f) { b.formate[r + ':' + c] = f; return bereich; }
    };
    return bereich;
  }
  appendRow(z) { this.zeilen.push(z.slice()); return this; }
  deleteRow(r) { this.zeilen.splice(r - 1, 1); }
}

/* Drive: Dateien und Ordner in Maps, IDs im Drive-Format (33 Zeichen) */
function neueId() { return '1' + crypto.randomBytes(24).toString('base64url').slice(0, 32); }

function drive(wurzelId) {
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
  neuerOrdner(wurzelId, 'Belegfotos', null);

  return {
    dateien, ordner,
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
 * Rückgabe: gs (alle Funktionen aus Code.gs), blatt(name), drive, mails, props.
 */
function laden(blaetter) {
  const sheets = {};
  for (const [name, zeilen] of Object.entries(blaetter)) sheets[name] = new Blatt(zeilen);

  const props = {}, cache = {}, mails = [];
  const dr = drive('1F7Y7DKMu9s5JEL67w5Ywy7p88vpMRTCM');   // BILD_ORDNER aus Code.gs

  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null }) },
    ContentService: {
      createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }),
      MimeType: { JSON: 'json', CSV: 'csv', TEXT: 'text' }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    MailApp: { sendEmail: m => mails.push(m) },
    DriveApp: dr.dienst,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s), 'utf8').digest()],
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

  return { gs: ctx, blatt: n => sheets[n], drive: dr, mails, props };
}

/** JSON aus einer ContentService-Antwort */
const json = antwort => JSON.parse(antwort.getContent());

module.exports = { laden, json };
