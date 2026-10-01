'use strict';
/* Tests für apps-script/Code.gs — ausführen mit:  node --test tests/*.test.js */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { laden, json } = require('./gas');

const BELEGE = ['Zeitstempel', 'Mitarbeiter', 'Email', 'BelegNr', 'Datum', 'Monat', 'Jahr',
  'Brutto', 'MwstSatz', 'MwstBetrag', 'Netto', 'KontoNr', 'KontoBez', 'KstNr', 'KstBez',
  'Bemerkung', 'DedupKey', 'Storniert', 'Art', 'KM', 'KmSatz', 'BildUrl'];
const BENUTZER = ['Email', 'Name', 'PassHash', 'Salt', 'Aktiv', 'Fehler', 'GesperrtBis',
  'LetzterLogin', 'OrdnerId', 'PwGeaendert', 'Rolle'];
const sp = n => BELEGE.indexOf(n);

function welt() {
  const morgen = new Date(Date.now() + 86400000);
  return laden({
    Belege: [BELEGE],
    Konten: [['Nr', 'Bezeichnung', 'Aktiv', 'Sortierung'],
      [4430, 'Reisekosten', true, 10], [6210, 'Fahrzeugkosten', true, 20], [5000, 'Alt', false, 30]],
    Kostenstellen: [['Nr', 'Bezeichnung', 'Aktiv', 'Sortierung'],
      [995, 'Allgemein', true, 10], [821, 'Projekt', true, 20]],
    Parameter: [['Schluessel', 'Wert', 'GueltigAb'],
      ['KmSatz', 0.7, '2026-01-01'], ['KmKonto', '6210', '2026-01-01']],
    Benutzer: [BENUTZER,
      ['admin@x.ch', 'Ada Admin', 'h', 's', true, 0, '', '', '', true, 'admin'],
      ['mia@x.ch', 'Mia Muster', 'h', 's', true, 0, '', '', '', true, '']],
    Sessions: [['Token', 'Email', 'GueltigBis'],
      ['T-ADMIN', 'admin@x.ch', morgen], ['T-MIA', 'mia@x.ch', morgen]]
  });
}

const post = (w, body) => json(w.gs.doPost({ postData: { contents: JSON.stringify(body) } }));
const get  = (w, p) => w.gs.doGet({ parameter: p });

const BELEG = {
  session: 'T-MIA', belegNr: '', datum: '2026-08-04', monat: '8', jahr: '2026',
  brutto: 45.8, mwstSatz: 8.1, kontoNr: '4430', kstNr: '995',
  bemerkung: 'Hotel Bern', bild: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
};
const FAHRT = {
  session: 'T-MIA', art: 'fahrt', km: 120, datum: '2026-08-05', monat: '8', jahr: '2026',
  kstNr: '995', bemerkung: 'Zürich–Bern'
};
const beleg = (w, x) => post(w, Object.assign({}, BELEG, x));
const fahrt = (w, x) => post(w, Object.assign({}, FAHRT, x));
const daten = w => w.blatt('Belege').zeilen.slice(1);


describe('Pflichtfelder', () => {
  test('gültiger Beleg wird gespeichert, mit Foto in Drive', () => {
    const w = welt();
    assert.equal(beleg(w).ok, true);
    const z = daten(w)[0];
    assert.equal(z[sp('Mitarbeiter')], 'Mia Muster');
    assert.equal(z[sp('MwstSatz')], 0.081);
    assert.match(z[sp('BildUrl')], /^https:\/\/drive\.google\.com\/file\/d\//);
  });

  test('jedes fehlende Feld beim Beleg hat seinen Code', () => {
    const w = welt();
    const faelle = {
      betrag: { brutto: '' }, konto: { kontoNr: '' }, datum: { datum: '4.8.2026' },
      periode: { monat: '13' }, mwst: { mwstSatz: '' }, bemerkung: { bemerkung: '  ' },
      foto: { bild: '' }
    };
    for (const [code, x] of Object.entries(faelle)) assert.equal(beleg(w, x).error, code, code);
    assert.equal(beleg(w, { jahr: '' }).error, 'periode');
    assert.equal(daten(w).length, 0, 'nichts geschrieben');
  });

  test('MWSt 0 % ist gültig, fehlender Satz nicht', () => {
    const w = welt();
    assert.equal(beleg(w, { mwstSatz: 0 }).ok, true);
    assert.equal(beleg(w, { mwstSatz: undefined, brutto: 9 }).error, 'mwst');
  });

  test('Fahrt braucht Datum, Periode, Kostenstelle und Zweck', () => {
    const w = welt();
    assert.equal(fahrt(w, { bemerkung: '' }).error, 'zweck');
    assert.equal(fahrt(w, { monat: '' }).error, 'periode');
    assert.equal(fahrt(w, { kstNr: '' }).error, 'konto');
    const r = fahrt(w);
    assert.equal(r.ok, true);
    assert.equal(r.brutto, 84);
    assert.equal(daten(w)[0][sp('Bemerkung')], '120 km à 0.70 — Zürich–Bern');
  });
});


describe('Konto und Kostenstelle', () => {
  test('inaktives oder unbekanntes Konto wird abgelehnt', () => {
    const w = welt();
    assert.equal(beleg(w, { kontoNr: '5000' }).error, 'stamm');
    assert.equal(beleg(w, { kstNr: '777' }).error, 'stamm');
    assert.equal(fahrt(w, { kstNr: '777' }).error, 'stamm');
  });

  test('Bezeichnung kommt aus den Stammdaten, nicht aus der Anfrage', () => {
    const w = welt();
    beleg(w, { kontoBez: '<b>gefälscht</b>', kstBez: 'auch' });
    const z = daten(w)[0];
    assert.equal(z[sp('KontoBez')], 'Reisekosten');
    assert.equal(z[sp('KstBez')], 'Allgemein');
  });
});


describe('Formeln in Sheets', () => {
  test('alsText setzt ein Apostroph vor = + - @', () => {
    const { gs } = welt();
    assert.equal(gs.alsText('=1+1'), "'=1+1");
    assert.equal(gs.alsText('+41 44'), "'+41 44");
    assert.equal(gs.alsText('-5% Rabatt'), "'-5% Rabatt");
    assert.equal(gs.alsText('@x'), "'@x");
    assert.equal(gs.alsText('Hotel = gut'), 'Hotel = gut');
    assert.equal(gs.alsText(''), '');
    assert.equal(gs.alsText(null), '');
  });

  test('Freitext im Beleg wird als Text geschrieben', () => {
    const w = welt();
    beleg(w, { bemerkung: '=IMPORTXML("https://x";"//a")', belegNr: '+41' });
    const z = daten(w)[0];
    assert.equal(z[sp('Bemerkung')], '\'=IMPORTXML("https://x";"//a")');
    assert.equal(z[sp('BelegNr')], "'+41");
  });

  test('Admin: Name als Text, Mailadresse ohne Formelzeichen', () => {
    const w = welt();
    assert.equal(post(w, { session: 'T-ADMIN', action: 'admin_neu', email: '=x@y.ch', name: 'X', mail: false }).error,
                 'ungültige Mailadresse');
    assert.equal(post(w, { session: 'T-ADMIN', action: 'admin_neu', email: 'neu@y.ch', name: '=HACK()', mail: false }).ok, true);
    assert.equal(w.blatt('Benutzer').zeilen.at(-1)[1], "'=HACK()");
  });
});


describe('Storno und Foto über den Schlüssel', () => {
  function mitBelegen() {
    const w = welt();
    beleg(w, { brutto: 10, bemerkung: 'eins' });
    beleg(w, { brutto: 20, bemerkung: 'zwei' });
    beleg(w, { session: 'T-ADMIN', brutto: 30, bemerkung: 'admin' });
    const liste = json(get(w, { session: 'T-MIA', action: 'meine', monat: '8', jahr: '2026' })).belege;
    // jemand sortiert die Tabelle von Hand um
    const b = w.blatt('Belege');
    b.zeilen = [b.zeilen[0], ...b.zeilen.slice(1).reverse()];
    return { w, liste };
  }
  const storniert = (w, bem) =>
    daten(w).find(z => z[sp('Bemerkung')] === bem)[sp('Storniert')] === true;

  test('trifft nach dem Umsortieren den richtigen Beleg', () => {
    const { w, liste } = mitBelegen();
    const eins = liste.find(b => b.Bemerkung === 'eins');
    // alte Zeilennummer zeigt jetzt auf den Beleg der Admin
    const r = post(w, { session: 'T-MIA', action: 'storno', key: eins.DedupKey, zeile: eins._zeile });
    assert.equal(r.ok, true);
    assert.equal(storniert(w, 'eins'), true);
    assert.equal(storniert(w, 'admin'), false);
    assert.equal(storniert(w, 'zwei'), false);
  });

  test('fremder oder schon stornierter Beleg: nicht gefunden', () => {
    const { w, liste } = mitBelegen();
    const adminKey = daten(w).find(z => z[sp('Bemerkung')] === 'admin')[sp('DedupKey')];
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: adminKey }).error, 'nicht gefunden');
    const zwei = liste.find(b => b.Bemerkung === 'zwei');
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: zwei.DedupKey }).ok, true);
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: zwei.DedupKey }).error, 'nicht gefunden');
  });

  test('ohne Schlüssel gilt die Zeilennummer, aber nur für eigene Belege', () => {
    const { w } = mitBelegen();
    const zeileAdmin = daten(w).findIndex(z => z[sp('Bemerkung')] === 'admin') + 2;
    const zeileMia   = daten(w).findIndex(z => z[sp('Bemerkung')] === 'zwei') + 2;
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', zeile: zeileAdmin }).error, 'nicht gefunden');
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', zeile: zeileMia }).ok, true);
    assert.equal(storniert(w, 'zwei'), true);
  });

  test('Foto über den Schlüssel nach dem Umsortieren', () => {
    const { w, liste } = mitBelegen();
    const eins = liste.find(b => b.Bemerkung === 'eins');
    const r = json(get(w, { session: 'T-MIA', action: 'bild', key: eins.DedupKey, zeile: eins._zeile }));
    assert.equal(r.ok, true);
    assert.match(r.bild, /^data:image\/jpeg;base64,/);
  });
});


describe('Konten und Kostenstellen verwalten', () => {
  const admin = (w, x) => post(w, Object.assign({ session: 'T-ADMIN' }, x));

  test('nur für Admins', () => {
    const w = welt();
    assert.equal(post(w, { session: 'T-MIA', action: 'admin_stamm' }).error, 'keine Berechtigung');
  });

  test('anlegen, doppelt, inaktiv, ungültig', () => {
    const w = welt();
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Konten', nr: '0700', bez: 'Neu' }).ok, true);
    assert.deepEqual(w.blatt('Konten').zeilen.at(-1), ['0700', 'Neu', true, 40]);
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Konten', nr: '4430', bez: 'x' }).error, 'existiert bereits');
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Konten', nr: '5000', bez: 'x' }).error, 'existiert inaktiv');
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Konten', nr: '<b>', bez: 'x' }).error, 'Nr ungültig');
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Konten', nr: '7', bez: '=x' }).error, 'Bezeichnung ungültig');
    assert.equal(admin(w, { action: 'admin_stamm_neu', liste: 'Benutzer', nr: '7', bez: 'x' }).error, 'unbekannte Liste');
  });

  test('ändern und schützen', () => {
    const w = welt();
    assert.equal(admin(w, { action: 'admin_stamm_aendern', liste: 'Konten', nr: '4430', bez: 'Reise', sort: '' }).ok, true);
    assert.equal(w.blatt('Konten').zeilen[1][1], 'Reise');
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Konten', nr: '6210' }).error, 'Kilometerkonto');
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Kostenstellen', nr: '821' }).aktiv, false);
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Kostenstellen', nr: '995' }).error, 'letzter Eintrag');
  });
});


describe('Foto-Link für Excel', () => {
  test('CSV liefert BildLink auf foto.html, die Signatur öffnet genau ein Foto', () => {
    const w = welt();
    beleg(w);
    const csv = get(w, { format: 'csv', token: 'HIER_LANGER_ZUFALLSSTRING' }).getContent().split('\n');
    assert.match(csv[0], /"BildUrl","BildLink"$/);
    const link = JSON.parse('[' + csv[1] + ']').pop();
    assert.match(link, /^https:\/\/dusanmiladinovicvnm\.github\.io\/Spesen\/foto\.html\?id=[-\w]{25,}&sig=[-\w]+$/);

    const q = Object.fromEntries(new URL(link).searchParams);
    const r = json(get(w, { format: 'foto', id: q.id, sig: q.sig }));
    assert.equal(r.ok, true);
    assert.match(r.name, /^Mia Muster 2026-08-04_45\.80/);
    assert.equal(json(get(w, { format: 'foto', id: q.id, sig: 'x' + q.sig.slice(1) })).error, 'ungültig');
    assert.equal(json(get(w, { format: 'foto', id: q.id.slice(0, -1) + 'Z', sig: q.sig })).error, 'ungültig');
  });

  test('CSV ohne gültigen Token: abgelehnt', () => {
    const w = welt();
    assert.equal(json(get(w, { format: 'csv', token: 'falsch' })).error, 'auth');
  });
});
