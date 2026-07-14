/*
 * Site-wide password gate.
 *
 * Loaded as a blocking <script> in the <head> of every page so the content
 * never paints for unauthenticated visitors. This is a client-side gate on
 * static hosting (GitHub Pages has no server) — it deters casual visitors,
 * it is NOT real security. Nothing sensitive may rely on it; guest data is
 * protected separately by Supabase RLS/RPC rules.
 *
 * Only the SHA-256 hash of the password lives in source. Unlock state is
 * remembered in localStorage so guests only type it once per device.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pj_gate_v1';
  var PASSWORD_HASH = '5fc6b6a518032ad46371a1a6a1e9f59931460a69cde2e26addc28d9a6f280237';

  /* Compact synchronous SHA-256 (public-domain style implementation) so the
     gate works identically over https, http, and file:// — crypto.subtle is
     async and unavailable in non-secure contexts. */
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var result = '';
    var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = [];
    var k = [];
    var primeCounter = 0;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return ''; // ASCII-only; non-ASCII input simply won't match
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = i < 16 ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function isUnlocked() {
    try {
      return localStorage.getItem(STORAGE_KEY) === PASSWORD_HASH;
    } catch (e) {
      return false; // storage blocked → always ask
    }
  }

  if (isUnlocked()) return;

  /* Hide the page before first paint: this script is blocking in <head>,
     so this style is in place before <body> exists. */
  document.documentElement.classList.add('pj-locked');
  var style = document.createElement('style');
  style.textContent = [
    'html.pj-locked body > :not(#pj-gate) { display: none !important; }',
    '#pj-gate {',
    '  position: fixed; inset: 0; z-index: 99999;',
    '  display: flex; align-items: center; justify-content: center;',
    '  background: var(--color-bg, #fdf6ef); padding: 1.5rem;',
    '}',
    '#pj-gate .pj-gate__card {',
    '  width: 100%; max-width: 24rem; text-align: center;',
    '  background: var(--color-surface, #fff);',
    '  border: 2px solid var(--blush, #f2c1c1); border-radius: 1.25rem;',
    '  padding: 2.5rem 2rem; box-shadow: 0 18px 40px rgba(61, 43, 40, 0.12);',
    '}',
    '#pj-gate .pj-gate__names {',
    "  font-family: var(--font-script, 'Caveat', cursive);",
    '  font-size: 2.4rem; line-height: 1.1; color: var(--copper, #ef5356);',
    '  margin: 0 0 0.5rem;',
    '}',
    '#pj-gate .pj-gate__hint {',
    "  font-family: var(--font-body, 'Poppins', sans-serif);",
    '  font-size: 0.9rem; color: var(--color-text-soft, #7a625d);',
    '  margin: 0 0 1.5rem;',
    '}',
    '#pj-gate input {',
    '  width: 100%; box-sizing: border-box; text-align: center;',
    "  font-family: var(--font-body, 'Poppins', sans-serif); font-size: 1rem;",
    '  padding: 0.7rem 1rem; border-radius: 0.6rem;',
    '  border: 1px solid var(--color-border, rgba(61, 43, 40, 0.2));',
    '  color: var(--color-text, #3d2b28); background: var(--color-bg, #fdf6ef);',
    '}',
    '#pj-gate input:focus { outline: 2px solid var(--golden-hour, #f2af3f); border-color: transparent; }',
    '#pj-gate button {',
    '  width: 100%; margin-top: 0.9rem; cursor: pointer;',
    "  font-family: var(--font-body, 'Poppins', sans-serif); font-weight: 600;",
    '  font-size: 1rem; padding: 0.7rem 1rem; border-radius: 0.6rem;',
    '  border: none; color: #fff; background: var(--copper, #ef5356);',
    '  transition: background 0.2s ease;',
    '}',
    '#pj-gate button:hover { background: var(--copper-deep, #cf3e4d); }',
    '#pj-gate .pj-gate__error {',
    "  font-family: var(--font-body, 'Poppins', sans-serif);",
    '  font-size: 0.85rem; color: var(--copper-deep, #cf3e4d);',
    '  min-height: 1.2rem; margin: 0.75rem 0 0; visibility: hidden;',
    '}',
    '#pj-gate .pj-gate__error.is-visible { visibility: visible; }'
  ].join('\n');
  document.head.appendChild(style);

  function showGate() {
    var overlay = document.createElement('div');
    overlay.id = 'pj-gate';
    overlay.innerHTML =
      '<form class="pj-gate__card">' +
      '  <p class="pj-gate__names">Parker &amp; Jolan</p>' +
      '  <p class="pj-gate__hint">Enter the password from your invitation to continue.</p>' +
      '  <input type="password" autocomplete="off" autofocus aria-label="Site password">' +
      '  <button type="submit">Enter</button>' +
      '  <p class="pj-gate__error" role="alert">That&rsquo;s not it &mdash; try again.</p>' +
      '</form>';
    document.body.appendChild(overlay);

    var form = overlay.querySelector('form');
    var input = overlay.querySelector('input');
    var error = overlay.querySelector('.pj-gate__error');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (sha256(input.value.trim().toLowerCase()) === PASSWORD_HASH) {
        try {
          localStorage.setItem(STORAGE_KEY, PASSWORD_HASH);
        } catch (e) { /* storage blocked — unlock this page view anyway */ }
        document.documentElement.classList.remove('pj-locked');
        overlay.remove();
      } else {
        error.classList.add('is-visible');
        input.value = '';
        input.focus();
      }
    });

    input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showGate);
  } else {
    showGate();
  }
})();
