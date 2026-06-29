const photoBase = window.PHOTO_MONOLITH_ASSET_BASE || "../photo-globe/assets/photo-wall/";
const photoSources = [
  ["1-Photo-1.jpg", 1.3333],
  ["2-Photo-2.jpg", 0.4602],
  ["3-Photo-3.jpg", 0.4602],
  ["4-Photo-4.jpg", 0.575],
  ["5-Photo-5.jpg", 0.6133],
  ["6-Photo-6.jpg", 0.4602],
  ["7-Photo-7.jpg", 0.4859],
  ["8-Photo-8.jpg", 0.4602],
  ["9-Photo-9.jpg", 0.75],
  ["10-Photo-10.jpg", 0.6664],
  ["11-Photo-11.jpg", 0.6664],
  ["12-Photo-12.jpg", 0.6664],
  ["13-Photo-13.jpg", 0.6664],
  ["14-Photo-14.jpg", 0.6664],
  ["15-Photo-15.jpg", 1.5006],
  ["16-Photo-16.jpg", 1.5006],
  ["17-Photo-17.jpg", 0.75],
  ["18-Photo-18.jpg", 1.5006],
  ["19-Photo-19.jpg", 1.5006],
  ["20-Photo-20.jpg", 0.6664],
];

const canvas = document.querySelector("#monolith-canvas");
const tunnelLength = 15000;
const nearPlane = 86;
const farPlane = tunnelLength + 900;
const travelOffset = 520;
const velocityLimit = 7.4;
const idleVelocity = 0.018;
const panelsPerLane = 34;
const laneDefs = [
  { x: -980, y: -330, yaw: 0.24, height: [820, 1220], jitterX: 170, jitterY: 120 },
  { x: 980, y: -330, yaw: -0.24, height: [820, 1220], jitterX: 170, jitterY: 120 },
  { x: -520, y: -270, yaw: 0.12, height: [640, 1030], jitterX: 190, jitterY: 170 },
  { x: 520, y: -270, yaw: -0.12, height: [640, 1030], jitterX: 190, jitterY: 170 },
  { x: -150, y: -300, yaw: 0.04, height: [700, 1180], jitterX: 250, jitterY: 150 },
  { x: 150, y: -300, yaw: -0.04, height: [700, 1180], jitterX: 250, jitterY: 150 },
];

let gl;
let program;
let buffer;
let attribs;
let uniforms;
let textures = [];
let panels = [];
let travel = 0;
let velocity = 0.12;
let lastTime = 0;
let dpr = 1;
let pointer = null;
let stats = {
  renderer: "webgl",
  count: photoSources.length,
  panels: 0,
  renderedPanels: 0,
  velocity: 0,
  travel: 0,
  webgl: false,
  canvasWidth: 0,
  canvasHeight: 0,
};

const vertexData = new Float32Array(36);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positiveModulo(value, size) {
  return ((value % size) + size) % size;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function makeShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
  }
  return shader;
}

function makeProgram() {
  const vertex = makeShader(gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    attribute float a_alpha;
    attribute float a_shade;
    varying vec2 v_uv;
    varying float v_alpha;
    varying float v_shade;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
      v_alpha = a_alpha;
      v_shade = a_shade;
    }
  `);

  const fragment = makeShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_uv;
    varying float v_alpha;
    varying float v_shade;

    void main() {
      vec4 photo = texture2D(u_texture, v_uv);
      gl_FragColor = vec4(photo.rgb * v_shade, photo.a * v_alpha);
    }
  `);

  const nextProgram = gl.createProgram();
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(nextProgram) || "Program link failed");
  }
  return nextProgram;
}

function makePlaceholderTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([9, 12, 22, 255]),
  );
  return texture;
}

function loadTexture([fileName, ratio]) {
  const texture = makePlaceholderTexture();
  const record = { texture, ratio, ready: false, src: `${photoBase}${fileName}` };
  const image = new Image();
  image.onload = () => {
    record.ratio = image.naturalWidth / image.naturalHeight || ratio;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    record.ready = true;
  };
  image.onerror = () => {
    record.ready = true;
  };
  image.src = record.src;
  return record;
}

function initWebGl() {
  gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    document.body.classList.add("webgl-unavailable");
    return false;
  }

  program = makeProgram();
  buffer = gl.createBuffer();
  attribs = {
    position: gl.getAttribLocation(program, "a_position"),
    uv: gl.getAttribLocation(program, "a_uv"),
    alpha: gl.getAttribLocation(program, "a_alpha"),
    shade: gl.getAttribLocation(program, "a_shade"),
  };
  uniforms = {
    texture: gl.getUniformLocation(program, "u_texture"),
  };

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(attribs.position);
  gl.enableVertexAttribArray(attribs.uv);
  gl.enableVertexAttribArray(attribs.alpha);
  gl.enableVertexAttribArray(attribs.shade);
  gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 24, 8);
  gl.vertexAttribPointer(attribs.alpha, 1, gl.FLOAT, false, 24, 16);
  gl.vertexAttribPointer(attribs.shade, 1, gl.FLOAT, false, 24, 20);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  stats.webgl = true;
  return true;
}

function choosePhotoIndex(random, previous, lanePrevious) {
  let next = Math.floor(random() * photoSources.length) % photoSources.length;
  let guard = 0;
  while ((next === previous || next === lanePrevious) && guard < 12) {
    next = Math.floor(random() * photoSources.length) % photoSources.length;
    guard += 1;
  }
  return next;
}

function buildPanels() {
  const random = makeRandom(20260629);
  const lanePrevious = new Array(laneDefs.length).fill(-1);
  let previous = -1;
  panels = [];

  laneDefs.forEach((lane, laneIndex) => {
    for (let index = 0; index < panelsPerLane; index += 1) {
      const photoIndex = choosePhotoIndex(random, previous, lanePrevious[laneIndex]);
      previous = photoIndex;
      lanePrevious[laneIndex] = photoIndex;
      const texture = textures[photoIndex] || { ratio: 1 };
      const height = mix(lane.height[0], lane.height[1], random());
      const width = clamp(height * texture.ratio, 260, 1320);
      const zStep = tunnelLength / panelsPerLane;
      panels.push({
        photoIndex,
        laneIndex,
        baseZ: index * zStep + laneIndex * (zStep / laneDefs.length) + random() * zStep * 0.42,
        x: lane.x + (random() - 0.5) * lane.jitterX,
        bottom: lane.y + (random() - 0.5) * lane.jitterY,
        width,
        height,
        yaw: lane.yaw + (random() - 0.5) * 0.08,
        roll: (random() - 0.5) * 0.045,
        shade: mix(0.72, 1.12, random()),
      });
    }
  });

  panels.sort((a, b) => a.baseZ - b.baseZ);
  stats.panels = panels.length;
}

function resizeCanvas() {
  if (!gl) return;
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
}

function scheduleResize() {
  resizeCanvas();
  setTimeout(resizeCanvas, 120);
  setTimeout(resizeCanvas, 360);
}

function project(point, focal, horizon) {
  const z = Math.max(nearPlane, point.z);
  return {
    x: canvas.width * 0.5 + (point.x / z) * focal,
    y: horizon - (point.y / z) * focal,
    z,
  };
}

function pushVertex(offset, point, uvX, uvY, alpha, shade) {
  vertexData[offset] = (point.x / canvas.width) * 2 - 1;
  vertexData[offset + 1] = 1 - (point.y / canvas.height) * 2;
  vertexData[offset + 2] = uvX;
  vertexData[offset + 3] = uvY;
  vertexData[offset + 4] = alpha;
  vertexData[offset + 5] = shade;
}

function drawPanel(panel, z, focal, horizon) {
  const texture = textures[panel.photoIndex];
  if (!texture) return false;

  const centerY = panel.bottom + panel.height * 0.5;
  const cosYaw = Math.cos(panel.yaw);
  const sinYaw = Math.sin(panel.yaw);
  const cosRoll = Math.cos(panel.roll);
  const sinRoll = Math.sin(panel.roll);
  const halfW = panel.width * 0.5;
  const halfH = panel.height * 0.5;
  const right = { x: cosYaw * cosRoll, y: sinRoll, z: -sinYaw * cosRoll };
  const up = { x: -cosYaw * sinRoll, y: cosRoll, z: sinYaw * sinRoll };
  const center = { x: panel.x, y: centerY + Math.sin((travel + panel.baseZ) * 0.0008) * 18, z };
  const corners = [
    { x: center.x - right.x * halfW + up.x * halfH, y: center.y - right.y * halfW + up.y * halfH, z: center.z - right.z * halfW + up.z * halfH },
    { x: center.x + right.x * halfW + up.x * halfH, y: center.y + right.y * halfW + up.y * halfH, z: center.z + right.z * halfW + up.z * halfH },
    { x: center.x - right.x * halfW - up.x * halfH, y: center.y - right.y * halfW - up.y * halfH, z: center.z - right.z * halfW - up.z * halfH },
    { x: center.x + right.x * halfW - up.x * halfH, y: center.y + right.y * halfW - up.y * halfH, z: center.z + right.z * halfW - up.z * halfH },
  ];

  if (corners.some((corner) => corner.z <= nearPlane)) return false;

  const points = corners.map((corner) => project(corner, focal, horizon));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  if (maxX < -240 || minX > canvas.width + 240 || maxY < -240 || minY > canvas.height + 240) return false;

  const nearFade = clamp((z - nearPlane) / 700, 0, 1);
  const farFade = clamp((farPlane - z) / 3400, 0, 1);
  const edgeFade = clamp(1.15 - Math.abs(panel.x) / 2200, 0.54, 1);
  const alpha = nearFade * farFade * edgeFade;
  const shade = panel.shade * mix(1.15, 0.48, clamp(z / farPlane, 0, 1));

  pushVertex(0, points[0], 0, 0, alpha, shade);
  pushVertex(6, points[1], 1, 0, alpha, shade);
  pushVertex(12, points[2], 0, 1, alpha, shade);
  pushVertex(18, points[2], 0, 1, alpha, shade);
  pushVertex(24, points[1], 1, 0, alpha, shade);
  pushVertex(30, points[3], 1, 1, alpha, shade);

  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STREAM_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return true;
}

function render(now) {
  resizeCanvas();
  const dt = lastTime ? Math.min(48, now - lastTime) : 16.67;
  lastTime = now;

  const directionalVelocity = Math.abs(velocity) > idleVelocity ? velocity : idleVelocity;
  travel += directionalVelocity * dt;
  if (!pointer && Math.abs(velocity) > idleVelocity) velocity *= Math.exp(-dt / 12000);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const focal = (canvas.height * 0.9) / Math.tan(36 * Math.PI / 180);
  const horizon = canvas.height * 0.62;
  const drawQueue = panels.map((panel) => ({
    panel,
    z: positiveModulo(panel.baseZ - travel, tunnelLength) + travelOffset,
  })).filter((entry) => entry.z > nearPlane && entry.z < farPlane);

  drawQueue.sort((a, b) => b.z - a.z);
  let rendered = 0;
  drawQueue.forEach((entry) => {
    if (drawPanel(entry.panel, entry.z, focal, horizon)) rendered += 1;
  });

  stats = {
    renderer: "webgl",
    count: photoSources.length,
    panels: panels.length,
    renderedPanels: rendered,
    velocity: Number(velocity.toFixed(3)),
    travel: Number(travel.toFixed(1)),
    webgl: Boolean(gl),
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };

  requestAnimationFrame(render);
}

function addForwardImpulse(amount, immediate = 0) {
  travel += immediate;
  velocity = clamp(velocity + amount, -velocityLimit, velocityLimit);
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const push = -event.deltaY * 0.018;
  addForwardImpulse(push, -event.deltaY * 1.4);
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointer = {
    id: event.pointerId,
    y: event.clientY,
    lastY: event.clientY,
    lastTime: performance.now(),
  };
  velocity = 0;
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture can fail in synthetic browser tests.
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const now = performance.now();
  const dy = event.clientY - pointer.lastY;
  const dt = Math.max(1, now - pointer.lastTime);
  const movement = -dy * 4.15;
  travel += movement;
  velocity = clamp(velocity * 0.62 + (movement / dt) * 0.38, -velocityLimit, velocityLimit);
  pointer.lastY = event.clientY;
  pointer.lastTime = now;
});

function stopPointer(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer = null;
}

canvas.addEventListener("pointerup", stopPointer);
canvas.addEventListener("pointercancel", stopPointer);

window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", scheduleResize);
window.addEventListener("pageshow", scheduleResize);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleResize();
});

window.__photoMonolithDebug = () => ({ ...stats });

function boot() {
  if (!initWebGl()) return;
  textures = photoSources.map(loadTexture);
  buildPanels();
  scheduleResize();
  requestAnimationFrame(render);
}

boot();
