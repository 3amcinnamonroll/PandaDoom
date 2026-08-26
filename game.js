(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const ui = {
    title: document.getElementById("title-screen"),
    pause: document.getElementById("pause-screen"),
    end: document.getElementById("end-screen"),
    endTitle: document.getElementById("end-title"),
    endCopy: document.getElementById("end-copy"),
    start: document.getElementById("start-button"),
    resume: document.getElementById("resume-button"),
    restart: document.getElementById("restart-button"),
    damage: document.getElementById("damage-flash"),
    touchPause: document.getElementById("touch-pause"),
    touchFire: document.getElementById("touch-fire"),
  };

  const MAP = [
    "1111111111111111",
    "1000000010000001",
    "1011110010111101",
    "1020000000000201",
    "1020111111100201",
    "1000100000100001",
    "1110101100101111",
    "1000001100000001",
    "1011100001110101",
    "1000101100010001",
    "1020001100000201",
    "1020110001100201",
    "1000000001000001",
    "1011111101000E01",
    "1000000000000001",
    "1111111111111111",
  ];

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const VIEW_HEIGHT = 454;
  const FOV = Math.PI / 3;
  const MAX_DEPTH = 22;
  const PLAYER_RADIUS = 0.2;
  const keys = Object.create(null);
  const touch = Object.create(null);
  let state = "title";
  let lastTime = performance.now();
  let muzzleFlash = 0;
  let shake = 0;
  let message = "FIND THE THREATS";
  let messageTimer = 3;
  let exitPulse = 0;
  let depthBuffer = new Float32Array(WIDTH);
  let pointerWasLocked = false;
  let mouseCaptureUnavailable = false;
  let pendingCaptureClick = false;

  const enemyCatalog = {
    poacher: { name: "POACHER", color: "#793c2c", accent: "#e0bd73", hp: 2, speed: 0.68, damage: 9 },
    leopard: { name: "SNOW LEOPARD", color: "#b9c7c6", accent: "#48514f", hp: 2, speed: 0.92, damage: 11 },
    fire: { name: "WILDFIRE SPIRIT", color: "#ec5a28", accent: "#ffcc45", hp: 3, speed: 0.58, damage: 13 },
  };

  const player = {
    x: 1.65,
    y: 1.65,
    angle: 0,
    health: 100,
    ammo: 40,
    kills: 0,
    shotCooldown: 0,
    hurtCooldown: 0,
    walkPhase: 0,
    moveAmount: 0,
  };

  let enemies = [];
  let pickups = [];

  function resetGame() {
    Object.assign(player, {
      x: 1.65,
      y: 1.65,
      angle: 0,
      health: 100,
      ammo: 40,
      kills: 0,
      shotCooldown: 0,
      hurtCooldown: 0,
      walkPhase: 0,
      moveAmount: 0,
    });
    enemies = [
      makeEnemy("leopard", 6.4, 3.5),
      makeEnemy("poacher", 12.5, 3.6),
      makeEnemy("fire", 3.5, 10.4),
      makeEnemy("leopard", 12.5, 10.5),
      makeEnemy("poacher", 7.5, 14.2),
    ];
    pickups = [
      { type: "ammo", x: 8.5, y: 8.5, active: true },
      { type: "health", x: 5.5, y: 12.5, active: true },
      { type: "ammo", x: 12.5, y: 14.2, active: true },
    ];
    message = "CLEAR 5 THREATS — FIND THE GREEN GATE";
    messageTimer = 4;
    muzzleFlash = 0;
    shake = 0;
  }

  function makeEnemy(type, x, y) {
    const data = enemyCatalog[type];
    return {
      type,
      x,
      y,
      hp: data.hp,
      alive: true,
      attackCooldown: Math.random() * 0.6,
      hitFlash: 0,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function mapCell(x, y) {
    const mx = Math.floor(x);
    const my = Math.floor(y);
    if (my < 0 || my >= MAP.length || mx < 0 || mx >= MAP[0].length) return "1";
    return MAP[my][mx];
  }

  function isSolid(x, y) {
    const cell = mapCell(x, y);
    return cell === "1" || cell === "2";
  }

  function canOccupy(x, y, radius = PLAYER_RADIUS) {
    return !isSolid(x - radius, y - radius) &&
      !isSolid(x + radius, y - radius) &&
      !isSolid(x - radius, y + radius) &&
      !isSolid(x + radius, y + radius);
  }

  function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function castRay(angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let distance = 0;
    let lastX = player.x;
    let lastY = player.y;
    while (distance < MAX_DEPTH) {
      distance += 0.025;
      const x = player.x + cos * distance;
      const y = player.y + sin * distance;
      const cell = mapCell(x, y);
      if (cell === "1" || cell === "2") {
        const hitVertical = Math.floor(x) !== Math.floor(lastX);
        const textureOffset = hitVertical ? y - Math.floor(y) : x - Math.floor(x);
        return { distance, cell, textureOffset, side: hitVertical ? 0 : 1 };
      }
      lastX = x;
      lastY = y;
    }
    return { distance: MAX_DEPTH, cell: "0", textureOffset: 0, side: 0 };
  }

  function hasLineOfSight(x1, y1, x2, y2) {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(distance / 0.12);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (isSolid(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  function moveEntity(entity, dx, dy, radius = PLAYER_RADIUS) {
    if (canOccupy(entity.x + dx, entity.y, radius)) entity.x += dx;
    if (canOccupy(entity.x, entity.y + dy, radius)) entity.y += dy;
  }

  function update(dt) {
    if (state !== "playing") return;

    player.shotCooldown = Math.max(0, player.shotCooldown - dt);
    player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);
    muzzleFlash = Math.max(0, muzzleFlash - dt * 6);
    shake = Math.max(0, shake - dt * 18);
    messageTimer = Math.max(0, messageTimer - dt);
    exitPulse += dt;

    const turn = ((keys.ArrowRight || keys.KeyE || touch.turnRight) ? 1 : 0) -
      ((keys.ArrowLeft || keys.KeyQ || touch.turnLeft) ? 1 : 0);
    player.angle = normalizeAngle(player.angle + turn * 2.15 * dt);

    const forward = ((keys.KeyW || keys.ArrowUp || touch.forward) ? 1 : 0) -
      ((keys.KeyS || keys.ArrowDown || touch.backward) ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (forward || strafe) {
      const speed = 2.15 * dt;
      const dx = (Math.cos(player.angle) * forward + Math.cos(player.angle + Math.PI / 2) * strafe) * speed;
      const dy = (Math.sin(player.angle) * forward + Math.sin(player.angle + Math.PI / 2) * strafe) * speed;
      const oldX = player.x;
      const oldY = player.y;
      moveEntity(player, dx, dy);
      if (Math.hypot(player.x - oldX, player.y - oldY) > 0.0001) {
        player.walkPhase += dt * 10;
        player.moveAmount = Math.min(1, player.moveAmount + dt * 7);
      } else {
        player.moveAmount = Math.max(0, player.moveAmount - dt * 5);
      }
    } else {
      player.moveAmount = Math.max(0, player.moveAmount - dt * 5);
    }

    for (const pickup of pickups) {
      if (!pickup.active || Math.hypot(player.x - pickup.x, player.y - pickup.y) > 0.55) continue;
      pickup.active = false;
      if (pickup.type === "ammo") {
        player.ammo += 12;
        showMessage("12 BAMBOO DARTS");
      } else {
        player.health = Math.min(100, player.health + 30);
        showMessage("MEDICINAL BAMBOO +30");
      }
    }

    updateEnemies(dt);

    if (player.kills === enemies.length && Math.hypot(player.x - 13.5, player.y - 13.5) < 0.7) {
      finish(true);
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 5);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.phase += dt * 4;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 7.5 && distance > 0.68 && hasLineOfSight(enemy.x, enemy.y, player.x, player.y)) {
        const speed = enemyCatalog[enemy.type].speed * dt;
        moveEntity(enemy, (dx / distance) * speed, (dy / distance) * speed, 0.22);
      }
      if (distance <= 0.82 && enemy.attackCooldown === 0) {
        enemy.attackCooldown = 0.85;
        hurtPlayer(enemyCatalog[enemy.type].damage);
      }
    }
  }

  function shoot() {
    if (state !== "playing" || player.shotCooldown > 0) return;
    if (player.ammo <= 0) {
      player.shotCooldown = 0.25;
      showMessage("OUT OF BAMBOO DARTS");
      return;
    }
    player.ammo -= 1;
    player.shotCooldown = 0.28;
    muzzleFlash = 1;
    shake = 4;

    let target = null;
    let targetDistance = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = Math.hypot(dx, dy);
      const angle = Math.abs(normalizeAngle(Math.atan2(dy, dx) - player.angle));
      const hitWindow = Math.min(0.18, 0.36 / Math.max(distance, 1));
      if (angle < hitWindow && distance < targetDistance && hasLineOfSight(player.x, player.y, enemy.x, enemy.y)) {
        target = enemy;
        targetDistance = distance;
      }
    }
    if (!target) return;
    target.hp -= 1;
    target.hitFlash = 1;
    if (target.hp <= 0) {
      target.alive = false;
      player.kills += 1;
      const remaining = enemies.length - player.kills;
      showMessage(remaining ? `${enemyCatalog[target.type].name} CLEARED — ${remaining} LEFT` : "ALL CLEAR — FIND THE GREEN GATE");
    }
  }

  function hurtPlayer(amount) {
    if (player.hurtCooldown > 0 || state !== "playing") return;
    player.health = Math.max(0, player.health - amount);
    player.hurtCooldown = 0.35;
    shake = 9;
    ui.damage.style.opacity = "0.58";
    setTimeout(() => { ui.damage.style.opacity = "0"; }, 80);
    showMessage("PANDA HURT!");
    if (player.health <= 0) finish(false);
  }

  function showMessage(text) {
    message = text;
    messageTimer = 2.3;
  }

  function finish(won) {
    state = won ? "won" : "lost";
    document.exitPointerLock?.();
    ui.endTitle.textContent = won ? "BAMBOO SAVED" : "PANDA DOWN";
    ui.endCopy.textContent = won
      ? `You cleared ${player.kills} threats and reclaimed the Moon Bamboo Sanctuary.`
      : `The sanctuary still needs you. You cleared ${player.kills} of ${enemies.length} threats.`;
    ui.end.classList.remove("hidden");
  }

  function render() {
    const stride = state === "playing" ? player.moveAmount : 0;
    const sway = Math.sin(player.walkPhase * 0.5) * 9 * stride;
    const bob = (Math.abs(Math.sin(player.walkPhase)) - 0.45) * 6 * stride;
    const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    renderWorld();
    renderSprites();
    renderWeapon(sway, bob);
    renderGrit();
    ctx.restore();
    renderHud();
  }

  function renderWorld() {
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT / 2);
    sky.addColorStop(0, "#020303");
    sky.addColorStop(0.7, "#101513");
    sky.addColorStop(1, "#39271d");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT / 2);

    ctx.fillStyle = "#8c3e2e";
    ctx.beginPath();
    ctx.arc(WIDTH * 0.82, 70, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#46251f";
    ctx.beginPath();
    ctx.arc(WIDTH * 0.82 - 10, 62, 6, 0, Math.PI * 2);
    ctx.arc(WIDTH * 0.82 + 12, 78, 8, 0, Math.PI * 2);
    ctx.fill();

    const floor = ctx.createLinearGradient(0, VIEW_HEIGHT / 2, 0, VIEW_HEIGHT);
    floor.addColorStop(0, "#2c2319");
    floor.addColorStop(1, "#070806");
    ctx.fillStyle = floor;
    ctx.fillRect(0, VIEW_HEIGHT / 2, WIDTH, VIEW_HEIGHT / 2);
    renderFloorBands();

    const rayCount = 320;
    const stripWidth = WIDTH / rayCount;
    for (let ray = 0; ray < rayCount; ray += 1) {
      const rayAngle = player.angle - FOV / 2 + (ray / rayCount) * FOV;
      const hit = castRay(rayAngle);
      const corrected = Math.max(0.01, hit.distance * Math.cos(rayAngle - player.angle));
      const wallHeight = Math.min(VIEW_HEIGHT * 1.8, VIEW_HEIGHT / corrected);
      const top = VIEW_HEIGHT / 2 - wallHeight / 2;
      const shade = Math.max(0.12, 0.92 - corrected / (MAX_DEPTH * 0.72)) * (hit.side ? 0.68 : 1);
      const stripe = Math.floor(hit.textureOffset * 10) % 2;
      let color;
      if (hit.cell === "2") {
        const base = stripe ? [40, 60, 27] : [63, 83, 34];
        color = `rgb(${base.map((value) => Math.floor(value * shade)).join(",")})`;
      } else {
        const base = stripe ? [54, 45, 34] : [72, 59, 42];
        color = `rgb(${base.map((value) => Math.floor(value * shade)).join(",")})`;
      }
      ctx.fillStyle = color;
      ctx.fillRect(ray * stripWidth, top, Math.ceil(stripWidth + 1), wallHeight);
      if (hit.cell === "2" && Math.floor(hit.textureOffset * 24) % 8 === 0) {
        ctx.fillStyle = `rgba(5,8,4,${0.58 * shade})`;
        ctx.fillRect(ray * stripWidth, top, Math.ceil(stripWidth + 1), wallHeight);
      }
      if (Math.floor((top + wallHeight) / 34) % 2 === 0) {
        ctx.fillStyle = `rgba(0,0,0,${0.07 + corrected / 180})`;
        ctx.fillRect(ray * stripWidth, top + wallHeight * 0.48, Math.ceil(stripWidth + 1), Math.max(2, wallHeight * 0.025));
      }
      const start = Math.floor(ray * stripWidth);
      const end = Math.min(WIDTH, Math.ceil((ray + 1) * stripWidth));
      for (let x = start; x < end; x += 1) depthBuffer[x] = corrected;
    }

    renderExitGate();
  }

  function renderFloorBands() {
    const horizon = VIEW_HEIGHT / 2;
    for (let y = horizon + 8; y < VIEW_HEIGHT; y += 9) {
      const depth = (y - horizon) / (VIEW_HEIGHT - horizon);
      const offset = Math.floor((player.x + player.y) * 19 + player.angle * 31) % 44;
      ctx.fillStyle = `rgba(111,82,48,${0.035 + depth * 0.07})`;
      for (let x = -offset; x < WIDTH; x += Math.max(18, 64 - Math.floor(depth * 34))) {
        ctx.fillRect(x, y, Math.max(7, depth * 18), Math.max(2, depth * 5));
      }
    }
  }

  function renderGrit() {
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    for (let y = 0; y < VIEW_HEIGHT; y += 4) ctx.fillRect(0, y, WIDTH, 1);
    const vignette = ctx.createRadialGradient(WIDTH / 2, VIEW_HEIGHT * 0.45, VIEW_HEIGHT * 0.2, WIDTH / 2, VIEW_HEIGHT * 0.45, WIDTH * 0.65);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.7, "rgba(0,0,0,0.13)");
    vignette.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT);
  }

  function renderExitGate() {
    const dx = 13.5 - player.x;
    const dy = 13.5 - player.y;
    const distance = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
    if (Math.abs(angle) > FOV * 0.7 || !hasLineOfSight(player.x, player.y, 13.5, 13.5)) return;
    const x = WIDTH / 2 + Math.tan(angle) * (WIDTH / (2 * Math.tan(FOV / 2)));
    const size = Math.min(420, 290 / Math.max(distance, 0.3));
    const unlocked = player.kills === enemies.length;
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(exitPulse * 4) * 0.16;
    ctx.fillStyle = unlocked ? "#76ff72" : "#b12626";
    ctx.fillRect(x - size / 2, VIEW_HEIGHT / 2 - size, size, size * 1.8);
    ctx.fillStyle = unlocked ? "#d8ffd1" : "#ffd0c4";
    ctx.font = `900 ${Math.max(10, size * 0.12)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(unlocked ? "EXIT" : "LOCKED", x, VIEW_HEIGHT / 2 - size * 0.1);
    ctx.restore();
  }

  function renderSprites() {
    const sprites = [];
    for (const enemy of enemies) {
      if (enemy.alive) sprites.push({ ...enemy, kind: "enemy" });
    }
    for (const pickup of pickups) {
      if (pickup.active) sprites.push({ ...pickup, kind: "pickup" });
    }
    sprites.sort((a, b) => Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y));

    for (const sprite of sprites) {
      const dx = sprite.x - player.x;
      const dy = sprite.y - player.y;
      const distance = Math.hypot(dx, dy);
      const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
      if (Math.abs(angle) > FOV * 0.78 || distance < 0.25) continue;
      const spriteDepth = distance * Math.cos(angle);
      const screenX = WIDTH / 2 + Math.tan(angle) * (WIDTH / (2 * Math.tan(FOV / 2)));
      const size = Math.min(520, (sprite.kind === "enemy" ? 360 : 170) / Math.max(spriteDepth, 0.25));
      const groundY = VIEW_HEIGHT / 2 + size * (sprite.kind === "enemy" ? 0.5 : 0.48);
      const top = groundY - size;
      const image = sprite.kind === "enemy" ? drawEnemySprite(sprite, size) : drawPickupSprite(sprite, size);
      const left = Math.floor(screenX - size / 2);
      if (sprite.kind === "enemy") {
        const shadowRadiusX = size * 0.34;
        const shadowRadiusY = size * 0.085;
        const shadowCenterY = groundY - size * 0.035;
        ctx.fillStyle = `rgba(0,0,0,${Math.min(0.68, 0.35 + 0.04 * distance)})`;
        for (let shadowX = Math.floor(screenX - shadowRadiusX); shadowX <= screenX + shadowRadiusX; shadowX += 1) {
          if (shadowX < 0 || shadowX >= WIDTH || spriteDepth >= depthBuffer[shadowX]) continue;
          const normalizedX = (shadowX - screenX) / shadowRadiusX;
          const halfHeight = shadowRadiusY * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
          ctx.fillRect(shadowX, shadowCenterY - halfHeight, 1, halfHeight * 2);
        }
      }
      for (let sx = 0; sx < Math.ceil(size); sx += 3) {
        const screenColumn = left + sx;
        if (screenColumn < 0 || screenColumn >= WIDTH || spriteDepth >= depthBuffer[screenColumn]) continue;
        ctx.drawImage(image, (sx / size) * image.width, 0, Math.max(1, (3 / size) * image.width), image.height, screenColumn, top, 3, size);
      }
    }
  }

  function spriteCanvas() {
    const offscreen = document.createElement("canvas");
    offscreen.width = 64;
    offscreen.height = 64;
    const spriteContext = offscreen.getContext("2d");
    spriteContext.imageSmoothingEnabled = false;
    spriteContext.scale(2 / 3, 2 / 3);
    return [offscreen, spriteContext];
  }

  function drawEnemySprite(enemy) {
    const [sprite, s] = spriteCanvas();
    const data = enemyCatalog[enemy.type];
    const motion = Math.sin(enemy.phase) * 2;
    s.translate(48, 48);
    s.fillStyle = "#000c";
    s.beginPath(); s.ellipse(0, 41, 34, 6, 0, 0, Math.PI * 2); s.fill();
    if (enemy.type === "fire") {
      s.fillStyle = "#2b1912";
      s.fillRect(-23, 31, 15, 12); s.fillRect(8, 31, 15, 12);
      s.fillStyle = "#080705";
      s.fillRect(-27, 39, 20, 6); s.fillRect(7, 39, 22, 6);
      const flame = s.createLinearGradient(-26, 34, 22, -42);
      flame.addColorStop(0, "#591d12"); flame.addColorStop(0.45, data.color); flame.addColorStop(1, "#7b2515");
      s.fillStyle = flame;
      s.beginPath();
      s.moveTo(-29, 34); s.lineTo(-37, 4); s.lineTo(-21 + motion, -10);
      s.lineTo(-13, -39); s.lineTo(1 + motion, -25); s.lineTo(12, -45);
      s.lineTo(20, -15); s.lineTo(36, 3); s.lineTo(27, 34); s.closePath(); s.fill();
      s.fillStyle = data.accent;
      s.beginPath();
      s.moveTo(-13, 27); s.lineTo(-16, 4); s.lineTo(1, -19); s.lineTo(16, 5); s.lineTo(12, 29); s.closePath(); s.fill();
      s.fillStyle = "#1a0d08"; s.fillRect(-17, -2, 11, 8); s.fillRect(7, -2, 11, 8);
      s.fillStyle = "#ff442d"; s.fillRect(-14, 0, 5, 3); s.fillRect(10, 0, 5, 3);
    } else if (enemy.type === "leopard") {
      s.fillStyle = "#333b3a";
      s.fillRect(-27 + motion, 20, 12, 23); s.fillRect(-4 - motion, 20, 12, 23); s.fillRect(17 + motion, 16, 12, 27);
      s.fillStyle = "#111514";
      s.fillRect(-30 + motion, 38, 17, 7); s.fillRect(-7 - motion, 38, 17, 7); s.fillRect(15 + motion, 38, 18, 7);
      const fur = s.createLinearGradient(-32, 0, 31, 15);
      fur.addColorStop(0, "#596463"); fur.addColorStop(0.52, data.color); fur.addColorStop(1, "#768180");
      s.fillStyle = fur;
      s.beginPath(); s.ellipse(-4, 6, 37, 25, -0.08, 0, Math.PI * 2); s.fill();
      s.beginPath(); s.ellipse(25, -12, 22, 21, -0.15, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#737f7d";
      s.beginPath(); s.moveTo(9, -24); s.lineTo(14, -39); s.lineTo(24, -27); s.closePath(); s.fill();
      s.beginPath(); s.moveTo(29, -29); s.lineTo(39, -40); s.lineTo(44, -23); s.closePath(); s.fill();
      s.lineWidth = 9; s.strokeStyle = "#596463"; s.beginPath(); s.arc(-35, -4, 27, 1.4, 4.8); s.stroke();
      s.fillStyle = data.accent;
      for (const [x, y] of [[-25,-4],[-10,7],[5,1],[-16,19],[14,15],[18,-15],[34,-15]]) {
        s.fillRect(x, y, 6, 5);
      }
      s.fillStyle = "#ff4130"; s.fillRect(18, -18, 6, 4); s.fillRect(33, -18, 6, 4);
      s.fillStyle = "#1a1c1b";
      s.beginPath(); s.moveTo(20, -3); s.lineTo(43, -3); s.lineTo(34, 10); s.lineTo(25, 8); s.closePath(); s.fill();
      s.fillStyle = "#ddd8bd";
      s.beginPath(); s.moveTo(26, 5); s.lineTo(30, 14); s.lineTo(34, 5); s.closePath(); s.fill();
      s.beginPath(); s.moveTo(35, 4); s.lineTo(39, 12); s.lineTo(42, 2); s.closePath(); s.fill();
    } else {
      s.fillStyle = "#171712";
      s.fillRect(-21 + motion, 19, 15, 25); s.fillRect(6 - motion, 19, 15, 25);
      s.fillStyle = "#080907"; s.fillRect(-25 + motion, 39, 21, 6); s.fillRect(4 - motion, 39, 23, 6);
      const coat = s.createLinearGradient(-29, -4, 29, 30);
      coat.addColorStop(0, "#3b201b"); coat.addColorStop(0.55, data.color); coat.addColorStop(1, "#2d1713");
      s.fillStyle = coat;
      s.beginPath(); s.moveTo(-33, 25); s.lineTo(-28, -10); s.lineTo(-17, -20); s.lineTo(17, -20); s.lineTo(31, -7); s.lineTo(34, 27); s.closePath(); s.fill();
      s.fillStyle = "#6e4d35"; s.beginPath(); s.arc(0, -24, 17, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#202b1d"; s.beginPath(); s.ellipse(0, -34, 30, 8, 0, 0, Math.PI * 2); s.fill(); s.fillRect(-18, -43, 36, 11);
      s.fillStyle = "#080908"; s.fillRect(-15, -28, 30, 8);
      s.fillStyle = "#e02f29"; s.fillRect(-12, -26, 7, 3); s.fillRect(5, -26, 7, 3);
      s.strokeStyle = "#17140e"; s.lineWidth = 8; s.beginPath(); s.moveTo(-30, 2); s.lineTo(27, 16); s.stroke();
      s.strokeStyle = data.accent; s.lineWidth = 3; s.beginPath(); s.moveTo(-35, -3); s.lineTo(34, 14); s.stroke();
      s.fillStyle = "#17140e"; s.fillRect(25, 10, 19, 8);
    }
    if (enemy.hitFlash > 0) {
      s.globalCompositeOperation = "source-atop";
      s.fillStyle = `rgba(255,255,255,${enemy.hitFlash * 0.8})`;
      s.fillRect(-48, -48, 96, 96);
    }
    return sprite;
  }

  function drawPickupSprite(pickup) {
    const [sprite, s] = spriteCanvas();
    s.translate(48, 48);
    s.fillStyle = "#0008";
    s.beginPath(); s.ellipse(0, 33, 25, 6, 0, 0, Math.PI * 2); s.fill();
    if (pickup.type === "ammo") {
      s.strokeStyle = "#66843d"; s.lineWidth = 9;
      for (let x = -18; x <= 18; x += 12) { s.beginPath(); s.moveTo(x, -26); s.lineTo(x, 28); s.stroke(); }
      s.strokeStyle = "#b7c75f"; s.lineWidth = 3;
      for (let x = -18; x <= 18; x += 12) { for (let y = -18; y <= 20; y += 14) { s.beginPath(); s.moveTo(x - 5, y); s.lineTo(x + 5, y); s.stroke(); } }
    } else {
      s.fillStyle = "#e5e0ca"; s.fillRect(-23, -22, 46, 50);
      s.fillStyle = "#9cc85a"; s.fillRect(-7, -14, 14, 34); s.fillRect(-17, -4, 34, 14);
    }
    return sprite;
  }

  function renderWeapon(sway, bob) {
    const recoil = muzzleFlash * 22;
    const gait = Math.sin(player.walkPhase * 0.5) * 13 * player.moveAmount;
    ctx.save();
    ctx.translate(WIDTH / 2 + sway * 1.25 + gait, VIEW_HEIGHT - 2 + recoil + bob * 0.65);

    ctx.fillStyle = "#090a08";
    ctx.beginPath(); ctx.ellipse(-58 - gait * 0.2, 50, 77, 47, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(73 + gait * 0.15, 52, 78, 48, 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c8c4b5";
    ctx.beginPath(); ctx.ellipse(-54 - gait * 0.2, 43, 38, 29, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(66 + gait * 0.15, 45, 39, 30, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#151714";
    ctx.beginPath(); ctx.ellipse(-61 - gait * 0.2, 40, 17, 13, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(71 + gait * 0.15, 41, 18, 13, 0.22, 0, Math.PI * 2); ctx.fill();

    const bamboo = ctx.createLinearGradient(-16, 66, 45, -70);
    bamboo.addColorStop(0, "#314520");
    bamboo.addColorStop(0.5, "#66863a");
    bamboo.addColorStop(1, "#9bab5c");
    ctx.fillStyle = "#11160e";
    ctx.beginPath(); ctx.moveTo(-23, 72); ctx.lineTo(61, 78); ctx.lineTo(13, -91); ctx.lineTo(-9, -90); ctx.closePath(); ctx.fill();
    ctx.fillStyle = bamboo;
    ctx.beginPath(); ctx.moveTo(-14, 68); ctx.lineTo(52, 73); ctx.lineTo(10, -87); ctx.lineTo(-5, -87); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(188,205,111,0.32)";
    ctx.beginPath(); ctx.moveTo(-4, 64); ctx.lineTo(12, 66); ctx.lineTo(5, -84); ctx.lineTo(0, -84); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = "#1b2814";
    ctx.lineWidth = 7;
    for (const [y, left, right] of [[35, -5, 42], [-4, -1, 31], [-38, 1, 21], [-66, 1, 15]]) {
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y + 2); ctx.stroke();
    }
    ctx.fillStyle = "#10120d";
    ctx.beginPath(); ctx.ellipse(3, -88, 11, 5, 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#a0af62"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(3, -88, 11, 5, 0.08, 0, Math.PI * 2); ctx.stroke();

    if (muzzleFlash > 0.15) {
      ctx.fillStyle = `rgba(238,118,44,${muzzleFlash})`;
      ctx.beginPath();
      ctx.moveTo(3, -91); ctx.lineTo(-19, -116); ctx.lineTo(-2, -110);
      ctx.lineTo(5, -132); ctx.lineTo(10, -108); ctx.lineTo(26, -117); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function renderHud() {
    ctx.fillStyle = "#090a08";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH, HEIGHT - VIEW_HEIGHT);
    ctx.fillStyle = "#30271d";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH, 5);
    ctx.fillStyle = player.health <= 30 ? "#8c241c" : "#566b32";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH * (player.health / 100), 5);

    drawHudNumber(36, 493, player.health, "HEALTH", player.health <= 30 ? "#e84d37" : "#f1edda");
    drawPandaFace(WIDTH / 2 + Math.sin(player.walkPhase * 0.5) * 4 * player.moveAmount, 496);
    drawHudNumber(WIDTH - 36, 493, player.ammo, "BAMBOO", "#d5c36f", true);

    ctx.font = "800 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#9bab73";
    ctx.fillText(`THREATS ${player.kills}/${enemies.length}`, WIDTH * 0.7, 489);
    ctx.fillStyle = player.kills === enemies.length ? "#75ff70" : "#8c927c";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText(player.kills === enemies.length ? "GATE OPEN" : "GATE LOCKED", WIDTH * 0.7, 512);

    if (messageTimer > 0) {
      const alpha = Math.min(1, messageTimer * 2);
      ctx.fillStyle = `rgba(10,14,9,${0.7 * alpha})`;
      ctx.fillRect(WIDTH / 2 - 250, 24, 500, 38);
      ctx.strokeStyle = `rgba(180,202,98,${0.8 * alpha})`;
      ctx.strokeRect(WIDTH / 2 - 250, 24, 500, 38);
      ctx.fillStyle = `rgba(239,235,211,${alpha})`;
      ctx.font = "900 17px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(message, WIDTH / 2, 49);
    }
  }

  function drawHudNumber(x, y, number, label, color, right = false) {
    ctx.textAlign = right ? "right" : "left";
    ctx.fillStyle = color;
    ctx.font = "900 36px Impact, sans-serif";
    ctx.fillText(String(number).padStart(2, "0"), x, y + 13);
    ctx.fillStyle = "#8e9581";
    ctx.font = "800 10px system-ui, sans-serif";
    ctx.fillText(label, x, y + 31);
  }

  function drawPandaFace(x, y) {
    const hurt = player.health <= 30 || player.hurtCooldown > 0;
    ctx.fillStyle = "#070807";
    ctx.beginPath(); ctx.arc(x - 32, y - 22, 18, 0, Math.PI * 2); ctx.arc(x + 32, y - 22, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e7e3d1";
    ctx.beginPath(); ctx.ellipse(x, y - 2, 45, 38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#171916";
    ctx.save(); ctx.translate(x - 18, y - 10); ctx.rotate(0.45); ctx.beginPath(); ctx.ellipse(0, 0, 12, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x + 18, y - 10); ctx.rotate(-0.45); ctx.beginPath(); ctx.ellipse(0, 0, 12, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = hurt ? "#d33b31" : "#ecf0d9";
    if (hurt) {
      ctx.fillRect(x - 23, y - 13, 10, 4); ctx.fillRect(x + 13, y - 13, 10, 4);
    } else {
      ctx.beginPath(); ctx.arc(x - 18, y - 11, 4, 0, Math.PI * 2); ctx.arc(x + 18, y - 11, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#171916";
    ctx.beginPath(); ctx.ellipse(x, y + 5, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#171916"; ctx.lineWidth = 3; ctx.beginPath();
    if (hurt) { ctx.arc(x, y + 24, 9, Math.PI + 0.4, Math.PI * 2 - 0.4); }
    else { ctx.moveTo(x, y + 10); ctx.quadraticCurveTo(x - 9, y + 20, x - 15, y + 14); ctx.moveTo(x, y + 10); ctx.quadraticCurveTo(x + 9, y + 20, x + 15, y + 14); }
    ctx.stroke();
  }

  function setState(next) {
    state = next;
    ui.title.classList.toggle("hidden", next !== "title");
    ui.pause.classList.toggle("hidden", next !== "paused");
    if (next !== "won" && next !== "lost") ui.end.classList.add("hidden");
  }

  function handleMouseCaptureFailure() {
    mouseCaptureUnavailable = true;
    const shouldFire = pendingCaptureClick;
    pendingCaptureClick = false;
    showMessage("MOUSE CAPTURE BLOCKED — CLICK OR SPACE TO FIRE");
    if (shouldFire) shoot();
  }

  function requestMouseCapture(fireOnFailure = false) {
    pendingCaptureClick = fireOnFailure;
    if (mouseCaptureUnavailable || typeof canvas.requestPointerLock !== "function") {
      pendingCaptureClick = false;
      if (fireOnFailure) shoot();
      return;
    }
    try {
      const request = canvas.requestPointerLock();
      request?.catch(handleMouseCaptureFailure);
    } catch {
      handleMouseCaptureFailure();
    }
  }

  function startGame() {
    resetGame();
    setState("playing");
    canvas.focus();
    requestMouseCapture();
  }

  function togglePause() {
    if (state === "playing") {
      setState("paused");
      document.exitPointerLock?.();
    } else if (state === "paused") {
      setState("playing");
      requestMouseCapture();
    }
  }

  window.addEventListener("keydown", (event) => {
    keys[event.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "Space") shoot();
    if (event.code === "Escape") togglePause();
  });
  window.addEventListener("keyup", (event) => { keys[event.code] = false; });
  window.addEventListener("blur", () => {
    for (const key of Object.keys(keys)) keys[key] = false;
  });
  document.addEventListener("mousemove", (event) => {
    if (state === "playing" && document.pointerLockElement === canvas) {
      player.angle = normalizeAngle(player.angle + event.movementX * 0.0024);
    }
  });
  canvas.addEventListener("click", () => {
    if (state !== "playing") return;
    if (document.pointerLockElement === canvas) shoot();
    else requestMouseCapture(true);
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      pointerWasLocked = true;
      pendingCaptureClick = false;
      return;
    }
    if (state === "playing" && pointerWasLocked && !matchMedia("(pointer: coarse)").matches) setState("paused");
    pointerWasLocked = false;
  });
  document.addEventListener("pointerlockerror", handleMouseCaptureFailure);

  document.querySelectorAll("[data-control]").forEach((button) => {
    const control = button.dataset.control;
    const on = (event) => { event.preventDefault(); touch[control] = true; button.classList.add("active"); };
    const off = (event) => { event.preventDefault(); touch[control] = false; button.classList.remove("active"); };
    button.addEventListener("pointerdown", on);
    button.addEventListener("pointerup", off);
    button.addEventListener("pointercancel", off);
    button.addEventListener("pointerleave", off);
  });
  ui.touchPause.addEventListener("pointerdown", (event) => { event.preventDefault(); togglePause(); });
  ui.touchFire.addEventListener("pointerdown", (event) => { event.preventDefault(); shoot(); });
  ui.start.addEventListener("click", startGame);
  ui.resume.addEventListener("click", togglePause);
  ui.restart.addEventListener("click", startGame);

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resetGame();
  render();
  requestAnimationFrame(frame);

  window.__PANDADOOM__ = {
    getState: () => ({ state, player: { ...player }, enemiesAlive: enemies.filter((enemy) => enemy.alive).length }),
    start: startGame,
    shoot,
    map: MAP.slice(),
  };
}());
