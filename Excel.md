# Excel šablon

`.xlsm` na SharePointu, list `Vorlage`. Šablon se ne prepravlja: podaci
ulaze u skriveni list `Daten`, a šablon ih dohvata formulom.

![List Vorlage](excel/vorlage.png)

```
Apps Script ─CSV─▶ Power Query (tabela Belege, list Daten) ─FILTER─▶ Vorlage B7:G31 i J7:J31
klik na J ─▶ foto.html (GitHub Pages) ─fetch─▶ Apps Script ─▶ download u Downloads
```

---

## 1. Power Query

1. **Daten → Daten abrufen → Aus anderen Quellen → Aus dem Web**

   ```
   <Web-App-URL>?token=<TOKEN_READ>&format=csv
   ```

   Autentifikacija: **Anonym**

2. **Erste Zeile als Überschriften verwenden**
3. Zadrži kolone `Datum`, `Brutto`, `MwstSatz`, `KontoNr`, `KstNr`,
   `Bemerkung`, `Mitarbeiter`, `Monat`, `Jahr` i **`BildLink`**
4. Tipovi: `Datum` → Datum, novčane → Dezimalzahl, `Monat`/`Jahr` → Ganze Zahl,
   `BildLink` → Text
5. Upit preimenuj u **`Belege`**. Naziv upita postaje naziv tabele,
   a formule u šablonu referišu `Belege[…]`.
6. **Schließen und laden in… → Tabelle → Neues Arbeitsblatt**,
   list nazovi `Daten` i sakrij ga

Filtriranje storniranih i deljenje `MwstSatz` sa 100 **ne rade se ovde**,
jer ih Apps Script već isporučuje gotove.

## 2. Automatsko osvežavanje na Macu

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

## 3. Formule u šablonu

Pomoćni list `Hilfe` sa nazivima meseci u `A1:A12`, ćelija `$Y$1` sa
`VERGLEICH`, i u `B7`:

```
=SORTIEREN(FILTER(Belege[[Datum]:[Bemerkung]];(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3);"");1)
```

Spojene ćelije u području u koje se formula prosipa obaraju je
greškom `#ÜBERLAUF!`. Odspoji ih pre svega ostalog.

---

## 4. Kolona Foto

U koloni **J**, desno od tabele, svaki red sa fotografijom dobija link
**Herunterladen**. Klik otvara browser, a fotografija se odmah snima u
Downloads kao `Jovica Miladinovic 2026-08-04_100.50_R1123.jpg`. Ista stranica
je i prikazuje, uz dugme za ponovni pokušaj.

Nema makroa i ništa se ne instalira. Radi na Macu i Windowsu, za ljude bez
Google naloga i u browseru koji je prijavljen na više Google naloga.

### Kako radi

- **CSV sadrži kolonu `BildLink`.** Apps Script je računa pri svakom
  osvežavanju, ne stoji u tabeli. Link vodi na `foto.html` pored aplikacije
  (GitHub Pages), a ta stranica fotografiju preuzima od Apps Scripta.
- **Zašto ne direktno Apps Script stranica:** ako je browser prijavljen na
  više Google naloga, Google ubaci `/u/N/` u adresu i prikaže *Datei kann
  derzeit nicht geöffnet werden*. `foto.html` zahtev šalje bez Google
  kolačića, kao i aplikacija, pa je to ne pogađa.
- **Link je potpisan.** Otvara samo tu jednu fotografiju i ne sadrži
  `TOKEN_READ`. Ključ za potpis Apps Script sam napravi u Script Properties
  (`FOTO_SCHLUESSEL`). Ako ga obrišeš, svi stari linkovi prestaju da važe, a
  Excel posle sledećeg osvežavanja ima nove.
- **Formula filtrira i sortira isto kao `B7`**, samo uzima `BildLink`. Zato
  red 7 dobija link prvog belega, red 8 drugog, i tako dalje (`ZEILE()-6`).
  Ako ikad menjaš uslove u `B7`, promeni ih i ovde.
- **Svaka ćelija ima svoju formulu**, umesto jedne koja se prosipa, da bi link
  u svakoj ćeliji sigurno bio klikabilan.
- **Greška namerno nije sakrivena.** Ako `BildLink` fali u tabeli, ćelija
  pokazuje `#BEZUG!` umesto da tiho ostane prazna.

### Postavljanje, jednom za fajl

1. **`BildLink` u Power Query.** Otvori **Daten → Daten abrufen → Power
   Query-Editor starten**, upit `Belege`.
   - Korak *Quelle*: ako formula sadrži `Columns=12`, promeni u `Columns=13`.
     Inače Power Query tiho odseca novu, 13. kolonu.
   - Korak *Andere entfernte Spalten* nabraja kolone poimence. Dodaj
     `"BildLink"` na kraj liste.
   - **Schließen & laden.** Tabela `Belege` sada ima kolonu `BildLink`.
2. U `J5` upiši `Foto`.
3. U `J7` upiši formulu ispod i kopiraj je do `J31`.
4. Sačuvaj i otpremi na SharePoint.

```
=LET(z;(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3);n;SUMME(z);i;ZEILE()-6;WENN(i>n;"";LET(u;INDEX(SORTIEREN(FILTER(HSTAPELN(Belege[Datum];Belege[BildLink]);z);1);i;2);WENN(LINKS(u;4)="http";HYPERLINK(u;"Herunterladen");""))))
```

Kolona `I` je sakrivena grupisanjem. Ne koristi je, jer `J` je prva vidljiva.

**U SharePoint folder:** fotografiju sa stranice prevuci mišem direktno u
sinhronizovani SharePoint folder u Finderu. Automatsko kopiranje u
SharePoint nije moguće bez registracije aplikacije u Microsoft 365 ili
Power Automate, jer SharePoint prima fajlove samo od prijavljenog
Microsoft naloga.

### Problemi

| Simptom | Uzrok |
|---|---|
| `J7` pokazuje `#BEZUG!` ili `#NAME?` | `BildLink` nije u tabeli `Belege` (korak 1), ili Excel nema `HSTAPELN` (potreban Microsoft 365) |
| Fotografija postoji u aplikaciji, a link nema | Excel nije osvežen (**Daten → Alle aktualisieren**) |
| Stranica kaže *Dieser Link ist ungültig* | ključ za potpis je promenjen; osveži Excel |
| Stranica stoji na *Foto wird geladen …* ili javlja *Keine Verbindung* | `API` u `foto.html` nije ista adresa kao `CONFIG.url` u `index.html` |
| Fotografija se prikaže, ali nema downloada | browser je blokirao automatski download; klikni **Herunterladen** na stranici |

---

## 5. SharePoint

**Fajl se ne otvara iz browsera.** Excel for Web ne osvežava Power Query,
ne pokreće `Workbook_Open` i to ne javlja. Sinhronizuj biblioteku i otvaraj
fajl iz Findera.
