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

const TOKEN = 'csv-token-fuer-tests';

function welt(optionen) {
  const morgen = new Date(Date.now() + 86400000);
  const w = laden({
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
  }, optionen);
  w.props.TOKEN_READ = TOKEN;   // Skripteigenschaft wie nach tokenErneuern()
  return w;
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
const keineFormeln = w => {
  for (const n of ['Belege', 'Benutzer', 'Sessions', 'Konten', 'Kostenstellen']) {
    assert.deepEqual(w.blatt(n).formeln, [], 'Formel in ' + n);
  }
};

/** ein Zeichen sicher verändern (nicht zufällig gleich bleiben) */
const anders = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);


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
    const z = daten(w)[0];
    assert.equal(z[sp('Bemerkung')], '120 km à 0.70 — Zürich–Bern');
    assert.equal(z[sp('KontoBez')], 'Fahrzeugkosten');
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

  test('Nummer mit führender Null bleibt erhalten', () => {
    const w = welt();
    post(w, { session: 'T-ADMIN', action: 'admin_stamm_neu', liste: 'Konten', nr: '0700', bez: 'Neu' });
    assert.equal(beleg(w, { kontoNr: '0700', belegNr: '0012' }).ok, true);
    const z = daten(w)[0];
    assert.equal(z[sp('KontoNr')], '0700');
    assert.equal(z[sp('BelegNr')], '0012');
    assert.equal(w.blatt('Konten').zeilen.at(-1)[0], '0700');
  });
});


describe('Schreiben in Sheets', () => {
  test('Freitext wird nie zur Formel und kommt unverändert zurück', () => {
    const w = welt();
    const texte = ['=IMPORTXML("https://x";"//a")', '+41 44', '-Taxi', '@Bahnhof'];
    texte.forEach((t, i) => assert.equal(beleg(w, { bemerkung: t, belegNr: t, brutto: 10 + i }).ok, true, t));
    keineFormeln(w);
    assert.deepEqual(daten(w).map(z => z[sp('Bemerkung')]), texte);
    assert.deepEqual(daten(w).map(z => z[sp('BelegNr')]), texte);
  });

  test('Admin: Name mit Formelzeichen, Mailadresse mit + oder - vorne', () => {
    const w = welt();
    for (const email of ['-info@firma.ch', '+support@firma.ch']) {
      const r = post(w, { session: 'T-ADMIN', action: 'admin_neu', email, name: '=HACK()', mail: false });
      assert.equal(r.ok, true, email);
    }
    keineFormeln(w);
    const z = w.blatt('Benutzer').zeilen.at(-1);
    assert.equal(z[0], '+support@firma.ch');
    assert.equal(z[1], '=HACK()');
  });

  test('Passwort-Hash mit "+" vorne wird gespeichert und funktioniert', () => {
    // feste Salz, damit der Hash mit "+" beginnt (gesucht für diesen Test)
    const w = welt({ uuid: () => 'salz-plus' });
    const NEU = 'Neues-Passwort-52';
    assert.equal(w.gs.hashPass(NEU, 'salz-plus')[0], '+');

    const ben = w.blatt('Benutzer');
    ben.zeilen[2][2] = w.gs.hashPass('alt-passwort', 's');   // Mia
    assert.equal(post(w, { session: 'T-MIA', action: 'passwort', alt: 'alt-passwort', neu: NEU }).ok, true);
    keineFormeln(w);
    assert.equal(ben.zeilen[2][2], w.gs.hashPass(NEU, 'salz-plus'));
    assert.equal(post(w, { action: 'login', email: 'mia@x.ch', passwort: NEU }).ok, true);
  });

  test('CSV entschärft Formelzeichen für Excel', () => {
    const w = welt();
    beleg(w, { bemerkung: '=HYPERLINK("http://x";"Beleg")' });
    const csv = get(w, { format: 'csv', token: TOKEN }).getContent();
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x"";""Beleg""\)"/);
  });

  test('Tabelle wird je Anfrage nur einmal geöffnet', () => {
    const w = welt();
    w.zaehler.openById = 0;
    beleg(w);
    assert.equal(w.zaehler.openById, 1);
  });

  test('sheetsSelbsttest meldet überall ok', () => {
    const w = welt();
    w.gs.sheetsSelbsttest();
    const log = w.log();
    assert.equal(log.length, 7);
    assert.ok(log.every(z => z.startsWith('ok')), log.join('\n'));
  });
});


describe('Storno und Foto', () => {
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
  const zeileVon = (w, bem) => daten(w).findIndex(z => z[sp('Bemerkung')] === bem) + 2;
  const storniert = (w, bem) => w.blatt('Belege').zeilen[zeileVon(w, bem) - 1][sp('Storniert')] === true;

  test('trifft nach dem Umsortieren den richtigen Beleg', () => {
    const { w, liste } = mitBelegen();
    const eins = liste.find(b => b.Bemerkung === 'eins');
    // alte Zeilennummer zeigt jetzt auf einen anderen Beleg
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: eins.DedupKey, zeile: eins._zeile }).ok, true);
    assert.equal(storniert(w, 'eins'), true);
    assert.equal(storniert(w, 'zwei'), false);
    assert.equal(storniert(w, 'admin'), false);
  });

  test('zwei Zeilen mit gleichem Schlüssel: es trifft die angetippte', () => {
    const w = welt();
    beleg(w, { bemerkung: 'original' });
    const b = w.blatt('Belege');
    const kopie = b.zeilen[1].slice(); kopie[sp('Bemerkung')] = 'kopie';
    b.zeilen.push(kopie);                                  // Buchhaltung kopiert die Zeile
    const key = kopie[sp('DedupKey')];
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key, zeile: 3 }).ok, true);
    assert.equal(storniert(w, 'kopie'), true);
    assert.equal(storniert(w, 'original'), false);
  });

  test('fremder oder schon stornierter Beleg: nicht gefunden', () => {
    const { w, liste } = mitBelegen();
    const adminKey = daten(w).find(z => z[sp('Bemerkung')] === 'admin')[sp('DedupKey')];
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: adminKey }).error, 'nicht gefunden');
    const zwei = liste.find(b => b.Bemerkung === 'zwei');
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: zwei.DedupKey }).ok, true);
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', key: zwei.DedupKey }).error, 'nicht gefunden');
  });

  test('nur Zeilennummer (alte App): nur für Zeilen ohne Schlüssel', () => {
    const { w } = mitBelegen();
    // Beleg mit Schlüssel: Zeilennummer allein reicht nicht mehr
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', zeile: zeileVon(w, 'zwei') }).error, 'nicht gefunden');
    assert.equal(storniert(w, 'zwei'), false);
    // von Hand erfasste Zeile ohne Schlüssel
    const b = w.blatt('Belege');
    const alt = daten(w).find(z => z[sp('Bemerkung')] === 'eins').slice();
    alt[sp('DedupKey')] = ''; alt[sp('Bemerkung')] = 'ohne Schlüssel';
    b.zeilen.push(alt);
    assert.equal(post(w, { session: 'T-MIA', action: 'storno', zeile: b.zeilen.length }).ok, true);
    assert.equal(storniert(w, 'ohne Schlüssel'), true);
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
    keineFormeln(w);
  });

  test('ändern und schützen', () => {
    const w = welt();
    assert.equal(admin(w, { action: 'admin_stamm_aendern', liste: 'Konten', nr: '4430', bez: '-Reise', sort: '' }).ok, true);
    assert.equal(w.blatt('Konten').zeilen[1][1], '-Reise');
    keineFormeln(w);
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Konten', nr: '6210' }).error, 'Kilometerkonto');
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Kostenstellen', nr: '821' }).aktiv, false);
    assert.equal(admin(w, { action: 'admin_stamm_aktiv', liste: 'Kostenstellen', nr: '995' }).error, 'letzter Eintrag');
  });

  test('Benutzerliste nennt die eigene Adresse', () => {
    const w = welt();
    assert.equal(post(w, { session: 'T-ADMIN', action: 'admin_liste' }).ich, 'admin@x.ch');
  });
});


describe('Foto-Link für Excel', () => {
  test('CSV liefert BildLink auf foto.html, die Signatur öffnet genau ein Foto', () => {
    const w = welt();
    beleg(w);
    const csv = get(w, { format: 'csv', token: TOKEN }).getContent().split('\n');
    assert.match(csv[0], /"BildUrl","BildLink"$/);
    const link = JSON.parse('[' + csv[1] + ']').pop();
    assert.ok(link.startsWith(w.konst('PWA_URL') + 'foto.html?id='), link);

    const q = Object.fromEntries(new URL(link).searchParams);
    const r = json(get(w, { format: 'foto', id: q.id, sig: q.sig }));
    assert.equal(r.ok, true);
    assert.match(r.name, /^Mia Muster 2026-08-04_45\.80/);
    assert.equal(json(get(w, { format: 'foto', id: q.id, sig: anders(q.sig, 0) })).error, 'ungültig');
    assert.equal(json(get(w, { format: 'foto', id: anders(q.id, q.id.length - 1), sig: q.sig })).error, 'ungültig');
  });

  test('CSV ohne gültigen Token: abgelehnt', () => {
    const w = welt();
    assert.equal(json(get(w, { format: 'csv', token: anders(TOKEN, 0) })).error, 'auth');
  });
});


describe('CSV-Token', () => {
  test('steht in den Skripteigenschaften, nicht im Code', () => {
    const w = welt();
    assert.throws(() => w.konst('TOKEN_READ'), /TOKEN_READ is not defined/);
    assert.match(get(w, { format: 'csv', token: TOKEN }).getContent(), /^"Datum"/);
    delete w.props.TOKEN_READ;
    // ohne Eigenschaft gilt kein Token — auch nicht der alte Platzhalter
    assert.equal(json(get(w, { format: 'csv', token: 'HIER_LANGER_ZUFALLSSTRING' })).error, 'auth');
    assert.equal(json(get(w, { format: 'csv', token: '' })).error, 'auth');
  });

  test('tokenErneuern: neuer, langer Token, der alte gilt sofort nicht mehr', () => {
    const w = welt();
    const neu = w.gs.tokenErneuern();
    assert.match(neu, /^[0-9a-f]{64}$/);
    assert.equal(w.props.TOKEN_READ, neu);
    assert.notEqual(w.gs.tokenErneuern(), neu);
    assert.equal(json(get(w, { format: 'csv', token: neu })).error, 'auth');
    assert.match(get(w, { format: 'csv', token: w.props.TOKEN_READ }).getContent(), /^"Datum"/);
  });
});


describe('Zufall', () => {
  test('Passwörter ohne Math.random, 12 Zeichen aus dem Alphabet, verschieden', () => {
    const w = welt();
    w.ausfuehren('Math.random = () => { throw new Error("Math.random benutzt"); }');
    const pws = Array.from({ length: 200 }, () => w.gs.zufallPasswort());
    pws.forEach(pw => assert.match(pw, /^[a-km-np-zA-HJ-NP-Z2-9]{12}$/));
    assert.equal(new Set(pws).size, 200);
    // auch der echte Weg über die Verwaltung
    const r = post(w, { session: 'T-ADMIN', action: 'admin_neu', email: 'neu@x.ch', name: 'Neu', mail: false });
    assert.equal(r.ok, true);
    assert.match(r.pw, /^[a-km-np-zA-HJ-NP-Z2-9]{12}$/);
  });
});


describe('Anmeldung und Sitzungen', () => {
  function mitPasswort() {
    const w = welt();
    const ben = w.blatt('Benutzer');
    ben.zeilen[1][2] = w.gs.hashPass('geheim123', 's');   // Admin
    ben.zeilen[2][2] = w.gs.hashPass('geheim123', 's');   // Mia
    return w;
  }
  const login = (w, email, passwort) => post(w, { action: 'login', email, passwort });

  test('in Sessions steht nur der Hash, das Token selbst funktioniert', () => {
    const w = mitPasswort();
    const r = login(w, 'mia@x.ch', 'geheim123');
    assert.equal(r.ok, true);
    const zeile = w.blatt('Sessions').zeilen.at(-1);
    assert.notEqual(zeile[0], r.session);
    assert.equal(zeile[0], w.gs.tokenHash(r.session));
    assert.equal(post(w, { session: r.session, action: 'stammdaten' }).ok, true);
    assert.equal(post(w, { session: zeile[0], action: 'stammdaten' }).error, 'session', 'Hash allein reicht nicht');
  });

  test('alte Sitzung im Klartext funktioniert weiter und wird umgestellt', () => {
    const w = welt();
    assert.equal(post(w, { session: 'T-MIA', action: 'stammdaten' }).ok, true);
    const zeile = w.blatt('Sessions').zeilen.find(z => z[1] === 'mia@x.ch');
    assert.equal(zeile[0], w.gs.tokenHash('T-MIA'));
    assert.equal(post(w, { session: 'T-MIA', action: 'stammdaten' }).ok, true);
  });

  test('Lesen per POST, ohne die Sperre zu belegen', () => {
    const w = welt();
    beleg(w);
    const liste = post(w, { session: 'T-MIA', action: 'meine', monat: '8', jahr: '2026' });
    w.zaehler.sperren = 0;
    assert.equal(post(w, { session: 'T-MIA', action: 'stammdaten' }).ok, true);
    assert.equal(post(w, { session: 'T-MIA', action: 'meine', monat: '8', jahr: '2026' }).belege.length, 1);
    assert.equal(post(w, { session: 'T-MIA', action: 'bild', key: liste.belege[0].DedupKey }).ok, true);
    assert.equal(w.zaehler.sperren, 0);
    beleg(w, { brutto: 99 });
    assert.equal(w.zaehler.sperren, 1, 'Schreiben belegt die Sperre');
  });

  test('ohne richtiges Passwort verrät die Antwort nichts über das Konto', () => {
    const w = mitPasswort();
    w.blatt('Benutzer').zeilen[2][4] = false;            // Mia inaktiv
    assert.equal(login(w, 'niemand@x.ch', 'falsch').error, 'login');
    assert.equal(login(w, 'admin@x.ch', 'falsch').error, 'login');
    assert.equal(login(w, 'mia@x.ch', 'falsch').error, 'login', 'inaktiv erst mit richtigem Passwort');
    assert.equal(login(w, 'mia@x.ch', 'geheim123').error, 'inaktiv');
  });

  test('gleiche Rechenzeit mit und ohne Konto', () => {
    const w = mitPasswort();
    w.zaehler.digest = 0; login(w, 'niemand@x.ch', 'falsch'); const ohne = w.zaehler.digest;
    w.zaehler.digest = 0; login(w, 'admin@x.ch', 'falsch');   const mit  = w.zaehler.digest;
    assert.ok(ohne >= 5000, 'auch ohne Konto wird gehasht');
    assert.ok(Math.abs(ohne - mit) <= 2, ohne + ' / ' + mit);
  });

  test('Sperre nach MAX_FEHLER, mit und ohne Konto gleich', () => {
    const w = mitPasswort();
    const max = w.konst('MAX_FEHLER');
    for (const email of ['niemand@x.ch', 'admin@x.ch']) {
      const antworten = Array.from({ length: max + 1 }, () => login(w, email, 'falsch').error);
      assert.deepEqual(antworten, [...Array(max).fill('login'), 'gesperrt'], email);
    }
    assert.equal(login(w, 'admin@x.ch', 'geheim123').error, 'gesperrt', 'auch mit richtigem Passwort');
  });
});


describe('Fehlermeldungen', () => {
  test('technische Details gehen ins Protokoll, nicht zum Client', () => {
    const w = welt();
    w.loeschen('Belege');
    const r = beleg(w);
    assert.equal(r.error, 'serverfehler');
    assert.equal(JSON.stringify(r).includes('TypeError'), false);
    assert.ok(w.konsole.some(z => z.includes('TypeError')), 'Details im Protokoll');
    assert.equal(post(w, { session: 'T-MIA', action: 'meine', monat: '8', jahr: '2026' }).error, 'serverfehler');
  });

  test('Fehler beim Foto: nur der Code "bild"', () => {
    const w = welt();
    w.drive.ordner.clear();                              // Belegfotos-Ordner fehlt
    const r = beleg(w);
    assert.equal(r.error, 'bild');
    assert.ok(w.konsole.some(z => z.startsWith('bildSpeichern')));
  });

  test('kaputte Anfrage', () => {
    const w = welt();
    assert.equal(json(w.gs.doPost({ postData: { contents: '{kein json' } })).error, 'anfrage');
  });
});
