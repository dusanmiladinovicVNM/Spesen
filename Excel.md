# Excel šablon

`.xlsm` na SharePointu, list `Vorlage`. Šablon se ne prepravlja: podaci
ulaze u skriveni list `Daten`, a šablon ih dohvata formulom.

![List Vorlage](excel/vorlage.png)

```
Apps Script  ─CSV─▶  Power Query (tabela Belege, list Daten)  ─FILTER─▶  Vorlage B7:G31
             ─Foto─▶  SpesenBild.applescript  ─▶  ~/Downloads        ◀─ klik na J
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
   `Bemerkung`, `Mitarbeiter`, `Monat`, `Jahr` i **`BildUrl`**
4. Tipovi: `Datum` → Datum, novčane → Dezimalzahl, `Monat`/`Jahr` → Ganze Zahl,
   `BildUrl` → Text
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

## 4. Kolona Foto: preuzimanje fotografija

U koloni **J**, desno od tabele, svaki red sa fotografijom dobija
**Herunterladen**. Klik na to snima fotografiju u **Downloads**, pod imenom

```
Jovica Miladinovic 2026-08 Beleg 01.jpg
```

Broj je iz kolone A, isti kao na A4 listu na koji se lepi račun.

### Kako radi

- **Formula u `J7`** filtrira i sortira **isto kao `B7`**, samo što uzima
  `BildUrl` umesto `Datum:Bemerkung`. Zato svaki red dobija link svog belega.
  Ako ikad menjaš uslove u `B7`, promeni ih i u `J7`.
- **Vrednost ćelije je Drive-link.** Format `;;;"Herunterladen"` umesto
  njega prikazuje reč, a red bez fotografije dobija `0`, koji format ne prikazuje.
- **Klik** hvata `Worksheet_SelectionChange` u listu `Vorlage`. Makro
  pita Apps Script (`?format=bild&token=…&id=…`) i dobija fotografiju.
- **Snimanje radi AppleScript.** Excel za Mac radi u sandboxu i ne sme sam ni
  da preuzima sa mreže ni da piše u Downloads.
- **Server daje samo fotografije iz lista `Belege`.** Bez te provere bi
  `TOKEN_READ` otvarao ceo Drive vlasnika skripte.

Google nalog knjigovodstvu ne treba, a fotografije ostaju privatne
(`BILD_OEFFENTLICH = false`).

### Postavljanje, jednom za fajl

1. **`BildUrl` u Power Query.** Korak *Andere entfernte Spalten* nabraja
   kolone poimence. Otvori **Daten → Daten abrufen → Power Query-Editor starten**,
   upit `Belege`, klikni na taj korak i u formuli dodaj `"BildUrl"` na kraj
   liste. Posle **Schließen & laden** tabela `Belege` ima kolonu `BildUrl`.
2. **VBA modul.** U VBA-Editoru (**Extras → Makro → Visual Basic-Editor**):
   **Datei → Datei importieren…** → `excel/BelegFoto.bas`.
   U modulu upiši pravi `TOKEN_READ` (isti kao u `Code.gs`) i proveri
   `WEBAPP_URL`.
3. **Klik.** Levo dvoklik na list `Vorlage` i zalepi sadržaj
   `excel/Vorlage-Blattmodul.vba`. Ako tamo već postoji
   `Worksheet_SelectionChange`, spoj ih u jedan.
4. **Kolona.** Pokreni makro `FotoSpalteEinrichten` jednom. On upisuje
   zaglavlje `Foto` u `J5`, formulu u `J7` i format za `J7:J31`.
5. Sačuvaj i otpremi na SharePoint.

Formula za ručni unos, ako ne želiš makro iz koraka 4:

```
=LET(z;(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3);WENN(SUMME(z)=0;0;LET(s;SORTIEREN(FILTER(HSTAPELN(Belege[Datum];Belege[BildUrl]);z);1);u;INDEX(s;;2);WENN(ISTTEXT(u)*(u<>"");u;0))))
```

Format ćelija `J7:J31`: **Zellen formatieren → Benutzerdefiniert** →
`;;;"Herunterladen"`.

Kolona `I` je sakrivena grupisanjem. Ne koristi je, jer `J` je prva vidljiva.

### Postavljanje, jednom po Macu

Na svakom Macu na kojem se preuzimaju fotografije, u Terminalu:

```sh
mkdir -p ~/Library/Application\ Scripts/com.microsoft.Excel
cp SpesenBild.applescript ~/Library/Application\ Scripts/com.microsoft.Excel/
```

Fajl je `excel/SpesenBild.applescript` iz ovog repozitorijuma. Excel mora
biti ponovo pokrenut posle kopiranja.

### Apps Script

`Code.gs` sa `format=bild` mora biti objavljen kao **nova verzija**
(Bereitstellungen verwalten → Bearbeiten → Neue Version). Bez toga URL
i dalje servira stari kod, a klik javlja *Unerwartete Antwort*.

### Problemi

| Simptom | Uzrok |
|---|---|
| `J7` pokazuje `#BEZUG!` ili `#NAME?` | `BildUrl` nije u tabeli `Belege` (korak 1), ili Excel nema `HSTAPELN` (potreban Microsoft 365) |
| Nigde nema *Herunterladen*, a fotografije postoje | Excel nije osvežen (**Daten → Alle aktualisieren**) |
| `SpesenBild.applescript nicht gefunden` | skripta nije u `~/Library/Application Scripts/com.microsoft.Excel/` ili Excel nije ponovo pokrenut |
| `TOKEN_READ … stimmt nicht` | token u modulu `BelegFoto` nije isti kao u `Code.gs` |
| `Foto nicht gefunden` | beleg je u međuvremenu storniran; osveži Excel |
| `Unerwartete Antwort vom Server` | `Code.gs` nije objavljen kao nova verzija |
| Drugi klik na istu ćeliju ne radi ništa | makro posle preuzimanja pomera izbor udesno; ako je ručno vraćen, klikni prvo drugu ćeliju |

Na Windowsu kolona prikazuje *Herunterladen*, ali klik javlja da je
preuzimanje podešeno samo za Mac.

---

## 5. SharePoint

**Fajl se ne otvara iz browsera.** Excel for Web ne osvežava Power Query,
ne pokreće makroe i to ne javlja. Sinhronizuj biblioteku i otvaraj
fajl iz Findera.
