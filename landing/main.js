// Progressive enhancement only: the page is complete without this file.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Year in the footer.
  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = String(new Date().getFullYear())));

  // Nav gets a glass background once the page scrolls.
  const nav = document.querySelector('[data-nav]');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Reveal sections as they enter the viewport, staggering siblings.
  const reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('in'));
  } else {
    const groups = new Map();
    reveals.forEach((el) => {
      const siblings = groups.get(el.parentElement) ?? [];
      siblings.push(el);
      groups.set(el.parentElement, siblings);
      el.style.setProperty('--d', `${Math.min(siblings.length - 1, 4) * 0.08}s`);
    });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    reveals.forEach((el) => io.observe(el));
  }

  if (reduced || !finePointer) return;

  // Background spotlight follows the pointer.
  const root = document.documentElement;
  let raf = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--mx', `${e.clientX}px`);
        root.style.setProperty('--my', `${e.clientY}px`);
      });
    },
    { passive: true },
  );
  document.querySelector('.spotlight')?.style.setProperty('background', 'radial-gradient(500px circle at var(--mx) var(--my), rgba(108,140,255,0.10), transparent 60%)');

  // 3D tilt + glow position on cards.
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    const max = el.hasAttribute('data-tilt-soft') ? 4 : 9;
    const base = getComputedStyle(el).transform;
    const baseTransform = base === 'none' ? '' : base;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--px', `${x * 100}%`);
      el.style.setProperty('--py', `${y * 100}%`);
      el.style.transform = `${baseTransform} perspective(1200px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateY(-4px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  });
})();
