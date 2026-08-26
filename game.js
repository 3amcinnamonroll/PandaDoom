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
    crosshair: document.getElementById("crosshair"),
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
  const AIM_BOUNDS = { left: WIDTH * 0.18, right: WIDTH * 0.82, top: VIEW_HEIGHT * 0.16, bottom: VIEW_HEIGHT * 0.84 };
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
  const aim = { x: WIDTH / 2, y: VIEW_HEIGHT / 2 };
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
  let darts = [];

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
    darts = [];
    setAim(WIDTH / 2, VIEW_HEIGHT / 2);
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

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function setAim(x, y) {
    aim.x = clamp(x, AIM_BOUNDS.left, AIM_BOUNDS.right);
    aim.y = clamp(y, AIM_BOUNDS.top, AIM_BOUNDS.bottom);
    ui.crosshair.style.left = `${(aim.x / WIDTH) * 100}%`;
    ui.crosshair.style.top = `${(aim.y / HEIGHT) * 100}%`;
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

    const aimHorizontal = (keys.KeyL ? 1 : 0) - (keys.KeyJ ? 1 : 0);
    const aimVertical = (keys.KeyK ? 1 : 0) - (keys.KeyI ? 1 : 0);
    if (aimHorizontal || aimVertical) setAim(aim.x + aimHorizontal * 260 * dt, aim.y + aimVertical * 260 * dt);

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
    updateDarts(dt);

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

  function projectEnemy(enemy) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
    if (Math.abs(angle) > FOV * 0.78 || distance < 0.25) return null;
    const depth = distance * Math.cos(angle);
    const screenX = WIDTH / 2 + Math.tan(angle) * (WIDTH / (2 * Math.tan(FOV / 2)));
    const size = Math.min(520, 360 / Math.max(depth, 0.25));
    const groundY = VIEW_HEIGHT / 2 + size * 0.5;
    return { distance, depth, screenX, size, groundY, top: groundY - size };
  }

  function damageEnemy(enemy) {
    if (!enemy?.alive) return;
    enemy.hp -= 1;
    enemy.hitFlash = 1;
    if (enemy.hp > 0) return;
    enemy.alive = false;
    player.kills += 1;
    const remaining = enemies.length - player.kills;
    showMessage(remaining ? `${enemyCatalog[enemy.type].name} CLEARED — ${remaining} LEFT` : "ALL CLEAR — FIND THE GREEN GATE");
  }

  function updateDarts(dt) {
    for (const dart of darts) {
      dart.age += dt;
      if (!dart.resolved && dart.age >= dart.duration) {
        dart.resolved = true;
        damageEnemy(dart.target);
      }
    }
    darts = darts.filter((dart) => dart.age < dart.duration + 0.08);
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
      const projection = projectEnemy(enemy);
      if (!projection) continue;
      const withinX = Math.abs(aim.x - projection.screenX) < projection.size * 0.42;
      const withinY = aim.y > projection.top + projection.size * 0.05 && aim.y < projection.groundY - projection.size * 0.04;
      const visibleAtAim = aim.x >= 0 && aim.x < WIDTH && projection.depth < depthBuffer[Math.floor(aim.x)] + 0.08;
      if (withinX && withinY && visibleAtAim && projection.distance < targetDistance && hasLineOfSight(player.x, player.y, enemy.x, enemy.y)) {
        target = enemy;
        targetDistance = projection.distance;
      }
    }
    const stride = player.moveAmount;
    const sway = Math.sin(player.walkPhase * 0.5) * 9 * stride;
    const bob = (Math.abs(Math.sin(player.walkPhase)) - 0.45) * 6 * stride;
    const pose = weaponPose(sway, bob);
    darts.push({
      age: 0,
      duration: target ? clamp(0.16 + targetDistance * 0.025, 0.18, 0.38) : 0.24,
      startX: pose.muzzleX,
      startY: pose.muzzleY,
      endX: aim.x,
      endY: aim.y,
      target,
      resolved: false,
    });
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
    renderDarts();
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
      const enemyProjection = sprite.kind === "enemy" ? projectEnemy(sprite) : null;
      if ((sprite.kind === "enemy" && !enemyProjection) || (sprite.kind !== "enemy" && (Math.abs(angle) > FOV * 0.78 || distance < 0.25))) continue;
      const spriteDepth = enemyProjection?.depth ?? distance * Math.cos(angle);
      const screenX = enemyProjection?.screenX ?? WIDTH / 2 + Math.tan(angle) * (WIDTH / (2 * Math.tan(FOV / 2)));
      const size = enemyProjection?.size ?? Math.min(520, 170 / Math.max(spriteDepth, 0.25));
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

  function drawVolumeEllipse(s, x, y, radiusX, radiusY, light, middle, dark, rotation = 0) {
    s.save();
    s.translate(x, y);
    s.rotate(rotation);
    const gradient = s.createRadialGradient(-radiusX * 0.34, -radiusY * 0.42, 2, 0, 0, Math.max(radiusX, radiusY) * 1.15);
    gradient.addColorStop(0, light);
    gradient.addColorStop(0.48, middle);
    gradient.addColorStop(1, dark);
    s.fillStyle = gradient;
    s.beginPath();
    s.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    s.fill();
    s.strokeStyle = "#080a08";
    s.lineWidth = 3;
    s.stroke();
    s.restore();
  }

  function drawVolumeBox(s, x, y, width, height, light, middle, dark) {
    const gradient = s.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, dark);
    gradient.addColorStop(0.3, middle);
    gradient.addColorStop(0.58, light);
    gradient.addColorStop(1, dark);
    s.fillStyle = gradient;
    s.fillRect(x, y, width, height);
    s.fillStyle = light;
    s.fillRect(x + 2, y + 2, Math.max(2, width - 5), 3);
    s.fillStyle = dark;
    s.fillRect(x + width - 4, y + 3, 4, height - 3);
    s.strokeStyle = "#080a08";
    s.lineWidth = 2;
    s.strokeRect(x, y, width, height);
  }

  function drawEnemySprite(enemy) {
    const [sprite, s] = spriteCanvas();
    const motion = Math.sin(enemy.phase) * 2;
    s.translate(48, 48);
    s.fillStyle = "#000d";
    s.beginPath(); s.ellipse(0, 42, 37, 7, 0, 0, Math.PI * 2); s.fill();

    if (enemy.type === "fire") {
      drawVolumeBox(s, -24 + motion, 24, 15, 20, "#78351d", "#3d1d14", "#130b08");
      drawVolumeBox(s, 9 - motion, 24, 15, 20, "#78351d", "#3d1d14", "#130b08");
      const flame = s.createLinearGradient(-20, 34, 13, -45);
      flame.addColorStop(0, "#40130d"); flame.addColorStop(0.48, "#b9361c"); flame.addColorStop(1, "#57170f");
      s.fillStyle = flame;
      s.beginPath();
      s.moveTo(-33, 31); s.lineTo(-38, 4); s.lineTo(-22 + motion, -10);
      s.lineTo(-14, -42); s.lineTo(0 + motion, -27); s.lineTo(13, -47);
      s.lineTo(21, -17); s.lineTo(37, 2); s.lineTo(29, 31); s.closePath(); s.fill();
      s.strokeStyle = "#160907"; s.lineWidth = 3; s.stroke();
      drawVolumeEllipse(s, -3, 8, 29, 28, "#ffe681", "#e76124", "#761b11");
      drawVolumeEllipse(s, 1, 10, 15, 20, "#fff2a1", "#ffb52d", "#a92d16");
      s.fillStyle = "#23100b"; s.fillRect(-17, -3, 11, 9); s.fillRect(7, -3, 11, 9);
      s.fillStyle = "#ff3024"; s.fillRect(-14, 0, 5, 3); s.fillRect(10, 0, 5, 3);
      s.fillStyle = "#2b0d09"; s.fillRect(-11, 17, 23, 5);
    } else if (enemy.type === "leopard") {
      const tail = s.createLinearGradient(-48, -4, -8, 10);
      tail.addColorStop(0, "#232a29"); tail.addColorStop(0.45, "#9aa5a3"); tail.addColorStop(1, "#46504f");
      s.strokeStyle = tail; s.lineWidth = 10; s.beginPath(); s.arc(-34, -4, 28, 1.4, 4.8); s.stroke();
      drawVolumeBox(s, -28 + motion, 18, 13, 26, "#c8d0ce", "#697472", "#242b2a");
      drawVolumeBox(s, -5 - motion, 19, 13, 25, "#c8d0ce", "#697472", "#242b2a");
      drawVolumeBox(s, 17 + motion, 14, 14, 30, "#d6dcda", "#75807e", "#252c2b");
      drawVolumeEllipse(s, -12, 5, 31, 25, "#e1e6e3", "#909b99", "#3e4947", -0.08);
      drawVolumeEllipse(s, 13, 1, 25, 28, "#edf0ec", "#9aa5a2", "#424c4a", -0.1);
      drawVolumeEllipse(s, 27, -17, 22, 21, "#edf1ed", "#9ca6a4", "#3e4746", -0.12);
      s.fillStyle = "#727d7a";
      s.beginPath(); s.moveTo(10, -27); s.lineTo(15, -43); s.lineTo(25, -29); s.closePath(); s.fill(); s.stroke();
      s.beginPath(); s.moveTo(30, -31); s.lineTo(41, -43); s.lineTo(45, -25); s.closePath(); s.fill(); s.stroke();
      drawVolumeEllipse(s, 36, -5, 17, 12, "#d9ddd7", "#747e7b", "#292f2e", 0.08);
      s.fillStyle = "#46504e";
      for (const [x, y, w, h] of [[-26,-5,7,6],[-11,8,7,6],[3,1,7,5],[-17,20,7,5],[12,15,7,6],[19,-18,6,5],[35,-18,6,5]]) s.fillRect(x, y, w, h);
      s.fillStyle = "#ff3e30"; s.fillRect(18, -20, 6, 4); s.fillRect(34, -20, 6, 4);
      s.fillStyle = "#111514"; s.beginPath(); s.ellipse(43, -6, 6, 5, 0, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#e6dfc4";
      s.beginPath(); s.moveTo(27, 4); s.lineTo(31, 14); s.lineTo(35, 4); s.closePath(); s.fill();
      s.beginPath(); s.moveTo(37, 3); s.lineTo(41, 12); s.lineTo(44, 1); s.closePath(); s.fill();
    } else {
      drawVolumeBox(s, -22 + motion, 18, 16, 27, "#5a3830", "#2c1c19", "#0d0c0a");
      drawVolumeBox(s, 6 - motion, 18, 16, 27, "#5a3830", "#2c1c19", "#0d0c0a");
      drawVolumeEllipse(s, -18, -1, 18, 21, "#9b5a42", "#63362c", "#271512");
      drawVolumeEllipse(s, 18, -1, 18, 21, "#9b5a42", "#63362c", "#271512");
      drawVolumeEllipse(s, 0, 8, 29, 31, "#a45f46", "#6e382d", "#291512");
      drawVolumeEllipse(s, 0, -24, 18, 18, "#b98258", "#755039", "#291d17");
      s.fillStyle = "#1d281b"; s.fillRect(-19, -44, 38, 13);
      const hat = s.createLinearGradient(-30, -39, 30, -29);
      hat.addColorStop(0, "#10150e"); hat.addColorStop(0.5, "#405137"); hat.addColorStop(1, "#151b13");
      s.fillStyle = hat; s.beginPath(); s.ellipse(0, -33, 31, 9, 0, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#070807"; s.beginPath(); s.ellipse(0, -29, 24, 5, 0, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#090a08"; s.fillRect(-16, -27, 32, 8);
      s.fillStyle = "#ef352e"; s.fillRect(-13, -25, 7, 3); s.fillRect(6, -25, 7, 3);
      s.strokeStyle = "#17130e"; s.lineWidth = 9; s.beginPath(); s.moveTo(-31, 2); s.lineTo(27, 17); s.stroke();
      s.strokeStyle = "#d0ad66"; s.lineWidth = 3; s.beginPath(); s.moveTo(-35, -2); s.lineTo(33, 16); s.stroke();
      drawVolumeEllipse(s, 34, 17, 10, 7, "#75613b", "#332b1c", "#0c0b08", 0.24);
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

  function renderDarts() {
    for (const dart of darts) {
      const time = clamp(dart.age / dart.duration, 0, 1);
      const travel = 1 - (1 - time) * (1 - time);
      const x = dart.startX + (dart.endX - dart.startX) * travel;
      const y = dart.startY + (dart.endY - dart.startY) * travel;
      const angle = Math.atan2(dart.endY - dart.startY, dart.endX - dart.startX);
      const length = 34 - travel * 24;
      const width = 7 - travel * 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = "#18230f";
      ctx.fillRect(-length, -width / 2 - 1, length + 5, width + 2);
      ctx.fillStyle = "#86a74b";
      ctx.fillRect(-length + 2, -width / 2, length, width);
      ctx.fillStyle = "#d6df80";
      ctx.fillRect(-length + 4, -width / 2, Math.max(3, length * 0.42), Math.max(1, width * 0.34));
      ctx.fillStyle = "#d7c69a";
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(0, -width); ctx.lineTo(0, width); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function weaponPose(sway, bob) {
    const gait = Math.sin(player.walkPhase * 0.5) * 13 * player.moveAmount;
    const originX = WIDTH / 2 + sway * 1.25 + gait;
    const originY = VIEW_HEIGHT - 2 + muzzleFlash * 22 + bob * 0.65;
    const targetX = 3 + (aim.x - WIDTH / 2) * 0.16;
    const targetY = -88 + (aim.y - VIEW_HEIGHT / 2) * 0.18;
    const rotation = clamp(Math.atan2(targetY, targetX) - Math.atan2(-88, 3), -0.34, 0.34);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      gait,
      originX,
      originY,
      rotation,
      muzzleX: originX + 3 * cos + 88 * sin,
      muzzleY: originY + 3 * sin - 88 * cos,
    };
  }

  function renderWeapon(sway, bob) {
    const pose = weaponPose(sway, bob);
    const gait = pose.gait;
    ctx.save();
    ctx.translate(pose.originX, pose.originY);
    ctx.rotate(pose.rotation);

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
    ctx.fillStyle = "#97221d";
    ctx.save(); ctx.translate(x, y - 27); ctx.rotate(-0.05); ctx.fillRect(-43, -5, 86, 11); ctx.restore();
    ctx.fillStyle = "#4f0e0d";
    ctx.beginPath(); ctx.arc(x + 40, y - 25, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8d1b18";
    ctx.beginPath(); ctx.moveTo(x + 42, y - 24); ctx.lineTo(x + 59, y - 17); ctx.lineTo(x + 48, y - 10); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 40, y - 24); ctx.lineTo(x + 55, y - 30); ctx.lineTo(x + 51, y - 19); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#171916";
    ctx.save(); ctx.translate(x - 18, y - 10); ctx.rotate(0.45); ctx.beginPath(); ctx.ellipse(0, 0, 12, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x + 18, y - 10); ctx.rotate(-0.45); ctx.beginPath(); ctx.ellipse(0, 0, 12, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = hurt ? "#d33b31" : "#ecf0d9";
    if (hurt) {
      ctx.fillRect(x - 23, y - 13, 10, 4); ctx.fillRect(x + 13, y - 13, 10, 4);
    } else {
      ctx.beginPath(); ctx.arc(x - 18, y - 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x + 13, y - 12, 10, 3);
    }
    ctx.fillStyle = "rgba(91,42,65,0.72)";
    ctx.beginPath(); ctx.ellipse(x - 27, y + 13, 10, 7, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(x + 26, y + 13);
    ctx.rotate(-0.35);
    ctx.fillStyle = "#d5caa5"; ctx.fillRect(-12, -5, 24, 10);
    ctx.strokeStyle = "#8d836c"; ctx.lineWidth = 2; ctx.strokeRect(-12, -5, 24, 10);
    ctx.fillStyle = "#9e9378"; ctx.fillRect(-5, -4, 2, 8); ctx.fillRect(4, -4, 2, 8);
    ctx.restore();
    ctx.strokeStyle = "#6f241f"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 38, y - 1); ctx.lineTo(x - 29, y + 4); ctx.moveTo(x - 40, y + 4); ctx.lineTo(x - 31, y + 9); ctx.stroke();
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
      const nextX = aim.x + event.movementX * 0.9;
      setAim(nextX, aim.y + event.movementY * 0.9);
      if (nextX < AIM_BOUNDS.left || nextX > AIM_BOUNDS.right) {
        player.angle = normalizeAngle(player.angle + event.movementX * 0.0024);
      }
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
    getState: () => ({
      state,
      player: { ...player },
      aim: { ...aim },
      dartsInFlight: darts.length,
      enemiesAlive: enemies.filter((enemy) => enemy.alive).length,
      enemies: enemies.map(({ type, x, y, hp, alive }) => ({ type, x, y, hp, alive })),
    }),
    start: startGame,
    shoot,
    aimAt: setAim,
    map: MAP.slice(),
  };
}());
