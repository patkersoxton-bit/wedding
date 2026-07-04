// Nav shadow on scroll
const nav = document.querySelector('.site-nav');
const navToggle = document.querySelector('.site-nav__toggle');
const navLinks = document.querySelector('.site-nav__links');

window.addEventListener('scroll', () => {
  nav.classList.toggle('is-scrolled', window.scrollY > 12);
}, { passive: true });

navToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('is-open');
});

navLinks?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => navLinks.classList.remove('is-open'));
});

// Reveal-on-scroll
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach((el) => revealObserver.observe(el));

// Countdown to the big day — set the real date/time on the
// [data-wedding-date] element in index.html (ISO 8601, local time).
const countdownEl = document.querySelector('[data-wedding-date]');

if (countdownEl) {
  const weddingDate = new Date(countdownEl.dataset.weddingDate);
  const numEls = {
    days: countdownEl.querySelector('[data-days]'),
    hours: countdownEl.querySelector('[data-hours]'),
    minutes: countdownEl.querySelector('[data-minutes]'),
    seconds: countdownEl.querySelector('[data-seconds]'),
  };

  const tick = () => {
    const diff = weddingDate - new Date();
    if (diff <= 0) {
      Object.values(numEls).forEach((el) => el && (el.textContent = '0'));
      return;
    }
    const day = Math.floor(diff / 86400000);
    const hr = Math.floor((diff % 86400000) / 3600000);
    const min = Math.floor((diff % 3600000) / 60000);
    const sec = Math.floor((diff % 60000) / 1000);

    if (numEls.days) numEls.days.textContent = day;
    if (numEls.hours) numEls.hours.textContent = String(hr).padStart(2, '0');
    if (numEls.minutes) numEls.minutes.textContent = String(min).padStart(2, '0');
    if (numEls.seconds) numEls.seconds.textContent = String(sec).padStart(2, '0');
  };

  tick();
  setInterval(tick, 1000);
}
