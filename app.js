/* Spesenerfassung — Clientlogik */

const MONATE = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];

const S = {
  session: localStorage.getItem('session') || '',
  name:    localStorage.getItem('name')    || '',
  konten:  [],
  kst:     [],
  suffix:  0,
  belege:  [],
  scharf:  null,          // ID reda naoružanog za storno
  laeuft:  false
};

const $ = id => document.getElementById(id);

/* ---------- pomoćno ---------- */

function zeigeScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('aktiv'));
  $(id).classList.add('aktiv');
  window.scrollTo(0, 0);
}

function toast(text, art) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast zeigen ' + (art || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.className = 'toast', 3200);
}

function chf(n) {
  return Number(n).toLocaleString('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function zahl(text) {
  const s = String(text || '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function heute() {
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---------- API ---------- */

async function post(payload) {
  const res  = await fetch(CONFIG.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // Apps Script hat HTML statt JSON geliefert — echte Ursache in der Konsole
    console.error('Antwort war kein JSON:', res.status, text.slice(0, 500));
    throw e;
  }
}

async function get(params) {
  const q = new URLSearchParams({ session: S.session, ...params });
  const res = await fetch(CONFIG.url + '?' + q.toString());
  return res.json();
}

function sessionWeg() {
  localStorage.clear();
  S.session = '';
  toast('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.', 'err');
  zeigeScreen('scr-login');
}

/* ---------- prijava ---------- */

async function anmelden() {
  const email = $('lg-email').value.trim();
  const pass  = $('lg-pass').value;
  const m     = $('lg-meldung');
  m.classList.remove('zeigen');

  if (!email || !pass) {
    m.textContent = 'Bitte Benutzername und Passwort eingeben.';
    m.classList.add('zeigen');
    return;
  }

  const btn = $('lg-senden');
  btn.disabled = true;
  btn.textContent = 'Anmelden …';

  try {
    const r = await post({ action: 'login', email, passwort: pass });
    if (r.ok) {
      S.session = r.session;
      S.name    = r.name;
      localStorage.setItem('session', r.session);
      localStorage.setItem('name', r.name);
      $('lg-pass').value = '';
      await start();
    } else {
      m.textContent = {
        login:    'Benutzername oder Passwort ist falsch.',
        gesperrt: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.',
        inaktiv:  'Dieser Zugang ist deaktiviert. Bitte melden Sie sich bei uns.'
      }[r.error] || 'Anmeldung nicht möglich.';
      m.classList.add('zeigen');
    }
  } catch (e) {
    m.textContent = 'Keine Verbindung. Bitte Internetverbindung prüfen.';
    m.classList.add('zeigen');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
}

function abmelden() {
  localStorage.clear();
  S.session = '';
  $('lg-email').value = '';
  zeigeScreen('scr-login');
}

/* ---------- popunjavanje forme ---------- */

function fuelleMonatJahr() {
  const jetzt = new Date();
  $('fm-monat').innerHTML = MONATE
    .map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
  $('fm-monat').value = jetzt.getMonth() + 1;

  const j = jetzt.getFullYear();
  $('fm-jahr').innerHTML = [j - 1, j, j + 1]
    .map(y => `<option value="${y}">${y}</option>`).join('');
  $('fm-jahr').value = j;
}

function fuelleStammdaten() {
  const opt = a => a
    .map(x => `<option value="${x.nr}">${x.nr} · ${x.bez}</option>`).join('');
  $('fm-konto').innerHTML = '<option value="">– wählen –</option>' + opt(S.konten);
  $('fm-kst').innerHTML   = '<option value="">– wählen –</option>' + opt(S.kst);
}

function vorschau() {
  const b = zahl($('fm-brutto').value);
  const s = parseFloat($('fm-mwst').value);
  if (!b || b <= 0) { $('fm-vorschau').textContent = ''; return; }
  const mwst  = Math.round((b - b / (1 + s / 100)) * 100) / 100;
  const netto = Math.round((b - mwst) * 100) / 100;
  $('fm-vorschau').textContent = `MWSt: ${chf(mwst)}   Netto: ${chf(netto)}`;
}

/* ---------- snimanje ---------- */

async function speichern() {
  if (S.laeuft) return;

  const brutto = zahl($('fm-brutto').value);
  if (!brutto || brutto <= 0) { toast('Betrag fehlt oder ist ungültig.', 'err'); return; }
  if (!$('fm-konto').value || !$('fm-kst').value) {
    toast('Konto und Kostenstelle sind erforderlich.', 'err'); return;
  }
  if (!$('fm-datum').value) { toast('Datum fehlt.', 'err'); return; }

  const kontoOpt = $('fm-konto').selectedOptions[0].textContent;
  const kstOpt   = $('fm-kst').selectedOptions[0].textContent;

  const daten = {
    session:   S.session,
    belegNr:   $('fm-belegnr').value.trim(),
    datum:     $('fm-datum').value,
    monat:     $('fm-monat').value,
    jahr:      $('fm-jahr').value,
    brutto:    brutto,
    mwstSatz:  parseFloat($('fm-mwst').value),
    kontoNr:   $('fm-konto').value,
    kontoBez:  kontoOpt.split(' · ').slice(1).join(' · '),
    kstNr:     $('fm-kst').value,
    kstBez:    kstOpt.split(' · ').slice(1).join(' · '),
    bemerkung: $('fm-bemerkung').value.trim(),
    suffix:    S.suffix
  };

  S.laeuft = true;
  const btn = $('fm-speichern');
  btn.disabled = true;
  btn.textContent = 'Speichern …';

  try {
    const r = await post(daten);

    if (r.ok) {
      toast('Beleg gespeichert.', 'ok');
      nachSpeichern();
    } else if (r.error === 'session') {
      sessionWeg();
    } else if (r.error === 'duplikat') {
      $('dlg-dup').classList.add('zeigen');
    } else {
      toast('Speichern nicht möglich: ' + (r.error || 'unbekannt'), 'err');
    }
  } catch (e) {
    toast('Keine Verbindung. Der Beleg wurde nicht gespeichert.', 'err');
  } finally {
    S.laeuft = false;
    btn.disabled = false;
    btn.textContent = 'Speichern';
  }
}

/* Monat, Jahr, Konto i Kostenstelle namerno ostaju — Speichern & neu */
function nachSpeichern() {
  $('fm-belegnr').value   = '';
  $('fm-brutto').value    = '';
  $('fm-bemerkung').value = '';
  $('fm-vorschau').textContent = '';
  S.suffix = 0;
  $('fm-belegnr').focus();
}

/* ---------- pregled ---------- */

async function ladeListe() {
  const monat = $('fm-monat').value;
  const jahr  = $('fm-jahr').value;

  $('lst-titel').textContent = 'Belege ' + MONATE[monat - 1] + ' ' + jahr;
  $('lst-liste').innerHTML   = '<div class="leer">Wird geladen …</div>';
  $('lst-total').textContent = '';
  S.scharf = null;
  zeigeScreen('scr-list');

  try {
    const r = await get({ action: 'meine', monat, jahr });
    if (!r.ok) { if (r.error === 'session') sessionWeg(); return; }
    S.belege = r.belege || [];
    zeichneListe();
  } catch (e) {
    $('lst-liste').innerHTML =
      '<div class="leer">Keine Verbindung. Bitte später erneut versuchen.</div>';
  }
}

function zeichneListe() {
  const el = $('lst-liste');

  if (!S.belege.length) {
    el.innerHTML = '<div class="leer">Keine Belege in diesem Monat.</div>';
    $('lst-total').textContent = '';
    return;
  }

  const summe = S.belege.reduce((a, b) => a + Number(b.Brutto || 0), 0);
  $('lst-total').textContent = 'Total: ' + chf(summe);

  el.innerHTML = S.belege.map((b, i) => {
    const d = String(b.Datum || '').split('-');
    const datum = d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : b.Datum;
    const detail = [b.KontoNr, b.KstNr].filter(Boolean).join(' · ') +
                   (b.Bemerkung ? '   ' + b.Bemerkung : '');
    return `
      <div class="eintrag">
        <div class="zellen">
          <div class="oben"><span>${datum}</span><span>${chf(b.Brutto)}</span></div>
          <div class="unten">${detail}</div>
        </div>
        <button class="storno" data-i="${i}" aria-label="Stornieren">&#128465;</button>
      </div>`;
  }).join('');

  el.querySelectorAll('.storno').forEach(btn => {
    btn.addEventListener('click', () => stornoKlick(Number(btn.dataset.i), btn));
  });
}

/* Prvi dodir naoruža, drugi izvrši — lista se skroluje prstom */
async function stornoKlick(i, btn) {
  if (S.scharf !== i) {
    S.scharf = i;
    document.querySelectorAll('.storno').forEach(b => b.classList.remove('scharf'));
    btn.classList.add('scharf');
    btn.innerHTML = '&#10003;';
    toast('Nochmals tippen zum Stornieren.', '');
    return;
  }

  const beleg = S.belege[i];
  try {
    const r = await post({
      session: S.session, action: 'storno', key: beleg.DedupKey
    });
    if (r.ok) {
      S.belege.splice(i, 1);
      S.scharf = null;
      zeichneListe();
      toast('Beleg storniert.', 'ok');
    } else if (r.error === 'session') {
      sessionWeg();
    } else {
      toast('Stornieren nicht möglich.', 'err');
    }
  } catch (e) {
    toast('Keine Verbindung.', 'err');
  }
}

/* ---------- start ---------- */

async function start() {
  $('fm-name').textContent = S.name;
  fuelleMonatJahr();
  $('fm-datum').value = heute();
  zeigeScreen('scr-form');

  // keširane master liste odmah, pa osvežavanje u pozadini
  const cache = localStorage.getItem('stammdaten');
  if (cache) {
    const c = JSON.parse(cache);
    S.konten = c.konten; S.kst = c.kostenstellen;
    fuelleStammdaten();
  }

  try {
    const r = await get({ action: 'stammdaten' });
    if (!r.ok) { if (r.error === 'session') sessionWeg(); return; }
    S.konten = r.konten; S.kst = r.kostenstellen;
    localStorage.setItem('stammdaten', JSON.stringify(r));
    fuelleStammdaten();
  } catch (e) {
    if (!cache) toast('Konto- und Kostenstellenliste konnte nicht geladen werden.', 'err');
  }
}

/* ---------- vezivanje ---------- */

$('lg-senden').addEventListener('click', anmelden);
$('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') anmelden(); });

$('fm-brutto').addEventListener('input', vorschau);
$('fm-mwst').addEventListener('change', vorschau);
$('fm-speichern').addEventListener('click', speichern);
$('fm-liste').addEventListener('click', ladeListe);
$('fm-abmelden').addEventListener('click', abmelden);

$('lst-zurueck').addEventListener('click', () => zeigeScreen('scr-form'));

$('dup-nein').addEventListener('click', () => $('dlg-dup').classList.remove('zeigen'));
$('dup-ja').addEventListener('click', () => {
  $('dlg-dup').classList.remove('zeigen');
  S.suffix += 1;
  speichern();
});

if (S.session) start(); else zeigeScreen('scr-login');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
