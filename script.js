// ===== Theme Management =====
function getEffectiveTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  // Re-render dot matrix with new colors
  renderDotMatrix();
}

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const current = getEffectiveTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Listen for system theme changes (only if user hasn't manually chosen)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!localStorage.getItem('theme')) {
      renderDotMatrix();
    }
  });
}

// ===== Dot Matrix Canvas Renderer =====
let dotMatrixRender = null;

function renderDotMatrix() {
  if (dotMatrixRender) dotMatrixRender();
}

function initDotMatrix() {
  const canvas = document.getElementById('dotMatrixCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  function render() {
    const wrapper = canvas.parentElement;
    const wrapperWidth = wrapper.clientWidth;

    // Responsive canvas height
    const canvasHeight = wrapperWidth <= 400
      ? Math.max(60, wrapperWidth * 0.18)
      : wrapperWidth <= 768
        ? Math.max(80, wrapperWidth * 0.18)
        : Math.max(140, wrapperWidth * 0.2);
    const canvasWidth = wrapperWidth;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const text = 'JIAYI HU';

    // Offscreen canvas to sample text pixels
    const offscreen = document.createElement('canvas');
    offscreen.width = canvasWidth;
    offscreen.height = canvasHeight;
    const offCtx = offscreen.getContext('2d');

    const fontSize = wrapperWidth <= 400
      ? Math.min(canvasWidth * 0.13, 50)
      : wrapperWidth <= 768
        ? Math.min(canvasWidth * 0.14, 80)
        : Math.min(canvasWidth * 0.16, 140);

    offCtx.font = `900 ${fontSize}px 'Inter', sans-serif`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.fillStyle = '#fff';
    offCtx.fillText(text, canvasWidth / 2, canvasHeight / 2);

    const imageData = offCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const pixels = imageData.data;

    // Responsive dot params
    const dotSpacing = wrapperWidth <= 400
      ? Math.max(3, Math.floor(canvasWidth / 120))
      : wrapperWidth <= 768
        ? Math.max(3, Math.floor(canvasWidth / 150))
        : Math.max(4, Math.floor(canvasWidth / 180));
    const dotRadius = dotSpacing * 0.32;

    // Colors depend on current theme
    const isDark = getEffectiveTheme() === 'dark';
    const colorStart = isDark
      ? { r: 96, g: 165, b: 250 }   // #60a5fa
      : { r: 79, g: 70, b: 229 };   // #4f46e5
    const colorEnd = isDark
      ? { r: 129, g: 140, b: 248 }   // #818cf8
      : { r: 37, g: 99, b: 235 };    // #2563eb

    for (let y = 0; y < canvasHeight; y += dotSpacing) {
      for (let x = 0; x < canvasWidth; x += dotSpacing) {
        const i = (y * canvasWidth + x) * 4;
        const alpha = pixels[i + 3];

        if (alpha > 128) {
          const t = x / canvasWidth;
          const r = Math.round(colorStart.r + (colorEnd.r - colorStart.r) * t);
          const g = Math.round(colorStart.g + (colorEnd.g - colorStart.g) * t);
          const b = Math.round(colorStart.b + (colorEnd.b - colorStart.b) * t);

          const dotAlpha = isDark
            ? 0.6 + (alpha / 255) * 0.4
            : 0.7 + (alpha / 255) * 0.3;

          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotAlpha})`;
          ctx.fill();
        }
      }
    }
  }

  dotMatrixRender = render;

  // Render after fonts load
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(render);
  } else {
    setTimeout(render, 300);
  }

  // Re-render on resize (debounced)
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(render, 100);
  });
}

// ===== Navbar scroll effect =====
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });
}

// ===== Mobile menu toggle =====
function initMobileMenu() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (!navToggle || !navLinks) return;

  function closeMenu() {
    navLinks.classList.remove('active');
    const spans = navToggle.querySelectorAll('span');
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }

  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('active');
    const spans = navToggle.querySelectorAll('span');
    if (isOpen) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      closeMenu();
    }
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
}

// ===== Scroll reveal animation =====
function initScrollReveal() {
  const revealElements = document.querySelectorAll(
    '.section-title, .origin-content, .timeline-item, .experience-card, .project-card, .contact-content'
  );

  revealElements.forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  );

  revealElements.forEach(el => observer.observe(el));
}

// ===== Smooth scroll for dive-in =====
function initScrollIndicator() {
  document.querySelector('.scroll-indicator')?.addEventListener('click', () => {
    document.querySelector('#origin')?.scrollIntoView({ behavior: 'smooth' });
  });
}

// ===== Init everything =====
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initDotMatrix();
  initNavbar();
  initMobileMenu();
  initScrollReveal();
  initScrollIndicator();
});
