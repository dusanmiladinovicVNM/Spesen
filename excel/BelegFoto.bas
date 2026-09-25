Attribute VB_Name = "BelegFoto"
Option Explicit

' ============================================================
'  Beleg-Foto aus der Vorlage herunterladen (Excel fuer Mac)
'
'  Spalte J zeigt "Herunterladen" fuer jede Zeile mit Foto.
'  Der Zellwert ist der Drive-Link aus Belege[BildUrl]; das
'  Zahlenformat ;;;"Herunterladen" zeigt statt des Links das Wort.
'  Ein Klick darauf (Worksheet_SelectionChange im Blatt Vorlage)
'  ruft FotoHerunterladen auf.
'
'  Excel darf in der Mac-Sandbox weder ins Netz laden noch nach
'  "Downloads" schreiben. Das erledigt SpesenBild.applescript in
'  ~/Library/Application Scripts/com.microsoft.Excel/
' ============================================================

' Gleiche Werte wie in der Power-Query-Abfrage "Belege"
Private Const WEBAPP_URL As String = "https://script.google.com/macros/s/AKfycbwERKKiXRwXqzgSSX7_XcFp3QImEpw5jc9ZfEqzrCXlHfJ2FOWAE52oZaWieQWF-p6Spw/exec"
Private Const TOKEN_READ As String = "HIER_LANGER_ZUFALLSSTRING"

Private Const SKRIPT As String = "SpesenBild.applescript"

' Lage in der Vorlage
Public Const FOTO_SPALTE As String = "J"
Public Const ERSTE_ZEILE As Long = 7
Public Const LETZTE_ZEILE As Long = 31


' Einmal ausfuehren: Kopf, Formel und Format der Foto-Spalte.
Public Sub FotoSpalteEinrichten()
    Dim ws As Worksheet, bereich As Range
    Set ws = ThisWorkbook.Worksheets("Vorlage")
    Set bereich = ws.Range(FOTO_SPALTE & ERSTE_ZEILE & ":" & FOTO_SPALTE & LETZTE_ZEILE)

    bereich.ClearContents
    bereich.NumberFormat = ";;;""Herunterladen"""
    bereich.Font.Name = ws.Range("B" & ERSTE_ZEILE).Font.Name
    bereich.Font.Size = ws.Range("B" & ERSTE_ZEILE).Font.Size
    bereich.Font.Color = RGB(5, 99, 193)
    bereich.Font.Underline = xlUnderlineStyleSingle

    With ws.Range(FOTO_SPALTE & "5")
        .Value = "Foto"
        .Font.Bold = True
        .Font.Name = ws.Range("B5").Font.Name
        .Font.Size = ws.Range("B5").Font.Size
    End With

    ws.Range(FOTO_SPALTE & ERSTE_ZEILE).Formula2 = FotoFormel()
End Sub

' Filtert und sortiert genau wie die Formel in B7 - so steht in
' jeder Zeile der Link des eigenen Belegs. Ohne Foto: 0, das
' Zahlenformat zeigt dann nichts an. Kein IFERROR um das Ganze:
' fehlt die Spalte BildUrl, soll der Fehler in J7 sichtbar sein.
Private Function FotoFormel() As String
    FotoFormel = "=LET(" & _
        "z,(Belege[Mitarbeiter]=$B$3)*(Belege[Monat]=$Y$1)*(Belege[Jahr]=$G$3)," & _
        "IF(SUM(z)=0,0,LET(" & _
        "s,SORT(FILTER(HSTACK(Belege[Datum],Belege[BildUrl]),z),1)," & _
        "u,INDEX(s,,2)," & _
        "IF(ISTEXT(u)*(u<>""""),u,0))))"
End Function


Public Sub FotoHerunterladen(ByVal zelle As Range)
    Dim id As String, datei As String, antwort As String

    If IsError(zelle.Value) Then Exit Sub
    id = DateiId(CStr(zelle.Value))
    If Len(id) = 0 Then Exit Sub

    datei = DateiName(zelle.Worksheet, zelle.Row)

#If Mac Then
    Application.StatusBar = "Foto wird geladen ..."
    DoEvents

    On Error Resume Next
    antwort = AppleScriptTask(SKRIPT, "bildLaden", _
        WEBAPP_URL & "?format=bild&token=" & TOKEN_READ & "&id=" & id & "|" & datei)
    If Err.Number <> 0 Then
        antwort = "FEHLER: " & SKRIPT & " nicht gefunden." & vbLf & _
                  "Ablage: ~/Library/Application Scripts/com.microsoft.Excel/"
    End If
    On Error GoTo 0

    If antwort = "FEHLER: auth" Then
        antwort = "FEHLER: TOKEN_READ im Modul BelegFoto stimmt nicht mit Code.gs ueberein."
    End If

    If Left$(antwort, 6) = "FEHLER" Then
        Application.StatusBar = False
        MsgBox antwort, vbExclamation, "Beleg-Foto"
    Else
        Application.StatusBar = "Gespeichert in Downloads: " & datei
    End If
#Else
    MsgBox "Das Herunterladen ist fuer Excel auf dem Mac eingerichtet.", _
           vbInformation, "Beleg-Foto"
#End If
End Sub


' Drive-ID aus dem Link: die erste Folge von mindestens 25 Zeichen
' aus A-Z a-z 0-9 _ - (wie /[-\w]{25,}/ in Code.gs).
' Excel fuer Mac hat kein RegExp, daher von Hand.
Private Function DateiId(ByVal url As String) As String
    Dim i As Long, c As String, lauf As String
    For i = 1 To Len(url) + 1
        c = Mid$(url, i, 1)
        If Len(c) = 1 And c Like "[A-Za-z0-9_-]" Then
            lauf = lauf & c
        Else
            If Len(lauf) >= 25 Then
                DateiId = lauf
                Exit Function
            End If
            lauf = ""
        End If
    Next i
End Function

' "Jovica Miladinovic 2026-08 Beleg 01.jpg" - Nummer wie in Spalte A,
' also wie der Beleg auf dem A4-Blatt aufgeklebt ist.
Private Function DateiName(ByVal ws As Worksheet, ByVal zeile As Long) As String
    DateiName = Bereinigt(CStr(ws.Range("B3").Value)) & " " & _
                CStr(ws.Range("G3").Value) & "-" & _
                Format$(Val(ws.Range("Y1").Value), "00") & _
                " Beleg " & Format$(Val(ws.Cells(zeile, "A").Value), "00") & ".jpg"
End Function

' Zeichen entfernen, die in Dateinamen oder im Aufruf stoeren ("|" trennt).
Private Function Bereinigt(ByVal s As String) As String
    Dim zeichen As Variant
    For Each zeichen In Array("/", "\", ":", "|", "*", "?", """", "<", ">")
        s = Replace(s, zeichen, "")
    Next zeichen
    Bereinigt = Trim$(s)
End Function
