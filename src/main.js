import { missions, moodPalettes } from './data.js';

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
  launch: false,
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
let particles = [];
let lastTimestamp = performance.now();
let cameraX = 0;
let runDistance = 0;
let gamePhase = 'briefing';
let plane = createPlane();
let runState = createRunState();

function createPlane() {
  return {
    x: 160,
    y: Math.max(180, window.innerHeight * 0.42),
    velocityX: 265,
    velocityY: -10,
    pitch: -0.04,
    durability: 100,
    invulnerableSeconds: 0,
    crashed: false,
    stall: 0,
    bestDistance: Number(localStorage.getItem('paper.bestDistance') ?? 0),
  };
}

function createRunState() {
  const mission = chooseMission();

  return {
    mission,
    delivered: false,
    deliveryBonus: 0,
    outcome: 'In flight',
    messageCondition: 100,
    confidence: 0,
    folds: [],
    stickers: [],
    pickupsCollected: 0,
    lastUpgradeText: mission.title,
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
  particles = createParticles();
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
    case 'Enter':
      input.launch = pressed;
      break;
  }
}

function restartRun() {
  const bestDistance = plane.bestDistance;
  plane = createPlane();
  plane.bestDistance = bestDistance;
  runState = createRunState();
  cameraX = 0;
  runDistance = 0;
  chunks = createInitialChunks();
  gamePhase = 'briefing';
}

function update(deltaSeconds) {
  if (gamePhase === 'briefing') {
    if (input.launch || input.pitchUp || input.pitchDown) {
      gamePhase = 'flying';
      runState.lastUpgradeText = 'Dive, lift, and deliver.';
      input.launch = false;
    }

    return;
  }

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

  plane.invulnerableSeconds = Math.max(0, plane.invulnerableSeconds - deltaSeconds);
  runState.confidence = clamp(runState.confidence + deltaSeconds * 1.8, 0, 100);

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

  checkDeliveryProgress();

  if (plane.y < bounds.ceilingY || plane.y > bounds.groundY) {
    crashPlane();
  }

  updateChunks();
  updateParticles(deltaSeconds);
  checkObstacleCollision();
  checkPickupCollection();
}

function crashPlane() {
  plane.crashed = true;
  gamePhase = 'crashed';
  plane.durability = Math.max(0, plane.durability - 35);
  runState.outcome = createMissionOutcome();
  plane.bestDistance = Math.max(plane.bestDistance, Math.floor(runDistance));
  localStorage.setItem('paper.bestDistance', String(plane.bestDistance));
}

function damagePlane(amount, messageAmount) {
  if (plane.invulnerableSeconds > 0 || plane.crashed) {
    return;
  }

  plane.durability = Math.max(0, plane.durability - amount);
  runState.messageCondition = Math.max(0, runState.messageCondition - messageAmount);
  runState.confidence = Math.max(0, runState.confidence - 22);
  plane.invulnerableSeconds = 0.9;
  plane.velocityX *= 0.62;
  plane.velocityY = Math.min(260, plane.velocityY + 130);
  plane.pitch += 0.35;
  runState.lastUpgradeText = messageAmount > amount ? 'The message got scuffed' : 'The plane crumpled';

  if (plane.durability <= 0 || runState.messageCondition <= 0) {
    crashPlane();
  }
}

function render() {
  drawSky();
  drawSunGlow();
  drawParallax();
  drawParticles('back');
  drawWindZones();
  drawWorldSilhouettes();
  drawDeliveryMarker();
  drawPickups();
  drawPlane();
  drawParticles('front');
  drawVignette();
  drawHud();
  drawBriefingOverlay();
}

function drawSky() {
  const palette = getMoodPalette();
  const gradient = context.createLinearGradient(0, 0, 0, bounds.height);
  gradient.addColorStop(0, palette.skyTop);
  gradient.addColorStop(0.5, palette.skyMid);
  gradient.addColorStop(1, palette.skyBottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, bounds.width, bounds.height);
}

function drawSunGlow() {
  const palette = getMoodPalette();
  const glowX = bounds.width * 0.72 - (cameraX * 0.035) % (bounds.width * 0.45);
  const glowY = bounds.height * 0.28;
  const glow = context.createRadialGradient(glowX, glowY, 12, glowX, glowY, bounds.width * 0.48);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, 'rgba(255, 245, 214, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, bounds.width, bounds.height);
}

function drawParallax() {
  const palette = getMoodPalette();
  drawLayer(palette.far, 0.12, 145, 42, 0.72);
  drawMemoryShapes(palette);
  drawLayer(palette.mid, 0.28, 230, 76, 0.92);
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

function drawMemoryShapes(palette) {
  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = palette.memory;

  for (let i = -1; i < 8; i += 1) {
    const worldX = Math.floor((cameraX * 0.2 + i * 260) / 260) * 260;
    const screenX = worldX - cameraX * 0.2;
    const y = 110 + seededNoise(worldX + 90) * 90;
    const width = 90 + seededNoise(worldX + 12) * 90;
    const height = 42 + seededNoise(worldX + 18) * 54;

    if (i % 3 === 0) {
      context.fillRect(screenX, y, width, height);
      context.fillRect(screenX + width * 0.15, y - height * 0.55, width * 0.7, height * 0.55);
    } else {
      context.beginPath();
      context.ellipse(screenX + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

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

function drawPickups() {
  for (const chunk of chunks) {
    for (const pickup of chunk.pickups) {
      if (pickup.collected || pickup.x < cameraX - 40 || pickup.x > cameraX + bounds.width + 40) {
        continue;
      }

      const screenX = pickup.x - cameraX;
      const pulse = Math.sin(performance.now() * 0.006 + pickup.x * 0.02) * 3;

      context.save();
      context.translate(screenX, pickup.y + pulse);
      context.shadowColor = pickup.color;
      context.shadowBlur = 14;
      context.fillStyle = pickup.color;

      if (pickup.type === 'fold') {
        context.beginPath();
        context.moveTo(0, -16);
        context.lineTo(18, 0);
        context.lineTo(0, 16);
        context.lineTo(-18, 0);
        context.closePath();
        context.fill();
      } else if (pickup.type === 'sticker') {
        drawStar(0, 0, 5, 17, 8);
      } else {
        context.fillRect(-13, -8, 26, 16);
        context.strokeStyle = '#fff5d6';
        context.strokeRect(-13, -8, 26, 16);
      }

      context.restore();
    }
  }
}

function drawStar(x, y, points, outerRadius, innerRadius) {
  context.beginPath();

  for (let point = 0; point < points * 2; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (point * Math.PI) / points;
    const starX = x + Math.cos(angle) * radius;
    const starY = y + Math.sin(angle) * radius;

    if (point === 0) {
      context.moveTo(starX, starY);
    } else {
      context.lineTo(starX, starY);
    }
  }

  context.closePath();
  context.fill();
}

function drawPlane() {
  const screenX = plane.x - cameraX;
  const screenY = plane.y;
  const damage = 1 - plane.durability / 100;
  const flicker = plane.invulnerableSeconds > 0 ? 0.55 + Math.sin(performance.now() * 0.04) * 0.25 : 1;

  context.save();
  context.translate(screenX, screenY);
  context.rotate(plane.pitch);
  context.globalAlpha = flicker;
  context.shadowColor = 'rgba(255, 242, 203, 0.65)';
  context.shadowBlur = 16;
  context.fillStyle = plane.crashed ? '#d2c4ab' : '#fff5d6';
  context.strokeStyle = '#ad8f6a';
  context.lineWidth = 1.25;

  context.beginPath();
  context.moveTo(28, 0);
  context.lineTo(-24, -14);
  context.lineTo(-9 + damage * 5, damage * 3);
  context.lineTo(-24, 14 - damage * 7);
  context.closePath();
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(28, 0);
  context.lineTo(-9, 0);
  context.lineTo(-24, -14);
  context.stroke();

  if (damage > 0.18) {
    context.strokeStyle = 'rgba(96, 67, 53, 0.75)';
    context.beginPath();
    context.moveTo(-4, -5);
    context.lineTo(5, 3);
    context.lineTo(0, 10);
    context.stroke();
  }

  context.restore();
}

function drawHud() {
  const speed = Math.floor(Math.hypot(plane.velocityX, plane.velocityY));
  context.fillStyle = 'rgba(8, 11, 20, 0.58)';
  context.fillRect(20, 20, 390, plane.crashed ? 284 : 232);
  context.fillStyle = '#fff5d6';
  context.font = '600 18px Inter, system-ui, sans-serif';
  context.fillText(runState.mission.title, 36, 52);
  context.font = '500 14px Inter, system-ui, sans-serif';
  context.fillText(runState.mission.hazard, 36, 76);
  context.font = '600 18px Inter, system-ui, sans-serif';
  context.fillText(`Distance ${Math.floor(runDistance)} / ${runState.mission.targetDistance} m`, 36, 108);
  context.fillText(`Best ${plane.bestDistance} m`, 36, 136);
  context.fillText(`Speed ${speed}`, 220, 136);
  context.fillText(`Chunk ${getCurrentChunkLabel()}`, 36, 164);
  context.fillText(`Plane ${Math.ceil(plane.durability)}%`, 36, 192);
  context.fillText(`Message ${Math.ceil(runState.messageCondition)}%`, 180, 192);

  if (plane.stall > 0.05) {
    context.fillStyle = `rgba(255, 229, 150, ${0.45 + plane.stall * 0.55})`;
    context.fillText('STALL — dive to recover', 36, 220);
  }

  context.fillStyle = '#ffe596';
  context.font = '500 15px Inter, system-ui, sans-serif';
  context.fillText(runState.lastUpgradeText, 36, 220);

  if (plane.crashed) {
    context.fillStyle = '#fff5d6';
    context.font = '700 30px Inter, system-ui, sans-serif';
    context.fillText('Crashed!', bounds.width / 2 - 70, bounds.height / 2 - 16);
    context.font = '500 18px Inter, system-ui, sans-serif';
    context.fillText('Press R to fold again', bounds.width / 2 - 86, bounds.height / 2 + 20);
    context.fillText(runState.outcome, bounds.width / 2 - 170, bounds.height / 2 + 52);
  }
}

function drawBriefingOverlay() {
  if (gamePhase !== 'briefing') {
    return;
  }

  context.save();
  context.fillStyle = 'rgba(8, 11, 20, 0.72)';
  context.fillRect(0, 0, bounds.width, bounds.height);

  const cardWidth = Math.min(620, bounds.width - 42);
  const cardX = (bounds.width - cardWidth) / 2;
  const cardY = Math.max(70, bounds.height * 0.16);

  context.fillStyle = 'rgba(255, 245, 214, 0.1)';
  context.strokeStyle = 'rgba(255, 245, 214, 0.38)';
  context.lineWidth = 2;
  roundRect(cardX, cardY, cardWidth, 360, 24);
  context.fill();
  context.stroke();

  context.fillStyle = '#fff5d6';
  context.font = '800 42px Inter, system-ui, sans-serif';
  context.fillText('Paper', cardX + 34, cardY + 64);

  context.font = '700 24px Inter, system-ui, sans-serif';
  context.fillText(runState.mission.title, cardX + 34, cardY + 112);

  context.font = '500 17px Inter, system-ui, sans-serif';
  wrapText(runState.mission.message, cardX + 34, cardY + 148, cardWidth - 68, 24);

  context.fillStyle = '#ffe596';
  context.font = '600 16px Inter, system-ui, sans-serif';
  context.fillText(`Target: ${runState.mission.targetDistance} m`, cardX + 34, cardY + 236);
  context.fillText(`Risk: ${runState.mission.hazard}`, cardX + 34, cardY + 264);

  context.fillStyle = '#fff5d6';
  context.font = '600 16px Inter, system-ui, sans-serif';
  context.fillText('Controls: W/↑ lift • S/↓/Space dive • R restart after crash', cardX + 34, cardY + 310);
  context.font = '800 20px Inter, system-ui, sans-serif';
  context.fillText('Press Enter, W, S, Space, or click to launch', cardX + 34, cardY + 344);

  context.restore();
}

function roundRect(x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (const word of words) {
    const testLine = `${line}${word} `;

    if (context.measureText(testLine).width > maxWidth && line !== '') {
      context.fillText(line, x, currentY);
      line = `${word} `;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  context.fillText(line, x, currentY);
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
  const pickups = [];

  for (let obstacleIndex = 0; obstacleIndex < obstacleCount; obstacleIndex += 1) {
    obstacles.push(createObstacle(index, obstacleIndex, x, difficulty, style));
  }

  if (index > 0 && seededNoise(index + 11) > 0.34) {
    windZones.push(createWindZone(index, x, difficulty));
  }

  if (index > 0 && seededNoise(index + 17) > 0.44) {
    pickups.push(createPickup(index, x));
  }

  return {
    index,
    x,
    label: style.label,
    tint: style.tint,
    obstacles,
    windZones,
    pickups,
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

function createPickup(index, chunkX) {
  const roll = seededNoise(index * 67);
  const type = roll > 0.68 ? 'sticker' : roll > 0.2 ? 'fold' : 'repair';
  const names = {
    fold: ['Wide Wing Fold', 'Tail Fin Fold', 'Reinforced Crease', 'Sharp Nose Fold'],
    sticker: ['Heart Sticker', 'Cloud Sticker', 'Star Sticker', 'Moon Sticker'],
    repair: ['Tape Patch', 'Sunbeam Drying', 'Gentle Refold'],
  };
  const palette = {
    fold: '#fff5d6',
    sticker: '#ffd36f',
    repair: '#b9f6ca',
  };

  return {
    type,
    name: names[type][Math.floor(seededNoise(index * 71) * names[type].length)],
    x: chunkX + 170 + seededNoise(index * 73) * 230,
    y: bounds.ceilingY + 90 + seededNoise(index * 79) * (bounds.groundY - bounds.ceilingY - 180),
    radius: 24,
    color: palette[type],
    collected: false,
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
          damagePlane(22, 12);
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
        damagePlane(28, 18);
        return;
      }
    }
  }
}

function checkPickupCollection() {
  for (const chunk of chunks) {
    for (const pickup of chunk.pickups) {
      if (pickup.collected) {
        continue;
      }

      const distance = Math.hypot(plane.x - pickup.x, plane.y - pickup.y);

      if (distance <= pickup.radius + 18) {
        collectPickup(pickup);
      }
    }
  }
}

function collectPickup(pickup) {
  pickup.collected = true;
  runState.pickupsCollected += 1;
  runState.confidence = clamp(runState.confidence + 18, 0, 100);
  runState.lastUpgradeText = pickup.name;

  if (pickup.type === 'fold') {
    runState.folds.push(pickup.name);
    plane.durability = clamp(plane.durability + 8, 0, 100);
    plane.velocityX += 24;
    return;
  }

  if (pickup.type === 'sticker') {
    runState.stickers.push(pickup.name);
    runState.messageCondition = clamp(runState.messageCondition + 10, 0, 100);
    plane.velocityY -= 42;
    return;
  }

  plane.durability = clamp(plane.durability + 18, 0, 100);
  runState.messageCondition = clamp(runState.messageCondition + 14, 0, 100);
}

function chooseMission() {
  const storedBest = Number(localStorage.getItem('paper.bestDistance') ?? 0);
  const index = Math.floor(storedBest / 350) % missions.length;
  return { ...missions[index] };
}

function checkDeliveryProgress() {
  if (runState.delivered || runDistance < runState.mission.targetDistance) {
    return;
  }

  runState.delivered = true;
  runState.deliveryBonus = Math.floor(runState.messageCondition + plane.durability * 0.5);
  runState.confidence = 100;
  runState.lastUpgradeText = 'Delivered! Keep riding the memory.';
}

function createMissionOutcome() {
  if (runState.delivered) {
    return `Delivered: ${runState.mission.title} (+${runState.deliveryBonus})`;
  }

  if (runState.messageCondition <= 0) {
    return `The ${runState.mission.title.toLowerCase()} became unreadable.`;
  }

  const remaining = Math.max(0, Math.ceil(runState.mission.targetDistance - runDistance));
  return `${remaining} m short of delivering ${runState.mission.title}.`;
}

function drawDeliveryMarker() {
  const markerX = 160 + runState.mission.targetDistance - cameraX;

  if (runState.delivered || markerX < -80 || markerX > bounds.width + 80) {
    return;
  }

  context.save();
  context.globalAlpha = 0.78;
  context.strokeStyle = '#fff5d6';
  context.fillStyle = 'rgba(255, 245, 214, 0.16)';
  context.lineWidth = 2;
  context.setLineDash([8, 10]);
  context.beginPath();
  context.moveTo(markerX, bounds.ceilingY + 18);
  context.lineTo(markerX, bounds.groundY - 18);
  context.stroke();
  context.setLineDash([]);
  context.fillRect(markerX - 44, bounds.ceilingY + 28, 88, 30);
  context.fillStyle = '#fff5d6';
  context.font = '700 14px Inter, system-ui, sans-serif';
  context.fillText('DELIVER', markerX - 31, bounds.ceilingY + 49);
  context.restore();
}

function createParticles() {
  const particleCount = Math.max(45, Math.floor((bounds.width * bounds.height) / 19000));
  const newParticles = [];

  for (let index = 0; index < particleCount; index += 1) {
    newParticles.push(createParticle(index, Math.random() * bounds.width));
  }

  return newParticles;
}

function createParticle(index, initialX = bounds.width + 40) {
  const typeRoll = seededNoise(index * 101 + runDistance * 0.003);
  const type = typeRoll > 0.78 ? 'scrap' : typeRoll > 0.55 ? 'leaf' : 'dust';

  return {
    type,
    layer: type === 'dust' ? 'back' : 'front',
    x: initialX,
    y: 40 + Math.random() * (bounds.height - 150),
    drift: 8 + Math.random() * 34,
    fall: type === 'dust' ? -2 + Math.random() * 5 : 10 + Math.random() * 28,
    size: type === 'dust' ? 1 + Math.random() * 2 : 4 + Math.random() * 6,
    spin: Math.random() * Math.PI * 2,
    spinSpeed: -1.4 + Math.random() * 2.8,
    alpha: type === 'dust' ? 0.18 + Math.random() * 0.3 : 0.34 + Math.random() * 0.28,
  };
}

function updateParticles(deltaSeconds) {
  for (const particle of particles) {
    particle.x -= (particle.drift + plane.velocityX * 0.045) * deltaSeconds;
    particle.y += particle.fall * deltaSeconds + Math.sin(performance.now() * 0.001 + particle.x * 0.02) * 0.08;
    particle.spin += particle.spinSpeed * deltaSeconds;

    if (particle.x < -40 || particle.y > bounds.height + 40 || particle.y < -40) {
      const replacement = createParticle(Math.floor(Math.random() * 10000));
      Object.assign(particle, replacement, {
        x: bounds.width + 40 + Math.random() * 100,
      });
    }
  }
}

function drawParticles(layer) {
  const palette = getMoodPalette();

  context.save();

  for (const particle of particles) {
    if (particle.layer !== layer) {
      continue;
    }

    context.globalAlpha = particle.alpha;
    context.translate(particle.x, particle.y);
    context.rotate(particle.spin);

    if (particle.type === 'dust') {
      context.fillStyle = palette.particle;
      context.beginPath();
      context.arc(0, 0, particle.size, 0, Math.PI * 2);
      context.fill();
    } else if (particle.type === 'leaf') {
      context.fillStyle = palette.leaf;
      context.beginPath();
      context.ellipse(0, 0, particle.size * 1.4, particle.size * 0.55, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillStyle = 'rgba(255, 245, 214, 0.75)';
      context.fillRect(-particle.size, -particle.size * 0.65, particle.size * 2, particle.size * 1.3);
    }

    context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  context.restore();
}

function drawVignette() {
  const vignette = context.createRadialGradient(
    bounds.width / 2,
    bounds.height / 2,
    bounds.width * 0.15,
    bounds.width / 2,
    bounds.height / 2,
    bounds.width * 0.72,
  );

  vignette.addColorStop(0, 'rgba(8, 11, 20, 0)');
  vignette.addColorStop(1, 'rgba(8, 11, 20, 0.48)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, bounds.width, bounds.height);
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

function getMoodPalette() {
  const label = runState.delivered ? runState.mission.paletteHint : getCurrentChunkLabel();
  return moodPalettes[label] ?? moodPalettes.bedroom;
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
canvas.addEventListener('pointerdown', () => {
  if (gamePhase === 'briefing') {
    input.launch = true;
  }
});

resizeCanvas();
chunks = createInitialChunks();
requestAnimationFrame(tick);
