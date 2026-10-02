/**
 * Spesenerfassung — Backend
 * Google Apps Script, gebunden an die Tabelle.
 *
 * Bereitstellen als Web-App:
 *   Ausführen als: Ich
 *   Zugriff:       Jeder
 *
 * Nach JEDER Codeänderung:
 *   Bereitstellungen verwalten → Bearbeiten → Neue Version
 */

// ============================================================
//  Konfiguration
// ============================================================

const SHEET_ID   = '1rDi4UQDGc_H1fADmFETAEi1Ef5WN9vboF5Av1W1Phmk';                 // Teil der URL zwischen /d/ und /edit
const TOKEN_READ = 'HIER_LANGER_ZUFALLSSTRING';        // nur für den CSV-Endpunkt (Excel)
const PWA_URL    = 'https://dusanmiladinovicvnm.github.io/Spesen/';        // Zugangsmail, Foto-Links

const BILD_ORDNER      = '1F7Y7DKMu9s5JEL67w5Ywy7p88vpMRTCM';      // Wurzelordner für Belegfotos
const BILD_MONATSORDNER = true;   // Unterordner je Periode, z.B. 2026-07
const BILD_OEFFENTLICH  = false;  // true = Link ohne Google-Anmeldung sichtbar

/* Spalten des CSV-Exports für Excel — Reihenfolge ist verbindlich.
   Die ersten sechs entsprechen dem Bereich Datum:Bemerkung in der Vorlage.
   Neue Spalten im Blatt "Belege" ändern hier nichts: was Excel bekommt,
   steht ausschliesslich in dieser Liste. */
const EXPORT_SPALTEN = [
  'Datum', 'Brutto', 'MwstSatz', 'KontoNr', 'KstNr', 'Bemerkung',
  'Mitarbeiter', 'Monat', 'Jahr', 'Art', 'KM', 'BildUrl', 'BildLink'
];
// BildLink steht nicht im Blatt, sondern wird beim Export aus BildUrl
// berechnet: ein signierter Link, der genau dieses eine Foto öffnet.

/* Ob ein Zugangsmail verschickt wird, entscheidet der Admin je Benutzer
   im Admin-Bereich. Die fertige Nachricht wird ihm dort ohnehin immer
   angezeigt — für WhatsApp, SMS oder ein anderes Postfach.
   Dieser Wert gilt nur als Vorgabe für zugangVerschicken() im Editor. */
const MAIL_STANDARD = true;

/* true  = Passwort steht im Zugangsmail
   false = Mail enthält nur den Link, das Passwort geht über einen
           anderen Kanal. Sicherer, weil nichts im Postfach liegen bleibt. */
const PASSWORT_PER_MAIL = true;

// Absenderangaben im Zugangsmail
const ABSENDER     = 'Dusan Miladinovic';
const ANTWORT_MAIL = 'dmi@yepp.ch';
const KONTAKT_TEL  = '+41 44 542 42 12';

const SESSION_TAGE = 60;
const SPERRE_MIN   = 15;
const MAX_FEHLER   = 5;

// Spaltenreihenfolge in "Belege" — muss mit der Tabelle übereinstimmen
// A Zeitstempel | B Mitarbeiter | C Email | D BelegNr | E Datum | F Monat |
// G Jahr | H Brutto | I MwstSatz | J MwstBetrag | K Netto | L KontoNr |
// M KontoBez | N KstNr | O KstBez | P Bemerkung | Q DedupKey | R Storniert |
// S Art | T KM | U KmSatz | V BildUrl


// ============================================================
//  Hilfsfunktionen
// ============================================================

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

let tabelle = null;   // je Ausführung nur einmal öffnen

function sheet(name) {
  if (!tabelle) tabelle = SpreadsheetApp.openById(SHEET_ID);
  return tabelle.getSheetByName(name);
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function dedupKey(email, datum, brutto, belegNr, suffix) {
  const base = [
    String(email).trim().toLowerCase(),
    String(datum),
    Math.round(Number(brutto) * 100),
    String(belegNr || '').toLowerCase().replace(/\s+/g, '')
  ].join('|');
  return Number(suffix) > 0 ? base + '|' + Number(suffix) : base;
}

function hashPass(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 5000; i++) {
    h = Utilities.base64Encode(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

// ------------------------------------------------------------
//  Schreiben in Sheets
//  Jeder Text geht über textSetzen() oder zeileSchreiben(). Sonst
//  deutet Sheets Eingaben um: "=…", "+…", "-…", "@…" wird zur Formel
//  (eine Formel in "Belege" könnte andere Blätter bis zu den
//  Passwort-Hashes auslesen, ein Hash mit "+" vorne wäre unbrauchbar),
//  "0700" wird zur Zahl 700. Textzellen bekommen deshalb das Format
//  "Nur Text" (@); ein führendes "=" zusätzlich ein Apostroph.
//  sheetsSelbsttest() prüft das einmal im echten Sheets.
// ------------------------------------------------------------

/** Wert für eine Textzelle. */
function textWert(v) {
  const s = String(v == null ? '' : v);
  return s.charAt(0) === '=' ? "'" + s : s;
}

/** Eine Zelle als Text setzen. */
function textSetzen(sh, zeile, spalte, wert) {
  sh.getRange(zeile, spalte).setNumberFormat('@').setValue(textWert(wert));
}

/** Schreibt werte ab Spalte 1 in die Zeile. textSpalten: 1-basierte
 *  Spaltennummern, die Text enthalten — sie bekommen zuerst das Format,
 *  damit Sheets beim Schreiben nichts umdeutet. */
function zeileSchreiben(sh, zeile, werte, textSpalten) {
  const text = new Set(textSpalten);
  // zusammenhängende Spalten in einem Aufruf formatieren
  textSpalten.slice().sort((a, b) => a - b).forEach((c, i, a) => {
    if (i > 0 && a[i - 1] === c - 1) return;
    let ende = c;
    while (text.has(ende + 1)) ende++;
    sh.getRange(zeile, c, 1, ende - c + 1).setNumberFormat('@');
  });
  sh.getRange(zeile, 1, 1, werte.length)
    .setValues([werte.map((v, i) => text.has(i + 1) ? textWert(v) : v)]);
}

/** Textspalten in "Belege", nach Namen — Datum ist yyyy-mm-dd als Text */
const BELEGE_TEXT = ['Mitarbeiter', 'Email', 'BelegNr', 'Datum', 'KontoNr', 'KontoBez',
  'KstNr', 'KstBez', 'Bemerkung', 'DedupKey', 'Art', 'BildUrl'];

function belegeTextSpalten(head) {
  return BELEGE_TEXT.map(n => head.indexOf(n) + 1).filter(c => c > 0);
}

/** Im Editor einmal ausführen: prüft, wie das echte Sheets die
 *  Schreibhilfen umsetzt. Legt ein Hilfsblatt an und löscht es wieder.
 *  Erwartet wird im Log überall "ok". */
function sheetsSelbsttest() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.insertSheet('Selbsttest ' + Utilities.getUuid().slice(0, 8));
  try {
    const faelle = ['=1+1', '+41 44', '-Taxi', '@x', '0700', '+Kq9/abc=', 'Hotel Bern'];
    faelle.forEach((f, i) => textSetzen(sh, i + 1, 1, f));
    const werte  = sh.getRange(1, 1, faelle.length, 1).getValues();
    const formel = sh.getRange(1, 1, faelle.length, 1).getFormulas();
    faelle.forEach((f, i) => {
      const ok = werte[i][0] === f && !formel[i][0];
      Logger.log((ok ? 'ok     ' : 'FEHLER ') + JSON.stringify(f) + ' → ' +
                 JSON.stringify(werte[i][0]) + (formel[i][0] ? ' (Formel!)' : ''));
    });
  } finally {
    ss.deleteSheet(sh);
  }
}

/** Zeilennummer eines eigenen, nicht stornierten Belegs, oder 0.
 *  Gesucht wird über den DedupKey. Stimmt die mitgeschickte Zeile noch
 *  (gleicher Schlüssel), gilt genau sie — so trifft es auch bei zwei
 *  Zeilen mit demselben Schlüssel die angetippte. Ohne Schlüssel gilt
 *  die Zeilennummer nur für Zeilen, die selbst keinen haben.
 *  Gelesen werden nur die drei nötigen Spalten, nicht das ganze Blatt. */
function belegZeile(sh, u, key, zeile) {
  const letzte = sh.getLastRow();
  if (letzte < 2) return 0;
  const head   = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const spalte = n => {
    const i = head.indexOf(n);
    return i < 0 ? null : sh.getRange(2, i + 1, letzte - 1, 1).getValues().map(z => z[0]);
  };
  const eml = spalte('Email'), sto = spalte('Storniert'), keys = spalte('DedupKey') || [];
  if (!eml || !sto) return 0;

  const ich   = String(u.email).trim().toLowerCase();
  const eigen = i => i >= 0 && i < eml.length &&
    String(eml[i]).trim().toLowerCase() === ich && String(sto[i]).toLowerCase() !== 'true';
  const k = i => String(keys[i] == null ? '' : keys[i]).trim();

  key = String(key || '').trim();
  const hinweis = Number(zeile) - 2;          // Index in den Spalten, NaN ohne Zeile
  if (key) {
    if (eigen(hinweis) && k(hinweis) === key) return hinweis + 2;
    for (let i = 0; i < eml.length; i++) if (k(i) === key && eigen(i)) return i + 2;
    return 0;
  }
  return eigen(hinweis) && k(hinweis) === '' ? hinweis + 2 : 0;
}

/** Zaglavlja iz tabele stižu ponekad sa razmakom na kraju.
 *  Bez trimovanja indexOf vrati -1 i poređenja tiho promaše. */
function kopf(rows) {
  return rows[0].map(h => String(h).trim());
}

/** Normalisiert die Datumsspalte auf yyyy-mm-dd.
 *  Ist die Zelle als Text formatiert, kommt der Wert bereits so an.
 *  Ist sie ein echtes Datum, liefert Sheets ein Date-Objekt in UTC —
 *  ohne Umrechnung nach Europe/Zurich verschiebt sich der Tag. */
function alsDatum(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Europe/Zurich', 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}

function zufallPasswort() {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += c.charAt(Math.floor(Math.random() * c.length));
  }
  return s;
}


/** Wert aus dem Blatt "Parameter". Bei mehreren Zeilen mit demselben
 *  Schlüssel gewinnt die jüngste, deren GueltigAb <= datum ist.
 *  GueltigAb muss als Text yyyy-mm-dd gespeichert sein. */
function parameter(schluessel, datum) {
  const rows = sheet('Parameter').getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iS = head.indexOf('Schluessel');
  const iW = head.indexOf('Wert');
  const iA = head.indexOf('GueltigAb');
  if (iS < 0 || iW < 0) return null;

  let wert = null, bestAb = '';
  rows.forEach(r => {
    if (String(r[iS]).trim() !== schluessel) return;
    const ab = iA >= 0 ? String(r[iA] || '').trim() : '';
    if (ab && datum && ab > String(datum)) return;
    if (wert === null || ab >= bestAb) { wert = r[iW]; bestAb = ab; }
  });
  return wert;
}

/** Alle KmSätze für die Vorschau im Client. */
function kmSaetze() {
  const rows = sheet('Parameter').getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iS = head.indexOf('Schluessel');
  const iW = head.indexOf('Wert');
  const iA = head.indexOf('GueltigAb');
  return rows
    .filter(r => String(r[iS]).trim() === 'KmSatz')
    .map(r => ({ ab: iA >= 0 ? String(r[iA] || '').trim() : '',
                 satz: Number(r[iW]) }))
    .sort((a, b) => a.ab < b.ab ? -1 : 1);
}


/** Unterordner holen oder anlegen. */
function unterOrdner(eltern, name) {
  const it = eltern.getFoldersByName(name);
  return it.hasNext() ? it.next() : eltern.createFolder(name);
}

/** Persönlicher Ordner des Mitarbeitenden.
 *  Die Verknüpfung läuft über die Ordner-ID in der Spalte OrdnerId,
 *  nicht über den Namen — zwei Personen dürfen gleich heissen.
 *  Der Ordnername ist reine Kosmetik und darf in Drive umbenannt werden. */
function benutzerOrdner(u) {
  const sh   = sheet('Benutzer');
  const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const iOrd = head.indexOf('OrdnerId');
  if (iOrd < 0) throw new Error('Spalte OrdnerId fehlt im Blatt Benutzer');

  const z  = benutzerZeile(u.email);
  const id = String(z.d[iOrd] || '').trim();

  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { /* Ordner gelöscht — unten neu anlegen */ }
  }

  const ordner = DriveApp.getFolderById(BILD_ORDNER).createFolder(u.name || u.email);
  textSetzen(sh, z.zeile, iOrd + 1, ordner.getId());
  return ordner;
}

/** Zielordner inklusive Monatsunterordner. */
function zielOrdner(u, datum) {
  const persoenlich = benutzerOrdner(u);
  if (!BILD_MONATSORDNER) return persoenlich;
  return unterOrdner(persoenlich, String(datum).slice(0, 7));   // 2026-07
}

/** Speichert ein Foto und gibt die Ansichts-URL zurück.
 *  Erwartet einen data:-URL wie ihn canvas.toDataURL() liefert.
 *  Der Client verkleinert das Bild vorher — hier kommen ~200 KB an. */
function bildSpeichern(dataUrl, u, datum, betrag, belegNr) {
  if (!dataUrl || String(dataUrl).indexOf('base64,') < 0) return '';
  if (!BILD_ORDNER || BILD_ORDNER.indexOf('HIER_') === 0) {
    throw new Error('BILD_ORDNER ist nicht gesetzt');
  }

  const nr   = String(belegNr || '').replace(/[^A-Za-z0-9]+/g, '');
  const name = [String(datum), Number(betrag).toFixed(2), nr]
                 .filter(Boolean).join('_') + '.jpg';

  const roh   = String(dataUrl).split('base64,')[1];
  const blob  = Utilities.newBlob(Utilities.base64Decode(roh), 'image/jpeg', name);
  const datei = zielOrdner(u, datum).createFile(blob);

  if (BILD_OEFFENTLICH) {
    datei.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return datei.getUrl();
}


// ============================================================
//  Benutzer und Sitzungen
// ============================================================

function benutzerZeile(email) {
  const rows = sheet('Benutzer').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() ===
        String(email).trim().toLowerCase()) {
      return { zeile: i + 1, d: rows[i] };
    }
  }
  return null;
}

function login(b) {
  const u = benutzerZeile(b.email);
  if (!u) return out({ ok: false, error: 'login' });

  const sh = sheet('Benutzer');
  const email       = u.d[0];
  const name        = u.d[1];
  const hash        = u.d[2];
  const salt        = u.d[3];
  const aktiv       = u.d[4];
  const fehler      = u.d[5];
  const gesperrtBis = u.d[6];

  if (String(aktiv).toLowerCase() !== 'true') {
    return out({ ok: false, error: 'inaktiv' });
  }
  if (gesperrtBis && new Date(gesperrtBis) > new Date()) {
    return out({ ok: false, error: 'gesperrt' });
  }
  if (!hash) {
    return out({ ok: false, error: 'login' });
  }

  if (hashPass(b.passwort, salt) !== hash) {
    const n = Number(fehler || 0) + 1;
    if (n >= MAX_FEHLER) {
      sh.getRange(u.zeile, 6).setValue(0);
      sh.getRange(u.zeile, 7).setValue(new Date(Date.now() + SPERRE_MIN * 60000));
    } else {
      sh.getRange(u.zeile, 6).setValue(n);
    }
    return out({ ok: false, error: 'login' });
  }

  sh.getRange(u.zeile, 6).setValue(0);
  sh.getRange(u.zeile, 7).setValue('');
  sh.getRange(u.zeile, 8).setValue(new Date());

  const token = Utilities.getUuid();
  const ses   = sheet('Sessions');
  zeileSchreiben(ses, ses.getLastRow() + 1,
    [token, email, new Date(Date.now() + SESSION_TAGE * 86400000)], [1, 2]);

  const kopfz  = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const iGeaen = kopfz.indexOf('PwGeaendert');
  const geaendert = iGeaen < 0
    ? true                                   // Spalte fehlt → nicht erzwingen
    : String(u.d[iGeaen]).toLowerCase() === 'true';

  const iRolle = kopfz.indexOf('Rolle');
  const rolle  = iRolle >= 0 ? String(u.d[iRolle]).trim().toLowerCase() : '';

  return out({ ok: true, session: token, name: name, email: email,
               pwGeaendert: geaendert, rolle: rolle });
}

/** Gibt {email, name} zurück oder null. Identität kommt IMMER von hier,
 *  nie aus dem Request — sonst könnte jeder unter fremdem Namen erfassen. */
function session(token) {
  if (!token) return null;
  const rows = sheet('Sessions').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token && new Date(rows[i][2]) > new Date()) {
      const u = benutzerZeile(rows[i][1]);
      if (!u || String(u.d[4]).toLowerCase() !== 'true') return null;

      const sh   = sheet('Benutzer');
      const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
      const iR   = head.indexOf('Rolle');

      return {
        email: u.d[0],
        name:  u.d[1],
        rolle: iR >= 0 ? String(u.d[iR]).trim().toLowerCase() : ''
      };
    }
  }
  return null;
}

function passwortAendern(b, u) {
  const z = benutzerZeile(u.email);
  if (hashPass(b.alt, z.d[3]) !== z.d[2]) {
    return out({ ok: false, error: 'login' });
  }
  if (!b.neu || String(b.neu).length < 8) {
    return out({ ok: false, error: 'zu kurz' });
  }
  const salt = Utilities.getUuid();
  const sh = sheet('Benutzer');
  textSetzen(sh, z.zeile, 3, hashPass(b.neu, salt));
  textSetzen(sh, z.zeile, 4, salt);

  const kopfz  = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const iGeaen = kopfz.indexOf('PwGeaendert');
  if (iGeaen >= 0) sh.getRange(z.zeile, iGeaen + 1).setValue(true);

  // geändertes Passwort meldet alle Geräte ab
  sitzungenBeenden(u.email);

  return out({ ok: true });
}


// ============================================================
//  Lesen
// ============================================================

function doGet(e) {
  const p = e.parameter;

  // CSV für Power Query — Excel kann sich nicht anmelden
  if (p.format === 'csv') {
    if (p.token !== TOKEN_READ) return out({ ok: false, error: 'auth' });

    const rows = sheet('Belege').getDataRange().getValues();
    const head = kopf(rows);
    rows.shift();

    const iSto = head.indexOf('Storniert');
    const iDat = head.indexOf('Datum');
    const iBld = head.indexOf('BildUrl');
    const spalten = EXPORT_SPALTEN.map(n => ({ name: n, i: head.indexOf(n) }));

    const fehlend = spalten
      .filter(x => x.i < 0 && x.name !== 'BildLink').map(x => x.name);
    if (fehlend.length) {
      return out({ ok: false, error: 'Spalte fehlt: ' + fehlend.join(', ') });
    }

    // Wer den CSV direkt in Excel öffnet, bekäme "=…" sonst als Formel
    const zellen = v => {
      const s = (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    };

    const csv = [EXPORT_SPALTEN.map(zellen).join(',')].concat(
      rows
        .filter(r => String(r[iSto]).toLowerCase() !== 'true')
        .map(r => spalten
          .map(x => zellen(
            x.name === 'BildLink' ? fotoLink(r[iBld]) :
            x.i === iDat          ? alsDatum(r[x.i])  : r[x.i]))
          .join(','))
    ).join('\n');

    return ContentService.createTextOutput(csv)
      .setMimeType(ContentService.MimeType.CSV);
  }

  // Beleg-Foto für foto.html — der Link aus der Spalte BildLink
  if (p.format === 'foto') return fotoDaten(p.id, p.sig);

  const u = session(p.session);
  if (!u) return out({ ok: false, error: 'session' });

  if (p.action === 'stammdaten') {
    return out({
      ok: true,
      konten:        aktiveListe('Konten'),
      kostenstellen: aktiveListe('Kostenstellen'),
      kmSaetze:      kmSaetze()
    });
  }

  // Bild einer eigenen Zeile — geht bewusst über den Server,
  // damit Mitarbeitende keinen Drive-Zugriff brauchen.
  if (p.action === 'bild') {
    const sh   = sheet('Belege');
    const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
    const iBld = head.indexOf('BildUrl');
    if (head.indexOf('Email') < 0 || iBld < 0) return out({ ok: false, error: 'Spalte fehlt' });

    const zeile = belegZeile(sh, u, p.key, p.zeile);
    if (!zeile) return out({ ok: false, error: 'nicht gefunden' });

    const treffer = String(sh.getRange(zeile, iBld + 1).getValue() || '').match(/[-\w]{25,}/);
    if (!treffer) return out({ ok: false, error: 'kein Bild' });

    try {
      const blob = DriveApp.getFileById(treffer[0]).getBlob();
      return out({ ok: true,
        bild: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) });
    } catch (err) {
      return out({ ok: false, error: 'Datei nicht lesbar' });
    }
  }

  if (p.action === 'meine') {
    const rows = sheet('Belege').getDataRange().getValues();
    const head = kopf(rows);
    rows.shift();
    const ix = n => head.indexOf(n);

    // _zeile = broj reda u trenutku čitanja. Storno i foto idu po
    // DedupKey (belegZeile), a _zeile je samo rezerva za redove bez ključa
    const iDat = head.indexOf('Datum');
    const alle = rows.map((r, i) => {
      const o = { _zeile: i + 2 };
      head.forEach((h, k) => o[h] = (k === iDat ? alsDatum(r[k]) : r[k]));
      return o;
    });

    const liste = alle.filter(o =>
      String(o[head[ix('Email')]]).trim().toLowerCase() === u.email.trim().toLowerCase() &&
      String(o[head[ix('Monat')]]) === String(p.monat) &&
      String(o[head[ix('Jahr')]])  === String(p.jahr)  &&
      String(o[head[ix('Storniert')]]).toLowerCase() !== 'true'
    );

    return out({ ok: true, belege: liste });
  }

  return out({ ok: false, error: 'unbekannte Aktion' });
}

function aktiveListe(name) {
  const rows = sheet(name).getDataRange().getValues();
  rows.shift();
  return rows
    .filter(r => String(r[0]).trim() !== '' &&
                 String(r[2]).toLowerCase() === 'true')
    .sort((a, b) => (Number(a[3]) || 0) - (Number(b[3]) || 0))
    .map(r => ({ nr: String(r[0]).trim(), bez: String(r[1]).trim() }));
}

/** Aktiver Eintrag aus Konten oder Kostenstellen, sonst null. */
function stammEintrag(liste, nr) {
  nr = String(nr == null ? '' : nr).trim();
  if (!nr) return null;
  const rows = sheet(liste).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === nr && String(rows[i][2]).toLowerCase() === 'true') {
      return { nr: nr, bez: String(rows[i][1]).trim() };
    }
  }
  return null;
}


// ============================================================
//  Foto-Links für Excel
//  Spalte J der Vorlage verlinkt auf foto.html neben der App
//  (GitHub Pages). Die Seite holt das Foto per fetch bei fotoDaten()
//  und startet den Download selbst.
//
//  Warum nicht direkt eine Apps-Script-Seite: Ist der Browser bei
//  mehreren Google-Konten angemeldet, schreibt Google /u/N/ in die
//  Adresse und zeigt "Datei kann derzeit nicht geöffnet werden".
//  fetch von einer fremden Seite schickt keine Google-Cookies mit —
//  wie bei der App selbst — und ist davon nicht betroffen.
//
//  Die Signatur bindet den Link an genau ein Foto; er enthält
//  keinen Token und braucht kein Google-Konto.
// ============================================================

/** Schlüssel für die Signatur. Entsteht beim ersten Aufruf von selbst
 *  in den Skripteigenschaften. Löschen macht alle Links ungültig;
 *  nach dem nächsten Aktualisieren hat Excel neue. */
function fotoSchluessel() {
  const props = PropertiesService.getScriptProperties();
  let k = props.getProperty('FOTO_SCHLUESSEL');
  if (!k) {
    k = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('FOTO_SCHLUESSEL', k);
  }
  return k;
}

function fotoSignatur(id) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(String(id), fotoSchluessel())
  ).replace(/=+$/, '');
}

/** Link für die Spalte BildLink, leer ohne Foto. */
function fotoLink(bildUrl) {
  const treffer = String(bildUrl || '').match(/[-\w]{25,}/);
  if (!treffer) return '';
  return PWA_URL + 'foto.html?id=' + treffer[0] + '&sig=' + fotoSignatur(treffer[0]);
}

/** Foto als Base64 mit Dateinamen, nur mit gültiger Signatur. */
function fotoDaten(id, sig) {
  id  = String(id  || '');
  sig = String(sig || '');
  if (!/^[-\w]{25,}$/.test(id) || sig !== fotoSignatur(id)) {
    return out({ ok: false, error: 'ungültig' });
  }

  let datei;
  try {
    datei = DriveApp.getFileById(id);
  } catch (err) {
    return out({ ok: false, error: 'fehlt' });
  }

  // Ablage: Belegfotos / Person / 2026-08 / Datei — Person in den Dateinamen
  let person = '';
  try {
    let ordner = datei.getParents().next();                       // 2026-08 oder Person
    if (BILD_MONATSORDNER) ordner = ordner.getParents().next();   // Person
    if (ordner.getId() !== BILD_ORDNER) person = ordner.getName();
  } catch (err) { /* nur Kosmetik für den Dateinamen */ }

  const blob = datei.getBlob();
  return out({
    ok:   true,
    name: ((person ? person + ' ' : '') + datei.getName()).replace(/[\/\\:*?"<>|]/g, ''),
    typ:  blob.getContentType() || 'image/jpeg',
    bild: Utilities.base64Encode(blob.getBytes())
  });
}


// ============================================================
//  Schreiben
// ============================================================

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const b = JSON.parse(e.postData.contents);

    if (b.action === 'login') return login(b);

    const u = session(b.session);
    if (!u) return out({ ok: false, error: 'session' });

    // Alle admin_* Aktionen laufen durch dieselbe Rollenprüfung
    if (String(b.action || '').indexOf('admin_') === 0) {
      if (u.rolle !== 'admin') return out({ ok: false, error: 'keine Berechtigung' });
      if (b.action === 'admin_liste') return adminListe(u);
      if (b.action === 'admin_neu')   return adminNeu(b, u);
      if (b.action === 'admin_aktiv') return adminAktiv(b, u);
      if (b.action === 'admin_reset') return adminReset(b, u);
      if (b.action === 'admin_rolle') return adminRolle(b, u);
      if (b.action === 'admin_stamm')         return adminStamm();
      if (b.action === 'admin_stamm_neu')     return adminStammNeu(b);
      if (b.action === 'admin_stamm_aendern') return adminStammAendern(b);
      if (b.action === 'admin_stamm_aktiv')   return adminStammAktiv(b);
      return out({ ok: false, error: 'unbekannte Aktion' });
    }

    if (b.action === 'passwort') return passwortAendern(b, u);
    if (b.action === 'storno')   return storno(b, u);
    if (b.art    === 'fahrt')    return fahrt(b, u);
    return beleg(b, u);

  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Datum und Abrechnungsperiode, gemeinsam für Beleg und Fahrt.
 *  Die App füllt Monat und Jahr vor; die Prüfung hier hält auch
 *  Anfragen ab, die nicht aus der App kommen. Gibt den Fehlercode
 *  zurück oder ''. */
function periodePruefen(b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.datum || ''))) return 'datum';
  const monat = Number(b.monat), jahr = Number(b.jahr);
  if (!Number.isInteger(monat) || monat < 1 || monat > 12)     return 'periode';
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100)   return 'periode';
  return '';
}

function beleg(b, u) {
  const brutto = Number(b.brutto);
  if (!brutto || brutto <= 0) return out({ ok: false, error: 'betrag' });
  if (!b.kontoNr || !b.kstNr)  return out({ ok: false, error: 'konto' });
  const fehler = periodePruefen(b);
  if (fehler)                  return out({ ok: false, error: fehler });

  // Number('') wäre 0 — ein fehlender Satz darf nicht als 0 % durchgehen
  const satz  = Number(b.mwstSatz);                       // 8.1
  if (b.mwstSatz === '' || b.mwstSatz == null || !isFinite(satz) || satz < 0 || satz >= 100) {
    return out({ ok: false, error: 'mwst' });
  }
  if (String(b.bemerkung || '').trim() === '')        return out({ ok: false, error: 'bemerkung' });
  // ohne "base64," würde bildSpeichern() still nichts speichern
  if (String(b.bild || '').indexOf('base64,') < 0)    return out({ ok: false, error: 'foto' });

  // Konto und Kostenstelle müssen aktiv sein; die Bezeichnung kommt aus
  // den Stammdaten, nicht aus der Anfrage
  const konto = stammEintrag('Konten', b.kontoNr);
  const kst   = stammEintrag('Kostenstellen', b.kstNr);
  if (!konto || !kst) return out({ ok: false, error: 'stamm' });
  const mwst  = round2(brutto - brutto / (1 + satz / 100));
  const netto = round2(brutto - mwst);

  const key = dedupKey(u.email, b.datum, brutto, b.belegNr, b.suffix);

  const sh   = sheet('Belege');
  const rows = sh.getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iKey = head.indexOf('DedupKey');
  const iSto = head.indexOf('Storniert');

  const dup = rows.some(r =>
    String(r[iKey]).trim() === key && String(r[iSto]).toLowerCase() !== 'true');
  if (dup) return out({ ok: false, error: 'duplikat' });

  let bildUrl = '';
  if (b.bild) {
    try {
      bildUrl = bildSpeichern(b.bild, u, b.datum, brutto, b.belegNr);
    } catch (err) {
      return out({ ok: false, error: 'bild: ' + err.message });
    }
  }

  zeileSchreiben(sh, sh.getLastRow() + 1, [
    new Date(),                 // Zeitstempel
    u.name,                     // Mitarbeiter  ← aus der Sitzung
    u.email,                    // Email        ← aus der Sitzung
    b.belegNr || '',
    String(b.datum),            // yyyy-mm-dd als Text, keine Zeitzone
    Number(b.monat),
    Number(b.jahr),
    brutto,
    satz / 100,                 // 0.081 — Excel-Prozentformat erwartet das so
    mwst,
    netto,
    konto.nr,                   // Text: führende Nullen bleiben
    konto.bez,
    kst.nr,
    kst.bez,
    String(b.bemerkung),
    key,
    false,
    'Beleg',
    '',
    '',
    bildUrl
  ], belegeTextSpalten(head));

  return out({ ok: true, mwst: mwst, netto: netto, bild: !!bildUrl });
}

/** Kilometerentschädigung: ein Eintrag pro Person und Tag.
 *  Bei erneuter Erfassung für denselben Tag wird die Zeile ersetzt,
 *  nicht ein zweiter Eintrag angelegt. */
function fahrt(b, u) {
  const km = Number(b.km);
  if (!km || km <= 0) return out({ ok: false, error: 'km' });
  const fehler = periodePruefen(b);
  if (fehler)         return out({ ok: false, error: fehler });
  if (!b.kstNr)       return out({ ok: false, error: 'konto' });
  if (String(b.bemerkung || '').trim() === '') return out({ ok: false, error: 'zweck' });
  const kst = stammEintrag('Kostenstellen', b.kstNr);
  if (!kst)           return out({ ok: false, error: 'stamm' });

  const satz = Number(parameter('KmSatz', b.datum));
  if (!satz) return out({ ok: false, error: 'kmsatz' });

  const kontoNr = String(parameter('KmKonto', b.datum) || '').trim();
  if (!kontoNr) return out({ ok: false, error: 'kmkonto' });

  const kontoTreffer = stammEintrag('Konten', kontoNr);
  const kontoBez = kontoTreffer ? kontoTreffer.bez : '';

  const brutto = round2(km * satz);
  const key = String(u.email).trim().toLowerCase() + '|' + String(b.datum) + '|fahrt';

  const sh   = sheet('Belege');
  const rows = sh.getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iKey = head.indexOf('DedupKey');
  const iSto = head.indexOf('Storniert');
  const iKm  = head.indexOf('KM');

  let treffer = 0;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][iKey]).trim() === key &&
        String(rows[i][iSto]).toLowerCase() !== 'true') {
      treffer = i + 2;
      if (!b.ersetzen) {
        return out({ ok: false, error: 'fahrt-existiert',
                     km: iKm >= 0 ? rows[i][iKm] : null });
      }
    }
  }

  const text = km + ' km à ' + satz.toFixed(2) +
               (b.bemerkung ? ' — ' + String(b.bemerkung) : '');

  const zeile = [
    new Date(), u.name, u.email, '',
    String(b.datum), Number(b.monat), Number(b.jahr),
    brutto, 0, 0, brutto,
    kontoNr, kontoBez,
    kst.nr, kst.bez,
    text, key, false,
    'Fahrt', km, satz, ''
  ];

  zeileSchreiben(sh, treffer || sh.getLastRow() + 1, zeile, belegeTextSpalten(head));

  return out({ ok: true, brutto: brutto, satz: satz, ersetzt: !!treffer });
}


function storno(b, u) {
  const sh   = sheet('Belege');
  const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const iSto = head.indexOf('Storniert');

  if (iSto < 0 || head.indexOf('Email') < 0) {
    return out({ ok: false,
      error: 'Spalte fehlt. Gefundene Kopfzeile: ' + head.join(' | ') });
  }

  const zeile = belegZeile(sh, u, b.key, b.zeile);
  if (!zeile) return out({ ok: false, error: 'nicht gefunden' });

  sh.getRange(zeile, iSto + 1).setValue(true);
  return out({ ok: true });
}


/** Im Editor ausführen und das Log prüfen, wenn Spalten nicht gefunden werden. */
function kopfPruefen() {
  ['Belege', 'Konten', 'Kostenstellen', 'Benutzer', 'Sessions', 'Parameter'].forEach(n => {
    const sh = sheet(n);
    if (!sh) { Logger.log(n + ' → BLATT FEHLT'); return; }
    Logger.log(n + ' → ' + kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues())
      .map(h => '[' + h + ']').join(' '));
  });
}


// ============================================================
//  Verwaltung — von Hand im Editor ausführen
// ============================================================

/** Verschickt das Zugangsmail. Text an einer Stelle, für Ersteinrichtung
 *  und Passwort-Reset gleichermassen. */
function mailSenden(email, name, pw) {
  const vorname = String(name).trim().split(/\s+/)[0] || name;
  const S = 'font-family:Verdana,Geneva,sans-serif;';
  const mitPw = PASSWORT_PER_MAIL && pw;

  const zeilePwHtml = mitPw
    ? '<tr><td style="padding:2px 16px 2px 0">Passwort:</td>' +
      '<td style="padding:2px 0"><b>' + pw + '</b></td></tr>'
    : '';

  const hinweis = mitPw
    ? 'Beim ersten Anmelden werden Sie aufgefordert, ein eigenes Passwort zu ' +
      'setzen. Danach ist das oben stehende nicht mehr gültig.'
    : 'Das Passwort erhalten Sie separat. Beim ersten Anmelden werden Sie ' +
      'aufgefordert, es durch ein eigenes zu ersetzen.';

  MailApp.sendEmail({
    to:      email,
    name:    ABSENDER,
    replyTo: ANTWORT_MAIL,
    subject: 'Spesenerfassung — Ihr Zugang',

    htmlBody:
      '<div style="' + S + 'font-size:13px;line-height:1.55;color:#222">' +
      '<p>Guten Tag ' + vorname + '</p>' +
      '<p>Wie angekündigt erfassen wir die Spesen ab sofort online.</p>' +
      '<p>Nachfolgend Ihre Zugangsdaten und eine kurze Anleitung.</p>' +
      '<table cellpadding="0" cellspacing="0" style="' + S +
        'font-size:13px;margin:16px 0">' +
        '<tr><td style="padding:2px 16px 2px 0">Webseite:</td>' +
            '<td style="padding:2px 0"><a href="' + PWA_URL + '">' + PWA_URL + '</a></td></tr>' +
        '<tr><td style="padding:2px 16px 2px 0">Benutzername:</td>' +
            '<td style="padding:2px 0">' + email + '</td></tr>' +
        zeilePwHtml +
      '</table>' +
      '<p>' + hinweis + '</p>' +
      '<p style="margin-top:24px"><b>Symbol auf dem Handy ablegen</b></p>' +
      '<p style="margin-bottom:4px">iPhone:</p>' +
      '<ol style="' + S + 'font-size:13px;margin:0 0 16px;padding-left:20px">' +
        '<li>Webseite in Safari öffnen</li>' +
        '<li>Unten auf «Teilen» tippen</li>' +
        '<li>«Zum Home-Bildschirm» wählen</li>' +
        '<li>Auf «Hinzufügen» tippen</li>' +
      '</ol>' +
      '<p style="margin-bottom:4px">Android:</p>' +
      '<ol style="' + S + 'font-size:13px;margin:0 0 16px;padding-left:20px">' +
        '<li>Webseite in Chrome öffnen</li>' +
        '<li>Oben rechts auf die drei Punkte tippen</li>' +
        '<li>«Zum Startbildschirm hinzufügen» wählen</li>' +
      '</ol>' +
      '<p>Danach genügt ein Tippen auf das Symbol. Eine erneute Anmeldung ' +
      'ist nicht nötig.</p>' +
      '<p style="margin-top:24px">Bei Fragen erreichen Sie mich unter ' +
      KONTAKT_TEL + '.</p>' +
      '<p>Freundliche Grüsse<br>' + ABSENDER + '<br>YEPP Logistics<br>' +
      KONTAKT_TEL + '</p>' +
      '</div>',

    body:
      'Guten Tag ' + vorname + '\n\n' +
      'Wie angekündigt erfassen wir die Spesen ab sofort online.\n\n' +
      'Nachfolgend Ihre Zugangsdaten und eine kurze Anleitung.\n\n' +
      'Webseite:     ' + PWA_URL + '\n' +
      'Benutzername: ' + email + '\n' +
      (mitPw ? 'Passwort:     ' + pw + '\n' : '') + '\n' +
      hinweis + '\n\n\n' +
      'SYMBOL AUF DEM HANDY ABLEGEN\n\n' +
      'iPhone:\n' +
      '  1. Webseite in Safari öffnen\n' +
      '  2. Unten auf "Teilen" tippen\n' +
      '  3. "Zum Home-Bildschirm" wählen\n' +
      '  4. Auf "Hinzufügen" tippen\n\n' +
      'Android:\n' +
      '  1. Webseite in Chrome öffnen\n' +
      '  2. Oben rechts auf die drei Punkte tippen\n' +
      '  3. "Zum Startbildschirm hinzufügen" wählen\n\n' +
      'Danach genügt ein Tippen auf das Symbol. Eine erneute Anmeldung ist\n' +
      'nicht nötig.\n\n\n' +
      'Bei Fragen erreichen Sie mich unter ' + KONTAKT_TEL + '.\n\n' +
      'Freundliche Grüsse\n' + ABSENDER + '\nYEPP Logistics\n' + KONTAKT_TEL
  });
}


/** Neues Passwort setzen, Zähler zurücksetzen und Zugangsmail verschicken. */
function zugangSenden(zeile, email, name, mailSchicken) {
  const sh   = sheet('Benutzer');
  const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());

  const pw   = zufallPasswort();
  const salt = Utilities.getUuid();

  textSetzen(sh, zeile, 3, hashPass(pw, salt));
  textSetzen(sh, zeile, 4, salt);
  sh.getRange(zeile, 5).setValue(true);
  sh.getRange(zeile, 6).setValue(0);
  sh.getRange(zeile, 7).setValue('');

  const iG = head.indexOf('PwGeaendert');
  if (iG >= 0) sh.getRange(zeile, iG + 1).setValue(false);

  if (mailSchicken) mailSenden(email, name, pw);
  return pw;
}


/**
 * Verschickt Zugänge für alle Zeilen in "Benutzer" ohne PassHash.
 * Wird nur noch zum Anlegen des allerersten Kontos gebraucht —
 * danach läuft die Verwaltung über den Admin-Bereich in der App.
 */
function zugangVerschicken() {
  const sh   = sheet('Benutzer');
  const rows = sh.getDataRange().getValues();
  let anzahl = 0;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2]) continue;
    const email = String(rows[i][0]).trim();
    if (!email) continue;
    const pw = zugangSenden(i + 1, email, String(rows[i][1]).trim(), MAIL_STANDARD);
    Logger.log(email + '  →  ' + pw);
    anzahl++;
    Utilities.sleep(4000);
  }
  Logger.log(anzahl + ' Zugang/Zugänge verschickt.');
}


// ============================================================
//  Admin-Bereich
//  Jede Aktion prüft die Rolle serverseitig. Dass der Knopf in
//  der App fehlt, ist keine Absicherung — der Client kann alles
//  senden.
// ============================================================

function adminListe(u) {
  const sh   = sheet('Benutzer');
  const rows = sh.getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const ix = n => head.indexOf(n);

  const jetzt = new Date();
  return out({ ok: true, ich: String(u.email).trim().toLowerCase(), benutzer: rows
    .filter(r => String(r[0]).trim())
    .map((r, i) => ({
      zeile:       i + 2,
      email:       String(r[0]).trim(),
      name:        String(r[1]).trim(),
      aktiv:       String(r[4]).toLowerCase() === 'true',
      angelegt:    !!r[2],
      pwGeaendert: ix('PwGeaendert') < 0 ? null
                     : String(r[ix('PwGeaendert')]).toLowerCase() === 'true',
      gesperrt:    !!(r[6] && new Date(r[6]) > jetzt),
      letzterLogin: r[7] ? Utilities.formatDate(new Date(r[7]), 'Europe/Zurich', 'dd.MM.yyyy') : '',
      rolle:       ix('Rolle') < 0 ? '' : String(r[ix('Rolle')]).trim().toLowerCase()
    }))
  });
}


function adminNeu(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const name  = String(b.name  || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return out({ ok: false, error: 'ungültige Mailadresse' });
  }
  if (!name) return out({ ok: false, error: 'Name fehlt' });
  if (benutzerZeile(email)) return out({ ok: false, error: 'existiert bereits' });

  const sh = sheet('Benutzer');
  const zeile = sh.getLastRow() + 1;
  zeileSchreiben(sh, zeile, [email, name, '', '', true, 0, '', ''], [1, 2]);

  const mailSchicken = b.mail !== false;
  let pw, mailOk = mailSchicken;

  try {
    pw = zugangSenden(zeile, email, name, mailSchicken);
  } catch (err) {
    // Benutzer ist angelegt, nur der Versand hat nicht geklappt —
    // das Passwort steht trotzdem in der Tabelle und wird zurückgegeben.
    mailOk = false;
    pw = null;
  }

  if (pw === null) {
    return out({ ok: false, error: 'angelegt, aber Versand fehlgeschlagen. ' +
                 'Bitte "Passwort neu senden" ohne Mail verwenden.' });
  }

  return out({ ok: true, email: email, name: name, pw: pw, mail: mailOk });
}


function adminAktiv(b, u) {
  const ziel = benutzerZeile(b.email);
  if (!ziel) return out({ ok: false, error: 'unbekannt' });

  if (String(b.email).trim().toLowerCase() === String(u.email).trim().toLowerCase()) {
    return out({ ok: false, error: 'eigenes Konto nicht möglich' });
  }

  const neu = !(String(ziel.d[4]).toLowerCase() === 'true');
  sheet('Benutzer').getRange(ziel.zeile, 5).setValue(neu);

  if (!neu) sitzungenBeenden(b.email);   // Deaktivieren meldet sofort ab
  return out({ ok: true, aktiv: neu });
}


function adminReset(b) {
  const ziel = benutzerZeile(b.email);
  if (!ziel) return out({ ok: false, error: 'unbekannt' });

  const mailSchicken = b.mail !== false;
  let pw, mailOk = mailSchicken;

  try {
    pw = zugangSenden(ziel.zeile, String(ziel.d[0]).trim(),
                      String(ziel.d[1]).trim(), mailSchicken);
  } catch (err) {
    return out({ ok: false, error: 'Mail fehlgeschlagen: ' + err.message });
  }

  sitzungenBeenden(b.email);
  return out({ ok: true,
               email: String(ziel.d[0]).trim(), name: String(ziel.d[1]).trim(),
               pw: pw, mail: mailOk });
}


function adminRolle(b, u) {
  const sh   = sheet('Benutzer');
  const head = kopf(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues());
  const iR   = head.indexOf('Rolle');
  if (iR < 0) return out({ ok: false, error: 'Spalte Rolle fehlt' });

  if (String(b.email).trim().toLowerCase() === String(u.email).trim().toLowerCase()) {
    return out({ ok: false, error: 'eigene Rolle nicht möglich' });
  }

  const ziel = benutzerZeile(b.email);
  if (!ziel) return out({ ok: false, error: 'unbekannt' });

  const neu = String(ziel.d[iR]).trim().toLowerCase() === 'admin' ? '' : 'admin';
  sh.getRange(ziel.zeile, iR + 1).setValue(neu);
  return out({ ok: true, rolle: neu });
}


function sitzungenBeenden(email) {
  const ses  = sheet('Sessions');
  const rows = ses.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
      ses.deleteRow(i + 1);
    }
  }
}


// ============================================================
//  Konten und Kostenstellen
//  Löschen gibt es bewusst nicht: erfasste Belege tragen Nr und
//  Bezeichnung als Kopie, "Deaktivieren" nimmt den Eintrag nur
//  aus der Auswahl. Die Nr ist der Schlüssel und bleibt fest —
//  für eine neue Nr wird ein neuer Eintrag angelegt.
//  Spalten wie in aktiveListe(): Nr | Bezeichnung | Aktiv | Sortierung
// ============================================================

const STAMM_BLAETTER = ['Konten', 'Kostenstellen'];

/** Nur diese beiden Blätter — der Blattname kommt vom Client. */
function stammBlatt(liste) {
  return STAMM_BLAETTER.indexOf(liste) >= 0 ? sheet(liste) : null;
}

/** Alle Einträge inklusive inaktiver, sortiert wie in der App. */
function stammAlle(liste) {
  const rows = sheet(liste).getDataRange().getValues();
  rows.shift();
  return rows
    .map((r, i) => ({
      zeile: i + 2,
      nr:    String(r[0]).trim(),
      bez:   String(r[1]).trim(),
      aktiv: String(r[2]).toLowerCase() === 'true',
      sort:  Number(r[3]) || 0
    }))
    .filter(x => x.nr !== '')
    .sort((a, b) => a.sort - b.sort);
}

/** Konten, die heute oder künftig als KmKonto gelten.
 *  Sie bleiben aktiv, sonst fehlt der Fahrt die Kontobezeichnung. */
function kmKonten() {
  const heute = Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd');
  const nr = [String(parameter('KmKonto', heute) || '').trim()];

  const rows = sheet('Parameter').getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iS = head.indexOf('Schluessel');
  const iW = head.indexOf('Wert');
  const iA = head.indexOf('GueltigAb');
  if (iS >= 0 && iW >= 0 && iA >= 0) {
    rows.forEach(r => {
      if (String(r[iS]).trim() === 'KmKonto' && String(r[iA] || '').trim() > heute) {
        nr.push(String(r[iW]).trim());
      }
    });
  }
  return nr.filter(Boolean);
}

/** Nr neuer Einträge: Ziffern, Buchstaben, Punkt, Bindestrich. */
function nrPruefen(nr) {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$/.test(nr) ? '' : 'Nr ungültig';
}

/** Keine spitzen Klammern (landet im HTML der App),
 *  kein führendes "=" (würde in Sheets zur Formel). */
function bezPruefen(bez) {
  if (!bez)                                      return 'Bezeichnung fehlt';
  if (/[<>]/.test(bez) || bez.charAt(0) === '=') return 'Bezeichnung ungültig';
  return '';
}

function adminStamm() {
  const ohneZeile = x => ({ nr: x.nr, bez: x.bez, aktiv: x.aktiv, sort: x.sort });
  return out({ ok: true,
    konten:        stammAlle('Konten').map(ohneZeile),
    kostenstellen: stammAlle('Kostenstellen').map(ohneZeile),
    kmKonten:      kmKonten()
  });
}

function adminStammNeu(b) {
  const sh = stammBlatt(b.liste);
  if (!sh) return out({ ok: false, error: 'unbekannte Liste' });

  const nr  = String(b.nr  || '').trim();
  const bez = String(b.bez || '').trim();
  const fehler = nrPruefen(nr) || bezPruefen(bez);
  if (fehler) return out({ ok: false, error: fehler });

  const alle = stammAlle(b.liste);
  const da   = alle.filter(x => x.nr.toLowerCase() === nr.toLowerCase())[0];
  if (da) return out({ ok: false, error: da.aktiv ? 'existiert bereits' : 'existiert inaktiv' });

  let sort = alle.reduce((m, x) => Math.max(m, x.sort), 0) + 10;   // ans Ende
  if (String(b.sort || '').trim() !== '') {
    sort = Number(b.sort);
    if (isNaN(sort)) return out({ ok: false, error: 'Sortierung ungültig' });
  }

  const zeile = sh.getLastRow() + 1;
  zeileSchreiben(sh, zeile, [nr, bez, true, sort], [1, 2]);   // führende Nullen bleiben
  return out({ ok: true });
}

function adminStammAendern(b) {
  const sh = stammBlatt(b.liste);
  if (!sh) return out({ ok: false, error: 'unbekannte Liste' });

  const x = stammAlle(b.liste).filter(e => e.nr === String(b.nr || '').trim())[0];
  if (!x) return out({ ok: false, error: 'unbekannt' });

  const bez = String(b.bez || '').trim();
  const fehler = bezPruefen(bez);
  if (fehler) return out({ ok: false, error: fehler });

  let sort = x.sort;
  if (String(b.sort || '').trim() !== '') {
    sort = Number(b.sort);
    if (isNaN(sort)) return out({ ok: false, error: 'Sortierung ungültig' });
  }

  textSetzen(sh, x.zeile, 2, bez);
  sh.getRange(x.zeile, 4).setValue(sort);
  return out({ ok: true });
}

function adminStammAktiv(b) {
  const sh = stammBlatt(b.liste);
  if (!sh) return out({ ok: false, error: 'unbekannte Liste' });

  const alle = stammAlle(b.liste);
  const x = alle.filter(e => e.nr === String(b.nr || '').trim())[0];
  if (!x) return out({ ok: false, error: 'unbekannt' });

  if (x.aktiv) {
    if (b.liste === 'Konten' && kmKonten().indexOf(x.nr) >= 0) {
      return out({ ok: false, error: 'Kilometerkonto' });
    }
    // ohne aktiven Eintrag lässt sich kein Beleg mehr speichern
    if (alle.filter(e => e.aktiv).length <= 1) {
      return out({ ok: false, error: 'letzter Eintrag' });
    }
  }

  sh.getRange(x.zeile, 3).setValue(!x.aktiv);
  return out({ ok: true, aktiv: !x.aktiv });
}


/** Legt für alle aktiven Benutzer den persönlichen Ordner an,
 *  damit das nicht beim ersten Foto während der Erfassung passiert. */
function ordnerAnlegen() {
  const rows = sheet('Benutzer').getDataRange().getValues();
  const head = kopf(rows);
  rows.shift();
  const iEml = head.indexOf('Email');
  const iNam = head.indexOf('Name');

  rows.forEach(r => {
    const email = String(r[iEml] || '').trim();
    if (!email) return;
    const ordner = benutzerOrdner({ email: email, name: String(r[iNam]).trim() });
    Logger.log(email + ' → ' + ordner.getName() + ' (' + ordner.getId() + ')');
  });
}


/** Optional: als Zeitauslöser wöchentlich laufen lassen. */
function sessionsAufraeumen() {
  const sh = sheet('Sessions');
  const rows = sh.getDataRange().getValues();
  const jetzt = new Date();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (new Date(rows[i][2]) < jetzt) sh.deleteRow(i + 1);
  }
}

/**
 * Wöchentliche Sicherung.
 *
 * Kopiert die GESAMTE Tabelle — nicht nur "Belege", sondern auch
 * "Benutzer" mit den Passwort-Hashes, "Konten", "Kostenstellen",
 * "Parameter" und "Sessions".
 *
 * Einrichten: im Editor links auf "Auslöser" → "Auslöser hinzufügen" →
 * Funktion: sicherung → Zeitgesteuert → Wochentimer → Sonntag 03:00.
 */

const SICHERUNG_ORDNER = '1cxpDY9-MIz5gl4dboBfPnM3jrBuamZNr';   // eigener Ordner, nicht der für Fotos
const SICHERUNG_TAGE   = 120;                      // ältere Sicherungen werden entfernt

function sicherung() {
  const ordner  = DriveApp.getFolderById(SICHERUNG_ORDNER);
  const stempel = Utilities.formatDate(new Date(), 'Europe/Zurich', 'yyyy-MM-dd_HHmm');

  try {
    DriveApp.getFileById(SHEET_ID)
      .makeCopy('Spesen-Sicherung ' + stempel, ordner);
  } catch (err) {
    sicherungMelden('Sicherung fehlgeschlagen: ' + err.message);
    throw err;
  }

  altSicherungenEntfernen(ordner);
}

/** Sicherungen älter als SICHERUNG_TAGE in den Papierkorb legen. */
function altSicherungenEntfernen(ordner) {
  const grenze  = new Date(Date.now() - SICHERUNG_TAGE * 86400000);
  const dateien = ordner.getFiles();
  while (dateien.hasNext()) {
    const d = dateien.next();
    if (d.getName().indexOf('Spesen-Sicherung ') === 0 &&
        d.getDateCreated() < grenze) {
      d.setTrashed(true);
    }
  }
}

/** Stille Fehler sind bei Sicherungen das eigentliche Risiko. */
function sicherungMelden(text) {
  try {
    MailApp.sendEmail({
      to: ANTWORT_MAIL,
      subject: 'Spesenerfassung — Sicherung',
      body: text + '\n\nZeit: ' +
            Utilities.formatDate(new Date(), 'Europe/Zurich', 'dd.MM.yyyy HH:mm')
    });
  } catch (e) { /* Mailversand darf die Sicherung nicht zusätzlich stören */ }
}

/** Einmal von Hand ausführen, um Ordner-ID und Berechtigung zu prüfen. */
function sicherungTesten() {
  sicherung();
  const dateien = DriveApp.getFolderById(SICHERUNG_ORDNER).getFiles();
  let n = 0;
  while (dateien.hasNext()) { dateien.next(); n++; }
  Logger.log('Sicherung erstellt. Dateien im Ordner: ' + n);
}
