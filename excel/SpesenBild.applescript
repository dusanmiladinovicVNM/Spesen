-- SpesenBild.applescript
--
-- Hilfsskript fuer die Excel-Vorlage (Spalte "Foto").
-- Excel fuer Mac laeuft in einer Sandbox und darf selbst weder aus dem
-- Netz laden noch nach "Downloads" schreiben. Dieses Skript tut beides;
-- VBA ruft es mit AppleScriptTask auf.
--
-- Ablage, einmal je Mac:
--   ~/Library/Application Scripts/com.microsoft.Excel/SpesenBild.applescript

on bildLaden(auftrag)
	-- auftrag = "<URL>|<Dateiname>"
	set AppleScript's text item delimiters to "|"
	set teile to text items of auftrag
	set AppleScript's text item delimiters to ""
	if (count of teile) is not 2 then return "FEHLER: Aufruf ungueltig"

	set quelle to item 1 of teile
	set ziel to (POSIX path of (path to downloads folder)) & (item 2 of teile)
	set roh to do shell script "/usr/bin/mktemp -t spesenbild"

	try
		do shell script "/usr/bin/curl -sSfL --max-time 60 -o " & quoted form of roh & " " & quoted form of quelle
	on error
		do shell script "/bin/rm -f " & quoted form of roh
		return "FEHLER: Keine Verbindung zum Server"
	end try

	-- Apps Script liefert Base64-Text oder "FEHLER: ..."
	set anfang to do shell script "/usr/bin/head -c 16 " & quoted form of roh
	if anfang is "" or anfang starts with "FEHLER" or anfang starts with "<" then
		if anfang starts with "FEHLER" then
			set meldung to do shell script "/bin/cat " & quoted form of roh
		else
			set meldung to "FEHLER: Unerwartete Antwort vom Server - Bereitstellung pruefen"
		end if
		do shell script "/bin/rm -f " & quoted form of roh
		return meldung
	end if

	try
		do shell script "/usr/bin/base64 -D -i " & quoted form of roh & " -o " & quoted form of ziel
	on error
		do shell script "/bin/rm -f " & quoted form of roh & " " & quoted form of ziel
		return "FEHLER: Foto konnte nicht gespeichert werden"
	end try

	do shell script "/bin/rm -f " & quoted form of roh
	return ziel
end bildLaden
