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
| `Benutzer` | `Email` `Name` `PassHash` `Salt` `Aktiv` `Fehler` `GesperrtBis` `LetzterLogin` `OrdnerId` |
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

## Faza 5 — Excel (~30 min)

Šablon se ne prepravlja. Podaci ulaze u skriveni list, šablon ih
dohvata postojećom `FILTER` formulom.

1. **Daten → Daten abrufen → Aus anderen Quellen → Aus dem Web**

   ```
   <Web-App-URL>?token=<TOKEN_READ>&format=csv
   ```

   Autentifikacija: **Anonym**

2. **Erste Zeile als Überschriften verwenden**
3. Zadrži i poređaj kolone kako ih traži šablon:
   `Datum`, `Brutto`, `MwstSatz`, `KontoNr`, `KstNr`, `Bemerkung`,
   pa `Mitarbeiter`, `Monat`, `Jahr`
4. Tipovi: `Datum` → Datum, novčane → Dezimalzahl, `Monat`/`Jahr` → Ganze Zahl
5. Upit preimenuj u **`Belege`** — naziv upita postaje naziv tabele,
   a formula u šablonu referiše `Belege[…]`
6. **Schließen und laden in… → Tabelle → Neues Arbeitsblatt**,
   list nazovi `Daten` i sakrij ga

Filtriranje storniranih i deljenje `MwstSatz` sa 100 **ne rade se ovde** —
Apps Script ih već isporučuje gotove.

### Automatsko osvežavanje na Macu

Excel za Mac nema *Aktualisieren beim Öffnen der Datei* za Power Query,
ali VBA radi. Sačuvaj kao **.xlsm** i u `DieseArbeitsmappe`:

```vba
Private Sub Workbook_Open()
    On Error Resume Next
    ThisWorkbook.RefreshAll
End Sub
```

`On Error Resume Next` je namerno: bez mreže makro tiho stane
umesto da izbaci dijalog s greškom.

### Formule u šablonu

Ostaju nepromenjene. Pomoćni list `Hilfe` sa nazivima meseci u `A1:A12`,
ćelija `$Y$1` sa `VERGLEICH`, i u prvoj ćeliji tabele:

```
=SORTIEREN(FILTER(Belege[[Datum]:[Bemerkung]];(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3);"");1)
```

Spojene ćelije u području u koje se formula prosipa obaraju je
greškom `#ÜBERLAUF!` — odspoji ih pre svega ostalog.

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

## Faza 6 — Saradnici

1. Upiši sve u `Benutzer`, po jedan red, samo `Email` i `Name`
2. Pokreni `zugangVerschicken` — obrađuje samo redove bez hasha
3. Mejlovi idu sami, sa linkom i uputstvom za ikonu na iPhoneu

**Reset lozinke:** obriši `PassHash` i `Salt` u tom redu, pokreni ponovo.
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

Test 1 zaključava nalog na 15 minuta — radi ga sa testnim nalogom.

---

## Šta ovaj model ne pokriva

**Lozinka putuje mejlom u čitljivom obliku** i ostaje u sandučetu.
Ko ima pristup mejlu saradnika, ima i pristup formularu.
Endpoint `passwortAendern` postoji u `Code.gs` — treba mu samo mali
ekran u PWA, i to bih dodao pre nego što ideš u širu upotrebu.

**Podaci su izvan tenanta firme.** Odluku o tome treba da potvrdi firma.

**Sheets nema verzionisanje kakvo ima SharePoint.** Funkcija `sicherung()`
u `Code.gs` pravi nedeljnu kopiju — zakači je na vremenski okidač.

**Nema offline unosa.** Aplikacija traži mrežu. Ako se pokaže da je
potrebno, dodaje se IndexedDB outbox bez izmene backenda.
