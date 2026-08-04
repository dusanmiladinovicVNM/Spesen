# Spesenerfassung

Kompletno rešenje: PWA → Google Sheets → Excel šablon.
Bez Microsoft licenci, radi i za spoljne saradnike.

```
PWA  →  Apps Script Web-App  →  Google Sheets  →  CSV  →  Excel .xlsm
```

Sheets nikada nije javan. Sve ide kroz Apps Script, koji proverava sesiju,
radi dedup i računa MWSt. Identitet dolazi iz sesije, ne iz zahteva —
korisnik ne može uneti beleg pod tuđim imenom.

---

## Datoteke

```
apps-script/
  Code.gs                    ceo backend — prijava, unos, Fahrt, storno, CSV

pwa/
  index.html                 CIJELA aplikacija: CSS, HTML, logika, konfiguracija, logo
  manifest.webmanifest       ime i ikone za dodavanje na home screen
  icons/icon-192.png         ← zamijeni
  icons/icon-512.png         ← zamijeni

README.md                    ovaj fajl
EXCEL.md                     povezivanje šablona, hosting na SharePointu
```

Sve što se mijenja nalazi se u `index.html`, u tri označena bloka na vrhu:

| Blok | Šta je unutra |
|---|---|
| `:root` u `<style>` | boje; akcentna zelena je `#8FA426` |
| `<symbol id="logo">` | logotip — zamijeni sadržaj svojim SVG-om |
| `const CONFIG` | Web-App-URL iz Apps Scripta |

**Bez service workera.** Aplikacija ionako traži mrežu za svaku radnju,
pa cache donosi samo problem zastarjele verzije. Bez njega izmjena je
vidljiva odmah po otpremanju, bez podizanja verzije keša i bez tvrdog
osvježavanja kod korisnika. Ikona na home screenu radi i ovako —
na iPhoneu je nose `apple-mobile-web-app-*` meta oznake, na Androidu manifest.

---

## Faza 1 — Google Sheets (~30 min)

Nova tabela, pet listova. Prvi red je zaglavlje, imena kolona doslovno.

| List | Kolone |
|---|---|
| `Belege` | `Zeitstempel` `Mitarbeiter` `Email` `BelegNr` `Datum` `Monat` `Jahr` `Brutto` `MwstSatz` `MwstBetrag` `Netto` `KontoNr` `KontoBez` `KstNr` `KstBez` `Bemerkung` `DedupKey` `Storniert` `Art` `KM` `KmSatz` `BildUrl` |
| `Parameter` | `Schluessel` `Wert` `GueltigAb` |
| `Konten` | `Nr` `Bezeichnung` `Aktiv` `Sortierung` |
| `Kostenstellen` | `Nr` `Bezeichnung` `Aktiv` `Sortierung` |
| `Benutzer` | `Email` `Name` `PassHash` `Salt` `Aktiv` `Fehler` `GesperrtBis` `LetzterLogin` `OrdnerId` `PwGeaendert` `Rolle` |
| `Sessions` | `Token` `Email` `GueltigBis` |

Popuni `Konten` i `Kostenstellen`. `Aktiv` upisuj kao `true`.
`Sortierung` ostavi sa rupama (10, 20, 30) da kasnije možeš ubaciti nešto između.

U `Parameter` upiši najmanje dva reda:

| `Schluessel` | `Wert` | `GueltigAb` |
|---|---|---|
| `KmSatz` | `0.70` | `2026-01-01` |
| `KmKonto` | `6210` | |

`KmSatz` sme imati više redova sa različitim `GueltigAb` — server bira onaj
koji važi na datum belega. `KmKonto` je konto na koji se knjiže kilometri;
mora postojati u listu `Konten`.

**Kolone `Datum` i `GueltigAb` formatiraj kao običan tekst** —
`Format → Zahl → Nur Text`. Inače Sheets tumači `2026-07-31` kao datum
i vraća pomak vremenske zone.

Zapiši ID tabele iz URL-a, deo između `/d/` i `/edit`.

## Faza 2 — Apps Script (~45 min)

**Erweiterungen → Apps Script** iz same tabele.

1. Obriši sadržaj i zalepi `apps-script/Code.gs`
2. Na vrhu postavi `SHEET_ID`, `TOKEN_READ` i `PWA_URL`
3. **Bereitstellen → Neue Bereitstellung → Web-App**
   *Ausführen als: Ich*, *Zugriff: Jeder*
4. Prvi put traži odobrenje za pristup tabeli i slanje pošte — potvrdi
5. Zapiši **Web-App-URL**

Test u browseru:

```
<URL>?token=<TOKEN_READ>&format=csv
```

Mora vratiti CSV sa zaglavljem. Ako vidiš Google login stranicu,
`Zugriff` nije postavljen na *Jeder*.

**Svaka kasnija izmena koda traži novu verziju** —
*Bereitstellungen verwalten → Bearbeiten → Neue Version*.
Bez toga URL i dalje servira stari kod. Ovo je najčešći uzrok
„izmenio sam, a ništa se nije promenilo".

## Faza 3 — PWA (~20 min)

1. `index.html` → u bloku `const CONFIG` upiši Web-App-URL
2. `index.html` → u `<symbol id="logo">` zalijepi svoj SVG logotip;
   svijetla verzija, jer tamni logo na crnoj podlozi nestaje
3. `pwa/icons/` → kvadratne PNG ikone, **samo znak bez teksta**,
   oko 10% praznog ruba
4. Objavi sadržaj foldera `pwa/` na statični host sa HTTPS —
   Cloudflare Pages, Netlify, GitHub Pages

Kasnije izmjene: `index.html` uredi direktno u GitHub browseru,
ikonica olovke → **Commit changes**. Za minut je promjena vani.

HTTPS nije opcion: bez njega nema service workera, dakle nema ikone
na home screenu.

## Faza 4 — Prvi nalog (~15 min)

1. U `Benutzer` upiši **samo** svoj `Email` i `Name`
2. U Apps Scriptu pokreni `zugangVerschicken`
3. Stiže mejl sa lozinkom i linkom
4. Prijavi se u PWA i unesi jedan beleg

Provere na tom redu u `Belege`: `Mitarbeiter` je tvoje ime iz sesije,
`Datum` je onaj koji si uneo, `MwstSatz` je `0.081`, `Storniert` je `false`.

## Faza 5 — Excel

Detaljno u **`EXCEL.md`**. Ukratko:

1. **Daten → Aus dem Web**, URL sa `&format=csv`, autentifikacija **Anonym**
2. Prvi red kao zaglavlje, tipovi kolona, upit preimenuj u **`Belege`**
3. Učitaj u novi list, nazovi ga `Daten`, sakrij
4. Sačuvaj kao **.xlsm** sa `Workbook_Open` makroom — na Macu je to jedini
   način za automatsko osvežavanje

CSV isporučuje tačno dvanaest kolona u fiksnom redosledu, već filtrirane od
storniranih, sa `MwstSatz` podeljenim sa 100 i datumom u zoni Europe/Zurich.
Dodavanje kolone u list `Belege` ne menja ništa u Excelu.

**Fajl na SharePointu se ne otvara iz browsera** — Excel for Web ne osvežava
Power Query i to ne javlja. Sinhronizuj biblioteku i otvaraj ga iz Findera.

## Beleg-Foto

Fotografija ide u **Google Drive**, u tabelu samo link. Ćelija u Sheetsu
ima granicu od 50.000 znakova, pa slika u njoj nije opcija.

**Struktura foldera** — svaki radnik ima svoj:

```
Belegfotos/                        ← BILD_ORDNER
├── Dusan Miladinovic/
│   ├── 2026-07/
│   │   ├── 2026-07-14_45.80_R1123.jpg
│   │   └── 2026-07-31_12.00.jpg
│   └── 2026-08/
└── Peter Muster/
    └── 2026-08/
```

Mesečni podfolder isključuješ sa `BILD_MONATSORDNER = false`.

**Postavljanje:**

1. Napravi korenski folder, npr. `Belegfotos`
2. Iz URL-a prepiši ID i upiši ga u `BILD_ORDNER` u `Code.gs`
3. Dodaj kolonu `OrdnerId` na kraj lista `Benutzer` — ostavi je praznu
4. Pokreni `ordnerAnlegen()` u editoru; pravi foldere za sve i upisuje ID-eve
5. Prvi put Apps Script traži dozvolu za Drive — potvrdi

Korak 4 nije obavezan — folder se napravi i pri prvoj fotografiji. Ali se
tada pravi **dok korisnik čeka**, pa je bolje uraditi to unapred.

**Vezu drži ID, ne naziv.** Dva radnika smeju se zvati isto; naziv foldera
je kozmetika i sme se preimenovati u Driveu bez ikakve posledice.
Ako neko obriše folder, sledeća fotografija pravi novi.

**Slika se smanjuje u browseru** pre slanja — 1400 px duža ivica,
JPEG 72%, oko 200 KB. Bez tog koraka fotografija sa telefona je 4–8 MB,
u base64 preko 10 MB, i pada i Apps Script i mobilna veza.

**Dozvole.** Podrazumevano su fajlovi privatni (`BILD_OEFFENTLICH = false`).
Podeli **korenski folder** sa Google nalogom knjigovodstva — pristup se
nasleđuje na sve podfoldere, i to je jedina postavka koju treba dirati.

Radnicima ne treba pristup Driveu; oni šalju kroz aplikaciju.

Ako knjigovodstvo nema Google nalog, postavi `BILD_OEFFENTLICH = true` —
tada link iz kolone `BildUrl` radi bez prijave. Cena je da svako ko dobije
link vidi taj račun.

**Excel.** Kolona `BildUrl` ostaje izvan šablona. Knjigovodstvo otvara
sam Drive folder — struktura `Osoba / Mesec / Datum_Iznos` prati način
na koji ionako rade mesečni obračun.
Ako link ipak treba u tabeli, dodaj `BildUrl` u Power Query i u prvoj
slobodnoj koloni pored tabele stavi `=HYPERLINK(...)` — šablon se time
ne dira, samo se proširuje udesno.

**Storno ne briše sliku.** Storniranje je povratno, pa fajl ostaje.
Čišćenje po potrebi radi ručno u Driveu.

## Kilometerkosten

U formularu je prekidač **Beleg / Fahrt**. Kod vožnje korisnik unosi samo
datum, broj kilometara i kostenstelle; iznos se računa kao `km × KmSatz`.

Red završava u istom listu `Belege` sa `Art = Fahrt`, `MwstSatz = 0`
i `Bemerkung` u obliku `120 km à 0.70 — Zürich–Bern`. Excel šablon se
ne menja: vožnja je za njega običan red.

**Jedan unos po osobi i danu.** Ponovni unos za isti datum ne pravi drugi
red nego nudi zamenu postojećeg. Ključ je `email|datum|fahrt`.

Kolone `Art`, `KM` i `KmSatz` stoje na kraju lista i služe za kontrolu.
Power Query ih ne povlači, jer korak *Andere Spalten entfernen* nabraja
kolone poimence — ne diraj postojeći upit.

## Admin-Bereich

Korisnicima upravlja neko iz firme kroz samu aplikaciju, ne kroz tabelu.

**Ko je admin:** u koloni `Rolle` u listu `Benutzer` stoji `admin`.
Prvom adminu tu vrednost upisuješ ručno; on dalje može postavljati druge.

Admin u formularu vidi dugme **Benutzer verwalten**. Tamo može:

- dodati korisnika — jedan red, jedan mejl sa pristupom, sve automatski
- deaktivirati i ponovo aktivirati; deaktivacija odmah prekida sve sesije
- poslati novu lozinku — stara prestaje da važi
- dodeliti ili oduzeti admin prava

Uz svakog korisnika stoje oznake: *inaktiv*, *Admin*, *gesperrt*,
i *noch nicht angemeldet* dok nije postavio svoju lozinku.

**Sopstveni nalog ne može da se deaktivira ni da sebi oduzme prava.**
Bez toga bi jedan pogrešan klik ostavio firmu bez ijednog admina.

**Provera prava je na serveru, ne u aplikaciji.** Svaka `admin_*` akcija
prolazi kroz istu proveru role iz sesije. To što dugme kod običnog
korisnika nije vidljivo nije zaštita — klijent može poslati bilo šta.

`zugangVerschicken()` u editoru ostaje samo za prvi nalog.

## Faza 6 — Saradnici

1. Upiši sve u `Benutzer`, po jedan red, samo `Email` i `Name`
2. Pokreni `zugangVerschicken` — obrađuje samo redove bez hasha
3. Mejlovi idu sami, sa linkom i uputstvom za ikonu na iPhoneu

**Reset lozinke:** obriši `PassHash`, `Salt` i `PwGeaendert` u tom redu,
pa pokreni `zugangVerschicken` ponovo.
**Deaktivacija:** `Aktiv` na `false`. Postojeće sesije prestaju odmah.
**Odjava uređaja:** obriši red u `Sessions`.

---

## Test pre predaje

| # | Scenario | Očekivano |
|---|---|---|
| 1 | Pogrešna lozinka pet puta | šesti pokušaj odbijen i sa ispravnom lozinkom |
| 2 | Isti beleg dva puta | drugi put pitanje o duplikatu |
| 3 | Potvrda na to pitanje | prolazi |
| 4 | Iznos `45,80` i `45.80` | oba daju 45.80 |
| 5 | Beleg od 31.07. u avgustovskom periodu | `Datum` 31.07., `Monat` 8 |
| 6 | Beleg unet oko ponoći | datum se ne pomera |
| 7 | Storno, pa osvežavanje Excela | red nestaje iz šablona |
| 8 | Prijava kolege | vidi samo svoje belege |
| 9 | Avionski režim, pa Speichern | jasna poruka, bez tihog gubitka |
| 10 | Ikona na home screenu, ponovno otvaranje | prijava se ne traži |
| 11 | Fahrt: 120 km pri stopi 0.70 | `Brutto` 84.00, `MwstSatz` 0 |
| 12 | Druga Fahrt za isti dan | pitanje o zameni, ne drugi red |
| 13 | Fahrt sa datumom pre `GueltigAb` nove stope | računa se sa starom stopom |
| 14 | Beleg sa fotografijom | fajl u Driveu, link u `BildUrl` |
| 15 | Beleg bez fotografije | prolazi normalno, `BildUrl` prazan |
| 16 | Fotografija na slaboj vezi | dugme pokazuje napredak, bez tihog gubitka |
| 17 | Dva radnika sa fotografijama istog dana | svaka slika u svom folderu |
| 18 | Obrisan folder u Driveu, pa nova fotografija | folder se napravi ponovo |
| 19 | Prva prijava sa lozinkom iz mejla | traži postavljanje svoje lozinke, nema preskakanja |
| 20 | Posle promene lozinke | drugi uređaj traži ponovnu prijavu |
| 21 | Promena lozinke sa pogrešnom starom | odbijeno |
| 22 | Običan korisnik | dugme Benutzer verwalten nije vidljivo |
| 23 | Običan korisnik pošalje `admin_liste` ručno | odbijeno sa `keine Berechtigung` |
| 24 | Admin doda korisnika | red u tabeli, mejl stiže |
| 25 | Admin deaktivira korisnika koji je prijavljen | njegov sledeći zahtev traži prijavu |
| 26 | Admin pokuša da deaktivira sebe | odbijeno |

Test 1 zaključava nalog na 15 minuta — radi ga sa testnim nalogom.

---

## Šta ovaj model ne pokriva

**Lozinka iz mejla važi samo do prve prijave.** Kolona `PwGeaendert`
stoji na `false` dok korisnik ne postavi svoju; do tada ga aplikacija
ne pušta dalje od ekrana za promenu. Time mejl prestaje da bude ključ
čim se čovek jednom prijavi.

Promena lozinke **poništava sve sesije** te osobe, pa se izgubljen ili
tuđ uređaj odjavljuje sam.

Ostaje da lozinka jednom prođe kroz nešifrovanu poštu. Ako i to smeta,
zamena je Google Sign-In — `login` tada prima ID token umesto lozinke,
ostatak arhitekture se ne menja.

**Podaci su izvan tenanta firme.** Odluku o tome treba da potvrdi firma.

**Sheets nema verzionisanje kakvo ima SharePoint.** Funkcija `sicherung()`
u `Code.gs` pravi nedeljnu kopiju — zakači je na vremenski okidač.

**Nema offline unosa.** Aplikacija traži mrežu. Ako se pokaže da je
potrebno, dodaje se IndexedDB outbox bez izmene backenda.
