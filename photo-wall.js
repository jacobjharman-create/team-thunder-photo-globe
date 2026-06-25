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
];

const rowPattern = ["size-small", "size-wide", "size-square", "size-poster", "size-small", "size-feature", "size-wide"];

const wall = document.querySelector("#wall");
const track = document.querySelector("#track");
const input = document.querySelector("#photo-input");
const resetButton = document.querySelector("#reset-photos");
const countOutput = document.querySelector("#photo-count");

const dbName = "team-thunder-photo-wall";
const storeName = "photos";
let customPhotos = [];
let photos = [];
let sequenceWidth = 0;
let raf = 0;
let drag = null;
let saveTimer = 0;
const activePointers = new Map();
const view = { x: 0, y: 0, scale: 1, rotate: 0 };
let gesture = null;
let spinRaf = 0;
let spinVelocity = 0;
let lastSpinTime = 0;

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

function render() {
  photos = [...starterPhotos, ...customPhotos];
  const sequence = buildSequence(photos);
  const markup = rowPattern
    .map((rowSize, rowIndex) => {
      const tiles = [0, 1, 2]
        .map((copy) =>
          sequence
            .map((_, index) => {
              const photo = sequence[(index + rowIndex * 3 + copy * 5) % sequence.length];
              const emphasis = (index + rowIndex) % 11 === 0 ? "is-center" : "";
              return `
                <figure class="tile ${rowSize} ${emphasis}" data-copy="${copy}" data-ratio="${photo.ratio || 1}">
                  <img src="${photo.src}" alt="Team Thunder wrestling photo" draggable="false" />
                </figure>
              `;
            })
            .join(""),
        )
        .join("");
      return `<div class="photo-row" style="--row-shift:${rowIndex * -34}px">${tiles}</div>`;
    })
    .join("");

  track.innerHTML = markup || `<div class="empty-state">Add photos</div>`;
  countOutput.value = `${photos.length}`;
  requestAnimationFrame(() => {
    syncTileWidths();
    measureSequence();
    wall.scrollLeft = sequenceWidth;
    updateCurve();
  });
}

function syncTileWidths() {
  track.querySelectorAll(".tile").forEach((tile) => {
    const ratio = Number(tile.dataset.ratio) || 1;
    tile.style.width = `${Math.max(36, tile.offsetHeight * ratio)}px`;
  });
}

function applyViewTransform() {
  track.style.setProperty("--view-x", `${view.x.toFixed(2)}px`);
  track.style.setProperty("--view-y", `${view.y.toFixed(2)}px`);
  track.style.setProperty("--view-scale", view.scale.toFixed(4));
  track.style.setProperty("--view-rotate", `${view.rotate.toFixed(2)}deg`);
  scheduleCurve();
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
  view.scale = Math.min(3.2, Math.max(0.45, gesture.startScale * (metrics.distance / gesture.distance)));
  view.x = gesture.startX + metrics.centerX - gesture.centerX;
  view.y = gesture.startY + metrics.centerY - gesture.centerY;
  let angleDelta = metrics.angle - gesture.angle;
  if (angleDelta > 180) angleDelta -= 360;
  if (angleDelta < -180) angleDelta += 360;
  view.rotate = Math.min(22, Math.max(-22, gesture.startRotate + angleDelta));
  applyViewTransform();
}

function stopSpin() {
  if (spinRaf) cancelAnimationFrame(spinRaf);
  spinRaf = 0;
  spinVelocity = 0;
}

function spinStep(now) {
  if (!lastSpinTime) lastSpinTime = now;
  const dt = Math.min(34, now - lastSpinTime);
  lastSpinTime = now;
  wall.scrollLeft += spinVelocity * dt;
  keepInfinite();
  scheduleCurve();
  spinVelocity *= Math.pow(0.94, dt / 16.67);
  if (Math.abs(spinVelocity) < 0.025) {
    stopSpin();
    return;
  }
  spinRaf = requestAnimationFrame(spinStep);
}

function startSpin(velocity) {
  stopSpin();
  spinVelocity = velocity;
  lastSpinTime = 0;
  if (Math.abs(spinVelocity) >= 0.025) {
    spinRaf = requestAnimationFrame(spinStep);
  }
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
  const center = rect.left + rect.width / 2;
  const radius = rect.width * 1.18;

  tiles.forEach((tile) => {
    const box = tile.getBoundingClientRect();
    const tileCenter = box.left + box.width / 2;
    const distance = (tileCenter - center) / radius;
    const clamped = Math.max(-1.18, Math.min(1.18, distance));
    const abs = Math.abs(clamped);
    const rotate = clamped * -28;
    const z = 96 * (1 - abs) - 58 * abs;
    const scale = 0.92 + 0.08 * (1 - abs);
    const lift = Math.sin(clamped * Math.PI) * -6;
    const brightness = 0.72 + 0.28 * (1 - abs * 0.55);

    tile.style.setProperty("--rotate", `${rotate.toFixed(2)}deg`);
    tile.style.setProperty("--z", `${z.toFixed(2)}px`);
    tile.style.setProperty("--scale", scale.toFixed(3));
    tile.style.setProperty("--lift", `${lift.toFixed(2)}px`);
    tile.style.filter = `brightness(${brightness.toFixed(3)}) saturate(1.12)`;
    tile.style.zIndex = String(Math.round((1 - abs) * 1000));
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
    view.scale = Math.min(3.2, Math.max(0.45, view.scale * (1 + delta)));
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
      scrollLeft: wall.scrollLeft,
      lastX: event.clientX,
      lastScrollLeft: wall.scrollLeft,
      lastTime: now,
      velocity: 0,
    };
  } else if (activePointers.size === 2) {
    drag = null;
    startGesture();
  }
  wall.classList.add("dragging");
  wall.setPointerCapture(event.pointerId);
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
  drag.velocity = (nextScrollLeft - drag.lastScrollLeft) / dt;
  drag.lastX = event.clientX;
  drag.lastScrollLeft = nextScrollLeft;
  drag.lastTime = now;
  wall.scrollLeft = nextScrollLeft;
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
      scrollLeft: wall.scrollLeft,
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
