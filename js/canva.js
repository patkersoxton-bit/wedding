/*
 * Canva pages (index.html, travel.html): scroll-triggered entrance
 * animations + the floating menu. Loaded in <head> (not deferred) so the
 * .cv-js class is set before first paint and layers don't flash.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('cv-js');

  function init() {
    // Bands animate in once, when ~20% visible.
    var bands = document.querySelectorAll('.cv-band');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.2 });
      bands.forEach(function (b) { io.observe(b); });
    } else {
      bands.forEach(function (b) { b.classList.add('is-in'); });
    }

    // Floating menu
    var menu = document.querySelector('.cv-menu');
    if (!menu) return;
    var btn = menu.querySelector('.cv-menu__btn');
    function setOpen(open) {
      menu.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', function () { setOpen(!menu.classList.contains('is-open')); });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) { setOpen(false); btn.focus(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
