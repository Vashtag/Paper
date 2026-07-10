import './style.css';

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
  const normalizedSpeed = clamp(speed / 440, 0, 1.7);
  const diveAcceleration = Math.max(0, Math.sin(plane.pitch)) * 360;
  const climbAngle = Math.max(0, -Math.sin(plane.pitch));
  const lift = climbAngle * speed * 1.55;
  const stallPressure = climbAngle > 0.48 && speed < 245 ? (0.48 + climbAngle) * 290 : 0;
  const drag = 0.985 - Math.max(0, speed - 380) * 0.000025;

  plane.velocityX += (42 + diveAcceleration - climbAngle * 78) * deltaSeconds;
  plane.velocityY += (285 - lift + stallPressure) * deltaSeconds;
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

  for (let i = -2; i < 18; i += 1) {
    const worldX = Math.floor((cameraX + i * 180) / 180) * 180;
    const screenX = worldX - cameraX;
    const height = 46 + seededNoise(worldX) * 118;
    const width = 34 + seededNoise(worldX + 41) * 54;

    context.fillStyle = i % 3 === 0 ? '#0c1020' : '#070912';
    context.fillRect(screenX, groundScreenY - height, width, height);

    if (i % 4 === 0) {
      context.fillRect(screenX + width + 18, bounds.ceilingY - 18, 28, 120 + seededNoise(worldX + 9) * 100);
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
  context.fillRect(20, 20, 310, plane.crashed ? 156 : 116);
  context.fillStyle = '#fff5d6';
  context.font = '600 18px Inter, system-ui, sans-serif';
  context.fillText(`Distance ${Math.floor(runDistance)} m`, 36, 52);
  context.fillText(`Best ${plane.bestDistance} m`, 36, 80);
  context.fillText(`Speed ${speed}`, 36, 108);

  if (plane.stall > 0.05) {
    context.fillStyle = `rgba(255, 229, 150, ${0.45 + plane.stall * 0.55})`;
    context.fillText('STALL — dive to recover', 36, 136);
  }

  if (plane.crashed) {
    context.fillStyle = '#fff5d6';
    context.font = '700 30px Inter, system-ui, sans-serif';
    context.fillText('Crashed!', bounds.width / 2 - 70, bounds.height / 2 - 16);
    context.font = '500 18px Inter, system-ui, sans-serif';
    context.fillText('Press R to fold again', bounds.width / 2 - 86, bounds.height / 2 + 20);
  }
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
requestAnimationFrame(tick);
