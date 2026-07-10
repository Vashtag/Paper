const app = document.querySelector('#app');

if (!app) {
  throw new Error('Missing #app element.');
}

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');

if (!context) {
  throw new Error('Canvas 2D rendering is not supported in this browser.');
}

app.append(canvas);

const input = {
  pitchUp: false,
  pitchDown: false,
  restart: false,
};

const bounds = {
  width: window.innerWidth,
  height: window.innerHeight,
  groundY: window.innerHeight - 96,
  ceilingY: 60,
};

const chunkWidth = 520;
const chunkKeepBehind = 2;
const chunkKeepAhead = 8;

let chunks = [];
let lastTimestamp = performance.now();
let cameraX = 0;
let runDistance = 0;
let plane = createPlane();

function createPlane() {
  return {
    x: 160,
    y: Math.max(180, window.innerHeight * 0.42),
    velocityX: 265,
    velocityY: -10,
    pitch: -0.04,
    durability: 100,
    crashed: false,
    stall: 0,
    bestDistance: Number(localStorage.getItem('paper.bestDistance') ?? 0),
  };
}

function resizeCanvas() {
  const devicePixelRatio = window.devicePixelRatio || 1;
  bounds.width = window.innerWidth;
  bounds.height = window.innerHeight;
  bounds.groundY = bounds.height - 96;
  bounds.ceilingY = 60;

  canvas.width = Math.floor(bounds.width * devicePixelRatio);
  canvas.height = Math.floor(bounds.height * devicePixelRatio);
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function setKey(key, pressed) {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      input.pitchUp = pressed;
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
    case ' ':
      input.pitchDown = pressed;
      break;
    case 'r':
    case 'R':
      input.restart = pressed;
      break;
  }
}

function restartRun() {
  const bestDistance = plane.bestDistance;
  plane = createPlane();
  plane.bestDistance = bestDistance;
  cameraX = 0;
  runDistance = 0;
  chunks = createInitialChunks();
}

function update(deltaSeconds) {
  if (input.restart && plane.crashed) {
    restartRun();
    input.restart = false;
  }

  if (plane.crashed) {
    plane.velocityY += 720 * deltaSeconds;
    plane.y += plane.velocityY * deltaSeconds;
    plane.pitch += 2.4 * deltaSeconds;
    return;
  }

  const pitchTarget = input.pitchUp ? -0.92 : input.pitchDown ? 0.72 : -0.08;
  const pitchResponsiveness = input.pitchDown ? 6.5 : 4.25;
  plane.pitch += (pitchTarget - plane.pitch) * pitchResponsiveness * deltaSeconds;

  const speed = Math.hypot(plane.velocityX, plane.velocityY);
  const wind = getWindAt(plane.x, plane.y);
  const diveAcceleration = Math.max(0, Math.sin(plane.pitch)) * 360;
  const climbAngle = Math.max(0, -Math.sin(plane.pitch));
  const lift = climbAngle * speed * 1.55;
  const stallPressure = climbAngle > 0.48 && speed < 245 ? (0.48 + climbAngle) * 290 : 0;
  const drag = 0.985 - Math.max(0, speed - 380) * 0.000025;

  plane.velocityX += (42 + diveAcceleration - climbAngle * 78 + wind.x) * deltaSeconds;
  plane.velocityY += (285 - lift + stallPressure + wind.y) * deltaSeconds;
  plane.velocityX *= Math.pow(clamp(drag, 0.945, 0.992), deltaSeconds * 60);
  plane.velocityY *= Math.pow(0.991, deltaSeconds * 60);
  plane.velocityX = clamp(plane.velocityX, 150, 640);
  plane.velocityY = clamp(plane.velocityY, -430, 470);

  plane.x += plane.velocityX * deltaSeconds;
  plane.y += plane.velocityY * deltaSeconds;
  plane.stall = clamp(stallPressure / 320, 0, 1);
  cameraX = Math.max(0, plane.x - bounds.width * 0.28);
  runDistance = Math.max(runDistance, plane.x - 160);

  if (plane.y < bounds.ceilingY || plane.y > bounds.groundY) {
    crashPlane();
  }

  updateChunks();
  checkObstacleCollision();
}

function crashPlane() {
  plane.crashed = true;
  plane.durability = Math.max(0, plane.durability - 35);
  plane.bestDistance = Math.max(plane.bestDistance, Math.floor(runDistance));
  localStorage.setItem('paper.bestDistance', String(plane.bestDistance));
}

function render() {
  drawSky();
  drawParallax();
  drawWindZones();
  drawWorldSilhouettes();
  drawPlane();
  drawHud();
}

function drawSky() {
  const gradient = context.createLinearGradient(0, 0, 0, bounds.height);
  gradient.addColorStop(0, '#29334f');
  gradient.addColorStop(0.5, '#a76869');
  gradient.addColorStop(1, '#f2b36d');
  context.fillStyle = gradient;
  context.fillRect(0, 0, bounds.width, bounds.height);
}

function drawParallax() {
  drawLayer('#182039', 0.15, 170, 52, 0.8);
  drawLayer('#11172c', 0.32, 230, 76, 0.95);
}

function drawLayer(color, factor, baseY, amplitude, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(0, bounds.height);

  for (let screenX = -40; screenX <= bounds.width + 80; screenX += 80) {
    const worldX = screenX + cameraX * factor;
    const y = baseY + Math.sin(worldX * 0.006) * amplitude + Math.sin(worldX * 0.017) * 18;
    context.lineTo(screenX, y);
  }

  context.lineTo(bounds.width, bounds.height);
  context.closePath();
  context.fill();
  context.restore();
}

function drawWorldSilhouettes() {
  const groundScreenY = bounds.groundY;
  context.fillStyle = '#080b14';
  context.fillRect(0, groundScreenY, bounds.width, bounds.height - groundScreenY);
  context.fillRect(0, 0, bounds.width, bounds.ceilingY - 28);

  for (const chunk of chunks) {
    if (chunk.x + chunkWidth < cameraX - 80 || chunk.x > cameraX + bounds.width + 80) {
      continue;
    }

    drawChunkBackdrop(chunk);

    for (const obstacle of chunk.obstacles) {
      drawObstacle(obstacle);
    }
  }
}

function drawChunkBackdrop(chunk) {
  const screenX = chunk.x - cameraX;
  context.save();
  context.globalAlpha = 0.34;
  context.fillStyle = chunk.tint;
  context.fillRect(screenX, bounds.ceilingY - 28, chunkWidth, 18);
  context.fillRect(screenX, bounds.groundY, chunkWidth, 18);
  context.restore();
}

function drawObstacle(obstacle) {
  const screenX = obstacle.x - cameraX;
  context.fillStyle = obstacle.color;

  if (obstacle.kind === 'arch') {
    context.fillRect(screenX, obstacle.y, obstacle.width, obstacle.height);
    context.beginPath();
    context.arc(screenX + obstacle.width / 2, obstacle.y, obstacle.width / 2, Math.PI, 0);
    context.fill();
    return;
  }

  if (obstacle.kind === 'branch') {
    context.save();
    context.translate(screenX, obstacle.y);
    context.rotate(obstacle.rotation);
    context.fillRect(0, -obstacle.height / 2, obstacle.width, obstacle.height);
    context.restore();
    return;
  }

  context.fillRect(screenX, obstacle.y, obstacle.width, obstacle.height);
}

function drawWindZones() {
  for (const chunk of chunks) {
    for (const windZone of chunk.windZones) {
      if (windZone.x + windZone.width < cameraX || windZone.x > cameraX + bounds.width) {
        continue;
      }

      const screenX = windZone.x - cameraX;
      const gradient = context.createLinearGradient(screenX, windZone.y, screenX, windZone.y + windZone.height);
      gradient.addColorStop(0, 'rgba(255, 245, 214, 0)');
      gradient.addColorStop(0.5, windZone.color);
      gradient.addColorStop(1, 'rgba(255, 245, 214, 0)');

      context.save();
      context.fillStyle = gradient;
      context.fillRect(screenX, windZone.y, windZone.width, windZone.height);
      context.strokeStyle = 'rgba(255, 245, 214, 0.34)';
      context.lineWidth = 1.5;

      for (let x = screenX + 18; x < screenX + windZone.width; x += 34) {
        context.beginPath();
        context.moveTo(x, windZone.y + windZone.height * 0.75);
        context.quadraticCurveTo(x + 18, windZone.y + windZone.height * 0.35, x + 4, windZone.y + windZone.height * 0.12);
        context.stroke();
      }

      context.restore();
    }
  }
}

function drawPlane() {
  const screenX = plane.x - cameraX;
  const screenY = plane.y;

  context.save();
  context.translate(screenX, screenY);
  context.rotate(plane.pitch);
  context.shadowColor = 'rgba(255, 242, 203, 0.65)';
  context.shadowBlur = 16;
  context.fillStyle = plane.crashed ? '#d2c4ab' : '#fff5d6';
  context.strokeStyle = '#ad8f6a';
  context.lineWidth = 1.25;

  context.beginPath();
  context.moveTo(28, 0);
  context.lineTo(-24, -14);
  context.lineTo(-9, 0);
  context.lineTo(-24, 14);
  context.closePath();
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(28, 0);
  context.lineTo(-9, 0);
  context.lineTo(-24, -14);
  context.stroke();

  context.restore();
}

function drawHud() {
  const speed = Math.floor(Math.hypot(plane.velocityX, plane.velocityY));
  context.fillStyle = 'rgba(8, 11, 20, 0.58)';
  context.fillRect(20, 20, 330, plane.crashed ? 180 : 140);
  context.fillStyle = '#fff5d6';
  context.font = '600 18px Inter, system-ui, sans-serif';
  context.fillText(`Distance ${Math.floor(runDistance)} m`, 36, 52);
  context.fillText(`Best ${plane.bestDistance} m`, 36, 80);
  context.fillText(`Speed ${speed}`, 36, 108);
  context.fillText(`Chunk ${getCurrentChunkLabel()}`, 36, 136);

  if (plane.stall > 0.05) {
    context.fillStyle = `rgba(255, 229, 150, ${0.45 + plane.stall * 0.55})`;
    context.fillText('STALL — dive to recover', 36, 164);
  }

  if (plane.crashed) {
    context.fillStyle = '#fff5d6';
    context.font = '700 30px Inter, system-ui, sans-serif';
    context.fillText('Crashed!', bounds.width / 2 - 70, bounds.height / 2 - 16);
    context.font = '500 18px Inter, system-ui, sans-serif';
    context.fillText('Press R to fold again', bounds.width / 2 - 86, bounds.height / 2 + 20);
  }
}

function createInitialChunks() {
  const initialChunks = [];

  for (let index = 0; index < chunkKeepAhead; index += 1) {
    initialChunks.push(createChunk(index));
  }

  return initialChunks;
}

function updateChunks() {
  const playerChunkIndex = Math.floor(plane.x / chunkWidth);
  const firstChunkIndex = Math.max(0, playerChunkIndex - chunkKeepBehind);
  const lastChunkIndex = playerChunkIndex + chunkKeepAhead;

  chunks = chunks.filter((chunk) => chunk.index >= firstChunkIndex);

  const existingIndexes = new Set(chunks.map((chunk) => chunk.index));

  for (let index = firstChunkIndex; index <= lastChunkIndex; index += 1) {
    if (!existingIndexes.has(index)) {
      chunks.push(createChunk(index));
    }
  }

  chunks.sort((a, b) => a.index - b.index);
}

function createChunk(index) {
  const x = index * chunkWidth;
  const difficulty = clamp(index / 12, 0, 1);
  const style = getChunkStyle(index);
  const obstacleCount = index === 0 ? 1 : 2 + Math.floor(seededNoise(index + 4) * (2 + difficulty * 3));
  const obstacles = [];
  const windZones = [];

  for (let obstacleIndex = 0; obstacleIndex < obstacleCount; obstacleIndex += 1) {
    obstacles.push(createObstacle(index, obstacleIndex, x, difficulty, style));
  }

  if (index > 0 && seededNoise(index + 11) > 0.34) {
    windZones.push(createWindZone(index, x, difficulty));
  }

  return {
    index,
    x,
    label: style.label,
    tint: style.tint,
    obstacles,
    windZones,
  };
}

function getChunkStyle(index) {
  const styles = [
    { label: 'bedroom', tint: '#2c2340', color: '#080b14' },
    { label: 'hallway', tint: '#26304d', color: '#0a0d18' },
    { label: 'classroom', tint: '#38263a', color: '#0c1020' },
    { label: 'backyard', tint: '#1f332d', color: '#071009' },
    { label: 'rain glass', tint: '#1d3442', color: '#07101a' },
  ];

  return styles[Math.floor(seededNoise(index * 7 + 3) * styles.length)];
}

function createObstacle(chunkIndex, obstacleIndex, chunkX, difficulty, style) {
  const laneNoise = seededNoise(chunkIndex * 19 + obstacleIndex * 31);
  const sizeNoise = seededNoise(chunkIndex * 23 + obstacleIndex * 17);
  const localX = 120 + obstacleIndex * 130 + seededNoise(chunkIndex * 13 + obstacleIndex) * 70;
  const width = 32 + sizeNoise * 58 + difficulty * 26;
  const minGap = 185 - difficulty * 58;
  const height = 75 + seededNoise(chunkIndex * 29 + obstacleIndex * 5) * 135 + difficulty * 70;
  const fromCeiling = laneNoise > 0.52;
  const kind = laneNoise > 0.82 ? 'branch' : laneNoise > 0.68 ? 'arch' : 'block';

  if (kind === 'branch') {
    const y = bounds.ceilingY + 110 + seededNoise(chunkIndex * 37 + obstacleIndex) * (bounds.groundY - bounds.ceilingY - 220);

    return {
      kind,
      x: chunkX + localX,
      y,
      width: 140 + difficulty * 90,
      height: 18 + difficulty * 10,
      rotation: (seededNoise(chunkIndex * 41 + obstacleIndex) - 0.5) * 0.75,
      color: style.color,
    };
  }

  if (fromCeiling) {
    return {
      kind,
      x: chunkX + localX,
      y: bounds.ceilingY - 28,
      width,
      height: Math.min(height, bounds.groundY - bounds.ceilingY - minGap),
      color: style.color,
    };
  }

  const obstacleHeight = Math.min(height, bounds.groundY - bounds.ceilingY - minGap);

  return {
    kind,
    x: chunkX + localX,
    y: bounds.groundY - obstacleHeight,
    width,
    height: obstacleHeight,
    color: style.color,
  };
}

function createWindZone(index, chunkX, difficulty) {
  const isUpdraft = seededNoise(index * 43) > 0.28;
  const width = 86 + seededNoise(index * 47) * 110;
  const height = 150 + seededNoise(index * 53) * 140;

  return {
    x: chunkX + 80 + seededNoise(index * 59) * (chunkWidth - width - 120),
    y: bounds.ceilingY + 60 + seededNoise(index * 61) * Math.max(80, bounds.groundY - bounds.ceilingY - height - 100),
    width,
    height,
    xForce: isUpdraft ? 34 + difficulty * 28 : -24,
    yForce: isUpdraft ? -210 - difficulty * 90 : 170 + difficulty * 70,
    color: isUpdraft ? 'rgba(255, 245, 214, 0.16)' : 'rgba(78, 97, 137, 0.2)',
  };
}

function getWindAt(x, y) {
  const wind = { x: 0, y: 0 };

  for (const chunk of chunks) {
    for (const windZone of chunk.windZones) {
      if (x < windZone.x || x > windZone.x + windZone.width || y < windZone.y || y > windZone.y + windZone.height) {
        continue;
      }

      const centerX = windZone.x + windZone.width / 2;
      const centerY = windZone.y + windZone.height / 2;
      const horizontalFalloff = 1 - Math.abs(x - centerX) / (windZone.width / 2);
      const verticalFalloff = 1 - Math.abs(y - centerY) / (windZone.height / 2);
      const strength = clamp(Math.min(horizontalFalloff, verticalFalloff), 0, 1);
      wind.x += windZone.xForce * strength;
      wind.y += windZone.yForce * strength;
    }
  }

  return wind;
}

function checkObstacleCollision() {
  const noseX = plane.x + Math.cos(plane.pitch) * 24;
  const noseY = plane.y + Math.sin(plane.pitch) * 24;
  const radius = 15;

  for (const chunk of chunks) {
    for (const obstacle of chunk.obstacles) {
      if (obstacle.kind === 'branch') {
        if (pointNearRotatedRect(noseX, noseY, obstacle, radius)) {
          crashPlane();
          return;
        }

        continue;
      }

      if (
        noseX + radius > obstacle.x &&
        noseX - radius < obstacle.x + obstacle.width &&
        noseY + radius > obstacle.y &&
        noseY - radius < obstacle.y + obstacle.height
      ) {
        crashPlane();
        return;
      }
    }
  }
}

function pointNearRotatedRect(x, y, obstacle, padding) {
  const cos = Math.cos(-obstacle.rotation);
  const sin = Math.sin(-obstacle.rotation);
  const dx = x - obstacle.x;
  const dy = y - obstacle.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  return (
    localX > -padding &&
    localX < obstacle.width + padding &&
    localY > -obstacle.height / 2 - padding &&
    localY < obstacle.height / 2 + padding
  );
}

function getCurrentChunkLabel() {
  const currentChunk = chunks.find((chunk) => plane.x >= chunk.x && plane.x < chunk.x + chunkWidth);
  return currentChunk?.label ?? 'memory';
}

function tick(timestamp) {
  const deltaSeconds = Math.min(0.033, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  update(deltaSeconds);
  render();
  requestAnimationFrame(tick);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seededNoise(value) {
  const noise = Math.sin(value * 12.9898) * 43758.5453;
  return noise - Math.floor(noise);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => setKey(event.key, true));
window.addEventListener('keyup', (event) => setKey(event.key, false));

resizeCanvas();
chunks = createInitialChunks();
requestAnimationFrame(tick);
