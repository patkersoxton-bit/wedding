/*
 * Canva pages (index.html, travel.html): scroll-triggered entrance
 * animations + the header nav. Loaded in <head> (not deferred) so the
 * .cv-js class is set before first paint and layers don't flash.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('cv-js');

  // Resolve once every image in the band has loaded and decoded (or after a
  // timeout), so on a slow connection the animation doesn't play out
  // before the artwork has arrived.
  function bandReady(band) {
    var imgs = Array.prototype.slice.call(band.querySelectorAll('img'));
    var loads = imgs.map(function (img) {
      img.loading = 'eager';
      var p = img.complete && img.naturalWidth ? Promise.resolve() :
        new Promise(function (res) { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); });
      return p.then(function () { return img.decode ? img.decode().catch(function () {}) : null; });
    });
    var timeout = new Promise(function (res) { setTimeout(res, 4000); });
    return Promise.race([Promise.all(loads), timeout]);
  }

  function reveal(band) {
    if (band.dataset.cvQueued) return;
    band.dataset.cvQueued = '1';
    bandReady(band).then(function () {
      requestAnimationFrame(function () { band.classList.add('is-in'); });
    });
  }

  function init() {
    var bands = document.querySelectorAll('.cv-band');
    if ('IntersectionObserver' in window) {
      // Start fetching a band's images a little before it scrolls in.
      var preload = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.querySelectorAll('img').forEach(function (img) { img.loading = 'eager'; });
            preload.unobserve(e.target);
          }
        });
      }, { rootMargin: '600px 0px' });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { reveal(entry.target); io.unobserve(entry.target); }
        });
      }, { threshold: 0.2 });
      bands.forEach(function (b) { preload.observe(b); io.observe(b); });
    } else {
      bands.forEach(function (b) { b.classList.add('is-in'); });
    }

    // Header nav: shadow on scroll + mobile toggle
    var nav = document.querySelector('.site-nav');
    if (!nav) return;
    var toggle = nav.querySelector('.site-nav__toggle');
    var links = nav.querySelector('.site-nav__links');
    window.addEventListener('scroll', function () {
      nav.classList.toggle('is-scrolled', window.scrollY > 12);
    }, { passive: true });
    function setOpen(open) {
      links.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function () { setOpen(!links.classList.contains('is-open')); });
    document.addEventListener('click', function (e) {
      if (links.classList.contains('is-open') && !nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && links.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
