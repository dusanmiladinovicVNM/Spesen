# Excel šablon

`.xlsm` na SharePointu, list `Vorlage`. Šablon se ne prepravlja: podaci
ulaze u skriveni list `Daten`, a šablon ih dohvata formulom.

![List Vorlage](excel/vorlage.png)

```
Apps Script ─CSV─▶ Power Query (tabela Belege, list Daten) ─FILTER─▶ Vorlage B7:G31 i J7:J31
Drive ─fotosNachSharePoint, svakih 15 min─▶ SharePoint …/Belegfotos ◀── link u koloni J
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
   `Bemerkung`, `Mitarbeiter`, `Monat`, `Jahr` i **`SpUrl`**
4. Tipovi: `Datum` → Datum, novčane → Dezimalzahl, `Monat`/`Jahr` → Ganze Zahl,
   `SpUrl` → Text
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

Fotografije se same kopiraju iz Google Drive-a u SharePoint folder
(README, *Fotos nach SharePoint*). U koloni **J**, desno od tabele, svaki
red sa fotografijom dobija link **Foto öffnen** na taj fajl u SharePointu.

Nema makroa i ništa se ne instalira na računarima. Radi na Macu, Windowsu
i u Excel for Web.

### Postavljanje, jednom za fajl

1. **`SpUrl` u Power Query.** Korak *Andere entfernte Spalten* nabraja
   kolone poimence. Otvori **Daten → Daten abrufen → Power Query-Editor starten**,
   upit `Belege`, klikni na taj korak i u formuli dodaj `"SpUrl"` na kraj
   liste. Posle **Schließen & laden** tabela `Belege` ima kolonu `SpUrl`.
2. U `J5` upiši `Foto`.
3. U `J7` upiši formulu ispod i kopiraj je do `J31`.
4. Sačuvaj i otpremi na SharePoint.

```
=LET(z;(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3);n;SUMME(z);i;ZEILE()-6;WENN(i>n;"";LET(u;INDEX(SORTIEREN(FILTER(HSTAPELN(Belege[Datum];Belege[SpUrl]);z);1);i;2);WENN(LINKS(u;4)="http";HYPERLINK(u;"Foto öffnen");""))))
```

### Kako radi

- **Filtrira i sortira isto kao `B7`**, samo uzima `SpUrl`. Zato red 7 dobija
  link prvog belega, red 8 drugog, i tako dalje (`ZEILE()-6`). Ako ikad
  menjaš uslove u `B7`, promeni ih i ovde.
- **Svaka ćelija ima svoju formulu**, umesto jedne koja se prosipa,
  da bi link u svakoj ćeliji sigurno bio klikabilan.
- **Prazno ostaje** kad red nema fotografiju, kad sinhronizacija još nije
  stigla do nje, ili kad je u `SpUrl` oznaka `FEHLER: …`.
- **Greška namerno nije sakrivena.** Ako `SpUrl` fali u tabeli, ćelija pokazuje
  `#BEZUG!` umesto da tiho ostane prazna.

Kolona `I` je sakrivena grupisanjem. Ne koristi je, jer `J` je prva vidljiva.

### Problemi

| Simptom | Uzrok |
|---|---|
| `J7` pokazuje `#BEZUG!` ili `#NAME?` | `SpUrl` nije u tabeli `Belege` (korak 1), ili Excel nema `HSTAPELN` (potreban Microsoft 365) |
| Fotografija postoji u aplikaciji, a link nema | sinhronizacija ide na 15 minuta; posle toga **Daten → Alle aktualisieren** |
| U `Belege` piše `FEHLER: Datei in Drive nicht lesbar` | fotografija je obrisana u Drive-u; obriši oznaku da bi se pokušalo ponovo |
| Link otvara *Zugriff verweigert* | ta osoba nema pravo na SharePoint folder |

---

## 5. SharePoint

**Fajl se ne otvara iz browsera.** Excel for Web ne osvežava Power Query,
ne pokreće `Workbook_Open` i to ne javlja. Sinhronizuj biblioteku i otvaraj
fajl iz Findera.
