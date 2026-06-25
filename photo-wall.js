const starterPhotos = [
  { src: "assets/photo-wall/1-Photo-1.jpg", ratio: 1.3333 },
  { src: "assets/photo-wall/2-Photo-2.jpg", ratio: 0.4602 },
  { src: "assets/photo-wall/3-Photo-3.jpg", ratio: 0.4602 },
  { src: "assets/photo-wall/4-Photo-4.jpg", ratio: 0.575 },
  { src: "assets/photo-wall/5-Photo-5.jpg", ratio: 0.6133 },
  { src: "assets/photo-wall/6-Photo-6.jpg", ratio: 0.4602 },
  { src: "assets/photo-wall/7-Photo-7.jpg", ratio: 0.4859 },
  { src: "assets/photo-wall/8-Photo-8.jpg", ratio: 0.4602 },
  { src: "assets/photo-wall/9-Photo-9.jpg", ratio: 0.75 },
  { src: "assets/photo-wall/10-Photo-10.jpg", ratio: 0.6664 },
  { src: "assets/photo-wall/11-Photo-11.jpg", ratio: 0.6664 },
  { src: "assets/photo-wall/12-Photo-12.jpg", ratio: 0.6664 },
  { src: "assets/photo-wall/13-Photo-13.jpg", ratio: 0.6664 },
  { src: "assets/photo-wall/14-Photo-14.jpg", ratio: 0.6664 },
  { src: "assets/photo-wall/15-Photo-15.jpg", ratio: 1.5006 },
  { src: "assets/photo-wall/16-Photo-16.jpg", ratio: 1.5006 },
  { src: "assets/photo-wall/17-Photo-17.jpg", ratio: 0.75 },
  { src: "assets/photo-wall/18-Photo-18.jpg", ratio: 1.5006 },
  { src: "assets/photo-wall/19-Photo-19.jpg", ratio: 1.5006 },
  { src: "assets/photo-wall/20-Photo-20.jpg", ratio: 0.6664 },
];

const rowTypes = [
  "small",
  "wide",
  "square",
  "poster",
  "small",
  "feature",
  "wide",
  "square",
  "small",
  "poster",
  "wide",
  "small",
  "square",
];

const rowHeights = {
  small: 46,
  wide: 56,
  square: 52,
  poster: 70,
  feature: 76,
};

const canvas = document.querySelector("#globe-canvas");
const wall = document.querySelector("#wall");
const input = document.querySelector("#photo-input");
const resetButton = document.querySelector("#reset-photos");
const countOutput = document.querySelector("#photo-count");

const dbName = "team-thunder-photo-wall";
const storeName = "photos";
const zoomLimits = { min: 0.65, max: 5.6 };
const defaultView = { x: 0, y: 0, zoom: 0.92, rotate: 0 };
const pointerState = new Map();

let gl;
let program;
let buffer;
let attribs;
let uniforms;
let customPhotos = [];
let photos = [];
let textures = [];
let meshRows = [];
let lastTime = 0;
let drag = null;
let gesture = null;
let orbit = 0;
let targetOrbit = 0;
let orbitVelocity = 0;
let devicePixelRatioUsed = 1;
let lastStats = {
  renderer: "webgl",
  count: 0,
  rows: 0,
  renderedTiles: 0,
  uniqueSrcs: 0,
  horizontalRepeats: 0,
  verticalRepeats: 0,
  zoom: defaultView.zoom,
  fps: 0,
};

const view = { ...defaultView };
const currentView = { ...defaultView };
const quad = new Float32Array(30);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredPhotos() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function writeStoredPhoto(photo) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(photo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearStoredPhotos() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function shortestAngleDelta(target, current) {
  let delta = target - current;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function positiveModulo(value, size) {
  return ((value % size) + size) % size;
}

function photoKey(photo) {
  return photo.id || photo.src;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function choosePhotoIndex(avoid, random) {
  const candidates = [];
  for (let index = 0; index < photos.length; index += 1) {
    if (!avoid.has(index)) candidates.push(index);
  }
  const pool = candidates.length ? candidates : photos.map((_, index) => index);
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function measureImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth / image.naturalHeight || 1);
    image.onerror = () => resolve(1);
    image.src = src;
  });
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
  }
  return shader;
}

function createProgram() {
  const vertex = createShader(gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    attribute float a_shade;
    varying vec2 v_uv;
    varying float v_shade;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = a_uv;
      v_shade = a_shade;
    }
  `);

  const fragment = createShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_uv;
    varying float v_shade;

    void main() {
      vec4 color = texture2D(u_texture, v_uv);
      gl_FragColor = vec4(color.rgb * v_shade, color.a);
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

function createPlaceholderTexture() {
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
    new Uint8Array([14, 20, 32, 255]),
  );
  return texture;
}

function loadTexture(photo) {
  const texture = createPlaceholderTexture();
  const record = { texture, ready: false, src: photo.src };
  const image = new Image();
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
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
  image.src = photo.src;
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
    wall.innerHTML = `<div class="empty-state">WebGL unavailable</div>`;
    return false;
  }

  program = createProgram();
  buffer = gl.createBuffer();
  attribs = {
    position: gl.getAttribLocation(program, "a_position"),
    uv: gl.getAttribLocation(program, "a_uv"),
    shade: gl.getAttribLocation(program, "a_shade"),
  };
  uniforms = {
    texture: gl.getUniformLocation(program, "u_texture"),
  };

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(attribs.position);
  gl.enableVertexAttribArray(attribs.uv);
  gl.enableVertexAttribArray(attribs.shade);
  gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 20, 0);
  gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 20, 8);
  gl.vertexAttribPointer(attribs.shade, 1, gl.FLOAT, false, 20, 16);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

function buildMeshRows() {
  const random = makeRandom(20260625 + photos.length * 131);
  const columns = Math.max(96, photos.length * 5);
  const rows = rowTypes.map((type) => ({ type, tiles: [] }));

  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < columns; column += 1) {
      const avoid = new Set();
      const left = row.tiles[column - 1];
      if (left) avoid.add(left.photoIndex);
      const above = rows[rowIndex - 1]?.tiles || [];
      for (let offset = -3; offset <= 3; offset += 1) {
        const neighbor = above[column + offset];
        if (neighbor) avoid.add(neighbor.photoIndex);
      }
      const photoIndex = choosePhotoIndex(avoid, random);
      row.tiles.push({
        photoIndex,
        ratio: photos[photoIndex]?.ratio || 1,
        randomLift: (random() - 0.5) * 0.18,
      });
    }
  });

  rows.forEach((row, rowIndex) => {
    const baseHeight = rowHeights[row.type] || 56;
    let cursor = 0;
    row.tiles.forEach((tile) => {
      const tileWidth = Math.max(34, baseHeight * tile.ratio);
      tile.baseWidth = tileWidth;
      tile.baseHeight = baseHeight;
      tile.center = cursor + tileWidth / 2;
      cursor += tileWidth + 3;
    });
    row.width = Math.max(1, cursor - 3);
    row.vertical = (rowIndex - (rows.length - 1) / 2) * 58;
  });

  meshRows = rows;
  lastStats.horizontalRepeats = countHorizontalRepeats(rows);
  lastStats.verticalRepeats = countVerticalRepeats(rows);
}

function countHorizontalRepeats(rows) {
  let repeats = 0;
  rows.forEach((row) => {
    for (let index = 1; index < row.tiles.length; index += 1) {
      if (row.tiles[index].photoIndex === row.tiles[index - 1].photoIndex) repeats += 1;
    }
  });
  return repeats;
}

function countVerticalRepeats(rows) {
  let repeats = 0;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex].tiles;
    const above = rows[rowIndex - 1].tiles;
    row.forEach((tile, index) => {
      for (let offset = -2; offset <= 2; offset += 1) {
        if (above[index + offset]?.photoIndex === tile.photoIndex) repeats += 1;
      }
    });
  }
  return repeats;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    devicePixelRatioUsed = dpr;
    gl.viewport(0, 0, width, height);
  }
}

function projectPoint(point, cameraDistance, centerX, centerY, screenRotation) {
  const depth = cameraDistance - point.z;
  const perspective = cameraDistance / Math.max(1, depth);
  let x = centerX + point.x * perspective;
  let y = centerY - point.y * perspective;

  if (screenRotation) {
    const dx = x - canvas.width / 2;
    const dy = y - canvas.height / 2;
    const cos = Math.cos(screenRotation);
    const sin = Math.sin(screenRotation);
    x = canvas.width / 2 + dx * cos - dy * sin;
    y = canvas.height / 2 + dx * sin + dy * cos;
  }

  return {
    x,
    y,
    clipX: (x / canvas.width) * 2 - 1,
    clipY: 1 - (y / canvas.height) * 2,
    perspective,
  };
}

function pushVertex(target, offset, point, uvX, uvY, shade) {
  target[offset] = point.clipX;
  target[offset + 1] = point.clipY;
  target[offset + 2] = uvX;
  target[offset + 3] = uvY;
  target[offset + 4] = shade;
}

function drawTile(renderTile) {
  const { points, texture, shade } = renderTile;
  pushVertex(quad, 0, points[0], 0, 0, shade);
  pushVertex(quad, 5, points[1], 1, 0, shade);
  pushVertex(quad, 10, points[2], 0, 1, shade);
  pushVertex(quad, 15, points[2], 0, 1, shade);
  pushVertex(quad, 20, points[1], 1, 0, shade);
  pushVertex(quad, 25, points[3], 1, 1, shade);

  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STREAM_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function getGlobeParameters() {
  const width = canvas.width;
  const height = canvas.height;
  const zoomProgress = smoothstep((currentView.zoom - zoomLimits.min) / (zoomLimits.max - zoomLimits.min));
  const baseRadius = Math.min(width, height) * 0.9;
  const radius = baseRadius * (1 + zoomProgress * 4.7);
  const tileScale = currentView.zoom / (1 + zoomProgress * 0.42);
  const centerX = width * 0.68 + currentView.x * devicePixelRatioUsed;
  const centerY = height * 0.53 + currentView.y * devicePixelRatioUsed;
  const cameraDistance = radius * (2.25 + zoomProgress * 2.1);

  return {
    width,
    height,
    zoomProgress,
    sphereStrength: 1 - zoomProgress,
    radius,
    tileScale,
    centerX,
    centerY,
    cameraDistance,
    screenRotation: currentView.rotate * Math.PI / 180,
  };
}

function renderScene(now) {
  resizeCanvas();
  const dt = lastTime ? Math.min(48, now - lastTime) : 16.67;
  lastTime = now;

  orbit += orbitVelocity * dt;
  targetOrbit = orbit;
  orbitVelocity *= Math.pow(0.944, dt / 16.67);
  if (Math.abs(orbitVelocity) < 0.004) orbitVelocity = 0;

  const ease = 1 - Math.exp(-dt / 70);
  currentView.x = lerp(currentView.x, view.x, ease);
  currentView.y = lerp(currentView.y, view.y, ease);
  currentView.zoom = lerp(currentView.zoom, view.zoom, ease);
  currentView.rotate += shortestAngleDelta(view.rotate, currentView.rotate) * ease;

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniform1i(uniforms.texture, 0);

  const params = getGlobeParameters();
  const rowGap = 5 * devicePixelRatioUsed;
  const drawQueue = [];
  const visiblePhotos = new Set();

  meshRows.forEach((row) => {
    const rowHeight = rowHeights[row.type] * devicePixelRatioUsed * params.tileScale;
    const rowArc = row.width * devicePixelRatioUsed * params.tileScale;
    const rowVertical = row.vertical * devicePixelRatioUsed * params.tileScale;
    const copyOffset = positiveModulo(orbit * devicePixelRatioUsed, rowArc);

    row.tiles.forEach((tile) => {
      const tileWidth = tile.baseWidth * devicePixelRatioUsed * params.tileScale;
      const tileHeight = rowHeight;
      const tileArcCenter = tile.center * devicePixelRatioUsed * params.tileScale;

      for (let copy = -2; copy <= 2; copy += 1) {
        const surfaceX = tileArcCenter + copy * rowArc - copyOffset - rowArc / 2;
        const latitude = clamp((rowVertical + tile.randomLift * rowHeight) / params.radius, -1.1, 1.1);
        const longitude = surfaceX / params.radius;
        if (Math.abs(longitude) > 1.72) continue;

        const sinLon = Math.sin(longitude);
        const cosLon = Math.cos(longitude);
        const sinLat = Math.sin(latitude);
        const cosLat = Math.cos(latitude);
        const normal = {
          x: cosLat * sinLon,
          y: sinLat,
          z: cosLat * cosLon,
        };
        if (normal.z < -0.08) continue;

        const center = {
          x: params.radius * normal.x,
          y: params.radius * normal.y,
          z: params.radius * normal.z,
        };
        const right = { x: cosLon, y: 0, z: -sinLon };
        const up = { x: -sinLat * sinLon, y: cosLat, z: -sinLat * cosLon };
        const halfW = tileWidth / 2;
        const halfH = tileHeight / 2;
        const corners = [
          {
            x: center.x - right.x * halfW - up.x * halfH,
            y: center.y - right.y * halfW - up.y * halfH,
            z: center.z - right.z * halfW - up.z * halfH,
          },
          {
            x: center.x + right.x * halfW - up.x * halfH,
            y: center.y + right.y * halfW - up.y * halfH,
            z: center.z + right.z * halfW - up.z * halfH,
          },
          {
            x: center.x - right.x * halfW + up.x * halfH,
            y: center.y - right.y * halfW + up.y * halfH,
            z: center.z - right.z * halfW + up.z * halfH,
          },
          {
            x: center.x + right.x * halfW + up.x * halfH,
            y: center.y + right.y * halfW + up.y * halfH,
            z: center.z + right.z * halfW + up.z * halfH,
          },
        ];

        const points = corners.map((corner) => projectPoint(corner, params.cameraDistance, params.centerX, params.centerY, params.screenRotation));
        const minX = Math.min(...points.map((point) => point.x));
        const maxX = Math.max(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y));
        const maxY = Math.max(...points.map((point) => point.y));
        if (maxX < -80 || minX > params.width + 80 || maxY < -80 || minY > params.height + 80) continue;

        const edge = clamp(Math.hypot(longitude / 1.34, latitude / 0.98), 0, 1);
        const shade = 0.54 + 0.46 * (normal.z * 0.72 + 0.28) * (1 - edge * 0.26);
        const texture = textures[tile.photoIndex] || textures[0];
        drawQueue.push({
          depth: center.z,
          points,
          texture,
          shade,
          photoIndex: tile.photoIndex,
        });
        visiblePhotos.add(tile.photoIndex);
      }
    });
  });

  drawQueue.sort((a, b) => a.depth - b.depth);
  drawQueue.forEach(drawTile);

  lastStats = {
    ...lastStats,
    renderer: "webgl",
    count: photos.length,
    rows: meshRows.length,
    renderedTiles: drawQueue.length,
    uniqueSrcs: visiblePhotos.size,
    zoom: Number(currentView.zoom.toFixed(3)),
    fps: Number((1000 / dt).toFixed(1)),
    horizontalRepeats: countHorizontalRepeats(meshRows),
    verticalRepeats: countVerticalRepeats(meshRows),
  };

  requestAnimationFrame(renderScene);
}

function rebuild() {
  photos = [...starterPhotos, ...customPhotos];
  countOutput.value = `${photos.length}`;
  textures = photos.map(loadTexture);
  buildMeshRows();
}

async function addFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const additions = [];
  for (const file of imageFiles) {
    const src = await fileToDataUrl(file);
    const ratio = await measureImage(src);
    const photo = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      src,
      ratio,
    };
    additions.push(photo);
    await writeStoredPhoto(photo);
  }

  customPhotos = [...customPhotos, ...additions];
  rebuild();
}

function getPointerPair() {
  return [...pointerState.values()].slice(0, 2);
}

function getGestureMetrics(points) {
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    distance: Math.hypot(dx, dy) || 1,
    centerX: (a.x + b.x) / 2,
    centerY: (a.y + b.y) / 2,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

function startGesture() {
  const points = getPointerPair();
  if (points.length < 2) return;
  const metrics = getGestureMetrics(points);
  gesture = {
    ...metrics,
    startX: view.x,
    startY: view.y,
    startZoom: view.zoom,
    startRotate: view.rotate,
  };
}

function updateGesture() {
  if (!gesture || pointerState.size < 2) return;
  const metrics = getGestureMetrics(getPointerPair());
  const nextZoom = clamp(gesture.startZoom * (metrics.distance / gesture.distance), zoomLimits.min, zoomLimits.max);
  const zoomDelta = nextZoom / gesture.startZoom;
  const originX = gesture.centerX - wall.clientWidth / 2;
  const originY = gesture.centerY - wall.clientHeight / 2;
  view.zoom = nextZoom;
  view.x = gesture.startX + metrics.centerX - gesture.centerX + originX * (1 - zoomDelta) * 0.16;
  view.y = gesture.startY + metrics.centerY - gesture.centerY + originY * (1 - zoomDelta) * 0.16;

  let angleDelta = metrics.angle - gesture.angle;
  if (angleDelta > 180) angleDelta -= 360;
  if (angleDelta < -180) angleDelta += 360;
  view.rotate = clamp(gesture.startRotate + angleDelta, -36, 36);
}

wall.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
  orbitVelocity = 0;
  const now = performance.now();
  if (pointerState.size === 1) {
    drag = {
      id: event.pointerId,
      x: event.clientX,
      lastX: event.clientX,
      lastTime: now,
      velocity: 0,
    };
  } else if (pointerState.size === 2) {
    drag = null;
    startGesture();
  }
  wall.classList.add("dragging");
  try {
    wall.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture can fail in synthetic browser tests.
  }
});

wall.addEventListener("pointermove", (event) => {
  if (!pointerState.has(event.pointerId)) return;
  pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointerState.size >= 2) {
    updateGesture();
    return;
  }
  if (!drag || drag.id !== event.pointerId) return;

  const now = performance.now();
  const dx = event.clientX - drag.lastX;
  const dt = Math.max(1, now - drag.lastTime);
  const movement = -dx * (1.8 / Math.max(0.7, currentView.zoom));
  orbit += movement;
  orbitVelocity = orbitVelocity * 0.68 + (movement / dt) * 0.32;
  drag.lastX = event.clientX;
  drag.lastTime = now;
  drag.velocity = orbitVelocity;
});

function stopPointer(event) {
  const endingDrag = drag && drag.id === event.pointerId ? drag : null;
  pointerState.delete(event.pointerId);
  if (pointerState.size >= 2) {
    startGesture();
    return;
  }
  if (pointerState.size === 1) {
    const [remaining] = pointerState.entries();
    drag = {
      id: remaining[0],
      x: remaining[1].x,
      lastX: remaining[1].x,
      lastTime: performance.now(),
      velocity: 0,
    };
    gesture = null;
    return;
  }
  if (endingDrag) orbitVelocity = endingDrag.velocity;
  drag = null;
  gesture = null;
  wall.classList.remove("dragging");
}

wall.addEventListener("pointerup", stopPointer);
wall.addEventListener("pointercancel", stopPointer);

wall.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const previousZoom = view.zoom;
    const nextZoom = clamp(view.zoom * (1 - event.deltaY * 0.0012), zoomLimits.min, zoomLimits.max);
    const zoomDelta = nextZoom / previousZoom;
    const rect = wall.getBoundingClientRect();
    const originX = event.clientX - rect.left - rect.width / 2;
    const originY = event.clientY - rect.top - rect.height / 2;
    view.zoom = nextZoom;
    view.x += originX * (1 - zoomDelta) * 0.18;
    view.y += originY * (1 - zoomDelta) * 0.18;
    return;
  }

  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.preventDefault();
    orbit += event.deltaY * 0.9;
    orbitVelocity = event.deltaY * 0.018;
  }
}, { passive: false });

input.addEventListener("change", async (event) => {
  await addFiles(event.target.files || []);
  input.value = "";
});

resetButton.addEventListener("click", async () => {
  customPhotos = [];
  await clearStoredPhotos();
  rebuild();
});

window.addEventListener("resize", resizeCanvas);

window.__photoGlobeDebug = () => ({ ...lastStats, webgl: Boolean(gl), canvasWidth: canvas.width, canvasHeight: canvas.height });

async function boot() {
  if (!initWebGl()) return;
  try {
    customPhotos = await readStoredPhotos();
  } catch {
    customPhotos = [];
  }
  rebuild();
  requestAnimationFrame(renderScene);
}

boot();
