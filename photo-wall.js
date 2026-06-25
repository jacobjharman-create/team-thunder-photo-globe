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

const rowPattern = [
  "size-small",
  "size-wide",
  "size-square",
  "size-poster",
  "size-small",
  "size-feature",
  "size-wide",
  "size-square",
  "size-small",
  "size-poster",
  "size-wide",
  "size-small",
  "size-square",
];

const tileHeightUnits = {
  "size-small": 46,
  "size-wide": 56,
  "size-square": 52,
  "size-poster": 70,
  "size-feature": 76,
};

const wall = document.querySelector("#wall");
const track = document.querySelector("#track");
const input = document.querySelector("#photo-input");
const resetButton = document.querySelector("#reset-photos");
const countOutput = document.querySelector("#photo-count");
const defaultView = { x: 0, y: 0, scale: 0.88, rotate: 0 };
const zoomLimits = { min: 0.7, max: 5.5 };

const dbName = "team-thunder-photo-wall";
const storeName = "photos";
let customPhotos = [];
let photos = [];
let sequenceWidth = 0;
let raf = 0;
let drag = null;
let saveTimer = 0;
const activePointers = new Map();
const view = { ...defaultView };
const currentView = { ...defaultView };
let gesture = null;
let spinVelocity = 0;
let motionRaf = 0;
let lastMotionTime = 0;
let repairTimer = 0;

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

function buildSequence(sourcePhotos) {
  const minimum = 30;
  const repeated = [];
  while (repeated.length < minimum) {
    sourcePhotos.forEach((photo) => repeated.push(photo));
  }
  return repeated;
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

function choosePhoto(sourcePhotos, avoidKeys, random) {
  const candidates = sourcePhotos.filter((photo) => !avoidKeys.has(photoKey(photo)));
  const pool = candidates.length ? candidates : sourcePhotos;
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function buildMeshRows(sourcePhotos) {
  const random = makeRandom(20260625 + sourcePhotos.length * 97);
  const columnsPerCopy = Math.max(18, sourcePhotos.length * 2);
  const rows = rowPattern.map(() => []);

  for (let rowIndex = 0; rowIndex < rowPattern.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnsPerCopy * 3; columnIndex += 1) {
      const avoid = new Set();
      const left = rows[rowIndex][columnIndex - 1];
      const nearbyAbove = rows[rowIndex - 1]?.slice(Math.max(0, columnIndex - 8), columnIndex + 9) || [];
      [left, ...nearbyAbove].forEach((photo) => {
        if (photo) avoid.add(photoKey(photo));
      });
      rows[rowIndex].push(choosePhoto(sourcePhotos, avoid, random));
    }
  }

  removeVisualRepeats(rows, sourcePhotos, random);
  return { columnsPerCopy, rows };
}

function estimateRowLayout(row, rowSize) {
  const tileHeight = tileHeightUnits[rowSize] || 56;
  const gap = 1;
  let left = 0;
  const tiles = row.map((photo, index) => {
    const width = Math.max(36, tileHeight * (photo.ratio || 1));
    const tile = { photo, index, left, right: left + width };
    left += width + gap;
    return tile;
  });
  const rowWidth = Math.max(0, left - gap);
  const centerOffset = -rowWidth / 2;

  return tiles.map((tile) => ({
    ...tile,
    left: tile.left + centerOffset,
    right: tile.right + centerOffset,
  }));
}

function findVisualAvoidKeys(layouts, rows, rowIndex, columnIndex) {
  const avoid = new Set();
  const current = layouts[rowIndex][columnIndex];
  const paddedLeft = current.left - 2;
  const paddedRight = current.right + 2;
  const sameRowNeighbors = [
    rows[rowIndex][columnIndex - 1],
    rows[rowIndex][columnIndex + 1],
  ];

  sameRowNeighbors.forEach((photo) => {
    if (photo) avoid.add(photoKey(photo));
  });

  [rowIndex - 1, rowIndex + 1].forEach((nearRowIndex) => {
    const nearLayout = layouts[nearRowIndex];
    if (!nearLayout) return;
    nearLayout.forEach((tile) => {
      if (tile.right >= paddedLeft && tile.left <= paddedRight) {
        avoid.add(photoKey(tile.photo));
      }
    });
  });

  return avoid;
}

function hasVisualRepeat(layouts, rows, rowIndex, columnIndex) {
  const key = photoKey(rows[rowIndex][columnIndex]);
  return findVisualAvoidKeys(layouts, rows, rowIndex, columnIndex).has(key);
}

function buildLayouts(rows) {
  return rows.map((row, index) => estimateRowLayout(row, rowPattern[index]));
}

function removeVisualRepeats(rows, sourcePhotos, random) {
  const maxPasses = 10;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    const layouts = buildLayouts(rows);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
        if (!hasVisualRepeat(layouts, rows, rowIndex, columnIndex)) continue;

        const avoid = findVisualAvoidKeys(layouts, rows, rowIndex, columnIndex);
        rows[rowIndex][columnIndex] = choosePhoto(sourcePhotos, avoid, random);
        changed = true;
      }
    }

    if (!changed) break;
  }
}

function render() {
  photos = [...starterPhotos, ...customPhotos];
  const sequence = buildSequence(photos);
  const mesh = buildMeshRows(sequence);
  const photoIndexes = new Map(photos.map((photo, index) => [photoKey(photo), index]));
  const markup = rowPattern
    .map((rowSize, rowIndex) => {
      const tiles = mesh.rows[rowIndex]
        .map((photo, index) => {
              const copy = Math.floor(index / mesh.columnsPerCopy);
              const emphasis = (index + rowIndex) % 11 === 0 ? "is-center" : "";
              const photoIndex = photoIndexes.get(photoKey(photo)) || 0;
              return `
                <figure class="tile ${rowSize} ${emphasis}" data-copy="${copy}" data-photo-index="${photoIndex}" data-ratio="${photo.ratio || 1}">
                  <img src="${photo.src}" alt="Team Thunder wrestling photo" decoding="async" draggable="false" />
                </figure>
              `;
            })
        .join("");
      return `<div class="photo-row">${tiles}</div>`;
    })
    .join("");

  track.innerHTML = markup || `<div class="empty-state">Add photos</div>`;
  countOutput.value = `${photos.length}`;
  requestAnimationFrame(() => {
    syncTileWidths();
    measureSequence();
    wall.scrollLeft = sequenceWidth;
    Object.assign(currentView, view);
    writeViewTransform();
    updateCurve();
    repairRenderedRepeats();
    syncTileWidths();
    measureSequence();
    updateCurve();
  });
}

function syncTileWidths() {
  track.querySelectorAll(".tile").forEach((tile) => {
    const ratio = Number(tile.dataset.ratio) || 1;
    tile.style.width = `${Math.max(36, tile.offsetHeight * ratio)}px`;
  });
}

function tilePhotoIndex(tile) {
  return Number(tile.dataset.photoIndex) || 0;
}

function applyPhotoToTile(tile, photoIndex) {
  const photo = photos[photoIndex];
  if (!photo) return;
  tile.dataset.photoIndex = `${photoIndex}`;
  tile.dataset.ratio = `${photo.ratio || 1}`;
  const image = tile.querySelector("img");
  if (image) image.src = photo.src;
}

function findRenderedAvoidIndexes(rowTiles, rowIndex, tileIndex, rects) {
  const avoid = new Set();
  const tile = rowTiles[rowIndex][tileIndex];
  const tileRect = rects.get(tile);
  const left = rowTiles[rowIndex][tileIndex - 1];
  const right = rowTiles[rowIndex][tileIndex + 1];

  [left, right].forEach((neighbor) => {
    if (neighbor) avoid.add(tilePhotoIndex(neighbor));
  });

  [rowIndex - 1, rowIndex + 1].forEach((nearRowIndex) => {
    const nearRow = rowTiles[nearRowIndex];
    if (!nearRow || !tileRect) return;
    nearRow.forEach((neighbor) => {
      const nearRect = rects.get(neighbor);
      if (!nearRect) return;
      const horizontalOverlap = Math.min(tileRect.right, nearRect.right) - Math.max(tileRect.left, nearRect.left);
      if (horizontalOverlap > 1) avoid.add(tilePhotoIndex(neighbor));
    });
  });

  return avoid;
}

function findReplacementIndex(avoid, seed) {
  if (!photos.length) return 0;
  const start = seed % photos.length;
  for (let offset = 0; offset < photos.length; offset += 1) {
    const index = (start + offset) % photos.length;
    if (!avoid.has(index)) return index;
  }
  return start;
}

function repairRenderedRepeats() {
  if (photos.length < 2) return;
  const maxPasses = 8;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const rowTiles = [...track.querySelectorAll(".photo-row")].map((row) => [...row.querySelectorAll(".tile")]);
    const rects = new Map();
    rowTiles.flat().forEach((tile) => rects.set(tile, tile.getBoundingClientRect()));
    let changed = false;

    for (let rowIndex = 0; rowIndex < rowTiles.length; rowIndex += 1) {
      for (let tileIndex = 0; tileIndex < rowTiles[rowIndex].length; tileIndex += 1) {
        const tile = rowTiles[rowIndex][tileIndex];
        const currentIndex = tilePhotoIndex(tile);
        const avoid = findRenderedAvoidIndexes(rowTiles, rowIndex, tileIndex, rects);
        if (!avoid.has(currentIndex)) continue;

        const replacement = findReplacementIndex(avoid, currentIndex + rowIndex + tileIndex + pass);
        if (replacement === currentIndex) continue;
        applyPhotoToTile(tile, replacement);
        changed = true;
      }
    }

    if (!changed) break;
    syncTileWidths();
    updateCurve();
  }
}

function scheduleRenderedRepair() {
  clearTimeout(repairTimer);
  repairTimer = setTimeout(() => {
    repairTimer = 0;
    repairRenderedRepeats();
    syncTileWidths();
    measureSequence();
    updateCurve();
  }, 180);
}

function applyViewTransform() {
  requestMotion();
}

function writeViewTransform() {
  track.style.setProperty("--origin-x", `${(wall.scrollLeft + wall.clientWidth / 2).toFixed(2)}px`);
  track.style.setProperty("--view-x", `${currentView.x.toFixed(2)}px`);
  track.style.setProperty("--view-y", `${currentView.y.toFixed(2)}px`);
  track.style.setProperty("--view-scale", currentView.scale.toFixed(4));
  track.style.setProperty("--view-rotate", `${currentView.rotate.toFixed(2)}deg`);
  scheduleCurve();
  scheduleRenderedRepair();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortestAngleDelta(target, current) {
  let delta = target - current;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clampViewTarget() {
  view.scale = clamp(view.scale, zoomLimits.min, zoomLimits.max);
  view.rotate = clamp(view.rotate, -34, 34);

  const rect = wall.getBoundingClientRect();
  const scaledExtraX = Math.max(0, rect.width * (view.scale - 1));
  const scaledExtraY = Math.max(0, rect.height * (view.scale - 1));
  const maxX = rect.width * 0.42 + scaledExtraX * 0.34;
  const maxY = rect.height * 0.42 + scaledExtraY * 0.34;
  view.x = clamp(view.x, -maxX, maxX);
  view.y = clamp(view.y, -maxY, maxY);
}

function requestMotion() {
  if (!motionRaf) motionRaf = requestAnimationFrame(motionStep);
}

function motionStep(now) {
  if (!lastMotionTime) lastMotionTime = now;
  const dt = Math.min(40, now - lastMotionTime);
  lastMotionTime = now;

  if (Math.abs(spinVelocity) > 0.001) {
    wall.scrollLeft += spinVelocity * dt;
    keepInfinite();
    spinVelocity *= Math.pow(0.955, dt / 16.67);
    if (Math.abs(spinVelocity) < 0.012) spinVelocity = 0;
  }

  const ease = 1 - Math.exp(-dt / 58);
  currentView.x = lerp(currentView.x, view.x, ease);
  currentView.y = lerp(currentView.y, view.y, ease);
  currentView.scale = lerp(currentView.scale, view.scale, ease);
  currentView.rotate += shortestAngleDelta(view.rotate, currentView.rotate) * ease;
  writeViewTransform();

  const viewSettled =
    Math.abs(currentView.x - view.x) < 0.05 &&
    Math.abs(currentView.y - view.y) < 0.05 &&
    Math.abs(currentView.scale - view.scale) < 0.001 &&
    Math.abs(currentView.rotate - view.rotate) < 0.03;

  if (spinVelocity || activePointers.size || !viewSettled) {
    motionRaf = requestAnimationFrame(motionStep);
    return;
  }

  motionRaf = 0;
  lastMotionTime = 0;
}

function getPointerPair() {
  return [...activePointers.values()].slice(0, 2);
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
    startScale: view.scale,
    startRotate: view.rotate,
  };
}

function updateGesture() {
  if (!gesture || activePointers.size < 2) return;
  const metrics = getGestureMetrics(getPointerPair());
  const nextScale = clamp(gesture.startScale * (metrics.distance / gesture.distance), zoomLimits.min, zoomLimits.max);
  const scaleDelta = nextScale / gesture.startScale;
  const originX = gesture.centerX - wall.clientWidth / 2;
  const originY = gesture.centerY - wall.clientHeight / 2;
  view.scale = nextScale;
  view.x = gesture.startX + metrics.centerX - gesture.centerX;
  view.y = gesture.startY + metrics.centerY - gesture.centerY;
  view.x += originX * (1 - scaleDelta) * 0.18;
  view.y += originY * (1 - scaleDelta) * 0.18;
  let angleDelta = metrics.angle - gesture.angle;
  if (angleDelta > 180) angleDelta -= 360;
  if (angleDelta < -180) angleDelta += 360;
  view.rotate = clamp(gesture.startRotate + angleDelta, -34, 34);
  clampViewTarget();
  applyViewTransform();
}

function stopSpin() {
  spinVelocity = 0;
}

function startSpin(velocity) {
  stopSpin();
  spinVelocity = clamp(velocity, -5.2, 5.2);
  if (Math.abs(spinVelocity) >= 0.012) requestMotion();
}

function measureSequence() {
  const secondCopy = track.querySelector('.photo-row [data-copy="1"]');
  const thirdCopy = track.querySelector('.photo-row [data-copy="2"]');
  if (!secondCopy || !thirdCopy) {
    sequenceWidth = track.scrollWidth / 3;
    return;
  }
  sequenceWidth = thirdCopy.offsetLeft - secondCopy.offsetLeft;
}

function keepInfinite() {
  if (!sequenceWidth) return;
  if (wall.scrollLeft < sequenceWidth * 0.38) {
    wall.scrollLeft += sequenceWidth;
  } else if (wall.scrollLeft > sequenceWidth * 1.62) {
    wall.scrollLeft -= sequenceWidth;
  }
}

function updateCurve() {
  raf = 0;
  keepInfinite();
  const tiles = track.querySelectorAll(".tile");
  const rect = wall.getBoundingClientRect();
  track.style.setProperty("--origin-x", `${(wall.scrollLeft + rect.width / 2).toFixed(2)}px`);
  const centerX = wall.scrollLeft + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const zoomProgress = smoothstep((currentView.scale - zoomLimits.min) / (zoomLimits.max - zoomLimits.min));
  const sphere = 1 - zoomProgress;
  const radiusX = rect.width * (0.42 + zoomProgress * 1.45);
  const radiusY = rect.height * (0.36 + zoomProgress * 1.35);
  const maxRotateY = 18 + sphere * 62;
  const maxRotateX = 8 + sphere * 40;
  const frontDepth = 34 + sphere * 74;
  const backDepth = 58 + sphere * 300;
  const edgeScaleDrop = 0.025 + sphere * 0.16;

  tiles.forEach((tile) => {
    const row = tile.parentElement;
    const tileCenterX = (row?.offsetLeft || 0) + tile.offsetLeft + tile.offsetWidth / 2;
    const tileRect = tile.getBoundingClientRect();
    const tileCenterY = tileRect.top + tileRect.height / 2;
    const xDistance = (tileCenterX - centerX) / radiusX;
    const yDistance = (tileCenterY - centerY) / radiusY;
    const clampedX = clamp(xDistance, -1.24, 1.24);
    const clampedY = clamp(yDistance, -1.1, 1.1);
    const radial = clamp(Math.hypot(clampedX, clampedY), 0, 1.28);
    const edge = Math.min(1, radial);
    const rotate = clampedX * -maxRotateY;
    const rotateX = clampedY * maxRotateX;
    const z = frontDepth * (1 - edge) - backDepth * edge;
    const scale = 1 - edge * edgeScaleDrop;
    const lift = clampedY * sphere * -18 + Math.sin(clampedX * Math.PI) * sphere * -5;
    const brightness = 0.72 + 0.28 * (1 - edge * 0.52);

    tile.style.setProperty("--rotate", `${rotate.toFixed(2)}deg`);
    tile.style.setProperty("--rotate-x", `${rotateX.toFixed(2)}deg`);
    tile.style.setProperty("--z", `${z.toFixed(2)}px`);
    tile.style.setProperty("--scale", scale.toFixed(3));
    tile.style.setProperty("--lift", `${lift.toFixed(2)}px`);
    tile.style.filter = `brightness(${brightness.toFixed(3)}) saturate(1.12)`;
    tile.style.zIndex = String(Math.round((1 - edge) * 1000));
  });
}

function scheduleCurve() {
  if (!raf) raf = requestAnimationFrame(updateCurve);
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
  render();
}

input.addEventListener("change", async (event) => {
  await addFiles(event.target.files || []);
  input.value = "";
});

resetButton.addEventListener("click", async () => {
  customPhotos = [];
  await clearStoredPhotos();
  render();
});

wall.addEventListener("scroll", scheduleCurve, { passive: true });
window.addEventListener("resize", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    syncTileWidths();
    measureSequence();
    scheduleCurve();
  }, 120);
});

wall.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const delta = -event.deltaY * 0.0012;
    const previousScale = view.scale;
    const nextScale = clamp(view.scale * (1 + delta), zoomLimits.min, zoomLimits.max);
    const scaleDelta = nextScale / previousScale;
    const rect = wall.getBoundingClientRect();
    const originX = event.clientX - rect.left - rect.width / 2;
    const originY = event.clientY - rect.top - rect.height / 2;
    view.scale = nextScale;
    view.x += originX * (1 - scaleDelta) * 0.22;
    view.y += originY * (1 - scaleDelta) * 0.22;
    clampViewTarget();
    applyViewTransform();
    return;
  }
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  wall.scrollLeft += event.deltaY;
}, { passive: false });

wall.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  stopSpin();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const now = performance.now();
  if (activePointers.size === 1) {
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: wall.scrollLeft,
      lastX: event.clientX,
      lastY: event.clientY,
      lastScrollLeft: wall.scrollLeft,
      lastTime: now,
      velocity: 0,
    };
  } else if (activePointers.size === 2) {
    drag = null;
    startGesture();
  }
  wall.classList.add("dragging");
  try {
    wall.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic pointer tests do not always register an active pointer capture target.
  }
});

wall.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size >= 2) {
    updateGesture();
    return;
  }
  if (!drag || drag.id !== event.pointerId) return;
  const now = performance.now();
  const delta = event.clientX - drag.x;
  const nextScrollLeft = drag.scrollLeft - delta;
  const dt = Math.max(1, now - drag.lastTime);
  const instantVelocity = (nextScrollLeft - drag.lastScrollLeft) / dt;
  drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  drag.lastScrollLeft = nextScrollLeft;
  drag.lastTime = now;
  wall.scrollLeft = nextScrollLeft;
  scheduleCurve();
});

function stopDrag(event) {
  const endingDrag = drag && drag.id === event.pointerId ? drag : null;
  activePointers.delete(event.pointerId);
  if (activePointers.size >= 2) {
    startGesture();
    return;
  }
  if (activePointers.size === 1) {
    const [remaining] = activePointers.entries();
    drag = {
      id: remaining[0],
      x: remaining[1].x,
      y: remaining[1].y,
      scrollLeft: wall.scrollLeft,
      lastX: remaining[1].x,
      lastY: remaining[1].y,
      lastScrollLeft: wall.scrollLeft,
      lastTime: performance.now(),
      velocity: 0,
    };
    gesture = null;
    return;
  }
  drag = null;
  gesture = null;
  wall.classList.remove("dragging");
  if (endingDrag) startSpin(endingDrag.velocity);
}

wall.addEventListener("pointerup", stopDrag);
wall.addEventListener("pointercancel", stopDrag);

readStoredPhotos()
  .then((stored) => {
    customPhotos = stored;
    render();
  })
  .catch(() => {
    customPhotos = [];
    render();
  });
