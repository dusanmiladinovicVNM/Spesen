'use strict';
/* Die Seiten haben keinen Build-Schritt — ein Tippfehler im Skript fällt
   sonst erst im Browser auf. Hier wird jedes <script> kompiliert. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

for (const datei of ['index.html', 'foto.html']) {
  test(datei + ': Skripte sind gültiges JavaScript', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', datei), 'utf8');
    const skripte = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(skripte.length > 0, 'kein <script> gefunden');
    skripte.forEach(s => new vm.Script(s, { filename: datei }));
  });
}

test('index.html und foto.html sprechen dieselbe Web-App an', () => {
  const lies = d => fs.readFileSync(path.join(__dirname, '..', d), 'utf8');
  const url = /https:\/\/script\.google\.com\/macros\/s\/[-\w]+\/exec/;
  assert.equal(lies('index.html').match(url)[0], lies('foto.html').match(url)[0]);
});

test('GitHub Action läuft nur mit Leserechten', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'tests.yml'), 'utf8');
  assert.match(yml, /^permissions:\s*\n\s+contents: read\s*$/m);
});

test('index.html: jede id nur einmal', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const doppelt = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(doppelt, []);
});
