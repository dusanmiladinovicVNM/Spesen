' ============================================================
'  In das Blattmodul "Vorlage" einfuegen
'  (VBA-Editor: links Doppelklick auf das Blatt Vorlage).
'  Ein Klick auf "Herunterladen" in der Foto-Spalte laedt das Foto.
' ============================================================

Private Sub Worksheet_SelectionChange(ByVal Target As Range)
    If Target.CountLarge <> 1 Then Exit Sub
    If Target.Column <> Me.Range(FOTO_SPALTE & "1").Column Then Exit Sub
    If Target.Row < ERSTE_ZEILE Or Target.Row > LETZTE_ZEILE Then Exit Sub
    If IsError(Target.Value) Then Exit Sub
    If VarType(Target.Value) <> vbString Then Exit Sub

    BelegFoto.FotoHerunterladen Target

    ' Auswahl weitersetzen, damit ein zweiter Klick wieder ausloest
    Application.EnableEvents = False
    Target.Offset(0, 1).Select
    Application.EnableEvents = True
End Sub
