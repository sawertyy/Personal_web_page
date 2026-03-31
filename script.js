// ===== Theme Management =====
function getEffectiveTheme() {
  return localStorage.getItem('theme') || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  renderDotMatrix();
  updateLiquidEtherColors();
}

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    applyTheme(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
  });
}

// ===== Liquid Ether Background (Canvas 2D) =====
let liquidEtherState = null;

function updateLiquidEtherColors() {
  if (!liquidEtherState) return;
  const isDark = getEffectiveTheme() === 'dark';
  liquidEtherState.blobs.forEach((blob, i) => {
    if (isDark) {
      const darkColors = [
        'rgba(212, 168, 83, 0.04)',
        'rgba(26, 74, 122, 0.06)',
        'rgba(100, 160, 220, 0.04)',
        'rgba(212, 168, 83, 0.03)',
        'rgba(15, 43, 70, 0.08)',
      ];
      blob.color = darkColors[i % darkColors.length];
    } else {
      const lightColors = [
        'rgba(212, 168, 83, 0.05)',
        'rgba(15, 43, 70, 0.04)',
        'rgba(26, 74, 122, 0.05)',
        'rgba(212, 168, 83, 0.03)',
        'rgba(232, 228, 222, 0.08)',
      ];
      blob.color = lightColors[i % lightColors.length];
    }
  });
}

function initLiquidEther() {
  const canvas = document.getElementById('liquidEtherCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width, height;
  let mouseX = -1000, mouseY = -1000;
  let animFrameId = null;
  let lastFrameTime = 0;
  const targetFPS = 30;
  const frameDuration = 1000 / targetFPS;

  // Create blobs
  const blobCount = 5;
  const blobs = [];
  const isDark = getEffectiveTheme() === 'dark';

  const lightColors = [
    'rgba(212, 168, 83, 0.05)',
    'rgba(15, 43, 70, 0.04)',
    'rgba(26, 74, 122, 0.05)',
    'rgba(212, 168, 83, 0.03)',
    'rgba(232, 228, 222, 0.08)',
  ];

  const darkColors = [
    'rgba(212, 168, 83, 0.04)',
    'rgba(26, 74, 122, 0.06)',
    'rgba(100, 160, 220, 0.04)',
    'rgba(212, 168, 83, 0.03)',
    'rgba(15, 43, 70, 0.08)',
  ];

  for (let i = 0; i < blobCount; i++) {
    blobs.push({
      x: Math.random(),
      y: Math.random(),
      radius: 0.2 + Math.random() * 0.25,
      speedX: (Math.random() - 0.5) * 0.0003,
      speedY: (Math.random() - 0.5) * 0.0003,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.003 + Math.random() * 0.004,
      color: isDark ? darkColors[i % darkColors.length] : lightColors[i % lightColors.length],
    });
  }

  liquidEtherState = { blobs };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function draw(timestamp) {
    animFrameId = requestAnimationFrame(draw);

    // Throttle to target FPS
    if (timestamp - lastFrameTime < frameDuration) return;
    lastFrameTime = timestamp;

    ctx.clearRect(0, 0, width, height);

    for (const blob of blobs) {
      // Update position
      blob.x += blob.speedX;
      blob.y += blob.speedY;
      blob.phase += blob.phaseSpeed;

      // Bounce off edges
      if (blob.x < -0.1 || blob.x > 1.1) blob.speedX *= -1;
      if (blob.y < -0.1 || blob.y > 1.1) blob.speedY *= -1;

      // Slight mouse attraction
      const blobPxX = blob.x * width;
      const blobPxY = blob.y * height;
      const dx = mouseX - blobPxX;
      const dy = mouseY - blobPxY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 400 && dist > 0) {
        const pull = 0.00002;
        blob.x += (dx / dist) * pull;
        blob.y += (dy / dist) * pull;
      }

      // Draw blob
      const r = blob.radius * Math.min(width, height) * (1 + 0.15 * Math.sin(blob.phase));
      const cx = blob.x * width;
      const cy = blob.y * height;

      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, blob.color);
      gradient.addColorStop(1, 'transparent');

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  // Mouse tracking
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { passive: true });

  resize();
  window.addEventListener('resize', resize);
  animFrameId = requestAnimationFrame(draw);

  // Pause when page is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(animFrameId);
    } else {
      lastFrameTime = 0;
      animFrameId = requestAnimationFrame(draw);
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

  let mouseX = -1000, mouseY = -1000, isHovering = false;

  function render() {
    const wrapper = canvas.parentElement;
    const wrapperWidth = wrapper.clientWidth;

    const canvasHeight = wrapperWidth <= 400
      ? Math.max(80, wrapperWidth * 0.22)
      : wrapperWidth <= 768
        ? Math.max(110, wrapperWidth * 0.22)
        : Math.max(180, wrapperWidth * 0.24);
    const canvasWidth = wrapperWidth;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const text = 'JIAYI HU';

    const offscreen = document.createElement('canvas');
    offscreen.width = canvasWidth;
    offscreen.height = canvasHeight;
    const offCtx = offscreen.getContext('2d');

    const fontSize = wrapperWidth <= 400
      ? Math.min(canvasWidth * 0.15, 60)
      : wrapperWidth <= 768
        ? Math.min(canvasWidth * 0.16, 100)
        : Math.min(canvasWidth * 0.18, 180);

    offCtx.font = `900 ${fontSize}px 'Inter', sans-serif`;
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.fillStyle = '#fff';
    offCtx.fillText(text, canvasWidth / 2, canvasHeight / 2);

    const imageData = offCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const pixels = imageData.data;

    const dotSpacing = wrapperWidth <= 400
      ? Math.max(3, Math.floor(canvasWidth / 120))
      : wrapperWidth <= 768
        ? Math.max(3, Math.floor(canvasWidth / 150))
        : Math.max(4, Math.floor(canvasWidth / 200));
    const dotRadius = dotSpacing * 0.3;

    const isDark = getEffectiveTheme() === 'dark';

    const colorStart = isDark
      ? { r: 100, g: 160, b: 220 }
      : { r: 15, g: 43, b: 70 };
    const colorEnd = isDark
      ? { r: 212, g: 168, b: 83 }
      : { r: 26, g: 74, b: 122 };
    const gold = { r: 212, g: 168, b: 83 };

    for (let y = 0; y < canvasHeight; y += dotSpacing) {
      for (let x = 0; x < canvasWidth; x += dotSpacing) {
        const i = (y * canvasWidth + x) * 4;
        const alpha = pixels[i + 3];

        if (alpha > 128) {
          const t = x / canvasWidth;
          let r, g, b;
          let radiusMult = 1;

          const baseR = Math.round(colorStart.r + (colorEnd.r - colorStart.r) * t);
          const baseG = Math.round(colorStart.g + (colorEnd.g - colorStart.g) * t);
          const baseB = Math.round(colorStart.b + (colorEnd.b - colorStart.b) * t);

          if (isHovering) {
            const dx = x - mouseX;
            const dy = y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const influenceRadius = 120;

            if (dist < influenceRadius) {
              const blend = 1 - (dist / influenceRadius);
              const blendEased = blend * blend;
              r = Math.round(baseR + (gold.r - baseR) * blendEased);
              g = Math.round(baseG + (gold.g - baseG) * blendEased);
              b = Math.round(baseB + (gold.b - baseB) * blendEased);
              radiusMult = 1 + blendEased * 0.6;
            } else {
              r = baseR; g = baseG; b = baseB;
            }
          } else {
            r = baseR; g = baseG; b = baseB;
          }

          const dotAlpha = isDark
            ? 0.65 + (alpha / 255) * 0.35
            : 0.75 + (alpha / 255) * 0.25;

          ctx.beginPath();
          ctx.arc(x, y, dotRadius * radiusMult, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotAlpha})`;
          ctx.fill();
        }
      }
    }
  }

  dotMatrixRender = render;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    isHovering = true;
    render();
  });

  canvas.addEventListener('mouseleave', () => {
    isHovering = false;
    render();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(render);
  } else {
    setTimeout(render, 300);
  }

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(render, 100);
  });
}

// ===== Navbar Scroll Effect =====
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const container = document.getElementById('snapContainer');
  if (!navbar || !container) return;

  container.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', container.scrollTop > 50);
  }, { passive: true });
}

// ===== Mobile Menu =====
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

// ===== Scroll Reveal (IntersectionObserver) =====
function initScrollReveal() {
  const animItems = document.querySelectorAll('.anim-item');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
  );

  animItems.forEach(el => observer.observe(el));
}

// ===== Active Nav Link Highlighting =====
function initActiveNavLinks() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  const container = document.getElementById('snapContainer');
  if (!container) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    },
    { threshold: 0.5, root: container }
  );

  sections.forEach(section => observer.observe(section));
}

// ===== Scroll Indicator =====
function initScrollIndicator() {
  document.querySelector('.hero-scroll-hint')?.addEventListener('click', () => {
    document.querySelector('#about')?.scrollIntoView({ behavior: 'smooth' });
  });
}

// ===== Nav Link Smooth Scroll =====
function initNavScroll() {
  const container = document.getElementById('snapContainer');
  if (!container) return;

  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href');
      const target = document.querySelector(targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// ===== Music Stack =====
function initMusicStack() {
  const wrapper = document.getElementById('musicStack');
  if (!wrapper) return;

  const stack = wrapper.querySelector('.music-stack');
  const cards = wrapper.querySelectorAll('.music-card');
  const dots = wrapper.querySelectorAll('.music-dot');
  const totalCards = cards.length;
  let currentIndex = 0;
  let isScrolling = false;

  function updateStack(activeIdx) {
    cards.forEach((card, i) => {
      card.classList.remove('active', 'pos-1', 'pos-2', 'pos-3', 'hidden');
      const diff = (i - activeIdx + totalCards) % totalCards;
      if (diff === 0) card.classList.add('active');
      else if (diff === 1) card.classList.add('pos-1');
      else if (diff === 2) card.classList.add('pos-2');
      else if (diff === 3) card.classList.add('pos-3');
      else card.classList.add('hidden');
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === activeIdx);
    });
  }

  function handleWheel(e) {
    e.preventDefault();
    if (isScrolling) return;
    isScrolling = true;

    if (e.deltaY > 0) {
      currentIndex = (currentIndex + 1) % totalCards;
    } else {
      currentIndex = (currentIndex - 1 + totalCards) % totalCards;
    }
    updateStack(currentIndex);
    setTimeout(() => { isScrolling = false; }, 400);
  }

  cards.forEach(card => {
    card.addEventListener('wheel', handleWheel, { passive: false });
  });

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      currentIndex = parseInt(dot.dataset.index);
      updateStack(currentIndex);
    });
  });

  // Play/pause
  const playBtns = wrapper.querySelectorAll('.music-play-btn');
  let currentlyPlaying = null;
  let currentPlayingIdx = null;

  playBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const audio = cards[idx].querySelector('audio');

      if (currentlyPlaying && currentlyPlaying !== audio) {
        currentlyPlaying.pause();
        currentlyPlaying.currentTime = 0;
        playBtns.forEach(b => b.classList.remove('playing'));
        if (currentPlayingIdx !== null) {
          const prevFill = cards[currentPlayingIdx].querySelector('.music-progress-fill');
          if (prevFill) prevFill.style.width = '0%';
        }
      }

      if (audio.paused) {
        audio.play().catch(() => {});
        btn.classList.add('playing');
        currentlyPlaying = audio;
        currentPlayingIdx = idx;
      } else {
        audio.pause();
        btn.classList.remove('playing');
        currentlyPlaying = null;
        currentPlayingIdx = null;
      }
    });
  });

  // Progress bars
  cards.forEach((card, i) => {
    const audio = card.querySelector('audio');
    const progressBar = card.querySelector('.music-progress-bar');
    const progressFill = card.querySelector('.music-progress-fill');

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        progressFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
      }
    });

    audio.addEventListener('ended', () => {
      playBtns[i].classList.remove('playing');
      progressFill.style.width = '0%';
      currentlyPlaying = null;
      currentPlayingIdx = null;
    });

    progressBar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audio.duration) {
        const rect = progressBar.getBoundingClientRect();
        audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
      }
    });
  });

  // Touch swipe
  let touchStartY = 0;
  stack.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  stack.addEventListener('touchend', (e) => {
    const deltaY = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(deltaY) > 30) {
      currentIndex = deltaY > 0
        ? (currentIndex + 1) % totalCards
        : (currentIndex - 1 + totalCards) % totalCards;
      updateStack(currentIndex);
    }
  }, { passive: true });

  updateStack(0);
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLiquidEther();
  initDotMatrix();
  initNavbar();
  initMobileMenu();
  initScrollReveal();
  initActiveNavLinks();
  initScrollIndicator();
  initNavScroll();
  initMusicStack();
});
