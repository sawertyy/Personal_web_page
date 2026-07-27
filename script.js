// ===== Theme Management =====
function getEffectiveTheme() {
  return localStorage.getItem('theme') || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    applyTheme(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
  });
}

// ===== Three.js Liquid Ether Background (WebGL Fluid Simulation) =====
function initLiquidEther() {
  const container = document.getElementById('liquidEtherContainer');
  if (!container || typeof THREE === 'undefined') return;

  // Skip fluid sim entirely for reduced motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // --- Configuration ---
  const isLowPowerDevice =
    window.matchMedia('(max-width: 768px)').matches ||
    window.matchMedia('(pointer: coarse)').matches ||
    ((navigator.hardwareConcurrency || 8) <= 4);

  const CONFIG = {
    mouseForce: 14,
    cursorSize: 95,
    isViscous: true,
    viscous: 30,
    iterationsViscous: isLowPowerDevice ? 4 : 8,
    iterationsPoisson: isLowPowerDevice ? 8 : 12,
    dt: 0.012,
    BFECC: false,
    resolution: isLowPowerDevice ? 0.28 : 0.38,
    maxPixelRatio: isLowPowerDevice ? 1 : 1.25,
    isBounce: false,
    colors: ['#3AA0FF', '#70D0FF', '#B0E8FF'],
    autoDemo: false,
    autoSpeed: 0.38,
    autoIntensity: 2.4,
    takeoverDuration: 0.4,
    autoResumeDelay: 3000,
    autoRampDuration: 1.2,
    autoMargin: 0.08,
    autoPauseMin: 450,
    autoPauseMax: 1600,
    autoDurationMin: 1.4,
    autoDurationMax: 4.2,
    autoFastDurationMin: 0.65,
    autoFastDurationMax: 1.25,
    autoFastChance: 0.32,
    autoCurveStrengthMin: 0.25,
    autoCurveStrengthMax: 0.75,
    autoEdgeBias: 0.7,
    audioCursorSize: isLowPowerDevice ? 180 : 260,
    audioForceBase: 0.003,
    audioForceMultiplier: 0.018,
    audioForceMax: 0.018,
    audioSmoothingAttack: 0.75,
    audioSmoothingRelease: 1.8,
    audioEnergyFloor: 0.025,
    audioEnergyGamma: 1.35,
    audioBreathSpeed: 0.035,
    audioBreathEnergySpeed: 0.025,
    audioDriftRangeX: 0.22,
    audioDriftRangeY: 0.16,
    audioDriftSecondary: 0.05,
    audioDriftSpeedX: 0.045,
    audioDriftSpeedY: 0.038,
    audioForceTurnSpeed: 0.11,
    audioForceYRatio: 0.72,
  };

  // --- Palette Texture ---
  function makePaletteTexture(stops) {
    const arr = stops.length > 1 ? stops : [stops[0], stops[0]];
    const w = arr.length;
    const data = new Uint8Array(w * 4);
    for (let i = 0; i < w; i++) {
      const c = new THREE.Color(arr[i]);
      data[i * 4 + 0] = Math.round(c.r * 255);
      data[i * 4 + 1] = Math.round(c.g * 255);
      data[i * 4 + 2] = Math.round(c.b * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const paletteTex = makePaletteTexture(CONFIG.colors);
  const bgVec4 = new THREE.Vector4(0, 0, 0, 0);

  // --- GLSL Shaders ---
  const face_vert = `
    attribute vec3 position;
    uniform vec2 px;
    uniform vec2 boundarySpace;
    varying vec2 uv;
    precision highp float;
    void main(){
      vec3 pos = position;
      vec2 scale = 1.0 - boundarySpace * 2.0;
      pos.xy = pos.xy * scale;
      uv = vec2(0.5) + (pos.xy) * 0.5;
      gl_Position = vec4(pos, 1.0);
    }
  `;

  const line_vert = `
    attribute vec3 position;
    uniform vec2 px;
    precision highp float;
    varying vec2 uv;
    void main(){
      vec3 pos = position;
      uv = 0.5 + pos.xy * 0.5;
      vec2 n = sign(pos.xy);
      pos.xy = abs(pos.xy) - px * 1.0;
      pos.xy *= n;
      gl_Position = vec4(pos, 1.0);
    }
  `;

  const mouse_vert = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
      vec2 pos = position.xy * scale * 2.0 * px + center;
      vUv = uv;
      gl_Position = vec4(pos, 0.0, 1.0);
    }
  `;

  const advection_frag = `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform bool isBFECC;
    uniform vec2 fboSize;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
      if(isBFECC == false){
        vec2 vel = texture2D(velocity, uv).xy;
        vec2 uv2 = uv - vel * dt * ratio;
        vec2 newVel = texture2D(velocity, uv2).xy;
        gl_FragColor = vec4(newVel, 0.0, 0.0);
      } else {
        vec2 spot_new = uv;
        vec2 vel_old = texture2D(velocity, uv).xy;
        vec2 spot_old = spot_new - vel_old * dt * ratio;
        vec2 vel_new1 = texture2D(velocity, spot_old).xy;
        vec2 spot_new2 = spot_old + vel_new1 * dt * ratio;
        vec2 error = spot_new2 - spot_new;
        vec2 spot_new3 = spot_new - error / 2.0;
        vec2 vel_2 = texture2D(velocity, spot_new3).xy;
        vec2 spot_old2 = spot_new3 - vel_2 * dt * ratio;
        vec2 newVel2 = texture2D(velocity, spot_old2).xy;
        gl_FragColor = vec4(newVel2, 0.0, 0.0);
      }
    }
  `;

  const color_frag = `
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D palette;
    uniform vec4 bgColor;
    varying vec2 uv;
    void main(){
      vec2 vel = texture2D(velocity, uv).xy;
      float lenv = clamp(length(vel), 0.0, 1.0);
      vec3 c = texture2D(palette, vec2(lenv, 0.5)).rgb;
      vec3 outRGB = mix(bgColor.rgb, c, lenv);
      float outA = mix(bgColor.a, 1.0, lenv);
      gl_FragColor = vec4(outRGB, outA);
    }
  `;

  const divergence_frag = `
    precision highp float;
    uniform sampler2D velocity;
    uniform float dt;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      float x0 = texture2D(velocity, uv-vec2(px.x, 0.0)).x;
      float x1 = texture2D(velocity, uv+vec2(px.x, 0.0)).x;
      float y0 = texture2D(velocity, uv-vec2(0.0, px.y)).y;
      float y1 = texture2D(velocity, uv+vec2(0.0, px.y)).y;
      float divergence = (x1-x0+y1-y0) / 2.0;
      gl_FragColor = vec4(divergence / dt);
    }
  `;

  const externalForce_frag = `
    precision highp float;
    uniform vec2 force;
    uniform vec2 center;
    uniform vec2 scale;
    uniform vec2 px;
    varying vec2 vUv;
    void main(){
      vec2 circle = (vUv - 0.5) * 2.0;
      float d = 1.0 - min(length(circle), 1.0);
      d *= d;
      gl_FragColor = vec4(force * d, 0.0, 1.0);
    }
  `;

  const poisson_frag = `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D divergence;
    uniform vec2 px;
    varying vec2 uv;
    void main(){
      float p0 = texture2D(pressure, uv+vec2(px.x*2.0,0.0)).r;
      float p1 = texture2D(pressure, uv-vec2(px.x*2.0,0.0)).r;
      float p2 = texture2D(pressure, uv+vec2(0.0,px.y*2.0)).r;
      float p3 = texture2D(pressure, uv-vec2(0.0,px.y*2.0)).r;
      float div = texture2D(divergence, uv).r;
      float newP = (p0+p1+p2+p3)/4.0 - div;
      gl_FragColor = vec4(newP);
    }
  `;

  const pressure_frag = `
    precision highp float;
    uniform sampler2D pressure;
    uniform sampler2D velocity;
    uniform vec2 px;
    uniform float dt;
    varying vec2 uv;
    void main(){
      float step = 1.0;
      float p0 = texture2D(pressure, uv+vec2(px.x*step,0.0)).r;
      float p1 = texture2D(pressure, uv-vec2(px.x*step,0.0)).r;
      float p2 = texture2D(pressure, uv+vec2(0.0,px.y*step)).r;
      float p3 = texture2D(pressure, uv-vec2(0.0,px.y*step)).r;
      vec2 v = texture2D(velocity, uv).xy;
      vec2 gradP = vec2(p0-p1, p2-p3) * 0.5;
      v = v - gradP * dt;
      gl_FragColor = vec4(v, 0.0, 1.0);
    }
  `;

  const viscous_frag = `
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D velocity_new;
    uniform float v;
    uniform vec2 px;
    uniform float dt;
    varying vec2 uv;
    void main(){
      vec2 old = texture2D(velocity, uv).xy;
      vec2 new0 = texture2D(velocity_new, uv+vec2(px.x*2.0,0.0)).xy;
      vec2 new1 = texture2D(velocity_new, uv-vec2(px.x*2.0,0.0)).xy;
      vec2 new2 = texture2D(velocity_new, uv+vec2(0.0,px.y*2.0)).xy;
      vec2 new3 = texture2D(velocity_new, uv-vec2(0.0,px.y*2.0)).xy;
      vec2 newv = 4.0*old + v*dt*(new0+new1+new2+new3);
      newv /= 4.0*(1.0+v*dt);
      gl_FragColor = vec4(newv, 0.0, 0.0);
    }
  `;

  // --- Common State ---
  const Common = {
    width: 0, height: 0, renderer: null, clock: null, time: 0, delta: 0,
    init(el) {
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio || 1);
      this.resize(el);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.autoClear = false;
      this.renderer.setClearColor(new THREE.Color(0x000000), 0);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(this.width, this.height);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.renderer.domElement.style.display = 'block';
      this.clock = new THREE.Clock();
      this.clock.start();
    },
    resize(el) {
      const rect = el.getBoundingClientRect();
      this.width = Math.max(1, Math.floor(rect.width));
      this.height = Math.max(1, Math.floor(rect.height));
      if (this.renderer) this.renderer.setSize(this.width, this.height, false);
    },
    update() {
      this.delta = this.clock.getDelta();
      this.time += this.delta;
    }
  };

  // --- Mouse Tracking ---
  const Mouse = {
    coords: new THREE.Vector2(),
    coords_old: new THREE.Vector2(),
    diff: new THREE.Vector2(),
    mouseMoved: false,
    isHoverInside: false,
    hasUserControl: false,
    isAutoActive: false,
    autoIntensity: CONFIG.autoIntensity,
    takeoverDuration: CONFIG.takeoverDuration,
    takeoverActive: false,
    takeoverStartTime: 0,
    takeoverFrom: new THREE.Vector2(),
    takeoverTo: new THREE.Vector2(),
    timer: null,
    onInteract: null,
    _container: null,

    init(el) {
      this._container = el;
      window.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: true });
      window.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: true });
      window.addEventListener('touchend', () => { this.isHoverInside = false; });
      document.addEventListener('mouseleave', () => { this.isHoverInside = false; });
    },

    _isPointInside(cx, cy) {
      const r = this._container.getBoundingClientRect();
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    },

    _setCoords(x, y) {
      const r = this._container.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const nx = (x - r.left) / r.width;
      const ny = (y - r.top) / r.height;
      this.coords.set(nx * 2 - 1, -(ny * 2 - 1));
      this.mouseMoved = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.mouseMoved = false; }, 100);
    },

    _onMouseMove(e) {
      this.isHoverInside = this._isPointInside(e.clientX, e.clientY);
      if (!this.isHoverInside) return;
      if (this.onInteract) this.onInteract();
      if (this.isAutoActive && !this.hasUserControl && !this.takeoverActive) {
        const r = this._container.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        this.takeoverFrom.copy(this.coords);
        this.takeoverTo.set(nx * 2 - 1, -(ny * 2 - 1));
        this.takeoverStartTime = performance.now();
        this.takeoverActive = true;
        this.hasUserControl = true;
        this.isAutoActive = false;
        return;
      }
      this._setCoords(e.clientX, e.clientY);
      this.hasUserControl = true;
    },

    _onTouchStart(e) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      this.isHoverInside = this._isPointInside(t.clientX, t.clientY);
      if (!this.isHoverInside) return;
      if (this.onInteract) this.onInteract();
      this._setCoords(t.clientX, t.clientY);
      this.hasUserControl = true;
    },

    _onTouchMove(e) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      this.isHoverInside = this._isPointInside(t.clientX, t.clientY);
      if (!this.isHoverInside) return;
      if (this.onInteract) this.onInteract();
      this._setCoords(t.clientX, t.clientY);
    },

    update() {
      if (this.takeoverActive) {
        const t = (performance.now() - this.takeoverStartTime) / (this.takeoverDuration * 1000);
        if (t >= 1) {
          this.takeoverActive = false;
          this.coords.copy(this.takeoverTo);
          this.coords_old.copy(this.coords);
          this.diff.set(0, 0);
        } else {
          const k = t * t * (3 - 2 * t);
          this.coords.copy(this.takeoverFrom).lerp(this.takeoverTo, k);
        }
      }
      this.diff.subVectors(this.coords, this.coords_old);
      this.coords_old.copy(this.coords);
      if (this.coords_old.x === 0 && this.coords_old.y === 0) this.diff.set(0, 0);
      if (this.isAutoActive && !this.takeoverActive) this.diff.multiplyScalar(this.autoIntensity);
    }
  };

  // --- Auto Demo Driver ---
  class AutoDriver {
    constructor(mouse, manager, opts) {
      this.mouse = mouse;
      this.manager = manager;
      this.enabled = opts.enabled;
      this.speed = opts.speed;
      this.resumeDelay = opts.resumeDelay || 3000;
      this.rampDurationMs = (opts.rampDuration || 0) * 1000;
      this.margin = opts.margin ?? 0.08;
      this.pauseMin = opts.pauseMin ?? 450;
      this.pauseMax = opts.pauseMax ?? 1600;
      this.durationMin = opts.durationMin ?? 1.4;
      this.durationMax = opts.durationMax ?? 4.2;
      this.fastDurationMin = opts.fastDurationMin ?? 0.65;
      this.fastDurationMax = opts.fastDurationMax ?? 1.25;
      this.fastChance = opts.fastChance ?? 0.32;
      this.curveStrengthMin = opts.curveStrengthMin ?? 0.25;
      this.curveStrengthMax = opts.curveStrengthMax ?? 0.75;
      this.edgeBias = opts.edgeBias ?? 0.7;
      this.active = false;
      this.current = new THREE.Vector2(0, 0);
      this.p0 = new THREE.Vector2();
      this.p1 = new THREE.Vector2();
      this.p2 = new THREE.Vector2();
      this.p3 = new THREE.Vector2();
      this.segmentStartTime = 0;
      this.segmentDurationMs = 0;
      this.pauseUntil = 0;
      this.activationTime = 0;
      this._tmpDir = new THREE.Vector2();
      this._tmpPerp = new THREE.Vector2();
      this._tmpPoint = new THREE.Vector2();
      this._tmpBezier = new THREE.Vector2();
    }
    randomRange(min, max) {
      return min + Math.random() * (max - min);
    }
    randomInBounds() {
      const limit = 1 - this.margin;
      const pickAxis = () => {
        const sign = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < this.edgeBias) {
          return sign * this.randomRange(0.45, 1) * limit;
        }
        return (Math.random() * 2 - 1) * limit;
      };
      return this._tmpPoint.set(pickAxis(), pickAxis()).clone();
    }
    clampToBounds(v) {
      const limit = 1 - this.margin;
      v.x = Math.max(-limit, Math.min(limit, v.x));
      v.y = Math.max(-limit, Math.min(limit, v.y));
      return v;
    }
    speedProfile(t) {
      t = Math.max(0, Math.min(1, t));
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    bezier(t, out) {
      const u = 1 - t;
      const uu = u * u;
      const tt = t * t;
      const uuu = uu * u;
      const ttt = tt * t;
      out.set(0, 0);
      out.addScaledVector(this.p0, uuu);
      out.addScaledVector(this.p1, 3 * uu * t);
      out.addScaledVector(this.p2, 3 * u * tt);
      out.addScaledVector(this.p3, ttt);
      return out;
    }
    startSegment(now) {
      this.p0.copy(this.current);
      this.p3.copy(this.randomInBounds());

      const dir = this._tmpDir.subVectors(this.p3, this.p0);
      const dist = Math.max(dir.length(), 0.001);
      dir.normalize();
      const perp = this._tmpPerp.set(-dir.y, dir.x);
      const bend = this.randomRange(this.curveStrengthMin, this.curveStrengthMax) * dist;
      const bendSign = Math.random() < 0.5 ? -1 : 1;
      const drift = this.randomRange(-0.18, 0.18) * dist;

      this.p1.copy(this.p0)
        .addScaledVector(dir, dist * this.randomRange(0.22, 0.38))
        .addScaledVector(perp, bend * bendSign)
        .addScaledVector(dir, drift);
      this.p2.copy(this.p0)
        .addScaledVector(dir, dist * this.randomRange(0.62, 0.82))
        .addScaledVector(perp, -bend * bendSign * this.randomRange(0.45, 0.9))
        .addScaledVector(dir, -drift * 0.5);

      this.clampToBounds(this.p1);
      this.clampToBounds(this.p2);
      this.clampToBounds(this.p3);

      const isFast = Math.random() < this.fastChance;
      const min = isFast ? this.fastDurationMin : this.durationMin;
      const max = isFast ? this.fastDurationMax : this.durationMax;
      const speedScale = this.speed > 0 ? 0.38 / this.speed : 1;
      this.segmentDurationMs = this.randomRange(min, max) * speedScale * 1000;
      this.segmentStartTime = now;
      this.pauseUntil = 0;
    }
    forceStop() {
      this.active = false;
      this.pauseUntil = 0;
      this.mouse.isAutoActive = false;
    }
    update() {
      if (!this.enabled) return;
      const now = performance.now();

      if (audioReactive.connected) {
        if (this.active) this.forceStop();
        return;
      }

      const idle = now - this.manager.lastUserInteraction;
      if (idle < this.resumeDelay) {
        if (this.active) this.forceStop();
        return;
      }
      if (!this.active) {
        this.active = true;
        this.current.copy(this.mouse.coords);
        this.clampToBounds(this.current);
        this.activationTime = now;
        this.startSegment(now);
      }
      this.mouse.isAutoActive = true;

      if (this.pauseUntil) {
        if (now < this.pauseUntil) return;
        this.startSegment(now);
      }

      const rawT = (now - this.segmentStartTime) / this.segmentDurationMs;
      if (rawT >= 1) {
        this.current.copy(this.p3);
        this.mouse.coords.copy(this.current);
        this.pauseUntil = now + this.randomRange(this.pauseMin, this.pauseMax);
        return;
      }

      let ramp = 1;
      if (this.rampDurationMs > 0) {
        const rt = Math.min(1, (now - this.activationTime) / this.rampDurationMs);
        ramp = rt * rt * (3 - 2 * rt);
      }
      const t = this.speedProfile(rawT * ramp);
      this.current.copy(this.bezier(t, this._tmpBezier));
      this.mouse.coords.copy(this.current);
      this.mouse.mouseMoved = true;
    }
  }

  // --- ShaderPass Base ---
  class ShaderPass {
    constructor(props) {
      this.props = props || {};
      this.uniforms = this.props.material ? this.props.material.uniforms : null;
      this.scene = null;
      this.camera = null;
    }
    init() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      if (this.uniforms) {
        this.material = new THREE.RawShaderMaterial(this.props.material);
        this.geometry = new THREE.PlaneGeometry(2.0, 2.0);
        this.plane = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(this.plane);
      }
    }
    update() {
      Common.renderer.setRenderTarget(this.props.output || null);
      Common.renderer.render(this.scene, this.camera);
      Common.renderer.setRenderTarget(null);
    }
  }

  // --- Advection ---
  class Advection extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: advection_frag,
          uniforms: {
            boundarySpace: { value: simProps.cellScale },
            px: { value: simProps.cellScale },
            fboSize: { value: simProps.fboSize },
            velocity: { value: simProps.src.texture },
            dt: { value: simProps.dt },
            isBFECC: { value: true }
          }
        },
        output: simProps.dst
      });
      this.uniforms = this.props.material.uniforms;
      this.init();
      this.createBoundary();
    }
    createBoundary() {
      const boundaryG = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -1,-1,0, -1,1,0, -1,1,0, 1,1,0, 1,1,0, 1,-1,0, 1,-1,0, -1,-1,0
      ]);
      boundaryG.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const boundaryM = new THREE.RawShaderMaterial({
        vertexShader: line_vert,
        fragmentShader: advection_frag,
        uniforms: this.uniforms
      });
      this.line = new THREE.LineSegments(boundaryG, boundaryM);
      this.scene.add(this.line);
    }
    update(opts) {
      this.uniforms.dt.value = opts.dt;
      this.line.visible = opts.isBounce;
      this.uniforms.isBFECC.value = opts.BFECC;
      super.update();
    }
  }

  // --- ExternalForce ---
  class ExternalForce extends ShaderPass {
    constructor(simProps) {
      super({ output: simProps.dst });
      this.init();
      const mouseG = new THREE.PlaneGeometry(1, 1);
      const mouseM = new THREE.RawShaderMaterial({
        vertexShader: mouse_vert,
        fragmentShader: externalForce_frag,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          px: { value: simProps.cellScale },
          force: { value: new THREE.Vector2(0.0, 0.0) },
          center: { value: new THREE.Vector2(0.0, 0.0) },
          scale: { value: new THREE.Vector2(simProps.cursor_size, simProps.cursor_size) }
        }
      });
      this.mouse = new THREE.Mesh(mouseG, mouseM);
      this.scene.add(this.mouse);
    }
    update(props) {
      const u = this.mouse.material.uniforms;
      const renderImpulse = (center, force, cursorSize) => {
        const csX = cursorSize * props.cellScale.x;
        const csY = cursorSize * props.cellScale.y;
        const centerX = Math.min(Math.max(center.x, -1 + csX + props.cellScale.x * 2), 1 - csX - props.cellScale.x * 2);
        const centerY = Math.min(Math.max(center.y, -1 + csY + props.cellScale.y * 2), 1 - csY - props.cellScale.y * 2);
        u.force.value.set(force.x, force.y);
        u.center.value.set(centerX, centerY);
        u.scale.value.set(cursorSize, cursorSize);
        super.update();
      };

      renderImpulse(Mouse.coords, {
        x: (Mouse.diff.x / 2) * props.mouse_force,
        y: (Mouse.diff.y / 2) * props.mouse_force
      }, props.cursor_size);

      if (props.audioActive) {
        renderImpulse(props.audioCenter, props.audioForce, props.audioCursorSize);
      }
    }
  }

  // --- Viscous ---
  class Viscous extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: viscous_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            velocity: { value: simProps.src.texture },
            velocity_new: { value: simProps.dst_.texture },
            v: { value: simProps.viscous },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt }
          }
        },
        output: simProps.dst,
        output0: simProps.dst_,
        output1: simProps.dst
      });
      this.init();
    }
    update(opts) {
      let fbo_in, fbo_out;
      this.uniforms.v.value = opts.viscous;
      for (let i = 0; i < opts.iterations; i++) {
        if (i % 2 === 0) { fbo_in = this.props.output0; fbo_out = this.props.output1; }
        else { fbo_in = this.props.output1; fbo_out = this.props.output0; }
        this.uniforms.velocity_new.value = fbo_in.texture;
        this.props.output = fbo_out;
        this.uniforms.dt.value = opts.dt;
        super.update();
      }
      return fbo_out;
    }
  }

  // --- Divergence ---
  class Divergence extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: divergence_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            velocity: { value: simProps.src.texture },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt }
          }
        },
        output: simProps.dst
      });
      this.init();
    }
    update(opts) {
      this.uniforms.velocity.value = opts.vel.texture;
      super.update();
    }
  }

  // --- Poisson ---
  class Poisson extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: poisson_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            pressure: { value: simProps.dst_.texture },
            divergence: { value: simProps.src.texture },
            px: { value: simProps.cellScale }
          }
        },
        output: simProps.dst,
        output0: simProps.dst_,
        output1: simProps.dst
      });
      this.init();
    }
    update(opts) {
      let p_in, p_out;
      for (let i = 0; i < opts.iterations; i++) {
        if (i % 2 === 0) { p_in = this.props.output0; p_out = this.props.output1; }
        else { p_in = this.props.output1; p_out = this.props.output0; }
        this.uniforms.pressure.value = p_in.texture;
        this.props.output = p_out;
        super.update();
      }
      return p_out;
    }
  }

  // --- Pressure ---
  class Pressure extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: pressure_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            pressure: { value: simProps.src_p.texture },
            velocity: { value: simProps.src_v.texture },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt }
          }
        },
        output: simProps.dst
      });
      this.init();
    }
    update(opts) {
      this.uniforms.velocity.value = opts.vel.texture;
      this.uniforms.pressure.value = opts.pressure.texture;
      super.update();
    }
  }

  // --- Simulation ---
  class Simulation {
    constructor() {
      this.options = { ...CONFIG };
      this.fbos = {};
      this.fboSize = new THREE.Vector2();
      this.cellScale = new THREE.Vector2();
      this.boundarySpace = new THREE.Vector2();
      this.init();
    }
    init() {
      this.calcSize();
      this.createAllFBO();
      this.createShaderPass();
    }
    getFloatType() {
      const isIOS = /(iPad|iPhone|iPod)/i.test(navigator.userAgent);
      return isIOS ? THREE.HalfFloatType : THREE.FloatType;
    }
    createAllFBO() {
      const type = this.getFloatType();
      const opts = {
        type, depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
      };
      const keys = ['vel_0','vel_1','vel_viscous0','vel_viscous1','div','pressure_0','pressure_1'];
      for (const key of keys) {
        this.fbos[key] = new THREE.WebGLRenderTarget(this.fboSize.x, this.fboSize.y, opts);
      }
    }
    createShaderPass() {
      this.advection = new Advection({
        cellScale: this.cellScale, fboSize: this.fboSize,
        dt: this.options.dt, src: this.fbos.vel_0, dst: this.fbos.vel_1
      });
      this.externalForce = new ExternalForce({
        cellScale: this.cellScale, cursor_size: this.options.cursorSize, dst: this.fbos.vel_1
      });
      this.viscous = new Viscous({
        cellScale: this.cellScale, boundarySpace: this.boundarySpace,
        viscous: this.options.viscous, src: this.fbos.vel_1,
        dst: this.fbos.vel_viscous1, dst_: this.fbos.vel_viscous0, dt: this.options.dt
      });
      this.divergence = new Divergence({
        cellScale: this.cellScale, boundarySpace: this.boundarySpace,
        src: this.fbos.vel_viscous0, dst: this.fbos.div, dt: this.options.dt
      });
      this.poisson = new Poisson({
        cellScale: this.cellScale, boundarySpace: this.boundarySpace,
        src: this.fbos.div, dst: this.fbos.pressure_1, dst_: this.fbos.pressure_0
      });
      this.pressure = new Pressure({
        cellScale: this.cellScale, boundarySpace: this.boundarySpace,
        src_p: this.fbos.pressure_0, src_v: this.fbos.vel_viscous0,
        dst: this.fbos.vel_0, dt: this.options.dt
      });
    }
    calcSize() {
      const w = Math.max(1, Math.round(this.options.resolution * Common.width));
      const h = Math.max(1, Math.round(this.options.resolution * Common.height));
      this.cellScale.set(1.0 / w, 1.0 / h);
      this.fboSize.set(w, h);
    }
    resize() {
      this.calcSize();
      for (const key in this.fbos) {
        this.fbos[key].setSize(this.fboSize.x, this.fboSize.y);
      }
    }
    update() {
      if (this.options.isBounce) this.boundarySpace.set(0, 0);
      else this.boundarySpace.copy(this.cellScale);

      this.advection.update({ dt: this.options.dt, isBounce: this.options.isBounce, BFECC: this.options.BFECC });
      this.externalForce.update({
        cursor_size: this.options.cursorSize,
        mouse_force: this.options.mouseForce,
        cellScale: this.cellScale,
        audioForce: audioReactive.force,
        audioCenter: audioReactive.center,
        audioCursorSize: this.options.audioCursorSize,
        audioActive: audioReactive.active
      });

      let vel = this.fbos.vel_1;
      if (this.options.isViscous) {
        vel = this.viscous.update({
          viscous: this.options.viscous,
          iterations: this.options.iterationsViscous,
          dt: this.options.dt
        });
      }
      this.divergence.update({ vel });
      const pres = this.poisson.update({ iterations: this.options.iterationsPoisson });
      this.pressure.update({ vel, pressure: pres });
    }
  }

  // --- Output ---
  class Output {
    constructor() {
      this.simulation = new Simulation();
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      this.output = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.RawShaderMaterial({
          vertexShader: face_vert,
          fragmentShader: color_frag,
          transparent: true,
          depthWrite: false,
          uniforms: {
            velocity: { value: this.simulation.fbos.vel_0.texture },
            boundarySpace: { value: new THREE.Vector2() },
            palette: { value: paletteTex },
            bgColor: { value: bgVec4 }
          }
        })
      );
      this.scene.add(this.output);
    }
    resize() { this.simulation.resize(); }
    render() {
      Common.renderer.setRenderTarget(null);
      Common.renderer.render(this.scene, this.camera);
    }
    update() {
      this.simulation.update();
      this.render();
    }
  }

  // --- Initialize ---
  let rafId = null;
  let running = false;
  let isVisible = true;

  try {
    Common.init(container);
  } catch (e) {
    return; // WebGL not available
  }

  Mouse.init(container);
  container.prepend(Common.renderer.domElement);

  const output = new Output();
  let lastUserInteraction = performance.now();

  Mouse.onInteract = () => {
    lastUserInteraction = performance.now();
    if (autoDriver) autoDriver.forceStop();
  };

  const managerProxy = { get lastUserInteraction() { return lastUserInteraction; } };
  const autoDriver = new AutoDriver(Mouse, managerProxy, {
    enabled: CONFIG.autoDemo,
    speed: CONFIG.autoSpeed,
    resumeDelay: CONFIG.autoResumeDelay,
    rampDuration: CONFIG.autoRampDuration,
    margin: CONFIG.autoMargin,
    pauseMin: CONFIG.autoPauseMin,
    pauseMax: CONFIG.autoPauseMax,
    durationMin: CONFIG.autoDurationMin,
    durationMax: CONFIG.autoDurationMax,
    fastDurationMin: CONFIG.autoFastDurationMin,
    fastDurationMax: CONFIG.autoFastDurationMax,
    fastChance: CONFIG.autoFastChance,
    curveStrengthMin: CONFIG.autoCurveStrengthMin,
    curveStrengthMax: CONFIG.autoCurveStrengthMax,
    edgeBias: CONFIG.autoEdgeBias
  });

  // ===== Audio Reactive =====
  const audioReactive = {
    ctx: null,
    analyser: null,
    sourceMap: new WeakMap(),
    dataArray: null,
    connected: false,
    active: false,
    currentAudio: null,
    center: new THREE.Vector2(0, 0),
    force: { x: 0, y: 0 },
    smoothedEnergy: 0,
    ambientPhase: 0,
    lastAmbientTime: 0,

    resetAmbient() {
      this.active = false;
      this.force.x = 0;
      this.force.y = 0;
      this.center.set(0, 0);
      this.smoothedEnergy = 0;
      this.ambientPhase = 0;
      this.lastAmbientTime = 0;
    },

    clearAmbient() {
      this.active = false;
      this.force.x = 0;
      this.force.y = 0;
      this.lastAmbientTime = 0;
    },

    updateAmbient(rawEnergy, now) {
      if (!this.active) {
        this.force.x = 0;
        this.force.y = 0;
        return;
      }

      if (!this.lastAmbientTime) this.lastAmbientTime = now;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastAmbientTime) / 1000));
      this.lastAmbientTime = now;

      const attack = 1 - Math.exp(-dt / CONFIG.audioSmoothingAttack);
      const release = 1 - Math.exp(-dt / CONFIG.audioSmoothingRelease);
      const k = rawEnergy > this.smoothedEnergy ? attack : release;
      this.smoothedEnergy += (rawEnergy - this.smoothedEnergy) * k;

      const normalizedEnergy = Math.max(0, this.smoothedEnergy - CONFIG.audioEnergyFloor);
      const energy = Math.pow(normalizedEnergy, CONFIG.audioEnergyGamma);
      this.ambientPhase += dt * (CONFIG.audioBreathSpeed + energy * CONFIG.audioBreathEnergySpeed);
      const breath = 0.55 + 0.45 * Math.sin(this.ambientPhase * Math.PI * 2);

      const driftT = now / 1000;
      this.center.set(
        Math.sin(driftT * CONFIG.audioDriftSpeedX) * CONFIG.audioDriftRangeX +
          Math.sin(driftT * 0.017) * CONFIG.audioDriftSecondary,
        Math.cos(driftT * CONFIG.audioDriftSpeedY) * CONFIG.audioDriftRangeY
      );

      const amp = Math.min(
        CONFIG.audioForceMax,
        CONFIG.audioForceBase + energy * CONFIG.audioForceMultiplier * breath
      );
      const angle = driftT * CONFIG.audioForceTurnSpeed;
      this.force.x = Math.cos(angle) * amp;
      this.force.y = Math.sin(angle * 0.87 + 1.2) * amp * CONFIG.audioForceYRatio;
    },

    connect(audioEl) {
      if (this.currentAudio === audioEl && this.connected) return;
      this.disconnect();
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      // createMediaElementSource can only be called once per element
      let source = this.sourceMap.get(audioEl);
      if (!source) {
        source = this.ctx.createMediaElementSource(audioEl);
        this.sourceMap.set(audioEl, source);
      }
      source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.resetAmbient();
      this.connected = true;
      this.currentAudio = audioEl;
    },

    disconnect() {
      const source = this.currentAudio ? this.sourceMap.get(this.currentAudio) : null;
      if (source) { source.disconnect(); }
      if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
      this.connected = false;
      this.currentAudio = null;
      this.resetAmbient();
    },

    getEnergy() {
      if (!this.connected || !this.analyser) return 0;
      this.analyser.getByteFrequencyData(this.dataArray);
      let sum = 0;
      const bassEnd = Math.floor(this.dataArray.length * 0.3);
      for (let i = 0; i < bassEnd; i++) sum += this.dataArray[i];
      return sum / (bassEnd * 255);
    }
  };

  window.fluidAudio = {
    connect: (el) => audioReactive.connect(el),
    disconnect: () => audioReactive.disconnect()
  };

  function resizeHandler() {
    Common.resize(container);
    output.resize();
  }

  function isHomeSectionActive() {
    const snapContainer = document.getElementById('snapContainer');
    const aboutSection = document.getElementById('about');
    if (!snapContainer || !aboutSection) return true;
    return snapContainer.scrollTop < aboutSection.offsetTop * 0.5;
  }

  function loop() {
    if (!running) return;
    autoDriver.update();
    const homeActive = isHomeSectionActive();
    audioReactive.active = audioReactive.connected && !homeActive;
    if (audioReactive.active) {
      const energy = audioReactive.getEnergy();
      audioReactive.updateAmbient(energy, performance.now());
    } else {
      audioReactive.clearAmbient();
    }
    Mouse.update();
    Common.update();
    output.update();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    loop();
  }

  function pause() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ResizeObserver
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(resizeHandler);
  });
  ro.observe(container);

  // IntersectionObserver — pause when off-screen
  const io = new IntersectionObserver((entries) => {
    const entry = entries[0];
    isVisible = entry.isIntersecting && entry.intersectionRatio > 0;
    if (isVisible && !document.hidden) start();
    else pause();
  }, { threshold: [0, 0.01, 0.1] });
  io.observe(container);

  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (isVisible) start();
  });

  window.addEventListener('resize', resizeHandler);
  start();
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
    const container = document.getElementById('snapContainer');
    const target = document.querySelector('#about');
    if (container && target) {
      container.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
    }
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
        container.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
      }
    });
  });
}

// ===== CardSwap Journey Section =====
var JOURNEY_CARDS = [
  {
    id: 'experience', type: 'experience', typeLabel: 'Experience', typeIcon: 'fas fa-briefcase',
    accentGradient: 'linear-gradient(135deg, #0f2b46, #1a4a7a)',
    title: 'Where I\u2019ve Worked',
    items: [
      {
        logo: 'images/%E4%BA%AC%E4%B8%9Clogo.png', company: 'JD.com', role: 'AI Product Intern',
        period: 'May 2026 \u2014 Present',
        desc: 'Working on AI-assisted operational products for collection, review, and human-in-the-loop workflows.',
        highlights: [
          'Redesigned a pre-collection assistant information interface, reducing average call-preparation time by 11% and lookup clicks by 19%',
          'Built an AI-assisted phone-number review workflow with ASR/OCR verification, human escalation, and sampling checks',
          'Kept AI review accuracy above 85% and reduced management-side review workload by 50%'
        ],
        tags: ['AI Workflow', 'Human-in-the-loop', 'Operations']
      },
      {
        logo: 'images/%E7%99%BE%E5%BA%A6.svg', company: 'Baidu', role: 'AI Product Intern',
        period: 'Jan \u2014 May 2026',
        desc: 'Worked on Wenxin Yiyan Web, improving AI assistant engagement through dynamic greetings, demo cards, and model capability evaluation.',
        highlights: [
          'Built 150+ emotionally engaging SayHi prompts, lifting homepage title CTR to 2% and average chat depth by 20%',
          'Designed 4 model demo card types across creative writing, multimodal understanding, and text generation; achieved 4.13% CTR and 12.1% post-click continued conversation',
          'Evaluated 5 leading LLMs on targeted capabilities and translated findings into product and operations strategies'
        ],
        tags: ['LLM', 'AI Assistant', 'Evaluation']
      },
      {
        logo: 'images/%E5%B0%8F%E7%BA%A2%E4%B9%A6.png', company: 'Xiaohongshu', role: 'E-commerce Product Intern',
        period: 'Sep \u2014 Dec 2025',
        desc: 'Designed LLM-powered search and product-card improvements to improve product discovery and conversion in e-commerce search.',
        highlights: [
          'Built a filter keyword recommendation pipeline from LLM generation and prompt tuning to data cleaning and launch',
          'Increased filter coverage to 40%, filter CTR to 5%, and post-filter conversion by 30%',
          'Optimized product card and trending-search card experiences, driving search GMV +3%, DAB +1%, and 2% organic CTR'
        ],
        tags: ['E-commerce', 'Search', 'Conversion']
      },
      {
        logo: 'images/%E7%99%BE%E8%9E%8D%E4%BA%91%E5%88%9B.png', company: 'BaiRong Cloud', role: 'AI Product Intern',
        period: 'Jun \u2014 Sep 2025',
        desc: 'Launched AI Agent and AI outbound-call workflows for overseas financial clients, connecting model capabilities with frontline operations.',
        highlights: [
          'Shipped 0-to-1 CRM AI Agent features including pre-call summaries, scenario templates, and an agent chat page',
          'Improved efficiency for 5 client managers by 50% and helped move the project toward deal signing',
          'Designed AI outbound-call workflows with SOP mapping, prompt design, and dialing strategies; achieved 56% intent rate, 0.8% conversion, and 80% labor-cost reduction'
        ],
        tags: ['AI Agent', 'Enterprise', 'SaaS']
      },
      {
        logo: 'images/%E6%98%93%E6%99%BA%E7%91%9E.png', company: 'Esri China', role: 'Product Operations Intern',
        period: 'Jul \u2014 Oct 2024',
        desc: 'Designed a provincial natural-resources dashboard demo and supported typhoon-weather scenario showcases for GIS industry clients.',
        highlights: [
          'Dashboard template adopted into the official library, reaching 200+ monthly uses',
          'Conference demos generated 5 inquiries and 2 signings, while related tutorials reached 10,000+ views'
        ],
        tags: ['GIS', 'Documentation', 'Operations']
      }
    ]
  },
  {
    id: 'research', type: 'project', typeLabel: 'Research & Awards', typeIcon: 'fas fa-file-alt',
    accentGradient: 'linear-gradient(135deg, #1e40af, #3b82f6)',
    title: 'Publications & Awards',
    items: [
      {
        badge: 'SCI Q2 \u00b7 First Author', badgeType: 'sci',
        title: 'Research on Multi-Scenario Simulation of Urban Expansion for Beijing\u2013Tianjin\u2013Hebei Region Considering Multilevel Urban Flows',
        meta: 'Hu, J.; Liu, D.; Zheng, X. \u2014 Land \u00b7 Nov 2024',
        desc: 'Published in SCI Q2 journal as first author. Research on multi-scenario urban expansion simulation considering multilevel urban flows.',
        link: 'https://doi.org/10.3390/land13111830',
        images: ['images/paper-land-1.png', 'images/paper-land-2.png', 'images/paper-land-3.jpg'],
        tags: ['Urban Simulation', 'Cellular Automata', 'Multi-Scenario']
      },
      {
        badge: 'SCI Q3 \u00b7 Second Author', badgeType: 'sci',
        title: 'How New Quality Productive Forces Influenced the Urban-Rural Income Gap: Evidence from Prefectural Cities in China',
        meta: 'Zhang, C.; Hu, J.; Song, C.; Lu, Y. \u2014 EDS \u00b7 2025',
        desc: 'Research on how New Quality Productive Forces influenced the urban-rural income gap.',
        link: 'https://doi.org/10.1007/s10668-025-06929-3',
        images: ['images/paper-eds-1.webp', 'images/paper-eds-2.webp', 'images/paper-eds-3.webp', 'images/paper-eds-4.webp'],
        tags: ['Productive Forces', 'Urban-Rural Gap', 'Panel Data']
      },
      {
        badge: 'National Award', badgeType: 'award',
        title: 'Supermarket Vegetable Pricing Optimization',
        meta: 'Hu, J.; Xu, J.; Ye, L. \u2014 CUMCM 2024 \u00b7 Beijing First Prize',
        desc: 'Mathematical modeling competition entry for optimizing supermarket vegetable pricing strategy.',
        link: null,
        images: [],
        tags: ['Mathematical Modeling', 'Optimization', 'Pricing Strategy']
      },
      {
        badge: 'National Award', badgeType: 'award',
        title: 'Graduate Mathematical Modeling Competition',
        meta: 'Nov 2025 \u00b7 National Second Prize',
        desc: '',
        link: null,
        images: [],
        tags: []
      }
    ]
  },
  {
    id: 'music', type: 'music', typeLabel: 'Music', typeIcon: 'fas fa-music',
    accentGradient: 'linear-gradient(135deg, #312e81, #6366f1)',
    title: "What I'm Listening To", meta: 'Melodic Bass \u00b7 Chill House \u00b7 Synthpop',
    desc: 'My taste in music is quite broad, but I mainly listen to melodic bass, chill house, synthpop, indie pop, and R&B.',
    introText: 'My taste in music is quite broad, but I mainly listen to <strong class="genre-accent">melodic bass</strong>, <strong class="genre-accent">chill house</strong>, <strong class="genre-accent">synthpop</strong>, <strong class="genre-accent">indie pop</strong>, and <strong class="genre-accent">R&amp;B</strong>. Check out the cards on the right for what I\'ve been listening to lately ^^',
    songs: [
      { name: '\u5fc3\u8df3119', artist: 'JOYCE \u5c31\u4ee5\u65af', cover: 'music/%E5%BF%83%E8%B7%B3119%20-%20JOYCE%20%E5%B0%B1%E4%BB%A5%E6%96%AF.jpg', audioId: 'journey-audio-3', genre: 'R&B' },
      { name: 'Everything is romantic', artist: 'Charli xcx ft. caroline polachek', cover: 'music/Charli%20xcx%20-%20Everything%20is%20romantic%20featuring%20caroline%20polachek.jpg', audioId: 'journey-audio-0', genre: 'Electro Pop' },
      { name: 'Staring Down Sunset', artist: 'Tinlicker ft. Nathan Nicholson', cover: 'music/Tinlicker%20-%20Staring%20Down%20Sunset%20ft.%20Nathan%20Nicholson.jpg', audioId: 'journey-audio-1', genre: 'Dream Pop' },
      { name: 'Saiko', artist: 'yeule', cover: 'music/yeule%20-%20Saiko.jpg', audioId: 'journey-audio-2', genre: 'Alternative Pop' }
    ],
    tags: ['Melodic Bass', 'Chill House', 'Synthpop', 'Indie Pop', 'R&B']
  },
  {
    id: 'now', type: 'now', typeLabel: 'Now', typeIcon: 'fas fa-clock',
    accentGradient: 'linear-gradient(135deg, #0369a1, #38bdf8)',
    title: "What I'm Up To", meta: 'Last updated Jul 2026',
    desc: 'Recent questions I keep returning to while building AI products.',
    nowItems: [
      { label: 'Doing', text: 'Connecting model capabilities with real operational workflows \u2014 from review automation to CRM agents and collection assistants.' },
      { label: 'Thinking', text: 'How should AI products be evaluated: model capability benchmarks, user satisfaction, task completion, or business metrics?' },
      { label: 'Learning', text: 'Studying how AI Agents move from demos to production through permissions, uncertainty handling, human escalation, data quality, and measurable ROI.' }
    ],
    tags: []
  }
];

// --- CardSwap class ---
function initCardSwap() {
  var stackEl = document.getElementById('cardswapStack');
  if (!stackEl || typeof gsap === 'undefined') return;

  var cards = JOURNEY_CARDS;
  var cardEls = [];
  var order = cards.map(function(_, i) { return i; });
  var autoTimer = null;
  var isPaused = false;
  var isAnimating = false;
  var isMobile = window.innerWidth <= 768;
  var distY = isMobile ? 18 : 28;
  var skewY = 0;

  // Render cards
  cards.forEach(function(card, i) {
    var el = document.createElement('div');
    el.className = 'cardswap-card card-type-' + card.type;
    el.dataset.index = i;
    el.dataset.cardId = card.id;

    var bodyContent = '';
    if (card.type === 'experience') {
      var expRows = card.items.map(function(item) {
        var year = item.period.match(/\d{4}/);
        year = year ? year[0] : '';
        return '<div class="cardswap-exp-item">' +
          '<img src="' + item.logo + '" alt="' + item.company + '">' +
          '<span class="cardswap-exp-company">' + item.company + '</span>' +
          '<span class="cardswap-exp-role">' + item.role + '</span>' +
          '<span class="cardswap-exp-year">' + year + '</span>' +
        '</div>';
      }).join('');
      bodyContent =
        '<div class="cardswap-card-type"><i class="' + card.typeIcon + '"></i> ' + card.typeLabel + '</div>' +
        '<div class="cardswap-card-title">' + card.title + '</div>' +
        '<div class="cardswap-exp-list">' + expRows + '</div>';
    } else if (card.type === 'project') {
      bodyContent =
        '<div class="cardswap-card-type"><i class="' + card.typeIcon + '"></i> ' + card.typeLabel + '</div>' +
        '<div class="cardswap-card-title">' + card.title + '</div>' +
        '<div class="cardswap-card-table">' +
          '<div class="cardswap-table-row">' +
            '<span class="cardswap-table-label">Publications</span>' +
            '<span class="cardswap-table-value">2 SCI + 1 Core</span>' +
          '</div>' +
          '<div class="cardswap-table-row">' +
            '<span class="cardswap-table-label">Under Review</span>' +
            '<span class="cardswap-table-value">1 SCI</span>' +
          '</div>' +
          '<div class="cardswap-table-row">' +
            '<span class="cardswap-table-label">Awards</span>' +
            '<span class="cardswap-table-value">10+ provincial/national</span>' +
          '</div>' +
          '<div class="cardswap-table-row">' +
            '<span class="cardswap-table-label">Scholarship</span>' +
            '<span class="cardswap-table-value">National</span>' +
          '</div>' +
        '</div>';
    } else if (card.type === 'music') {
      var s = card.songs[0];
      bodyContent =
        '<div class="cardswap-card-type"><i class="' + card.typeIcon + '"></i> ' + card.typeLabel + '</div>' +
        '<div class="cardswap-card-title">' + card.title + '</div>' +
        '<img src="images/music.png" alt="Music" class="cardswap-music-cover">' +
        '<div class="cardswap-card-bottom">' +
          '<p class="cardswap-music-intro">' + (card.introText || card.desc) + '</p>' +
          '<div class="cardswap-music-controls">' +
            '<div class="mini-player-info">' +
              '<span class="mini-player-name">' + s.name + '</span>' +
              '<span class="mini-player-artist">' + s.artist + '</span>' +
            '</div>' +
            '<button class="cardswap-music-play" data-song-index="0" aria-label="Play"><i class="fas fa-play"></i></button>' +
            '<div class="cardswap-music-progress"><div class="cardswap-music-progress-fill"></div></div>' +
          '</div>' +
        '</div>';
    } else if (card.type === 'now') {
      var firstItem = card.nowItems[0] || { text: '' };
      var plainText = firstItem.text.replace(/<[^>]*>/g, '');
      var lines = card.nowItems.map(function(item) {
        return '<div class="cardswap-now-line"><span class="cardswap-now-label">' + item.label + '</span>' + item.text + '</div>';
      }).join('');
      bodyContent =
        '<div class="cardswap-card-type"><i class="' + card.typeIcon + '"></i> ' + card.typeLabel + '</div>' +
        '<div class="cardswap-card-title">' + card.title + '</div>' +
        '<div class="cardswap-card-bottom">' +
          '<div class="cardswap-status">' +
            '<span class="cardswap-status-dot"></span>' +
            '<span class="cardswap-status-text">Currently Active</span>' +
          '</div>' +
          '<div class="cardswap-card-tagline">' + plainText + '</div>' +
          '<div class="cardswap-now-chat">' + lines + '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="cardswap-card-accent" style="background: ' + card.accentGradient + '"></div>' +
      '<div class="cardswap-card-body">' + bodyContent + '</div>';

    stackEl.appendChild(el);
    cardEls.push(el);
  });

  // Position helpers
  function makeSlot(visualIdx) {
    return {
      x: 0,
      y: visualIdx * distY,
      z: -visualIdx * 30,
      zIndex: cards.length - visualIdx,
      scale: Math.max(0.88, 1 - visualIdx * 0.03)
    };
  }

  function placeAll(animate) {
    cardEls.forEach(function(el, i) {
      var vi = order.indexOf(i);
      var slot = makeSlot(vi);
      if (animate) {
        gsap.to(el, {
          x: slot.x, y: slot.y, z: slot.z,
          xPercent: -50, yPercent: -50,
          skewY: 0, scale: slot.scale, opacity: 1, zIndex: slot.zIndex,
          duration: 0.5, ease: 'power2.inOut', force3D: true
        });
      } else {
        gsap.set(el, {
          x: slot.x, y: slot.y, z: slot.z,
          xPercent: -50, yPercent: -50,
          skewY: 0, scale: slot.scale, opacity: 1, zIndex: slot.zIndex,
          transformOrigin: 'center center', force3D: true
        });
      }
    });
  }

  // Initial position
  placeAll(false);

  function updateCounter(direction) {
    var frontIdx = order[0];
    var card = cards[frontIdx];
    var chapterNum = document.getElementById('journeyChapterNum');
    var chapterLabel = document.getElementById('journeyChapterLabel');
    var slideOut = direction === 'up' ? -30 : 30;
    var slideIn = direction === 'up' ? 30 : -30;

    if (chapterNum && chapterLabel) {
      // Slide out old text
      gsap.to([chapterNum, chapterLabel], {
        y: slideOut, opacity: 0, duration: 0.15, ease: 'power2.in',
        onComplete: function() {
          chapterNum.textContent = String(frontIdx + 1).padStart(2, '0');
          chapterLabel.textContent = card.typeLabel;
          gsap.fromTo(chapterNum,
            { y: slideIn, opacity: 0 },
            { y: 0, opacity: 0.25, duration: 0.25, ease: 'power2.out' }
          );
          gsap.fromTo(chapterLabel,
            { y: slideIn, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' }
          );
        }
      });
    }

    // Sync active dot
    var frontType = card.type;
    var dots = document.querySelectorAll('.journey-dot');
    dots.forEach(function(d) {
      d.classList.toggle('active', d.dataset.type === frontType);
    });
  }

  // Swap animation — smooth slide up
  function swap() {
    if (isAnimating || order.length < 2) return;
    isAnimating = true;

    var frontIdx = order[0];
    var frontEl = cardEls[frontIdx];

    // 1. Front card slides up and fades out
    gsap.to(frontEl, {
      y: '-=400', opacity: 0,
      duration: 0.4, ease: 'power2.out'
    });

    // 2. Rotate order
    order = order.slice(1).concat(order[0]);
    updateCounter('up');

    // 3. Remaining cards slide to new positions (slight delay for stagger)
    cardEls.forEach(function(el, i) {
      if (i === frontIdx) return;
      var vi = order.indexOf(i);
      var slot = makeSlot(vi);
      gsap.to(el, {
        x: slot.x, y: slot.y, z: slot.z,
        xPercent: -50, yPercent: -50,
        skewY: 0, scale: slot.scale, opacity: 1, zIndex: slot.zIndex,
        duration: 0.45, ease: 'power2.inOut', force3D: true,
        delay: 0.1
      });
    });

    // 4. After exit completes, reposition front card at back and slide in
    var backSlot = makeSlot(cards.length - 1);
    gsap.delayedCall(0.45, function() {
      gsap.set(frontEl, {
        x: backSlot.x, y: backSlot.y + 150, z: backSlot.z,
        xPercent: -50, yPercent: -50,
        scale: backSlot.scale, opacity: 0, zIndex: backSlot.zIndex
      });
      gsap.to(frontEl, {
        y: backSlot.y, opacity: 1,
        duration: 0.35, ease: 'power2.out',
        onComplete: function() { isAnimating = false; }
      });
    });
  }

  // Reverse swap — back card slides in from top
  function swapReverse() {
    if (isAnimating || order.length < 2) return;
    isAnimating = true;

    var backIdx = order[order.length - 1];
    var backEl = cardEls[backIdx];

    // 1. Place back card above viewport
    var frontSlot = makeSlot(0);
    gsap.set(backEl, {
      x: frontSlot.x, y: frontSlot.y - 300, z: frontSlot.z,
      xPercent: -50, yPercent: -50,
      opacity: 0, scale: 1, zIndex: frontSlot.zIndex
    });

    // 2. Rotate order
    order = [backIdx].concat(order.slice(0, -1));
    updateCounter('down');

    // 3. Others slide to new positions
    cardEls.forEach(function(el, i) {
      if (i === backIdx) return;
      var vi = order.indexOf(i);
      var slot = makeSlot(vi);
      gsap.to(el, {
        x: slot.x, y: slot.y, z: slot.z,
        xPercent: -50, yPercent: -50,
        skewY: 0, scale: slot.scale, opacity: 1, zIndex: slot.zIndex,
        duration: 0.45, ease: 'power2.inOut', force3D: true
      });
    });

    // 4. Back card slides in from top
    gsap.to(backEl, {
      y: frontSlot.y, scale: 1, opacity: 1,
      duration: 0.45, ease: 'power2.out',
      onComplete: function() { isAnimating = false; }
    });
  }

  // Auto rotation (disabled — kept for API compatibility)
  var autoTimer = null;
  function startAuto() {
    stopAuto();
    autoTimer = setInterval(function() {
      if (!isPaused) swap();
    }, 3000);
  }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  // --- Wheel: Journey hijack + hover card switching ---
  var isHoveringCards = false;
  var wheelCooldown = false;
  var journeyHijack = true;
  var journeyJustArrived = false;
  var journeyWasVisible = false;
  var journeySectionEl = document.querySelector('.journey-section');

  var cardViewport = document.querySelector('.cardswap-viewport');
  if (cardViewport) {
    cardViewport.addEventListener('mouseenter', function() { isHoveringCards = true; });
    cardViewport.addEventListener('mouseleave', function() { isHoveringCards = false; });
  }

  function isJourneyVisible() {
    if (!journeySectionEl || !snapContainer) return false;
    var viewportTop = snapContainer.scrollTop;
    var viewportBottom = viewportTop + snapContainer.clientHeight;
    var sectionTop = journeySectionEl.offsetTop;
    var sectionBottom = sectionTop + journeySectionEl.offsetHeight;
    return sectionTop <= viewportTop + 10 && sectionBottom >= viewportBottom - 10;
  }

  var snapContainer = document.getElementById('snapContainer');
  var allSections = snapContainer ? Array.from(snapContainer.querySelectorAll('.snap-section')) : [];
  var pageCooldown = false;

  if (snapContainer) {
    snapContainer.addEventListener('wheel', function(e) {
      // === First-visit Journey hijack mode ===
      if (journeyHijack && isJourneyVisible()) {
        // Detect first arrival — ignore inertia scroll from snap
        if (!journeyWasVisible) {
          journeyWasVisible = true;
          journeyJustArrived = true;
          e.preventDefault();
          setTimeout(function() { journeyJustArrived = false; }, 500);
          return;
        }
        if (journeyJustArrived) {
          e.preventDefault();
          return;
        }
        var frontIdx = order[0];

        if (e.deltaY > 0) {
          if (frontIdx === cards.length - 1) {
            // Last card — absorb this scroll, release hijack for next one
            e.preventDefault();
            journeyHijack = false;
            pageCooldown = true;
            setTimeout(function() { pageCooldown = false; }, 1200);
            return;
          } else {
            e.preventDefault();
            if (!isAnimating && !wheelCooldown) {
              wheelCooldown = true;
              swap();
              setTimeout(function() { wheelCooldown = false; }, 500);
            }
            return;
          }
        } else if (e.deltaY < 0) {
          if (frontIdx === 0) {
            // Fall through to global page scroll below
          } else {
            e.preventDefault();
            if (!isAnimating && !wheelCooldown) {
              wheelCooldown = true;
              swapReverse();
              setTimeout(function() { wheelCooldown = false; }, 500);
            }
            return;
          }
        }
      }

      // === Post-hijack: hover-only card switching ===
      if (isHoveringCards && !journeyHijack) {
        e.preventDefault();
        if (!isAnimating && !wheelCooldown) {
          wheelCooldown = true;
          if (e.deltaY > 0) swap();
          else if (e.deltaY < 0) swapReverse();
          setTimeout(function() { wheelCooldown = false; }, 500);
        }
        return;
      }

      // === Global one-page-at-a-time scroll ===
      e.preventDefault();
      if (pageCooldown) return;

      var currentIdx = 0;
      var containerMiddle = snapContainer.scrollTop + snapContainer.clientHeight / 2;
      for (var i = 0; i < allSections.length; i++) {
        var sectionTop = allSections[i].offsetTop;
        var sectionBottom = sectionTop + allSections[i].offsetHeight;
        if (containerMiddle >= sectionTop && containerMiddle < sectionBottom) { currentIdx = i; break; }
      }

      var targetIdx;
      if (e.deltaY > 0) {
        targetIdx = Math.min(currentIdx + 1, allSections.length - 1);
      } else {
        targetIdx = Math.max(currentIdx - 1, 0);
      }

      if (targetIdx === currentIdx) return;

      pageCooldown = true;
      snapContainer.scrollTo({ top: allSections[targetIdx].offsetTop, behavior: 'smooth' });
      setTimeout(function() { pageCooldown = false; }, 1200);
    }, { passive: false });
  }

  // --- Touch Swipe ---
  var touchStartY = 0;
  if (journeySectionEl) {
    journeySectionEl.addEventListener('touchstart', function(e) {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    journeySectionEl.addEventListener('touchend', function(e) {
      var diff = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(diff) < 50) return;
      if (isAnimating) return;
      if (diff > 0) swap();
      else swapReverse();
    }, { passive: true });
  }

  // --- Overlay (Card Extract/Return Animation) ---
  var overlay = document.getElementById('cardOverlay');
  var overlayContent = document.getElementById('cardOverlayContent');
  var overlayClose = document.getElementById('cardOverlayClose');
  var activeClone = null;
  var activeCardRect = null;

  function openOverlay(card, cardEl) {
    var rect = cardEl.getBoundingClientRect();
    activeCardRect = rect;
    isPaused = true;

    // Clone card for animation
    var clone = cardEl.cloneNode(true);
    clone.className = 'cardswap-card-clone';
    clone.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;z-index:2001;margin:0;transform:none;pointer-events:auto;';
    document.body.appendChild(clone);
    activeClone = clone;

    // Show backdrop
    overlay.classList.add('active');
    overlayContent.style.display = 'none';
    document.body.style.overflow = 'hidden';

    // Phase 1: Smooth expand to 85vw × 85vh
    var targetW = Math.min(window.innerWidth * 0.85, 1200);
    var targetH = window.innerHeight * 0.85;
    gsap.to(clone, {
      top: '50%', left: '50%',
      xPercent: -50, yPercent: -50,
      width: targetW, height: targetH,
      borderRadius: 24,
      duration: 0.6, ease: 'power2.out',
      onComplete: function() {
        // Phase 2: Replace content
        clone.innerHTML = '<div class="overlay-expanded">' +
          '<button class="clone-close" aria-label="Close"><i class="fas fa-times"></i></button>' +
          renderOverlay(card) + '</div>';
        clone.style.overflowY = 'hidden'; // split handles its own scroll

        var cloneClose = clone.querySelector('.clone-close');
        if (cloneClose) cloneClose.addEventListener('click', closeOverlay);

        // Phase 3: Content stagger fade-in
        var items = clone.querySelectorAll('.overlay-anim-item');
        if (items.length) {
          gsap.fromTo(items, { y: 20, opacity: 0 }, {
            y: 0, opacity: 1,
            duration: 0.3, ease: 'power2.out',
            stagger: 0.05
          });
        }

        // Animate skill bars
        var skillFills = clone.querySelectorAll('.exp-skill-fill');
        skillFills.forEach(function(fill) {
          var level = fill.dataset.level || 0;
          setTimeout(function() { fill.style.width = level + '%'; }, 300);
        });

        // Counter scroll animation for metrics
        var counters = clone.querySelectorAll('.metric-value[data-count]');
        counters.forEach(function(el) {
          var target = parseInt(el.dataset.count) || 0;
          var obj = { val: 0 };
          gsap.to(obj, {
            val: target, duration: 1.2, ease: 'power2.out',
            onUpdate: function() { el.textContent = Math.round(obj.val); }
          });
        });

        if (card.type === 'music') wireOverlayMusic(card, clone);
      }
    });
  }

  var isClosing = false;

  function closeOverlay() {
    if (!activeClone || isClosing) {
      if (!activeClone) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
      return;
    }
    isClosing = true;

    // Don't stop music — floating player takes over
    // Just reset overlay visual transparency
    if (musicState.audio && musicState.playing) {
      setMusicTransparencyGlobal(false);
    }

    // Reset music transparency
    overlay.style.background = '';
    activeClone.style.background = '';
    activeClone.style.backdropFilter = '';
    activeClone.style.webkitBackdropFilter = '';

    // Phase 1: Content fade out
    var items = activeClone.querySelectorAll('.overlay-anim-item');
    gsap.to(items, { y: 10, opacity: 0, duration: 0.2, stagger: 0.03 });

    // Phase 2: Clone shrinks back (after content fades)
    var cloneRef = activeClone;
    var rectRef = activeCardRect;
    setTimeout(function() {
      cloneRef.style.overflowY = 'hidden';
      gsap.to(cloneRef, {
        top: rectRef.top, left: rectRef.left,
        xPercent: 0, yPercent: 0,
        width: rectRef.width, height: rectRef.height,
        borderRadius: 20,
        duration: 0.45, ease: 'power2.inOut',
        onComplete: function() {
          if (cloneRef) cloneRef.remove();
          activeClone = null;
          activeCardRect = null;
          overlay.classList.remove('active');
          document.body.style.overflow = '';
          isPaused = false;
          isClosing = false;
        }
      });
    }, 120);
  }

  if (overlayClose) overlayClose.addEventListener('click', closeOverlay);
  if (overlay) {
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeOverlay(); });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeClone) closeOverlay();
  });

  // Click to open overlay — pass the card element
  cardEls.forEach(function(el, i) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.cardswap-music-controls')) return;
      openOverlay(cards[i], el);
    });
  });

  function renderOverlay(card) {
    // === EXPERIENCE — Timeline + Skills ===
    if (card.type === 'experience') {
      // Left nav
      var leftNav = card.items.map(function(item, i) {
        return '<div class="overlay-left-nav-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
          '<span class="overlay-left-nav-dot"></span>' +
          '<span>' + item.company + '</span>' +
        '</div>';
      }).join('');

      var left = '<div class="overlay-split-left">' +
        '<h3 class="overlay-split-title overlay-anim-item">' + card.title + '</h3>' +
        '<p class="overlay-split-desc overlay-anim-item">5 product internships across AI, e-commerce, fintech & GIS</p>' +
        '<div class="overlay-left-stats overlay-anim-item">' +
          '<div><span class="overlay-left-stat-num">' + card.items.length + '</span><span class="overlay-left-stat-label">Internships</span></div>' +
        '</div>' +
        '<div class="overlay-left-nav">' + leftNav + '</div>' +
      '</div>';

      // Right content — timeline entries
      var right = card.items.map(function(item) {
        var hl = item.highlights ? item.highlights.map(function(h) { return '<li>' + h + '</li>'; }).join('') : '';
        var tags = item.tags.map(function(t) { return '<span class="exp-tag">' + t + '</span>'; }).join('');
        return '<div class="overlay-exp-entry overlay-anim-item">' +
          '<div class="exp-timeline-dot"></div>' +
          '<div class="exp-entry-header">' +
            '<img src="' + item.logo + '" alt="" class="exp-logo">' +
            '<div>' +
              '<h3>' + item.role + '</h3>' +
              '<p class="exp-company">' + item.company + ' \u00b7 ' + item.period + '</p>' +
            '</div>' +
          '</div>' +
          '<p class="exp-desc">' + item.desc + '</p>' +
          (hl ? '<ul class="exp-highlights">' + hl + '</ul>' : '') +
          '<div class="exp-tags">' + tags + '</div>' +
        '</div>';
      }).join('');

      return '<div class="overlay-split">' + left +
        '<div class="overlay-split-right">' + right + '</div></div>';
    }

    // === RESEARCH — Academic Style ===
    if (card.type === 'project') {
      var paperCount = card.items.filter(function(i) { return i.badgeType === 'sci'; }).length;
      var awardCount = card.items.filter(function(i) { return i.badgeType === 'award'; }).length;

      var left = '<div class="overlay-split-left">' +
        '<h3 class="overlay-split-title overlay-anim-item">' + card.title + '</h3>' +
        '<p class="overlay-split-desc overlay-anim-item">Published research & academic achievements</p>' +
        '<div class="overlay-left-stats overlay-anim-item">' +
          '<div><span class="overlay-left-stat-num metric-value" data-count="' + paperCount + '">0</span><span class="overlay-left-stat-label">Publications</span></div>' +
          '<div><span class="overlay-left-stat-num metric-value" data-count="' + awardCount + '">0</span><span class="overlay-left-stat-label">Awards</span></div>' +
        '</div>' +
      '</div>';

      var right = card.items.map(function(item) {
        var boldMeta = item.meta ? item.meta.replace(/Hu, J\./g, '<strong>Hu, J.</strong>') : '';
        var citation = boldMeta ? '<p class="research-citation">' + boldMeta + '</p>' : '';
        var gallery = '';
        if (item.images && item.images.length > 0) {
          var imgs = item.images.map(function(src) {
            return '<img src="' + src + '" alt="' + item.title + '" class="research-paper-img">';
          }).join('');
          gallery = '<div class="research-gallery">' + imgs + '</div>';
        }
        var titleHtml = item.link
          ? '<a href="' + item.link + '" target="_blank" rel="noopener noreferrer" class="research-title-link"><h3 class="research-title">' + item.title + '</h3></a>'
          : '<h3 class="research-title">' + item.title + '</h3>';

        return '<div class="overlay-research-entry overlay-anim-item">' +
          '<span class="project-badge">' + item.badge + '</span>' +
          titleHtml +
          citation +
          gallery +
        '</div>';
      }).join('');

      return '<div class="overlay-split">' + left +
        '<div class="overlay-split-right">' + right + '</div></div>';
    }

    // === MUSIC — Player UI ===
    if (card.type === 'music') {
      var firstSong = card.songs[0];
      var left = '<div class="overlay-split-left">' +
        '<img src="images/music.png" alt="Music" class="music-player-cover overlay-anim-item" id="overlayMusicCover">' +
        '<p class="overlay-split-desc overlay-anim-item">My taste in music is quite broad, but I mainly listen to <strong>melodic bass</strong>, <strong>chill house</strong>, <strong>synthpop</strong>, <strong>indie pop</strong>, and <strong>R&amp;B</strong>. I don\u2019t have a particular favorite artist \u2014 I only recognize a song.</p>' +
        '<p class="overlay-split-desc overlay-anim-item" style="font-weight:600;">Whenever I find a great song, I\u2019m so tempted to shove my headphones into someone\u2019s ears, and I just want them to cry their eyes out after listening to it.</p>' +
      '</div>';

      var songList = card.songs.map(function(song, i) {
        return '<div class="overlay-music-item overlay-anim-item" data-song-index="' + i + '">' +
          '<img src="' + song.cover + '" alt="' + song.name + '" class="overlay-music-cover">' +
          '<div class="overlay-music-info">' +
            '<div class="overlay-music-name">' + song.name + '</div>' +
            '<div class="overlay-music-artist">' + song.artist + ' \u00b7 ' + song.genre + '</div>' +
          '</div>' +
          '<button class="overlay-music-play" data-audio-id="' + song.audioId + '" aria-label="Play ' + song.name + '"><i class="fas fa-play"></i></button>' +
        '</div>';
      }).join('');

      var right = '<h3 class="overlay-split-title overlay-anim-item">Playlist</h3>' +
        '<p class="overlay-split-desc overlay-anim-item">' + card.desc + '</p>' +
        '<div class="overlay-music-list">' + songList + '</div>';

      return '<div class="overlay-split">' + left +
        '<div class="overlay-split-right">' + right + '</div></div>';
    }

    // === NOW — Chat + Status Indicator ===
    if (card.type === 'now') {
      var left = '<div class="overlay-split-left">' +
        '<h3 class="overlay-split-title overlay-anim-item">' + card.title + '</h3>' +
        '<div class="status-indicator overlay-anim-item">' +
          '<span class="status-dot"></span>' +
          '<span class="status-text">Currently: Studying at WHU & building AI product judgment</span>' +
        '</div>' +
        '<p class="overlay-split-desc overlay-anim-item">' + card.meta + '</p>' +
        '<p class="overlay-split-desc overlay-anim-item" style="margin-top:auto;font-size:0.75rem;color:var(--text-muted);">' + card.desc + '</p>' +
      '</div>';

      var labelColors = { Doing: 'building', Reading: 'reading', Thinking: 'learning', Learning: 'reading', Listening: 'listening' };
      var chatLines = card.nowItems.map(function(item) {
        var colorClass = labelColors[item.label] || 'building';
        return '<div class="chat-bubble chat-answer overlay-anim-item">' +
          '<span class="chat-avatar">J</span>' +
          '<div class="chat-content">' +
            '<span class="now-label-tag ' + colorClass + '">' + item.label + '</span>' +
            '<p>' + item.text + '</p>' +
          '</div>' +
        '</div>';
      }).join('');

      var right = '<div class="chat-bubble chat-question overlay-anim-item"><span class="chat-avatar">?</span><p>What are you up to lately?</p></div>' +
        chatLines;

      return '<div class="overlay-split">' + left +
        '<div class="overlay-split-right" style="display:flex;flex-direction:column;gap:1rem;">' + right + '</div></div>';
    }

    return '';
  }

  // --- Music playback ---
  var musicState = { audio: null, playing: false };

  // Expose reset for floating player close
  window._resetMusicState = function() {
    musicState.audio = null;
    musicState.playing = false;
    disconnectFluidAudio();
  };

  function connectFluidAudio(audioEl) {
    if (window.fluidAudio) window.fluidAudio.connect(audioEl);
    document.querySelector('.journey-section')?.classList.add('audio-active');
  }

  function disconnectFluidAudio() {
    if (window.fluidAudio) window.fluidAudio.disconnect();
    document.querySelector('.journey-section')?.classList.remove('audio-active');
  }

  // Expose for floating player
  window._connectFluidAudio = connectFluidAudio;
  window._disconnectFluidAudio = disconnectFluidAudio;

  // Mini player on music card
  var musicCardEl = stackEl.querySelector('[data-card-id="music"]');
  if (musicCardEl) {
    var miniPlay = musicCardEl.querySelector('.cardswap-music-play');
    var miniProgress = musicCardEl.querySelector('.cardswap-music-progress-fill');
    var miniName = musicCardEl.querySelector('.mini-player-name');
    var miniArtist = musicCardEl.querySelector('.mini-player-artist');
    var musicData = cards.find(function(c) { return c.id === 'music'; });
    var miniSongIdx = 0;

    if (miniPlay) {
      miniPlay.addEventListener('click', function(e) {
        e.stopPropagation();
        var audioEl = document.getElementById(musicData.songs[miniSongIdx].audioId);
        if (musicState.playing && musicState.audio === audioEl) {
          audioEl.pause();
          musicState.playing = false;
          miniPlay.classList.remove('playing');
          disconnectFluidAudio();
        } else {
          if (musicState.audio && musicState.audio !== audioEl) {
            musicState.audio.pause();
            musicState.audio.currentTime = 0;
            disconnectFluidAudio();
          }
          audioEl.play().catch(function() {});
          musicState.audio = audioEl;
          musicState.playing = true;
          miniPlay.classList.add('playing');
          connectFluidAudio(audioEl);
          if (miniName) miniName.textContent = musicData.songs[miniSongIdx].name;
          if (miniArtist) miniArtist.textContent = musicData.songs[miniSongIdx].artist;
          // Show floating player
          if (window.showFloatingPlayer) window.showFloatingPlayer(musicData.songs[miniSongIdx], audioEl);
          audioEl.ontimeupdate = function() {
            if (audioEl.duration && miniProgress) {
              miniProgress.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
            }
          };
          audioEl.onended = function() {
            miniPlay.classList.remove('playing');
            if (miniProgress) miniProgress.style.width = '0%';
            musicState.playing = false;
            musicState.audio = null;
            disconnectFluidAudio();
          };
        }
      });
    }

    // Expose global mini player updater for overlay/floating player sync
    window._updateMiniPlayer = function(song, audioEl) {
      if (miniName) miniName.textContent = song.name;
      if (miniArtist) miniArtist.textContent = song.artist;
      miniPlay.classList.add('playing');
      if (audioEl) {
        audioEl.ontimeupdate = function() {
          if (audioEl.duration && miniProgress) {
            miniProgress.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
          }
        };
      }
      // Update miniSongIdx to match
      for (var si = 0; si < musicData.songs.length; si++) {
        if (musicData.songs[si].name === song.name) { miniSongIdx = si; break; }
      }
    };
  }

  // Overlay music player
  function wireOverlayMusic(card, container) {
    var root = container || overlayContent;
    var items = root.querySelectorAll('.overlay-music-item');
    var mainBtn = root.querySelector('#overlayMusicMainBtn');
    var coverImg = root.querySelector('#overlayMusicCover');
    var titleEl = root.querySelector('#overlayMusicTitle');
    var artistEl = root.querySelector('#overlayMusicArtist');
    var progressBar = root.querySelector('#overlayMusicProgress');
    var progressFill = root.querySelector('#overlayMusicProgressFill');
    var songs = card.songs || [];
    var currentSongIndex = 0;

    function setMusicTransparency(on) {
      if (on) {
        if (activeClone) {
          activeClone.style.transition = 'background 0.6s ease, backdrop-filter 0.6s ease';
          activeClone.style.backdropFilter = 'blur(8px)';
          activeClone.style.webkitBackdropFilter = 'blur(8px)';
        }
      } else {
        if (activeClone) {
          activeClone.style.backdropFilter = '';
          activeClone.style.webkitBackdropFilter = '';
        }
      }
    }

    function updateLeftPanel(song) {
      if (coverImg) { coverImg.src = song.cover; coverImg.alt = song.name; }
      if (titleEl) titleEl.textContent = song.name;
      if (artistEl) artistEl.textContent = song.artist;
      if (mainBtn) mainBtn.dataset.audioId = song.audioId;
    }

    function clearAllPlaying() {
      items.forEach(function(it) {
        it.classList.remove('playing');
        var b = it.querySelector('.overlay-music-play');
        if (b) { b.classList.remove('playing'); b.querySelector('i').className = 'fas fa-play'; }
      });
      if (mainBtn) mainBtn.querySelector('i').className = 'fas fa-play';
    }

    function playSong(index) {
      var song = songs[index];
      if (!song) return;
      var audioEl = document.getElementById(song.audioId);
      if (!audioEl) return;

      // Stop previous if different
      if (musicState.audio && musicState.audio !== audioEl) {
        musicState.audio.pause();
        musicState.audio.currentTime = 0;
        disconnectFluidAudio();
      }
      clearAllPlaying();
      currentSongIndex = index;
      updateLeftPanel(song);

      if (audioEl.paused) {
        audioEl.play().catch(function() {});
        musicState.audio = audioEl;
        musicState.playing = true;
        connectFluidAudio(audioEl);
        setMusicTransparency(true);

        // Show floating player
        if (window.showFloatingPlayer) window.showFloatingPlayer(song, audioEl);
        // Sync mini player on small card
        if (window._updateMiniPlayer) window._updateMiniPlayer(song, audioEl);
        if (mainBtn) mainBtn.querySelector('i').className = 'fas fa-pause';
        var activeItem = root.querySelector('.overlay-music-item[data-song-index="' + index + '"]');
        if (activeItem) {
          activeItem.classList.add('playing');
          var ib = activeItem.querySelector('.overlay-music-play');
          if (ib) { ib.classList.add('playing'); ib.querySelector('i').className = 'fas fa-pause'; }
        }

        audioEl.ontimeupdate = function() {
          if (audioEl.duration && progressFill) {
            progressFill.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
          }
        };
        audioEl.onended = function() {
          clearAllPlaying();
          if (progressFill) progressFill.style.width = '0%';
          musicState.playing = false;
          musicState.audio = null;
          disconnectFluidAudio();
          setMusicTransparency(false);
        };
      } else {
        // Already playing this song — pause it
        audioEl.pause();
        musicState.playing = false;
        disconnectFluidAudio();
        setMusicTransparency(false);
      }
    }

    // Wire right-panel song list items
    items.forEach(function(item) {
      var btn = item.querySelector('.overlay-music-play');
      var idx = parseInt(item.dataset.songIndex);

      // Click entire item row to play
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        playSong(idx);
      });
      if (btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          playSong(idx);
        });
      }
    });

    // Wire main play button in left panel
    if (mainBtn) {
      mainBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        playSong(currentSongIndex);
      });
    }

    // Progress bar seek
    if (progressBar) {
      progressBar.addEventListener('click', function(e) {
        if (musicState.audio && musicState.audio.duration) {
          var rect = progressBar.getBoundingClientRect();
          musicState.audio.currentTime = ((e.clientX - rect.left) / rect.width) * musicState.audio.duration;
        }
      });
    }
  }

  // Dot navigation — bring matching card to front
  var dots = document.querySelectorAll('.journey-dot');
  dots.forEach(function(dot) {
    dot.addEventListener('click', function() {
      var targetType = dot.dataset.type;
      var targetIdx = -1;
      cards.forEach(function(c, idx) { if (c.type === targetType) targetIdx = idx; });
      if (targetIdx < 0 || order[0] === targetIdx) return;
      var pos = order.indexOf(targetIdx);
      order.splice(pos, 1);
      order.unshift(targetIdx);
      placeAll(true);
      updateCounter();
    });
  });

  updateCounter();
}

// ===== Typewriter Effect =====
function initTypewriter() {
  const el = document.querySelector('.typewriter-text');
  if (!el) return;

  const phrases = ['INTP', 'WHU Master\'s Student', 'Product Manager Intern'];

  // Respect reduced motion: show first phrase statically
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = phrases[0];
    return;
  }

  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;

  function tick() {
    const current = phrases[phraseIdx];

    if (!isDeleting) {
      charIdx++;
      el.textContent = current.substring(0, charIdx);
      if (charIdx === current.length) {
        setTimeout(() => { isDeleting = true; tick(); }, 1500);
        return;
      }
      setTimeout(tick, 80);
    } else {
      charIdx--;
      el.textContent = current.substring(0, charIdx);
      if (charIdx === 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        setTimeout(tick, 400);
        return;
      }
      setTimeout(tick, 40);
    }
  }

  tick();
}

// ===== Bento Skill Bars Animation =====
function initBentoSkills() {
  const fills = document.querySelectorAll('.bento-skill-fill');
  if (!fills.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const level = entry.target.getAttribute('data-level') || 0;
          entry.target.style.width = level + '%';
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  fills.forEach(el => observer.observe(el));
}

// ===== Pixel Transition Card =====
function initPixelTransition() {
  const card = document.getElementById('pixelCard');
  const pixelGrid = document.getElementById('pixelGrid');
  if (!card || !pixelGrid) return;

  const gridSize = 8;
  const pixelColor = '#ffffff';
  const animationStepDuration = 0.4;
  let isActive = false;
  let delayedCall = null;

  const isTouchDevice =
    'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

  // Generate pixel grid
  pixelGrid.innerHTML = '';
  const size = 100 / gridSize;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const pixel = document.createElement('div');
      pixel.classList.add('pixel-card__pixel');
      pixel.style.backgroundColor = pixelColor;
      pixel.style.width = size + '%';
      pixel.style.height = size + '%';
      pixel.style.left = (col * size) + '%';
      pixel.style.top = (row * size) + '%';
      pixelGrid.appendChild(pixel);
    }
  }

  const activeEl = card.querySelector('.pixel-card__active');

  function animatePixels(activate) {
    isActive = activate;
    const pixels = pixelGrid.querySelectorAll('.pixel-card__pixel');
    if (!pixels.length || !activeEl) return;

    gsap.killTweensOf(pixels);
    if (delayedCall) delayedCall.kill();

    gsap.set(pixels, { display: 'none' });

    const totalPixels = pixels.length;
    const staggerDuration = animationStepDuration / totalPixels;

    // Show pixels with random stagger
    gsap.to(pixels, {
      display: 'block',
      duration: 0,
      stagger: { each: staggerDuration, from: 'random' }
    });

    // Switch content at midpoint
    delayedCall = gsap.delayedCall(animationStepDuration, function() {
      activeEl.style.display = activate ? 'block' : 'none';
      activeEl.style.pointerEvents = activate ? 'none' : '';
    });

    // Hide pixels after transition
    gsap.to(pixels, {
      display: 'none',
      duration: 0,
      delay: animationStepDuration,
      stagger: { each: staggerDuration, from: 'random' }
    });
  }

  if (isTouchDevice) {
    card.addEventListener('click', function() {
      animatePixels(!isActive);
    });
  } else {
    card.addEventListener('mouseenter', function() {
      if (!isActive) animatePixels(true);
    });
    card.addEventListener('mouseleave', function() {
      if (isActive) animatePixels(false);
    });
    card.addEventListener('focus', function() {
      if (!isActive) animatePixels(true);
    });
    card.addEventListener('blur', function() {
      if (isActive) animatePixels(false);
    });
  }
}

// ===== Floating Music Player =====
function setMusicTransparencyGlobal(on) {
  // Stub — overlay transparency is handled inside wireOverlayMusic
}

function initFloatingPlayer() {
  var fp = document.getElementById('floatingPlayer');
  var fpCover = document.getElementById('fpCover');
  var fpName = document.getElementById('fpName');
  var fpArtist = document.getElementById('fpArtist');
  var fpPlayBtn = document.getElementById('fpPlayBtn');
  var fpCloseBtn = document.getElementById('fpCloseBtn');
  var fpProgressFill = document.getElementById('fpProgressFill');
  if (!fp) return;

  // Expose globally so playSong can call it
  window.showFloatingPlayer = function(song, audioEl) {
    fpCover.src = song.cover;
    fpCover.alt = song.name;
    fpName.textContent = song.name;
    fpArtist.textContent = song.artist;
    fpPlayBtn.querySelector('i').className = 'fas fa-pause';
    fp.classList.add('active');

    // Track progress
    audioEl.addEventListener('timeupdate', function fpUpdate() {
      if (audioEl !== window._fpAudio) {
        audioEl.removeEventListener('timeupdate', fpUpdate);
        return;
      }
      if (audioEl.duration) {
        fpProgressFill.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
      }
    });
    window._fpAudio = audioEl;
  };

  window.hideFloatingPlayer = function() {
    fp.classList.remove('active');
    fpProgressFill.style.width = '0%';
    window._fpAudio = null;
  };

  // Play/Pause toggle
  fpPlayBtn.addEventListener('click', function() {
    if (!window._fpAudio) return;
    if (window._fpAudio.paused) {
      window._fpAudio.play().catch(function() {});
      fpPlayBtn.querySelector('i').className = 'fas fa-pause';
      if (window._connectFluidAudio) window._connectFluidAudio(window._fpAudio);
    } else {
      window._fpAudio.pause();
      fpPlayBtn.querySelector('i').className = 'fas fa-play';
      if (window._disconnectFluidAudio) window._disconnectFluidAudio();
    }
  });

  // Close — stop music and hide
  fpCloseBtn.addEventListener('click', function() {
    if (window._fpAudio) {
      window._fpAudio.pause();
      window._fpAudio.currentTime = 0;
    }
    if (window._disconnectFluidAudio) window._disconnectFluidAudio();
    // Reset global music state (from initCardSwap scope)
    if (window._resetMusicState) window._resetMusicState();
    hideFloatingPlayer();
  });

  // Progress bar seek (click + drag)
  var fpProgressBar = document.getElementById('fpProgress');
  var fpDragging = false;
  function fpSeek(e) {
    if (!window._fpAudio || !window._fpAudio.duration) return;
    var rect = fpProgressBar.getBoundingClientRect();
    var ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    window._fpAudio.currentTime = ratio * window._fpAudio.duration;
  }
  fpProgressBar.addEventListener('click', fpSeek);
  fpProgressBar.addEventListener('mousedown', function(e) { fpDragging = true; fpSeek(e); });
  document.addEventListener('mousemove', function(e) { if (fpDragging) fpSeek(e); });
  document.addEventListener('mouseup', function() { fpDragging = false; });
  fpProgressBar.addEventListener('touchstart', function(e) { fpDragging = true; fpSeek(e.touches[0]); }, { passive: true });
  document.addEventListener('touchmove', function(e) { if (fpDragging) fpSeek(e.touches[0]); }, { passive: true });
  document.addEventListener('touchend', function() { fpDragging = false; });
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLiquidEther();
  initTypewriter();
  initNavbar();
  initMobileMenu();
  initScrollReveal();
  initActiveNavLinks();
  initScrollIndicator();
  initNavScroll();
  initCardSwap();
  initFloatingPlayer();
  initBentoSkills();
  initPixelTransition();
});
