/* =========================================================================
   花 · FLOWER — 一个写给陈星汉《花》的网页致敬
   风格化草坪 / 风吹麦浪 / 云影投地 / 花瓣群 / 路过生花 / 天气变化
   体积云 / 地面雾气 / 停驻景深 / 电影化调色 / 生成式 BGM
   （全链路线性渲染，最后一步 ACES + sRGB + 晕影 + 颗粒）
   ========================================================================= */
(function () {
'use strict';

function showErr(e) {
  var el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = '初始化失败：' + (e && e.message ? e.message : e); }
  try { console.error(e); } catch (_) {}
}
window.addEventListener('error', function (ev) { if (ev && ev.error) showErr(ev.error); });

var booted = false;
function boot() {
  if (booted) return;
  if (!window.THREE) return;
  booted = true;
  try { init(); } catch (e) {
    if (e instanceof Error) showErr(e); else showErr(new Error(String(e)));
  }
}
if (window.THREE) { boot(); } else {
  var tries = 0;
  var iv = setInterval(function () { if (window.THREE) { clearInterval(iv); boot(); } else if (++tries > 120) clearInterval(iv); }, 100);
}
window.__threeReady = boot;

function init() {

  // ------------------------------------------------------------ 小工具
  var clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  var lerpN = function (a, b, t) { return a + (b - a) * t; };
  var sstep = function (x, a, b) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  var damp = function (a, b, k, dt) { return b + (a - b) * Math.exp(-k * dt); };
  var rand = Math.random;
  function hash2i(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return n - Math.floor(n); }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2i(xi, yi), b = hash2i(xi + 1, yi), c = hash2i(xi, yi + 1), d = hash2i(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct) { var s = 0, a = 0.5, f = 1, i; for (i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.02; a *= 0.5; } return s; }
  function ridged(x, y, oct) { var s = 0, a = 0.55, f = 1, i; for (i = 0; i < oct; i++) { var n = vnoise(x * f, y * f); s += a * (1 - Math.abs(2 * n - 1)); f *= 2.01; a *= 0.52; } return s; }
  function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function mixC(a, b, t) { return a.clone().lerp(b, t); }
  function dampAngle(a, b, k, dt) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    return a + d * (1 - Math.exp(-k * dt));
  }

  // ------------------------------------------------------------ 地形高度
  function terrainH(x, z) {
    var h = 0;
    h += 11.0 * ridged(x * 0.0046 + 5.3, z * 0.0046 - 2.1, 4);
    h += 3.4 * fbm(x * 0.016 + 9.0, z * 0.016 + 3.7, 3);
    h += 0.8 * fbm(x * 0.05 - 4.0, z * 0.05 + 8.0, 2);
    var r = Math.sqrt(x * x + z * z);
    var s = clamp((r - 172) / 175, 0, 1); h += 34 * s * s * s;      // 缓坡远山
    h += 15 * Math.exp(-((x - 125) * (x - 125) + (z + 58) * (z + 58)) / (2 * 85 * 85));
    h += 9 * Math.exp(-((x + 98) * (x + 98) + (z - 92) * (z - 92)) / (2 * 70 * 70));
    h += 14 * Math.exp(-((x - 40) * (x - 40) + (z + 150) * (z + 150)) / (2 * 90 * 90));
    h -= 5.5 * Math.exp(-(x * x + z * z) / (2 * 52 * 52));          // 出生地洼地
    return h;
  }

  // ------------------------------------------------------------ 渲染器与场景
  var app = document.getElementById('app');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true   // 保证画布内容稳定合成（兼容部分驱动/截图），并便于验证
    });
  }
  catch (e) { showErr(new Error('WebGL 不可用')); return; }
  var isWebGL2 = renderer.capabilities.isWebGL2;
  if (!isWebGL2 && !renderer.extensions.has('WEBGL_depth_texture')) { /* 无深度纹理则关闭景深 */ }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.LinearEncoding;   // 全链路线性，最终pass统一调色
  renderer.toneMapping = THREE.NoToneMapping;
  app.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd8e4ea, 0.0016);
  scene.fog.color.convertSRGBToLinear();

  var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 9000);
  var clock = new THREE.Clock();
  var depthOK = isWebGL2 || renderer.extensions.has('WEBGL_depth_texture');

  // 花瓣用的物理光（自定义着色器自带光照，互不干扰）
  var sunLight = new THREE.DirectionalLight(0xfff1d4, 1.6); scene.add(sunLight);
  var hemiLight = new THREE.HemisphereLight(0xcfe2f5, 0x51774a, 0.85); scene.add(hemiLight);

  // ------------------------------------------------------------ 共享 uniform
  var U = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.47, 0.58, 0.27).normalize() },
    uSunColor: { value: col('#ffefcd') },
    uCov: { value: 0.08 },
    uCloudAlt: { value: 330.0 },
    uCloudThick: { value: 165.0 },
    uWindDir: { value: new THREE.Vector2(0.72, 0.47).normalize() },
    uWindAmp: { value: 1.0 },
    uSkyTint: { value: col('#bfe0f2') },
    uGroundTint: { value: col('#5fa05a') },
    uMistAmt: { value: 0.15 }
  };
  function matU(extra) { return Object.assign({}, THREE.UniformsLib.fog, U, extra || {}); }

  // ------------------------------------------------------------ GLSL 公共库
  var NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float vnoise3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z); }
float fbm2(vec2 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 3; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return v; }
`;

  var CLOUD = `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uCloudAlt;
uniform float uCloudThick;
uniform float uCov;
// 云层覆盖率阈值（按 GLSL 确切噪声分布二次拟合标定）
float cloudTh(){
  float c = uCov;
  return 0.6748 - 0.7748 * c + 0.2833 * c * c;
}
// 2D 云场（含宏观团块调制；天空与地表云影共用，保证形状一致）
float cloudCover2D(vec2 xz){
  vec2 uv = xz * 0.00105;
  vec2 drift = vec2(uTime * 0.013, uTime * 0.0085);
  float b = fbm2(uv * 2.6 + drift);
  float w = fbm2(uv * 7.4 - drift * 1.15 + vec2(7.3, 3.1));
  float m = fbm2(uv * 2.2 + drift * 0.5 + vec2(4.2, 9.1));
  return (b * 0.62 + w * 0.38) * (0.50 + 0.75 * smoothstep(0.30, 0.58, m));
}
// 云层密度场（世界坐标，含软阈值边缘 + 云核 + 三维蓬松扰动）
float cloudDensity(vec3 wp){
  float d = cloudCover2D(wp.xz);
  float th = cloudTh();
  float cov = smoothstep(th - 0.04, th + 0.05, d);
  float core = smoothstep(th + 0.04, th + 0.10, d);
  float v3 = 0.5 + 0.5 * vnoise3(vec3(wp.xz * 0.0021, wp.y * 0.0052));
  float v3b = 0.5 + 0.5 * vnoise3(vec3(wp.xz * 0.0053 + 37.2, wp.y * 0.012 + 9.7));
  float hf = clamp((wp.y - (uCloudAlt - uCloudThick)) / uCloudThick, 0.0, 1.0);
  float yShape = smoothstep(0.04, 0.36, hf) * (1.0 - smoothstep(0.50, 1.0, hf));
  return (0.03 + 0.13 * cov + 1.00 * core) * (0.28 + 1.05 * yShape) * (0.30 + 0.52 * v3 + 0.28 * v3b);
}
// 太阳在平行投影下把高空云投射到地表的阴影（与天空覆盖同一阈值，软边）
float cloudShadowAmt(vec2 xz, float alt){
  vec2 shift = (uSunDir.xz / max(uSunDir.y, 0.2)) * alt;
  float d = cloudCover2D(xz + shift);
  float th = cloudTh();
  return smoothstep(th - 0.07, th + 0.07, d);
}
`;

  // ------------------------------------------------------------ 天空（屏幕空间体积云pass）
  var PASS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  var QUALITY = [
    { name: '高', grass: 170000, dpr: 1.5, steps: 28.0, skyScale: 0.5 },
    { name: '中', grass: 95000, dpr: 1.25, steps: 24.0, skyScale: 0.42 },
    { name: '低', grass: 42000, dpr: 1.0, steps: 18.0, skyScale: 0.38 }
  ];
  var qLevel = 0;

  var skyRT = new THREE.WebGLRenderTarget(2, 2);
  skyRT.texture.minFilter = THREE.LinearFilter;
  skyRT.texture.magFilter = THREE.LinearFilter;

  var skyFrag = `
varying vec2 vUv;
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform vec3 uCamPos;
uniform vec3 uSunLight;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uSteps;
// uTime / uSunDir / uCov / uCloudAlt / uCloudThick 由 CLOUD 块统一声明
${NOISE}
${CLOUD}
void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 q = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = (uInvView * vec4(q.xyz / q.w, 0.0)).xyz;
  dir = normalize(dir);
  // 天空渐变
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.5));
  sky = mix(sky, uHorizon * 0.9, smoothstep(0.02, -0.10, dir.y));
  float sd = max(dot(dir, uSunDir), 0.0);
  sky += uSunLight * (pow(sd, 900.0) * 2.6 + pow(sd, 120.0) * 0.12);
  // 体积云 raymarch
  vec3 cloudCol = vec3(0.0);
  float trans = 1.0;
  if (dir.y > 0.015 && uCov > 0.02) {
    float yTop = uCloudAlt;
    float yBot = uCloudAlt - uCloudThick;
    float tA = (yBot - uCamPos.y) / dir.y;
    float tB = (yTop - uCamPos.y) / dir.y;
    float t0 = max(min(tA, tB), 0.0);
    float t1 = max(max(tA, tB), 0.0);
    if (t1 > t0) {
      float h = (t1 - t0) / uSteps;
      vec3 P = uCamPos + dir * t0;
      vec2 sunShift = uSunDir.xz / max(uSunDir.y, 0.25);
      float sd2 = max(dot(dir, uSunDir), 0.0);
      vec3 cloudLight = mix(uSunLight, vec3(0.58, 0.66, 0.78), 0.35);
      for (int i = 0; i < 32; i++) {
        if (float(i) >= uSteps) break;
        float d = cloudDensity(P);
        if (d > 0.004) {
          float a = 1.0 - exp(-d * 0.014 * h);
          float sh = cloudCover2D(P.xz + sunShift * (uCloudAlt - P.y));
          float light = 0.28 + 0.72 * (1.0 - smoothstep(0.50, 0.80, sh));
          light *= (0.82 + 0.38 * pow(sd2, 2.0));
          cloudCol += cloudLight * light * a * trans;
          trans *= (1.0 - a * 0.9);
          if (trans < 0.02) break;
        }
        P += dir * h;
      }
      cloudCol *= vec3(1.0, 0.985, 0.965);
    }
  }
  vec3 outc = sky * trans + cloudCol;
  gl_FragColor = vec4(outc, 1.0);
}
`;
  var skyMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT, fragmentShader: skyFrag,
    uniforms: {
      uInvProj: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunLight: { value: col('#fff3d2').multiplyScalar(1.35) },
      uZenith: { value: col('#69a7dd') },
      uHorizon: { value: col('#eaf3f4') },
      uSteps: { value: QUALITY[0].steps },
      uTime: U.uTime, uSunDir: U.uSunDir, uCov: U.uCov, uCloudAlt: U.uCloudAlt, uCloudThick: U.uCloudThick
    }
  });
  var skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  skyMesh.frustumCulled = false;
  var passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 采样的天空穹顶（保证相机旋转下天空视角正确）
  var domeMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec4 vClip; varying vec3 vDir; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vDir = mv.xyz; gl_Position = projectionMatrix * mv; vClip = gl_Position; }',
    fragmentShader: `
uniform sampler2D uSky;
uniform vec3 uSunDirView;
uniform vec3 uSunColor;
uniform float uCov;
varying vec4 vClip;
varying vec3 vDir;
void main(){
  vec2 suv = clamp(vClip.xy / vClip.w * 0.5 + 0.5, 0.002, 0.998);
  vec3 c = texture2D(uSky, suv).rgb;
  float sd = max(dot(normalize(vDir), uSunDirView), 0.0);
  c += uSunColor * pow(sd, 900.0) * 2.4 * (1.0 - uCov * 0.7);
  gl_FragColor = vec4(c, 1.0);
}`,
    uniforms: {
      uSky: { value: skyRT.texture },
      uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: U.uSunColor, uCov: U.uCov
    },
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
  });
  var dome = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 20), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  var sunDirView = new THREE.Vector3();

  function renderSky() {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    skyMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    skyMat.uniforms.uInvView.value.copy(camera.matrixWorld);
    skyMat.uniforms.uCamPos.value.copy(camera.position);
    dome.position.copy(camera.position);
    sunDirView.copy(U.uSunDir.value).transformDirection(camera.matrixWorldInverse);
    domeMat.uniforms.uSunDirView.value.copy(sunDirView);
    renderer.setRenderTarget(skyRT);
    renderer.render(skyMesh, passCam);
  }

  // ------------------------------------------------------------ 地形
  var T_SIZE = 760, T_SEG = 240;
  var terrGeo = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEG, T_SEG);
  terrGeo.rotateX(-Math.PI / 2);
  var tp = terrGeo.attributes.position;
  var tn = tp.count;
  var heights = new Float32Array(tn);
  for (var ti = 0; ti < tn; ti++) {
    var tx = tp.getX(ti), tz = tp.getZ(ti);
    var th = terrainH(tx, tz);
    tp.setY(ti, th);
    heights[ti] = th;
  }
  terrGeo.computeVertexNormals();
  var tnor = terrGeo.attributes.normal;
  var tcol = new Float32Array(tn * 3);
  var cValley = col('#265b33'), cBase = col('#46864a'), cLight = col('#7cb958'),
      cPatch = col('#b9ce78'), cHigh = col('#a2c768'), tmpC = new THREE.Color();
  for (ti = 0; ti < tn; ti++) {
    var px = tp.getX(ti), pz = tp.getZ(ti), ph = heights[ti];
    var ny = tnor.getY(ti);
    var t1 = fbm(px * 0.012 + 7.0, pz * 0.012 - 5.0, 3);
    var t2 = 0.55 + 0.45 * ny;
    var c = mixC(cValley, cBase, clamp(t2 * 1.2 - 0.08, 0, 1));
    c.lerp(cLight, clamp((t1 - 0.35) * 2.0, 0, 1));
    c.lerp(cPatch, sstep(fbm(px * 0.005 + 31.0, pz * 0.005 - 17.0, 3), 0.55, 0.72) * 0.5);
    c.lerp(cHigh, sstep(ph, 30, 70) * 0.3);
    var detail = 0.92 + 0.16 * fbm(px * 0.09, pz * 0.09, 2);
    tmpC.copy(c).multiplyScalar(detail);
    tcol[ti * 3] = tmpC.r; tcol[ti * 3 + 1] = tmpC.g; tcol[ti * 3 + 2] = tmpC.b;
  }
  terrGeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));

  var terrFrag = `
varying vec3 vN;
varying vec2 vWp;
varying vec3 vCol;
uniform vec3 uSunColor;
uniform vec3 uSkyTint;
uniform vec3 uGroundTint;
#include <fog_pars_fragment>
${NOISE}
${CLOUD}
void main(){
  vec3 n = normalize(vN);
  float sunD = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  float cloud = cloudShadowAmt(vWp, uCloudAlt);
  vec3 sunT = uSunColor * (0.14 + 0.80 * smoothstep(-0.18, 0.62, sunD)) * (1.0 - 0.58 * cloud);
  vec3 ambT = mix(uGroundTint, uSkyTint, hemi) * (0.52 + 0.34 * (1.0 - cloud));
  vec3 c = vCol * (sunT + ambT);
  c *= 0.94 + 0.10 * fbm2(vWp * 0.55);
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}
`;
  var terrMat = new THREE.ShaderMaterial({
    vertexShader: `
varying vec3 vN; varying vec2 vWp; varying vec3 vCol;
#include <fog_pars_vertex>
void main(){
  vCol = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vWp = (modelMatrix * vec4(position, 1.0)).xz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: terrFrag,
    uniforms: matU(),
    vertexColors: true,
    fog: true
  });
  var terrain = new THREE.Mesh(terrGeo, terrMat);
  terrain.frustumCulled = false;
  scene.add(terrain);

  // ------------------------------------------------------------ 草坪（风吹麦浪）
  var grassVert = `
attribute float aPhase;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindAmp;
varying vec2 vUv;
varying vec2 vWp;
varying vec3 vTint;
#include <fog_pars_vertex>
${NOISE}
void main(){
  vUv = uv;
  vec4 wpos4;
  #ifdef USE_INSTANCING
    wpos4 = instanceMatrix * vec4(position, 1.0);
  #else
    wpos4 = vec4(position, 1.0);
  #endif
  vec3 wp = wpos4.xyz;
  vWp = wp.xz;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  // 阵风噪声 + 麦浪波（世界空间的风场）
  float gust = fbm2(wp.xz * 0.018 + vec2(uTime * 0.30, -uTime * 0.21));
  float wave = 0.5 + 0.5 * sin(dot(wp.xz, uWindDir) * 0.075 + uTime * 1.35);
  float wstr = uWindAmp * (0.35 + 1.05 * gust) * (0.45 + 1.15 * wave);
  float b = uv.y * uv.y;
  float sway = sin(uTime * 2.0 + aPhase + wp.x * 0.11 + wp.z * 0.09);
  vec3 offs = vec3(0.0);
  offs.x += (wstr * 0.30 * sway + wstr * 0.22) * uWindDir.x * b;
  offs.z += (wstr * 0.30 * sway * 0.9 + wstr * 0.22) * uWindDir.y * b;
  offs.x += sin(uTime * 1.7 + aPhase * 1.3) * 0.05 * b;
  // 距离淡出：远处草叶收缩（配合雾感，避免远处噪点黑带）
  vec4 mv = modelViewMatrix * vec4(wp + offs, 1.0);
  float dc = -mv.z;
  float fade = 1.0 - smoothstep(80.0, 130.0, dc);
  fade = mix(0.18, 1.0, fade);
  vec4 base4;
  #ifdef USE_INSTANCING
    base4 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #else
    base4 = vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  vec3 wpt = base4.xyz + (wp + offs - base4.xyz) * fade;
  vec4 mvPosition = modelViewMatrix * vec4(wpt, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
  var grassFrag = `
varying vec2 vUv;
varying vec2 vWp;
varying vec3 vTint;
uniform vec3 uSunColor;
uniform vec3 uSkyTint;
#include <fog_pars_fragment>
${NOISE}
${CLOUD}
void main(){
  float cloud = cloudShadowAmt(vWp, uCloudAlt);
  float sun = clamp(uSunDir.y * 0.55 + 0.35, 0.45, 0.95);
  vec3 lit = mix(uSkyTint * 0.8, uSunColor, 0.5);
  float s = 0.22 + 0.44 * vUv.y;
  vec3 c = lit * (1.0 - 0.68 * cloud) * s;
  c *= vTint;
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}
`;
  var grassMat = new THREE.ShaderMaterial({
    vertexShader: grassVert, fragmentShader: grassFrag,
    uniforms: matU(),
    side: THREE.DoubleSide, fog: true
  });

  var grassMesh = null;
  function buildGrass(count) {
    if (grassMesh) {
      scene.remove(grassMesh);
      grassMesh.geometry.dispose();
    }
    var geo = new THREE.PlaneGeometry(1, 1, 1, 3);
    geo.translate(0, 0.5, 0);
    var p2 = geo.attributes.position, uv2 = geo.attributes.uv;
    for (var i2 = 0; i2 < p2.count; i2++) {
      var vv = uv2.getY(i2);
      p2.setX(i2, (uv2.getX(i2) - 0.5) * (1.0 - vv * 0.85));
      p2.setY(i2, vv);
      p2.setZ(i2, vv * vv * 0.22);
    }
    var phases = new Float32Array(count);
    var tints = new Float32Array(count * 3);
    var mesh = new THREE.InstancedMesh(geo, grassMat, count);
    var dummy = new THREE.Object3D();
    var placed = 0, attempt = 0;
    // 草簇布置：以簇心为样本，每簇 6-12 株环绕密布；近处密、远处稀
    var TUFTS = Math.ceil(count / 7);
    while (placed < count && attempt < count * 30) {
      attempt++;
      var x = (rand() * 2 - 1) * 208, z = (rand() * 2 - 1) * 208;
      if (x * x + z * z > 208 * 208) continue;
      var dens = fbm(x * 0.013 + 3.0, z * 0.013 - 11.0, 3);
      if (dens < 0.28) continue;
      var rr2 = Math.sqrt(x * x + z * z);
      if (rand() > clamp(1.35 - rr2 / 130, 0.06, 1)) continue;   // 密度随半径衰减
      var dh = Math.abs(terrainH(x + 2, z) - terrainH(x - 2, z));
      if (dh > 3.6) continue;
      // 簇身
      var baseH = terrainH(x, z);
      var blades = 5 + Math.floor(rand() * 6);
      for (var bj = 0; bj < blades && placed < count; bj++) {
        var bx = x + (rand() - 0.5) * 1.2;
        var bz = z + (rand() - 0.5) * 1.2;
        var h = baseH + (rand() - 0.5) * 0.4;
        var w = 0.07 + 0.05 * rand() + 0.04 * Math.max(0, dens - 0.4);
        var hh = (0.38 + 0.78 * rand()) * (0.8 + 0.45 * Math.max(0, dens - 0.3));
        dummy.position.set(bx, h - 0.04, bz);
        dummy.rotation.set((rand() - 0.5) * 0.30, rand() * Math.PI * 2, (rand() - 0.5) * 0.30);
        dummy.scale.set(w, hh, w);
        dummy.updateMatrix();
        mesh.setMatrixAt(placed, dummy.matrix);
        phases[placed] = rand() * Math.PI * 2;
        var s2 = 0.72 + 0.26 * rand();
        tints[placed * 3] = s2 * (0.62 + 0.20 * rand());
        tints[placed * 3 + 1] = s2 * (0.85 + 0.15 * rand());
        tints[placed * 3 + 2] = s2 * (0.42 + 0.18 * rand());
        placed++;
      }
    }
    mesh.count = placed;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(tints, 3);
    mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
    grassMesh = mesh;
  }
  buildGrass(QUALITY[0].grass);

  // ------------------------------------------------------------ 花（路过生花）
  function petalGeo(w, l, curve, wseg, lseg) {
    var g = new THREE.PlaneGeometry(w, l, wseg || 3, lseg || 5);
    g.translate(0, l / 2, 0);
    var p = g.attributes.position, u = g.attributes.uv;
    for (var i3 = 0; i3 < p.count; i3++) {
      var vv = u.getY(i3);
      var f = Math.sin(Math.min(vv * 1.18 + 0.08, 1.0) * Math.PI);
      p.setX(i3, (u.getX(i3) - 0.5) * f * w);
      p.setZ(i3, Math.pow(vv, 1.7) * curve);
    }
    g.computeVertexNormals();
    return g;
  }
  function mergeGeos(parts) {
    var total = 0;
    parts.forEach(function (e) {
      if (e.geo.index) e.geo = e.geo.toNonIndexed();
      total += e.geo.attributes.position.count;
    });
    var posA = new Float32Array(total * 3), norA = new Float32Array(total * 3),
        colA = new Float32Array(total * 3), tintA = new Float32Array(total);
    var o = 0;
    parts.forEach(function (e) {
      var p = e.geo.attributes.position, nn = e.geo.attributes.normal, cnt = p.count;
      posA.set(p.array, o * 3);
      norA.set(nn.array, o * 3);
      for (var j = 0; j < cnt; j++) {
        colA[(o + j) * 3] = e.color.r;
        colA[(o + j) * 3 + 1] = e.color.g;
        colA[(o + j) * 3 + 2] = e.color.b;
        tintA[o + j] = e.tint;
      }
      o += cnt;
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posA, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
    g.setAttribute('aBaked', new THREE.BufferAttribute(colA, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(tintA, 1));
    return g;
  }
  var GREEN = col('#3f7d3a'), GREEN2 = col('#4c8a41'), YEL = col('#f0c04a');
  function buildDaisy() {
    var parts = [];
    var stem = new THREE.CylinderGeometry(0.028, 0.042, 0.52, 5);
    stem.translate(0, 0.26, 0);
    parts.push({ geo: stem, color: GREEN, tint: 0 });
    var leaf = petalGeo(0.07, 0.3, 0.12);
    leaf.rotateX(-2.0); leaf.rotateY(0.6); leaf.translate(0.06, 0.2, 0);
    parts.push({ geo: leaf, color: GREEN2, tint: 0 });
    for (var k = 0; k < 9; k++) {
      var pp = petalGeo(0.115, 0.52, 0.24);
      pp.rotateX(-1.05);
      pp.rotateY(k * Math.PI * 2 / 9);
      pp.translate(0, 0.52, 0);
      parts.push({ geo: pp, color: new THREE.Color(1, 1, 1), tint: 1 });
    }
    var cen = new THREE.CircleGeometry(0.085, 12);
    cen.rotateX(-Math.PI / 2);
    cen.translate(0, 0.53, 0);
    parts.push({ geo: cen, color: YEL, tint: 0 });
    return mergeGeos(parts);
  }
  function buildTulip() {
    var parts = [];
    var stem = new THREE.CylinderGeometry(0.032, 0.05, 0.62, 5);
    stem.translate(0, 0.31, 0);
    parts.push({ geo: stem, color: GREEN, tint: 0 });
    var leaf = petalGeo(0.09, 0.4, 0.2);
    leaf.rotateX(-2.2); leaf.rotateY(-0.7); leaf.translate(-0.05, 0.3, 0);
    parts.push({ geo: leaf, color: GREEN2, tint: 0 });
    for (var k = 0; k < 5; k++) {
      var pp = petalGeo(0.22, 0.5, 0.5);
      pp.rotateX(-0.42);
      pp.rotateY(k * Math.PI * 2 / 5 + 0.3);
      pp.translate(0, 0.62, 0);
      parts.push({ geo: pp, color: new THREE.Color(1, 1, 1), tint: 1 });
    }
    var cen = new THREE.CircleGeometry(0.05, 10);
    cen.rotateX(-Math.PI / 2);
    cen.translate(0, 0.66, 0);
    parts.push({ geo: cen, color: YEL, tint: 0 });
    return mergeGeos(parts);
  }
  function buildButter() {
    var parts = [];
    var stem = new THREE.CylinderGeometry(0.024, 0.036, 0.34, 5);
    stem.translate(0, 0.17, 0);
    parts.push({ geo: stem, color: GREEN, tint: 0 });
    for (var k = 0; k < 6; k++) {
      var pp = petalGeo(0.1, 0.26, 0.28);
      pp.rotateX(-1.2);
      pp.rotateY(k * Math.PI * 2 / 6);
      pp.translate(0, 0.34, 0);
      parts.push({ geo: pp, color: new THREE.Color(1, 1, 1), tint: 1 });
    }
    var cen = new THREE.CircleGeometry(0.06, 10);
    cen.rotateX(-Math.PI / 2);
    cen.translate(0, 0.35, 0);
    parts.push({ geo: cen, color: YEL, tint: 0 });
    return mergeGeos(parts);
  }

  var flowerFrag = `
varying vec3 vN;
varying vec2 vWp;
varying vec3 vBaked;
varying float vTintF;
varying vec3 vTint;
varying float vGrow;
uniform vec3 uSunColor;
uniform vec3 uSkyTint;
uniform vec3 uGroundTint;
#include <fog_pars_fragment>
${NOISE}
${CLOUD}
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float sunD = max(dot(n, uSunDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  float cloud = cloudShadowAmt(vWp, uCloudAlt);
  vec3 alb = vBaked * mix(vec3(1.0), vTint, vTintF);
  vec3 c = alb * (uSunColor * (0.16 + 0.95 * smoothstep(-0.1, 0.7, sunD)) * (1.0 - 0.74 * cloud)
                + mix(uGroundTint, uSkyTint, hemi) * (0.66 + 0.22 * (1.0 - cloud)));
  float glow = (1.0 - clamp(vGrow * 2.4, 0.0, 1.0)) * (0.7 + 0.3 * sin(uTime * 5.0 + vGrow * 40.0));
  c += glow * vec3(1.0, 0.92, 0.6) * 0.4 * (0.4 + 0.6 * vTintF);
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}
`;
  var flowerMat = new THREE.ShaderMaterial({
    vertexShader: `
attribute float aGrow;
attribute float aPhase;
attribute vec3 aBaked;
attribute float aTint;
uniform float uTime;
varying vec3 vN;
varying vec2 vWp;
varying vec3 vBaked;
varying float vTintF;
varying vec3 vTint;
varying float vGrow;
#include <fog_pars_vertex>
void main(){
  vGrow = aGrow;
  float e = 1.0 - pow(1.0 - clamp(aGrow, 0.0, 1.0), 3.0);
  vec3 pos = position;
  pos.y *= (0.16 + 0.84 * e);
  pos.xz *= (0.3 + 0.7 * e);
  float sway = sin(uTime * 1.5 + aPhase) * 0.05 * pos.y;
  pos.x += sway;
  pos.z += sway * 0.7;
  vec4 wp4 = instanceMatrix * vec4(pos, 1.0);
  vWp = wp4.xz;
  vN = normalize(mat3(instanceMatrix) * normal);
  vBaked = aBaked;
  vTintF = aTint;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  vec4 mvPosition = modelViewMatrix * wp4;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: flowerFrag,
    uniforms: matU(),
    side: THREE.DoubleSide, fog: true
  });

  var FLOWER_PALETTE = ['#ffffff', '#fff0ee', '#ffd1dc', '#ff9db0', '#ff7a6e', '#ff9c4f', '#ffd36b', '#f3e35c', '#c88cf0', '#ff6f8b', '#fbe6c4'];
  var flowerPaletteL = FLOWER_PALETTE.map(col);
  var FLOWER_PER = [420, 420, 420];
  var flowerVariants = [buildDaisy(), buildTulip(), buildButter()];
  var flowerStates = [];
  var growing = []; // {mesh, slot, t, dur}
  var ZERO_MAT = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  var fdummy = new THREE.Object3D();
  (function initFlowers() {
    for (var v = 0; v < 3; v++) {
      var mesh = new THREE.InstancedMesh(flowerVariants[v], flowerMat, FLOWER_PER[v]);
      mesh.frustumCulled = false;
      var grows = new Float32Array(FLOWER_PER[v]);
      var phases = new Float32Array(FLOWER_PER[v]);
      for (var k = 0; k < FLOWER_PER[v]; k++) {
        mesh.setMatrixAt(k, ZERO_MAT);
        grows[k] = 0;
        phases[k] = rand() * Math.PI * 2;
      }
      mesh.instanceMatrix.needsUpdate = true;
      flowerVariants[v].setAttribute('aGrow', new THREE.InstancedBufferAttribute(grows, 1));
      flowerVariants[v].setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FLOWER_PER[v] * 3).fill(1), 3);
      scene.add(mesh);
      flowerStates.push({ mesh: mesh, grows: grows, used: [], queue: [], cur: 0 });
    }
  })();

  function spawnFlower(x, z, prime) {
    // 选择变体并取出槽位
    var v = rand() < 0.5 ? 0 : (rand() < 0.5 ? 1 : 2);
    var st = flowerStates[v];
    var slot;
    if (st.queue.length) slot = st.queue.shift();
    else if (st.used.length < FLOWER_PER[v]) { slot = st.cur++; }
    else {
      slot = st.used.shift();
      // 若该槽仍处于生长期，移除旧的生长记录，避免互相覆盖
      for (var gi2 = growing.length - 1; gi2 >= 0; gi2--) {
        if (growing[gi2].st === st && growing[gi2].slot === slot) growing.splice(gi2, 1);
      }
    }
    st.used.push(slot);
    var s = prime ? 0.6 + rand() * 0.5 : 0.5 + rand() * 0.55;
    fdummy.position.set(x, terrainH(x, z) - 0.02, z);
    fdummy.rotation.set(0, rand() * Math.PI * 2, 0);
    fdummy.scale.set(s, s, s);
    fdummy.updateMatrix();
    st.mesh.setMatrixAt(slot, fdummy.matrix);
    st.mesh.instanceMatrix.needsUpdate = true;
    var c = flowerPaletteL[Math.floor(rand() * flowerPaletteL.length)];
    var ca = st.mesh.instanceColor.array;
    ca[slot * 3] = c.r; ca[slot * 3 + 1] = c.g; ca[slot * 3 + 2] = c.b;
    st.mesh.instanceColor.needsUpdate = true;
    st.grows[slot] = 0;
    st.mesh.geometry.attributes.aGrow.needsUpdate = true;
    growing.push({ st: st, slot: slot, t: 0, dur: 2.0 + rand() * 2.8 });
  }
  // 初始花田
  (function seedFlowers() {
    var n = 0, tries = 0;
    while (n < 150 && tries < 4000) {
      tries++;
      var x = (rand() * 2 - 1) * 175, z = (rand() * 2 - 1) * 175;
      if (x * x + z * z > 175 * 175) continue;
      if (fbm(x * 0.02 + 13, z * 0.02 + 4, 2) < 0.45) continue;
      spawnFlower(x, z, true);
      var gIdx = growing.length - 1;
      if (gIdx >= 0) { growing[gIdx].t = -rand() * 2.4; growing[gIdx].dur = 0.8; }
      n++;
    }
  })();

  // ------------------------------------------------------------ 花瓣群（主角）
  var petalGeom = (function () {
    var g = new THREE.PlaneGeometry(0.62, 0.95, 4, 6);
    g.translate(0, 0.475, 0);
    var p = g.attributes.position, u = g.attributes.uv;
    for (var i4 = 0; i4 < p.count; i4++) {
      var vv = u.getY(i4);
      var f = Math.sin(Math.min(vv * 1.12 + 0.10, 1.0) * Math.PI);
      p.setX(i4, (u.getX(i4) - 0.5) * f * 0.62);
      p.setZ(i4, Math.pow(vv, 1.8) * 0.55 - (1.0 - Math.abs(u.getX(i4) * 2 - 1)) * 0.10);
    }
    g.computeVertexNormals();
    return g;
  })();
  var petalMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.48, metalness: 0.0,
    side: THREE.DoubleSide, emissive: 0x241a12, emissiveIntensity: 0.3
  });
  var PETAL_N = 34;
  var petalMesh = new THREE.InstancedMesh(petalGeom, petalMat, PETAL_N);
  petalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  petalMesh.frustumCulled = false;
  scene.add(petalMesh);
  var PETAL_PALETTE = ['#fff6ee', '#ffe2e8', '#ffbccb', '#ff8f70', '#ffd76b', '#ff6f61', '#fda44f', '#e9788f', '#fff8ee'];
  for (ti = 0; ti < PETAL_N; ti++) {
    petalMesh.setColorAt(ti, col(PETAL_PALETTE[ti % PETAL_PALETTE.length]));
  }
  petalMesh.instanceColor.needsUpdate = true;

  var leader = new THREE.Vector3(0, terrainH(0, 0) + 1.5, 0);
  var target = leader.clone();
  var pointerHit = null;
  var prevLeader = leader.clone();
  var pts = [];
  for (ti = 0; ti < PETAL_N; ti++) {
    pts.push(new THREE.Vector3(leader.x + (rand() * 6 - 3), leader.y + rand() * 3 - 1.5, leader.z + (rand() * 6 - 3)));
  }
  var ph = new Float32Array(PETAL_N);
  for (ti = 0; ti < PETAL_N; ti++) ph[ti] = ti * 2.39996 + rand();
  var pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), pe = new THREE.Euler(), pv = new THREE.Vector3(), ps = new THREE.Vector3();
  var burstTimer = 0;
  var spotDist = 0;
  var lastSpot = leader.clone();

  function updatePetals(dt, t, moving) {
    // 目标
    if (playStarted) {
      if (pointerHit) target.copy(pointerHit);
      if (kb.x !== 0 || kb.z !== 0) {
        target.x += kb.x * 42 * dt;
        target.z += kb.z * 42 * dt;
      }
      var rr = Math.sqrt(target.x * target.x + target.z * target.z);
      if (rr > 150) { target.x *= 150 / rr; target.z *= 150 / rr; }
    } else {
      target.set(Math.sin(t * 0.07) * 26, 0, Math.cos(t * 0.05) * 26);
    }
    var speed = 26 * (burstTimer > 0 ? 1.7 : 1);
    var k = 1 - Math.exp(-4.2 * dt);
    var dx = target.x - leader.x, dz = target.z - leader.z;
    var dl = Math.sqrt(dx * dx + dz * dz);
    var maxErr = speed * 0.55;
    if (dl > maxErr) { leader.x = target.x - dx / dl * maxErr; leader.z = target.z - dz / dl * maxErr; }
    else { leader.x += dx * k; leader.z += dz * k; }
    leader.y = terrainH(leader.x, leader.z) + 1.35 + Math.sin(t * 1.4) * 0.22;
    // 链式跟随
    pts[0].copy(leader);
    var spacing = 1.45;
    for (var i = 1; i < PETAL_N; i++) {
      var prev = pts[i - 1], cur = pts[i];
      var kk = 1 - Math.exp(-6.5 * dt);
      cur.x += (prev.x - cur.x) * kk;
      cur.y += (prev.y - cur.y) * kk;
      cur.z += (prev.z - cur.z) * kk;
      var ddx = cur.x - prev.x, ddy = cur.y - prev.y, ddz = cur.z - prev.z;
      var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (dd > spacing) {
        var sc = spacing / dd;
        cur.set(prev.x + ddx * sc, prev.y + ddy * sc, prev.z + ddz * sc);
      }
    }
    // 矩阵
    var sc0 = 1.05;
    for (i = 0; i < PETAL_N; i++) {
      var c = pts[i];
      var fl = ph[i];
      pv.set(
        c.x + Math.sin(t * 1.9 + fl) * 0.30,
        c.y + Math.sin(t * 1.35 + fl * 1.7) * 0.26,
        c.z + Math.cos(t * 1.6 + fl) * 0.30
      );
      pe.set(t * 1.1 + fl, t * 0.9 + fl * 2.1, t * 0.7 + fl * 1.3);
      pq.setFromEuler(pe);
      var ss = sc0 * (0.85 + 0.25 * Math.sin(fl * 3.1));
      ps.set(ss, ss, ss);
      pm.compose(pv, pq, ps);
      petalMesh.setMatrixAt(i, pm);
    }
    petalMesh.instanceMatrix.needsUpdate = true;
    // 沿途生花
    var mvx = leader.x - lastSpot.x, mvz = leader.z - lastSpot.z;
    spotDist += Math.sqrt(mvx * mvx + mvz * mvz);
    if (spotDist > 1.15) {
      spotDist = 0;
      lastSpot.set(leader.x, 0, leader.z);
      if (playStarted && rand() < 0.8) {
        spawnFlower(leader.x + (rand() - 0.5) * 2.6, leader.z + (rand() - 0.5) * 2.6, false);
        if (rand() < 0.16) spawnFlower(leader.x + (rand() - 0.5) * 4.5, leader.z + (rand() - 0.5) * 4.5, false);
      }
    }
    if (burstTimer > 0) burstTimer -= dt;
  }

  // ------------------------------------------------------------ 地面雾气
  var mistMats = [];
  [[1.6, 0.030, 0.026, 0.55], [3.6, 0.022, 0.018, 0.45], [6.6, 0.014, 0.012, 0.38]].forEach(function (cfg) {
    var g = new THREE.PlaneGeometry(1500, 1500, 1, 1);
    g.rotateX(-Math.PI / 2);
    var m = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vWp; varying float vDist; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xz; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `
varying vec2 vWp;
varying float vDist;
uniform float uTime;
uniform float uMistAmt;
uniform vec2 uDrift;
uniform float uScale;
${NOISE}
void main(){
  vec2 p = vWp * 0.004 + uDrift * uTime;
  float n1 = fbm2(p * 2.2);
  float n2 = fbm2(p * 6.0 + vec2(3.7, 8.1));
  float a = (n1 * n1 * 0.8 + n2 * 0.4) * uScale;
  a = smoothstep(0.30, 0.90, a);
  a *= uMistAmt;
  a *= smoothstep(0.0, 40.0, vDist) * (1.0 - smoothstep(140.0, 520.0, vDist));
  vec3 c = vec3(0.84, 0.90, 0.93);
  gl_FragColor = vec4(c, a * 0.5);
}`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: Object.assign({}, U, {
        uDrift: { value: new THREE.Vector2(cfg[1], cfg[2]) },
        uScale: { value: cfg[3] }
      })
    });
    var mesh = new THREE.Mesh(g, m);
    mesh.position.y = cfg[0];
    mesh.renderOrder = 30;
    mesh.frustumCulled = false;
    scene.add(mesh);
    mistMats.push(m);
  });

  // ------------------------------------------------------------ 雨
  var RAIN_N = 1300;
  var rainPos = new Float32Array(RAIN_N * 3);
  for (ti = 0; ti < RAIN_N; ti++) {
    rainPos[ti * 3] = (rand() * 2 - 1) * 120;
    rainPos[ti * 3 + 1] = rand() * 120 + 10;
    rainPos[ti * 3 + 2] = (rand() * 2 - 1) * 120;
  }
  var rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  var rainMat = new THREE.ShaderMaterial({
    vertexShader: `
uniform float uPixelRatio;
varying float vFade;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(46.0 / -mv.z, 2.0, 20.0) * uPixelRatio;
  vFade = clamp(1.0 - (-mv.z) / 240.0, 0.1, 1.0);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform float uRainAmt;
varying float vFade;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.08, length(q)) * smoothstep(0.30, 0.06, abs(q.x));
  gl_FragColor = vec4(0.75, 0.84, 0.92, a * 0.5 * uRainAmt * vFade);
}`,
    transparent: true, depthWrite: false,
    uniforms: { uRainAmt: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) } }
  });
  var rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 40;
  scene.add(rain);
  function updateRain(dt) {
    var wind = U.uWindDir.value;
    for (var i = 0; i < RAIN_N; i++) {
      var iy = i * 3;
      rainPos[iy + 1] -= (34 + 10 * U.uWindAmp.value) * dt;
      rainPos[iy] += wind.x * 5.5 * dt;
      rainPos[iy + 2] += wind.y * 5.5 * dt;
      if (rainPos[iy + 1] < 0.5) {
        rainPos[iy] = leader.x + (rand() * 2 - 1) * 110;
        rainPos[iy + 1] = leader.y + 40 + rand() * 60;
        rainPos[iy + 2] = leader.z + (rand() * 2 - 1) * 110;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------ 花粉光尘
  var SP_N = 400;
  var spPos = new Float32Array(SP_N * 3);
  var spVel = new Float32Array(SP_N * 3);
  var spLife = new Float32Array(SP_N);
  var spMax = new Float32Array(SP_N);
  var spSize = new Float32Array(SP_N);
  for (ti = 0; ti < SP_N; ti++) { spPos[ti * 3 + 1] = -9999; spSize[ti] = 1.5 + rand() * 2.2; }
  var spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute('aLife', new THREE.BufferAttribute(spLife, 1).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute('aSize', new THREE.BufferAttribute(spSize, 1));
  var spMat = new THREE.ShaderMaterial({
    vertexShader: `
attribute float aLife;
attribute float aSize;
uniform float uPixelRatio;
varying float vLife;
void main(){
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (aSize * 0.55 + (1.0 - aLife) * 1.2) * uPixelRatio * (60.0 / max(-mv.z, 8.0));
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform float uTime;
varying float vLife;
void main(){
  if (vLife <= 0.0) discard;
  float a = pow(clamp(vLife, 0.0, 1.0), 1.35) * 0.62;
  vec2 q = gl_PointCoord - 0.5;
  a *= smoothstep(0.5, 0.12, length(q));
  vec3 c = mix(vec3(1.0, 0.86, 0.55), vec3(1.0, 0.97, 0.88), fract(uTime * 0.1));
  gl_FragColor = vec4(c, a);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) } }
  });
  var sparkles = new THREE.Points(spGeo, spMat);
  sparkles.frustumCulled = false;
  sparkles.renderOrder = 41;
  scene.add(sparkles);
  var spCursor = 0, spAcc = 0, spBurst = 0;
  function spawnSpark(x, y, z, spd) {
    var i = spCursor; spCursor = (spCursor + 1) % SP_N;
    spPos[i * 3] = x; spPos[i * 3 + 1] = y; spPos[i * 3 + 2] = z;
    spVel[i * 3] = (rand() - 0.5) * spd;
    spVel[i * 3 + 1] = rand() * spd * 0.7 + 0.4;
    spVel[i * 3 + 2] = (rand() - 0.5) * spd;
    spMax[i] = 1.1 + rand() * 1.4;
    spLife[i] = spMax[i];
  }
  function updateSparkles(dt) {
    spAcc += dt * 26;
    while (spAcc >= 1) {
      spAcc -= 1;
      spawnSpark(leader.x + (rand() - 0.5) * 7, leader.y + (rand() - 0.5) * 3, leader.z + (rand() - 0.5) * 7, 1.6);
    }
    if (spBurst > 0) {
      spBurst -= dt;
      spawnSpark(leader.x, leader.y, leader.z, 7);
    }
    for (var i = 0; i < SP_N; i++) {
      if (spLife[i] <= 0) continue;
      spLife[i] -= dt;
      if (spLife[i] <= 0) { spPos[i * 3 + 1] = -9999; spLife[i] = 0; continue; }
      spPos[i * 3] += spVel[i * 3] * dt;
      spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
      spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
      spVel[i * 3 + 1] += 0.5 * dt;
    }
    spGeo.attributes.position.needsUpdate = true;
    spGeo.attributes.aLife.needsUpdate = true;
  }

  // ------------------------------------------------------------ 天气系统
  var WX = [
    { dur: 80, cov: 0.06, sun: 1.06, wind: 0.90, rain: 0, mist: 0.16, fog: 0.0022, name: '晴 · 微风', icon: '☀' },
    { dur: 42, cov: 0.46, sun: 0.85, wind: 1.30, rain: 0, mist: 0.24, fog: 0.0026, name: '云起 · 风渐急', icon: '⛅' },
    { dur: 30, cov: 0.88, sun: 0.52, wind: 1.45, rain: 0, mist: 0.42, fog: 0.0034, name: '转阴 · 天光微沉', icon: '☁' },
    { dur: 38, cov: 0.94, sun: 0.32, wind: 1.30, rain: 0.9, mist: 0.62, fog: 0.0040, name: '细雨 · 雾笼山野', icon: '🌧' },
    { dur: 30, cov: 0.55, sun: 0.76, wind: 1.00, rain: 0.1, mist: 0.30, fog: 0.0030, name: '云开 · 云影缓移', icon: '🌤' },
    { dur: 48, cov: 0.10, sun: 1.12, wind: 0.78, rain: 0, mist: 0.13, fog: 0.0020, name: '晚晴 · 斜阳正好', icon: '☀' }
  ];
  var WX_TOTAL = 0;
  WX.forEach(function (w) { WX_TOTAL += w.dur; });
  var wxEl = document.getElementById('wx');
  var wxLast = -1;
  var weatherState = { cov: 0.06, sun: 1.06, wind: 0.9, rain: 0, mist: 0.16, fog: 0.00125 };
  var sunBase = col('#ffefcd');
  var fogSun = col('#d9e6ec'), fogRain = col('#b3bfc7');
  var zenSun = col('#7ab4e6'), zenCloud = col('#93a3b1');
  var horSun = col('#eaf3f4'), horCloud = col('#b9c4cc'), horWarm = col('#f5e4be');
  var lightCol = col('#fff3d2');
  function updateWeather(t) {
    var tw = t % WX_TOTAL;
    var idx = 0, acc = 0;
    for (var i = 0; i < WX.length; i++) { if (tw < acc + WX[i].dur) { idx = i; break; } acc += WX[i].dur; }
    var local = (tw - acc) / WX[idx].dur;
    var w0 = WX[idx], w1 = WX[(idx + 1) % WX.length];
    var ease = sstep(local, 0, 1);
    var st = weatherState;
    st.cov = lerpN(w0.cov, w1.cov, ease);
    st.sun = lerpN(w0.sun, w1.sun, ease);
    st.wind = lerpN(w0.wind, w1.wind, ease);
    st.rain = lerpN(w0.rain, w1.rain, ease);
    st.mist = lerpN(w0.mist, w1.mist, ease);
    st.fog = lerpN(w0.fog, w1.fog, ease);
    // 高频阵风
    var gust = 0.68 + 0.55 * fbm(t * 0.05, 1.7, 2) + 0.18 * Math.sin(t * 0.9);
    U.uTime.value = t;
    U.uCov.value = st.cov;
    U.uWindAmp.value = st.wind * clamp(gust, 0.4, 1.6);
    U.uSunColor.value.copy(sunBase).multiplyScalar(st.sun * 1.35);
    // 天光
    var covC = clamp(st.cov * 1.15, 0, 1);
    var zen = mixC(zenSun, zenCloud, covC);
    var hor = mixC(horSun, horCloud, covC);
    hor.lerp(horWarm, 0.3 * (1 - st.cov) * st.sun);
    U.uSkyTint.value.copy(zen).lerp(hor, 0.4);
    skyMat.uniforms.uZenith.value.copy(zen);
    skyMat.uniforms.uHorizon.value.copy(hor);
    skyMat.uniforms.uSunLight.value.copy(lightCol).multiplyScalar(1.2 * st.sun + 0.12);
    // 雾
    scene.fog.density = st.fog;
    scene.fog.color.copy(fogSun).lerp(fogRain, st.rain * 0.85 + covC * 0.4);
    // 物理光（花瓣）
    sunLight.intensity = 0.55 + 1.15 * st.sun;
    sunLight.color.copy(sunBase).lerp(col('#c8d2d8'), covC);
    hemiLight.intensity = 0.55 + 0.35 * (1 - covC);
    // 雨与雾
    rainMat.uniforms.uRainAmt.value = st.rain;
    U.uMistAmt.value = st.mist;
    // HUD
    if (idx !== wxLast) { wxLast = idx; if (wxEl) wxEl.textContent = w0.name; }
    return st;
  }

  // ------------------------------------------------------------ 输入
  var raycaster = new THREE.Raycaster();
  var pointerNDC = new THREE.Vector2();
  var kb = { x: 0, z: 0 };
  var inputT = -100;
  var playStarted = false;
  var lastInputMode = null;

  function onPointerMove(cx, cy) {
    pointerNDC.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNDC, camera);
    var ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    var found = false;
    if (rd.y < -0.015) {
      var t = 8, step = 3.0;
      for (var i = 0; i < 160; i++) {
        var px = ro.x + rd.x * t, py = ro.y + rd.y * t, pz = ro.z + rd.z * t;
        if (py <= terrainH(px, pz)) {
          pointerHit = new THREE.Vector3(px, 0, pz);
          found = true;
          break;
        }
        t += step;
      }
    }
    if (!found) pointerHit = null;
    inputT = clock.elapsedTime;
  }
  window.addEventListener('pointermove', function (e) { lastInputMode = 'mouse'; onPointerMove(e.clientX, e.clientY); });
  window.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.closest && e.target.closest('.chip')) return;
    if (!playStarted) return;
    burstTimer = 0.85;
    spBurst = 0.9;
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  });
  window.addEventListener('touchmove', function (e) {
    if (e.touches.length) { lastInputMode = 'touch'; onPointerMove(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') kb.z = -1;
    if (k === 's' || k === 'arrowdown') kb.z = 1;
    if (k === 'a' || k === 'arrowleft') kb.x = -1;
    if (k === 'd' || k === 'arrowright') kb.x = 1;
    if (k === 'm') toggleMute();
    lastInputMode = 'key';
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') kb.z = 0;
    if (k === 's' || k === 'arrowdown') kb.z = 0;
    if (k === 'a' || k === 'arrowleft') kb.x = 0;
    if (k === 'd' || k === 'arrowright') kb.x = 0;
  });

  // ------------------------------------------------------------ 摄像机
  var camPos = new THREE.Vector3(30, 16, 40);
  var lookPos = new THREE.Vector3(0, 2, 0);
  var camCfg = { dist: 28, height: 7.0, ang: 0.85, fov: 48 };
  var dofAmt = 0;
  var focusDist = 20;
  var groupCenter = new THREE.Vector3();

  function updateCamera(dt, t, st) {
    var idle = (t - inputT) > 2.8;
    var mvx = leader.x - prevLeader.x, mvz = leader.z - prevLeader.z;
    var spd = Math.sqrt(mvx * mvx + mvz * mvz) / Math.max(dt, 0.001);
    prevLeader.copy(leader);
    groupCenter.set(0, 0, 0);
    for (var i = 0; i < 8; i++) groupCenter.add(pts[i]);
    groupCenter.multiplyScalar(1 / 8);
    groupCenter.lerp(leader, 0.35);
    if (spd > 1.2) {
      var wa = Math.atan2(-mvx, -mvz);
      camCfg.ang = dampAngle(camCfg.ang, wa, 2.2, dt);
    } else if (idle) {
      camCfg.ang += 0.02 * dt;
    }
    camCfg.dist = damp(camCfg.dist, idle ? 12 : 28, 1.6, dt);
    camCfg.height = damp(camCfg.height, idle ? 4.4 : 7.0, 1.6, dt);
    camCfg.fov = damp(camCfg.fov, idle ? 44 : 48, 1.5, dt);
    var cxp = groupCenter.x + Math.sin(camCfg.ang) * camCfg.dist;
    var czp = groupCenter.z + Math.cos(camCfg.ang) * camCfg.dist;
    var cyp = groupCenter.y + camCfg.height;
    cyp = Math.max(cyp, terrainH(cxp, czp) + 3.0);
    var kk = 1 - Math.exp(-2.8 * dt);
    camPos.x += (cxp - camPos.x) * kk;
    camPos.y += (cyp - camPos.y) * kk;
    camPos.z += (czp - camPos.z) * kk;
    lookPos.x += (groupCenter.x - lookPos.x) * (1 - Math.exp(-5 * dt));
    lookPos.y += (groupCenter.y + (idle ? 1.6 : 3.2) - lookPos.y) * (1 - Math.exp(-5 * dt));
    lookPos.z += (groupCenter.z - lookPos.z) * (1 - Math.exp(-5 * dt));
    camera.position.copy(camPos);
    camera.lookAt(lookPos);
    if (Math.abs(camera.fov - camCfg.fov) > 0.02) { camera.fov = camCfg.fov; camera.updateProjectionMatrix(); }
    dofAmt = damp(dofAmt, idle ? 1 : 0, idle ? 0.9 : 2.2, dt);
    if (dofAmt < 0.004) dofAmt = 0;
    focusDist = camera.position.distanceTo(groupCenter);
  }

  // ------------------------------------------------------------ 后期管线
  function makeRT(w, h, withDepth) {
    if (withDepth) {
      return new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h) });
    }
    var rt = new THREE.WebGLRenderTarget(w, h);
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    return rt;
  }
  var rtScene = makeRT(2, 2, true);
  var rtBloom1 = makeRT(2, 2, false);
  var rtBloom2 = makeRT(2, 2, false);
  var quad = new THREE.PlaneGeometry(2, 2);

  var brightMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    fragmentShader: 'varying vec2 vUv; uniform sampler2D tColor; void main(){ vec3 c = texture2D(tColor, vUv).rgb; c = max(c - 0.78, vec3(0.0)) * 1.35; gl_FragColor = vec4(c, 1.0); }',
    uniforms: { tColor: { value: null } }
  });
  function makeBlur(dir) {
    return new THREE.ShaderMaterial({
      vertexShader: PASS_VERT,
      fragmentShader: `
varying vec2 vUv; uniform sampler2D tColor; uniform vec2 uDir; uniform vec2 uRes;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846 / uRes;
  vec2 o2 = uDir * 3.2307692308 / uRes;
  c += (texture2D(tColor, vUv + o1).rgb + texture2D(tColor, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(tColor, vUv + o2).rgb + texture2D(tColor, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`,
      uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2(dir, 0) }, uRes: { value: new THREE.Vector2(2, 2) } }
    });
  }
  var blurH = makeBlur(1), blurV = makeBlur(0);
  var K16 = [];
  for (ti = 0; ti < 16; ti++) {
    var kr = Math.sqrt((ti + 0.5) / 16), ka = ti * 2.3999632297;
    K16.push(new THREE.Vector2(Math.cos(ka) * kr, Math.sin(ka) * kr));
  }
  var finalFrag = `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uDof;
uniform float uExposure;
uniform float uTime;
uniform vec2 uK[16];
${NOISE}
vec3 aces(vec3 x){
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  x *= 0.65;
  x = m1 * x;
  x = (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081);
  x = m2 * x;
  return clamp(x, 0.0, 1.0);
}
float linDepth(float d){
  float ndc = d * 2.0 - 1.0;
  return -(2.0 * uNear * uFar) / ((uFar - uNear) * ndc - (uFar + uNear));
}
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tScene, uv).rgb;
  c += texture2D(tBloom, uv).rgb * 0.55;
  float dof = uDof;
  if (dof > 0.004) {
    float d0 = texture2D(tDepth, uv).r;
    float l0 = linDepth(d0);
    float rel = abs(l0 - uFocus) / max(uFocus, 0.001);
    float blur = clamp((rel - 0.05) * 10.0, 0.0, 8.0) * dof;
    if (blur > 0.05) {
      vec3 acc = c;
      float wsum = 1.0;
      for (int i = 0; i < 16; i++) {
        vec2 off = uK[i] * blur / uRes.y;
        float l1 = linDepth(texture2D(tDepth, uv + off).r);
        float w = 1.0 - smoothstep(0.05, 0.6, abs(l1 - l0) / (l0 * 0.6 + 1.0));
        acc += texture2D(tScene, uv + off).rgb * w;
        wsum += w;
      }
      c = acc / wsum;
    }
  }
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(g), c, 1.07);
  c = (c - 0.5) * 1.05 + 0.5;
  c = pow(max(c, vec3(0.0)), vec3(0.97));
  float vd = length(uv - vec2(0.5)) * 2.0;
  c *= 1.0 - 0.22 * smoothstep(0.42, 1.05, vd);
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  float gr = hash12(uv * uRes + fract(uTime) * 42.7) - 0.5;
  c += gr * 0.022;
  gl_FragColor = vec4(c, 1.0);
}
`;
  var finalMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT, fragmentShader: finalFrag,
    uniforms: {
      tScene: { value: null }, tBloom: { value: null }, tDepth: { value: null },
      uRes: { value: new THREE.Vector2(2, 2) },
      uNear: { value: 0.5 }, uFar: { value: 9000 },
      uFocus: { value: 20 }, uDof: { value: 0 }, uExposure: { value: 1.16 }, uTime: U.uTime,
      uK: { value: K16 }
    }
  });
  var passMeshes = {};
  function passMesh(name, mat) {
    if (!passMeshes[name]) passMeshes[name] = new THREE.Mesh(quad, mat);
    else passMeshes[name].material = mat;   // 关键：复用网格时换用新材质
    return passMeshes[name];
  }
  var drawSize = new THREE.Vector2(2, 2);
  function doPass(mat, rt) {
    renderer.setRenderTarget(rt || null);
    renderer.getDrawingBufferSize(drawSize);
    renderer.setViewport(0, 0, rt ? rt.width : drawSize.x, rt ? rt.height : drawSize.y);
    renderer.render(passMesh('q1', mat), passCam);
  }

  function sizeRTs() {
    var ds = renderer.getDrawingBufferSize(new THREE.Vector2());
    var w = ds.x, h = ds.y;
    var sw = Math.max(2, Math.round(w * QUALITY[qLevel].skyScale)), shh = Math.max(2, Math.round(h * QUALITY[qLevel].skyScale));
    skyRT.setSize(sw, shh);
    // 直接重建带深度纹理的RT，保证深度缓冲与新尺寸一致
    rtScene.dispose();
    rtScene = makeRT(w, h, true);
    rtBloom1.dispose(); rtBloom1 = makeRT(Math.max(2, w >> 2), Math.max(2, h >> 2), false);
    rtBloom2.dispose(); rtBloom2 = makeRT(Math.max(2, w >> 2), Math.max(2, h >> 2), false);
    finalMat.uniforms.uRes.value.set(w, h);
    blurH.uniforms.uRes.value.set(w, h);
    blurV.uniforms.uRes.value.set(w, h);
  }

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qLevel].dpr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    rainMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, QUALITY[qLevel].dpr);
    spMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, QUALITY[qLevel].dpr);
    sizeRTs();
  });

  // ------------------------------------------------------------ BGM（生成式）
  var audio = { ctx: null, master: null, started: false, muted: false, windGain: null, rainGain: null, revGain: null, nextChord: 0, nextNote: 0, chordIdx: 0, timer: null, chords: null, penta: null };
  function makeIR(ctx, dur, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * dur);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var tt = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - tt, decay) * 0.43;
      }
    }
    return buf;
  }
  function makeNoise(ctx, dur) {
    var rate = ctx.sampleRate, len = Math.floor(rate * dur);
    var buf = ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function midiF(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function startAudio() {
    if (audio.started) { if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    audio.started = true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = audio.ctx = new AC();
    var master = audio.master = ctx.createGain();
    master.gain.value = 0.85;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 8;
    master.connect(comp); comp.connect(ctx.destination);
    // 混响母线
    var conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, 3.6, 2.8);
    var revGain = audio.revGain = ctx.createGain();
    revGain.gain.value = 0.32;
    master.connect(revGain); revGain.connect(conv); conv.connect(master);
    // 延迟
    var dl = ctx.createDelay(1.2); dl.delayTime.value = 0.42;
    var fb = ctx.createGain(); fb.gain.value = 0.30;
    var dlWet = ctx.createGain(); dlWet.gain.value = 0.15;
    master.connect(dlWet); dlWet.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(master);
    // 风声
    var windSrc = ctx.createBufferSource(); windSrc.buffer = makeNoise(ctx, 5); windSrc.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.4;
    var windGain = audio.windGain = ctx.createGain(); windGain.gain.value = 0.045;
    windSrc.connect(lp); lp.connect(windGain); windGain.connect(master); windSrc.start();
    // 雨声
    var rainSrc = ctx.createBufferSource(); rainSrc.buffer = makeNoise(ctx, 3); rainSrc.loop = true;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600;
    var rainGain = audio.rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(hp); hp.connect(rainGain); rainGain.connect(master); rainSrc.start();
    // 乐句
    audio.chords = [
      [48, 52, 55, 59, 64],  // Cmaj7
      [45, 52, 57, 60, 64],  // Am7
      [41, 48, 53, 57, 60],  // Fmaj7
      [43, 50, 55, 59, 64]   // G6
    ];
    audio.penta = [60, 62, 64, 67, 69, 72, 74, 76, 79];
    audio.nextChord = ctx.currentTime + 0.6;
    audio.nextNote = ctx.currentTime + 1.4;
    audio.timer = setInterval(function () {
      var now = ctx.currentTime;
      if (audio.nextChord < now + 1.2) {
        playChord(ctx, audio.nextChord, audio.chords[audio.chordIdx % audio.chords.length]);
        audio.chordIdx++;
        audio.nextChord += 8.0;
      }
      while (audio.nextNote < now + 1.2) {
        playNote(ctx, audio.nextNote);
        audio.nextNote += 0.7 + Math.random() * 2.2;
      }
    }, 220);
  }
  function envGain(ctx, t, peak, attack, sustain, release, o1, o2) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.55, 0.001), t + sustain);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sustain + release);
    o1.connect(g);
    if (o2) o2.connect(g);
    g.connect(audio.master);
    if (audio.revGain) g.connect(audio.revGain);
    return g;
  }
  function playChord(ctx, t, notes) {
    notes.forEach(function (mi) {
      var f = midiF(mi);
      var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.007;
      var g = envGain(ctx, t, 0.024, 2.4, 4.2, 3.4, o, o2);
      o.start(t); o.stop(t + 10.2); o2.start(t); o2.stop(t + 10.2);
      void g;
    });
    // 低音
    var ob = ctx.createOscillator(); ob.type = 'sine'; ob.frequency.value = midiF(notes[0] - 12);
    var gb = envGain(ctx, t, 0.030, 1.7, 3.0, 3.2, ob, null);
    ob.start(t); ob.stop(t + 8.5);
    void gb;
  }
  function playNote(ctx, t) {
    var chordTones = audio.chords[audio.chordIdx % audio.chords.length];
    var mi;
    if (Math.random() < 0.72) mi = audio.penta[Math.floor(Math.random() * audio.penta.length)];
    else mi = chordTones[Math.floor(Math.random() * chordTones.length)] + 12;
    var f = midiF(mi);
    var isBell = Math.random() < 0.12;
    var o = ctx.createOscillator();
    o.type = isBell ? 'sine' : 'triangle';
    o.frequency.value = f;
    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.001;
    var peak = 0.038 + Math.random() * 0.030;
    var g = envGain(ctx, t, peak, 0.04, 1.0, isBell ? 4.5 : 2.6, o, o2);
    void g;
    o.start(t); o.stop(t + (isBell ? 6.2 : 4.2));
    o2.start(t); o2.stop(t + (isBell ? 6.2 : 4.2));
  }
  function updateAudio(weather) {
    if (!audio.ctx) return;
    var wind = weather.wind * (0.7 + 0.6 * U.uWindAmp.value * 0.5);
    audio.windGain.gain.setTargetAtTime(0.03 + wind * 0.02, audio.ctx.currentTime, 0.8);
    audio.rainGain.gain.setTargetAtTime(weather.rain * 0.07, audio.ctx.currentTime, 1.2);
  }
  var muteBtn = document.getElementById('btn-mute');
  function toggleMute() {
    audio.muted = !audio.muted;
    if (muteBtn) muteBtn.textContent = audio.muted ? '音乐 · 关' : '音乐 · 开';
    if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(audio.muted ? 0 : 0.85, audio.ctx.currentTime, 0.25);
  }
  if (muteBtn) muteBtn.addEventListener('click', toggleMute);

  // ------------------------------------------------------------ UI
  var veil = document.getElementById('veil');
  var hint = document.getElementById('hint');
  var cineBtn = document.getElementById('btn-cine');
  var qualityBtn = document.getElementById('btn-quality');
  document.body.classList.add('cine');
  function beginPlay() {
    if (playStarted) return;
    playStarted = true;
    veil.classList.add('hide');
    document.body.classList.add('cine');
    startAudio();
    inputT = clock.elapsedTime;
    burstTimer = 0.85;
    spBurst = 0.9;
    setTimeout(function () { if (hint) hint.style.opacity = '0'; }, 14000);
  }
  veil.addEventListener('click', beginPlay);
  if (cineBtn) cineBtn.addEventListener('click', function () {
    document.body.classList.toggle('cine');
    cineBtn.textContent = document.body.classList.contains('cine') ? '电影框 · 开' : '电影框 · 关';
  });
  if (qualityBtn) qualityBtn.addEventListener('click', function () {
    qLevel = (qLevel + 1) % QUALITY.length;
    var q = QUALITY[qLevel];
    qualityBtn.textContent = '画质 · ' + q.name;
    buildGrass(q.grass);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    skyMat.uniforms.uSteps.value = q.steps;
    rainMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, q.dpr);
    spMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, q.dpr);
    sizeRTs();
  });

  // ------------------------------------------------------------ 主循环
  var frameT = 0, frameN = 0, autoAdjusted = false;

  function frame() {
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;

    var st = updateWeather(t);
    updatePetals(dt, t);
    updateSparkles(dt);
    if (st.rain > 0.02) updateRain(dt);
    updateCamera(dt, t, st);

    // 花朵生长
    for (var gi = growing.length - 1; gi >= 0; gi--) {
      var gg = growing[gi];
      if (gg.t < 0) { gg.t += dt; continue; }
      gg.t += dt;
      var gv = clamp(gg.t / gg.dur, 0, 1);
      gg.st.grows[gg.slot] = gv;
      if (gv >= 1) {
        gg.st.grows[gg.slot] = 1;
        growing.splice(gi, 1);
      }
    }
    if (growing.length > 0) {
      for (var fv = 0; fv < 3; fv++) {
        flowerStates[fv].mesh.geometry.attributes.aGrow.needsUpdate = true;
      }
    }

    // 渲染
    renderSky();
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    finalMat.uniforms.tScene.value = rtScene.texture;
    finalMat.uniforms.tBloom.value = rtBloom1.texture;
    finalMat.uniforms.tDepth.value = rtScene.depthTexture;
    finalMat.uniforms.uFocus.value = focusDist;
    finalMat.uniforms.uDof.value = depthOK ? dofAmt : 0;

    brightMat.uniforms.tColor.value = rtScene.texture;
    blurH.uniforms.tColor.value = rtScene.texture;
    doPass(brightMat, rtBloom2);
    blurH.uniforms.tColor.value = rtBloom2.texture;
    doPass(blurH, rtBloom1);
    blurV.uniforms.tColor.value = rtBloom1.texture;
    doPass(blurV, rtBloom2);
    finalMat.uniforms.tBloom.value = rtBloom2.texture;
    doPass(finalMat, null);

    updateAudio(st);

    // 简易自适应画质
    frameT += dt; frameN++;
    if (frameN >= 100) {
      var fps = frameN / frameT;
      if (fps < 30 && qLevel < QUALITY.length - 1 && !autoAdjusted) {
        autoAdjusted = true;
        qLevel++;
        var q = QUALITY[qLevel];
        buildGrass(q.grass);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
        renderer.setSize(window.innerWidth, window.innerHeight);
        skyMat.uniforms.uSteps.value = q.steps;
        sizeRTs();
        if (qualityBtn) qualityBtn.textContent = '画质 · ' + q.name;
      }
      frameT = 0; frameN = 0;
    }
  }

  sizeRTs();
  camera.position.copy(camPos);
  camera.lookAt(lookPos);
  // 调试钩子（无副作用，便于自动化检查）
  window.__dbg = {
    renderer: renderer, scene: scene, camera: camera, U: U, terrain: terrain, petalMesh: petalMesh,
    skyRT: skyRT, flowerStates: flowerStates, dome: dome, skyMesh: skyMesh,
    rtScene: function () { return rtScene; },
    grassMesh: function () { return grassMesh; },
    renderSky: renderSky,
    passes: { finalMat: finalMat, brightMat: brightMat, blurH: blurH, blurV: blurV }
  };
  renderer.setAnimationLoop(frame);
}

})();
