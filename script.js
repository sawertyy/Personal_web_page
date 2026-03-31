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

  // --- Configuration ---
  const CONFIG = {
    mouseForce: 20,
    cursorSize: 100,
    isViscous: true,
    viscous: 30,
    iterationsViscous: 32,
    iterationsPoisson: 32,
    dt: 0.014,
    BFECC: true,
    resolution: 0.5,
    isBounce: false,
    colors: ['#1E90FF', '#60C0FF', '#A0D8FF'],
    autoDemo: true,
    autoSpeed: 0.5,
    autoIntensity: 2.2,
    takeoverDuration: 0.25,
    autoResumeDelay: 3000,
    autoRampDuration: 0.6,
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
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
      this.active = false;
      this.current = new THREE.Vector2(0, 0);
      this.target = new THREE.Vector2();
      this.lastTime = performance.now();
      this.activationTime = 0;
      this.margin = 0.2;
      this._tmpDir = new THREE.Vector2();
      this.pickNewTarget();
    }
    pickNewTarget() {
      this.target.set(
        (Math.random() * 2 - 1) * (1 - this.margin),
        (Math.random() * 2 - 1) * (1 - this.margin)
      );
    }
    forceStop() {
      this.active = false;
      this.mouse.isAutoActive = false;
    }
    update() {
      if (!this.enabled) return;
      const now = performance.now();
      const idle = now - this.manager.lastUserInteraction;
      if (idle < this.resumeDelay) {
        if (this.active) this.forceStop();
        return;
      }
      if (this.mouse.isHoverInside) {
        if (this.active) this.forceStop();
        return;
      }
      if (!this.active) {
        this.active = true;
        this.current.copy(this.mouse.coords);
        this.lastTime = now;
        this.activationTime = now;
      }
      this.mouse.isAutoActive = true;
      let dtSec = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dtSec > 0.2) dtSec = 0.016;
      const dir = this._tmpDir.subVectors(this.target, this.current);
      const dist = dir.length();
      if (dist < 0.01) { this.pickNewTarget(); return; }
      dir.normalize();
      let ramp = 1;
      if (this.rampDurationMs > 0) {
        const t = Math.min(1, (now - this.activationTime) / this.rampDurationMs);
        ramp = t * t * (3 - 2 * t);
      }
      const step = this.speed * dtSec * ramp;
      const move = Math.min(step, dist);
      this.current.addScaledVector(dir, move);
      this.mouse.coords.set(this.current.x, this.current.y);
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
      const forceX = (Mouse.diff.x / 2) * props.mouse_force;
      const forceY = (Mouse.diff.y / 2) * props.mouse_force;
      const csX = props.cursor_size * props.cellScale.x;
      const csY = props.cursor_size * props.cellScale.y;
      const centerX = Math.min(Math.max(Mouse.coords.x, -1 + csX + props.cellScale.x * 2), 1 - csX - props.cellScale.x * 2);
      const centerY = Math.min(Math.max(Mouse.coords.y, -1 + csY + props.cellScale.y * 2), 1 - csY - props.cellScale.y * 2);
      const u = this.mouse.material.uniforms;
      u.force.value.set(forceX, forceY);
      u.center.value.set(centerX, centerY);
      u.scale.value.set(props.cursor_size, props.cursor_size);
      super.update();
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
        cellScale: this.cellScale
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
    rampDuration: CONFIG.autoRampDuration
  });

  function resizeHandler() {
    Common.resize(container);
    output.resize();
  }

  function loop() {
    if (!running) return;
    autoDriver.update();
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
  initNavbar();
  initMobileMenu();
  initScrollReveal();
  initActiveNavLinks();
  initScrollIndicator();
  initNavScroll();
  initMusicStack();
});
