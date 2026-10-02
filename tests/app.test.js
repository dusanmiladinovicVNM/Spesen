'use strict';
/* App-Tests im Browser: index.html in Chromium (Playwright), dahinter
   das echte Code.gs aus tests/gas.js statt Apps Script. Ohne
   installiertes Playwright (npm install) werden sie übersprungen. */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const { laden } = require('./gas');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* unten übersprungen */ }
const OHNE = chromium ? false : 'Playwright nicht installiert (npm install)';

const SEITE = 'file://' + path.join(__dirname, '..', 'index.html');
const FOTO  = path.join(__dirname, '..', 'icons', 'icon-192.png');

const BELEGE = ['Zeitstempel', 'Mitarbeiter', 'Email', 'BelegNr', 'Datum', 'Monat', 'Jahr',
  'Brutto', 'MwstSatz', 'MwstBetrag', 'Netto', 'KontoNr', 'KontoBez', 'KstNr', 'KstBez',
  'Bemerkung', 'DedupKey', 'Storniert', 'Art', 'KM', 'KmSatz', 'BildUrl', 'Id'];
const sp = n => BELEGE.indexOf(n);

function welt() {
  const w = laden({
    Belege: [BELEGE],
    Konten: [['Nr', 'Bezeichnung', 'Aktiv', 'Sortierung'],
      [4430, 'Reisekosten', true, 10], [6210, 'Fahrzeugkosten', true, 20]],
    Kostenstellen: [['Nr', 'Bezeichnung', 'Aktiv', 'Sortierung'],
      [995, 'Allgemein', true, 10], [821, 'Projekt', true, 20]],
    Parameter: [['Schluessel', 'Wert', 'GueltigAb'],
      ['KmSatz', 0.7, '2026-01-01'], ['KmKonto', '6210', '2026-01-01']],
    Benutzer: [['Email', 'Name', 'PassHash', 'Salt', 'Aktiv', 'Fehler', 'GesperrtBis',
                'LetzterLogin', 'OrdnerId', 'PwGeaendert', 'Rolle'],
      ['admin@x.ch', 'Ada Admin', '', 's', true, 0, '', '', '', true, 'admin'],
      ['mia@x.ch', '<img src=x onerror="window.XSS=1">', '', 's', true, 0, '', '', '', true, '']],
    Sessions: [['Token', 'Email', 'GueltigBis'],
      ['T-ADMIN', 'admin@x.ch', new Date(Date.now() + 86400000)]]
  });
  const ben = w.blatt('Benutzer');
  ben.zeilen[1][2] = w.gs.hashPass('geheim123', 's');
  ben.zeilen[2][2] = w.gs.hashPass('geheim123', 's');
  return w;
}

let browser;
before(async () => { if (chromium) browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

/** Neue Seite mit eigenem Speicher; Anfragen an Apps Script gehen an Code.gs. */
async function oeffnen(w, optionen = {}) {
  const kontext = await browser.newContext();
  const p = await kontext.newPage();
  const posts = [], urls = [], alle = [];
  p.on('dialog', d => d.accept());
  p.on('request', r => alle.push(r.url()));
  if (optionen.vorher) await p.addInitScript(optionen.vorher);
  await p.route(/script\.google\.com/, async r => {
    const req = r.request();
    const u = new URL(req.url());
    urls.push(req.url());
    const body = req.method() === 'POST' ? JSON.parse(req.postData()) : {};
    const aktion = body.action || u.searchParams.get('action');
    if (optionen.stammdatenKaputt && optionen.stammdatenKaputt() && aktion === 'stammdaten') {
      return r.fulfill({ status: 500, contentType: 'text/html', body: '<html>Fehler</html>' });
    }
    let antwort;
    if (req.method() === 'POST') {
      posts.push(body);
      antwort = w.gs.doPost({ postData: { contents: req.postData() } });
    } else {
      antwort = w.gs.doGet({ parameter: Object.fromEntries(u.searchParams) });
    }
    await r.fulfill({ status: 200, contentType: 'application/json', body: antwort.getContent() });
  });
  await p.goto(SEITE);
  return { p, posts, urls, alle, schliessen: () => kontext.close() };
}

async function anmelden(p, email) {
  await p.fill('#lg-email', email);
  await p.fill('#lg-pass', 'geheim123');
  await p.click('#lg-senden');
  await p.waitForSelector('#scr-form.aktiv');
  await p.waitForSelector('#fm-konto option[value="4430"]', { state: 'attached' });
}

/** Führt die Aktion aus und liefert den Text des Toasts, der danach erscheint. */
async function toastNach(p, aktion) {
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await aktion();
  await p.waitForFunction(() => document.getElementById('toast').textContent !== '');
  return p.textContent('#toast');
}

async function foto(p) {
  await p.setInputFiles('#fm-foto', FOTO);
  await p.waitForSelector('#fm-foto-vorschau.da');
}

async function belegErfassen(p, x = {}) {
  await p.selectOption('#fm-konto', x.konto || '4430');
  await p.selectOption('#fm-kst', x.kst || '995');
  await p.fill('#fm-brutto', x.brutto || '12.50');
  await p.fill('#fm-bemerkung', x.bemerkung || 'Taxi');
  await foto(p);
}


describe('App im Browser', { skip: OHNE }, () => {
  test('geteiltes Gerät: nach dem Abmelden übernimmt niemand die Eingaben', async () => {
    const w = welt();
    const { p, schliessen } = await oeffnen(w);
    await anmelden(p, 'admin@x.ch');
    await p.selectOption('#fm-konto', '4430');
    await p.selectOption('#fm-kst', '821');
    await p.fill('#fm-bemerkung', 'vertraulich');
    await foto(p);
    await p.click('#fm-abmelden');
    await anmelden(p, 'mia@x.ch');
    assert.equal(await p.inputValue('#fm-konto'), '');
    assert.equal(await p.inputValue('#fm-kst'), '');
    assert.equal(await p.inputValue('#fm-bemerkung'), '');
    assert.equal(await p.isVisible('#fm-foto-vorschau'), false);
    await schliessen();
  });

  test('Pflichtfelder: ohne Foto, Bemerkung oder Zweck wird nichts gesendet', async () => {
    const w = welt();
    const { p, posts, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    await p.selectOption('#fm-konto', '4430');
    await p.selectOption('#fm-kst', '995');
    await p.fill('#fm-brutto', '10');
    assert.equal(await toastNach(p, () => p.click('#fm-speichern')), 'Beleg-Foto ist erforderlich.');
    await foto(p);
    assert.equal(await toastNach(p, () => p.click('#fm-speichern')), 'Bemerkung ist erforderlich.');
    await p.click('.tab[data-art=fahrt]');
    await p.fill('#fm-km', '100');
    assert.equal(await toastNach(p, () => p.click('#fm-speichern')), 'Strecke / Zweck ist erforderlich.');
    assert.equal(posts.filter(x => x.brutto || x.km).length, 0);
    await schliessen();
  });

  test('Beleg speichern: keine Bezeichnungen vom Client, Name aus den Stammdaten', async () => {
    const w = welt();
    const { p, posts, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    await belegErfassen(p);
    assert.equal(await toastNach(p, () => p.click('#fm-speichern')), 'Beleg gespeichert.');
    const gesendet = posts.find(x => x.brutto);
    assert.equal('kontoBez' in gesendet, false);
    assert.equal('kstBez' in gesendet, false);
    const z = w.blatt('Belege').zeilen[1];
    assert.equal(z[sp('KontoBez')], 'Reisekosten');
    assert.equal(z[sp('KstBez')], 'Allgemein');
    await schliessen();
  });

  test('Text aus der Tabelle wird angezeigt, nie als HTML ausgeführt', async () => {
    const w = welt();
    const { p, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    const boese = '<img src=x onerror="window.XSS=2"> | Rest';
    await belegErfassen(p, { bemerkung: boese });
    await toastNach(p, () => p.click('#fm-speichern'));
    await p.click('#fm-liste');
    await p.waitForSelector('#lst-liste .eintrag');
    assert.match(await p.textContent('#lst-liste .unten'), /<img src=x onerror="window\.XSS=2">\|Rest/);
    assert.equal(await p.$$eval('#lst-liste img', x => x.length), 0);
    assert.equal(await p.evaluate(() => window.XSS), undefined);
    await schliessen();

    // Name mit HTML in der Benutzerverwaltung
    const a = await oeffnen(w);
    await anmelden(a.p, 'admin@x.ch');
    await a.p.click('#fm-admin');
    await a.p.waitForSelector('#adm-liste .nutzer');
    assert.ok((await a.p.$$eval('#adm-liste .nm', x => x.map(e => e.textContent))).includes('<img src=x onerror="window.XSS=1">'));
    assert.equal(await a.p.evaluate(() => window.XSS), undefined);
    await a.schliessen();
  });

  test('eigenes Konto ist gesperrt, auch bei einer Sitzung von vor dem Update', async () => {
    const w = welt();
    // angemeldet ohne gespeicherte Adresse, wie vor diesem Update
    const { p, schliessen } = await oeffnen(w, { vorher: () => {
      localStorage.setItem('session', 'T-ADMIN');
      localStorage.setItem('name', 'Ada Admin');
      localStorage.setItem('rolle', 'admin');
    } });
    await p.waitForSelector('#scr-form.aktiv');
    await p.click('#fm-admin');
    await p.waitForSelector('#adm-liste .nutzer');
    assert.equal(await p.isDisabled('#adm-liste .klein[data-tun=aktiv][data-email="admin@x.ch"]'), true);
    assert.equal(await p.isDisabled('#adm-liste .klein[data-tun=rolle][data-email="admin@x.ch"]'), true);
    assert.equal(await p.isDisabled('#adm-liste .klein[data-tun=aktiv][data-email="mia@x.ch"]'), false);
    await schliessen();
  });

  test('inaktives Konto: Liste wird neu geladen, dann gemeldet', async () => {
    const w = welt();
    const { p, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    await belegErfassen(p, { konto: '4430', kst: '821' });
    w.blatt('Konten').zeilen[1][2] = false;              // 4430 wird inzwischen deaktiviert
    const text = await toastNach(p, () => p.click('#fm-speichern'));
    assert.match(text, /Liste ist aktualisiert/);
    assert.deepEqual(await p.$$eval('#fm-konto option', x => x.map(o => o.value)), ['', '6210']);
    assert.equal(await p.inputValue('#fm-konto'), '');
    assert.equal(await p.inputValue('#fm-kst'), '821', 'Kostenstelle bleibt');
    await schliessen();
  });

  test('inaktives Konto und Neuladen scheitert: ehrliche Meldung', async () => {
    const w = welt();
    let kaputt = false;
    const { p, schliessen } = await oeffnen(w, { stammdatenKaputt: () => kaputt });
    await anmelden(p, 'mia@x.ch');
    await belegErfassen(p);
    w.blatt('Konten').zeilen[1][2] = false;
    kaputt = true;
    const text = await toastNach(p, () => p.click('#fm-speichern'));
    assert.match(text, /Bitte die App neu laden/);
    assert.doesNotMatch(text, /aktualisiert/);
    await schliessen();
  });

  test('Storno schickt die Id und trifft nach Umsortieren den richtigen Beleg', async () => {
    const w = welt();
    const { p, posts, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    for (const [brutto, bem] of [['10', 'eins'], ['20', 'zwei']]) {
      await belegErfassen(p, { brutto, bemerkung: bem });
      await toastNach(p, () => p.click('#fm-speichern'));
    }
    await p.click('#fm-liste');
    await p.waitForSelector('#lst-liste .eintrag');
    // Tabelle wird von Hand umsortiert, nachdem die Liste geladen ist
    const b = w.blatt('Belege');
    b.zeilen = [b.zeilen[0], ...b.zeilen.slice(1).reverse()];
    const erster = await p.textContent('#lst-liste .eintrag .unten');
    await p.click('#lst-liste .storno');
    assert.equal(await toastNach(p, () => p.click('#lst-liste .storno')), 'Beleg storniert.');
    const st = posts.find(x => x.action === 'storno');
    assert.ok(st.key, 'Schlüssel gesendet (für Zeilen ohne Id)');
    const getroffen = b.zeilen.slice(1).find(z => z[sp('Storniert')] === true);
    assert.equal(st.id, getroffen[sp('Id')]);
    assert.ok(erster.endsWith(getroffen[sp('Bemerkung')]), erster + ' / ' + getroffen[sp('Bemerkung')]);
    await schliessen();
  });

  test('Sitzungs-Token erscheint nie in einer URL', async () => {
    const w = welt();
    const { p, urls, posts, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    await belegErfassen(p);
    await toastNach(p, () => p.click('#fm-speichern'));
    await p.click('#fm-liste');
    await p.waitForSelector('#lst-liste .eintrag');
    await p.click('#lst-liste .foto-auf');
    await p.waitForSelector('#bild-gross:not([hidden])');
    assert.equal(posts.find(x => x.action === 'bild').id, w.blatt('Belege').zeilen[1][sp('Id')]);
    const token = await p.evaluate(() => localStorage.getItem('session'));
    assert.ok(token && token.length > 40, 'Token vorhanden');
    assert.ok(urls.length >= 5, 'Anfragen beobachtet');
    assert.deepEqual(urls.filter(u => u.includes('session=') || u.includes(token)), []);
    // in Sessions steht nicht das Token, sondern sein Hash
    assert.equal(w.blatt('Sessions').zeilen.some(z => z[0] === token), false);
    await schliessen();
  });

  test('Logo und Zeichen werden gezeichnet', async () => {
    const w = welt();
    const { p, schliessen } = await oeffnen(w);
    const flaeche = sel => p.$eval(sel, e => { const b = e.getBBox(); return b.width * b.height; });
    assert.ok(await flaeche('#scr-login .logo use') > 0, 'Logo Anmeldung');
    await anmelden(p, 'mia@x.ch');
    assert.ok(await flaeche('.kopf .zeichen use') > 0, 'Zeichen im Kopf');
    await schliessen();
  });

  test('Schrift kommt aus dem Repo, keine Anfrage an Google Fonts', async () => {
    const w = welt();
    const { p, alle, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    const geladen = await p.evaluate(async () => {
      await document.fonts.load('600 15px "Open Sans"', 'Spesen Ä ć');   // ć: latin-ext
      return [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Open Sans')
                                .map(f => f.status);
    });
    assert.deepEqual(geladen, ['loaded', 'loaded']);
    const fremd = alle.filter(u => !/^(file:|data:|blob:|https:\/\/script\.google\.com\/)/.test(u));
    assert.deepEqual(fremd, []);
    assert.ok(alle.some(u => u.endsWith('/fonts/open-sans-latin.woff2')), 'Schrift aus fonts/');
    await schliessen();
  });

  test('Fehler am Server: verständliche Meldung statt Technik', async () => {
    const w = welt();
    const { p, schliessen } = await oeffnen(w);
    await anmelden(p, 'mia@x.ch');
    await belegErfassen(p);
    w.loeschen('Belege');
    assert.equal(await toastNach(p, () => p.click('#fm-speichern')),
                 'Technischer Fehler. Bitte später erneut versuchen.');
    await schliessen();
  });
});
