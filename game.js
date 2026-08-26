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
  const PROJECTION_PLANE = WIDTH / (2 * Math.tan(FOV / 2));
  const CAMERA_HEIGHT = 0.5;
  const MESH_NEAR = 0.08;
  const MESH_PIXEL = 2;
  const AIM_BOUNDS = { top: VIEW_HEIGHT * 0.16, bottom: VIEW_HEIGHT * 0.84 };
  const MODEL_BOUNDS = {
    poacher: { width: 0.92, height: 1.24 },
    leopard: { width: 1.05, height: 1.08 },
    fire: { width: 0.9, height: 1.32 },
  };
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
  let meshDebug = { models: 0, triangles: 0, visibleTriangles: 0, pixels: 0 };
  const aim = { x: WIDTH / 2, y: VIEW_HEIGHT / 2 };
  let pointerWasLocked = false;
  let mouseCaptureUnavailable = false;
  let pendingCaptureClick = false;
  let inspectionMode = false;

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
    inspectionMode = false;
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
    setAim(VIEW_HEIGHT / 2);
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
      facing: Math.atan2(player.y - y, player.x - x),
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

  function turnToward(angle, target, maximumStep) {
    const difference = normalizeAngle(target - angle);
    return normalizeAngle(angle + clamp(difference, -maximumStep, maximumStep));
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function setAim(y) {
    aim.x = WIDTH / 2;
    aim.y = clamp(y, AIM_BOUNDS.top, AIM_BOUNDS.bottom);
    ui.crosshair.style.left = `${(aim.x / WIDTH) * 100}%`;
    ui.crosshair.style.top = `${(aim.y / HEIGHT) * 100}%`;
  }

  function castRayFrom(originX, originY, angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let distance = 0;
    let lastX = originX;
    let lastY = originY;
    while (distance < MAX_DEPTH) {
      distance += 0.025;
      const x = originX + cos * distance;
      const y = originY + sin * distance;
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

  function castRay(angle) {
    return castRayFrom(player.x, player.y, angle);
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

    const turn = ((keys.ArrowRight || keys.KeyE || keys.KeyL || touch.turnRight) ? 1 : 0) -
      ((keys.ArrowLeft || keys.KeyQ || keys.KeyJ || touch.turnLeft) ? 1 : 0);
    player.angle = normalizeAngle(player.angle + turn * 2.15 * dt);

    const aimVertical = (keys.KeyK ? 1 : 0) - (keys.KeyI ? 1 : 0);
    if (aimVertical) setAim(aim.y + aimVertical * 260 * dt);

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
      if (inspectionMode) continue;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      enemy.facing = turnToward(enemy.facing, Math.atan2(dy, dx), dt * 1.8);
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

  function projectEnemy(enemy, camera = player) {
    const dx = enemy.x - camera.x;
    const dy = enemy.y - camera.y;
    const distance = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx) - camera.angle);
    if (Math.abs(angle) > FOV * 0.78 || distance < 0.25) return null;
    const depth = distance * Math.cos(angle);
    const bounds = MODEL_BOUNDS[enemy.type];
    const screenX = WIDTH / 2 + Math.tan(angle) * PROJECTION_PLANE;
    const size = Math.min(VIEW_HEIGHT * 1.8, (bounds.height * VIEW_HEIGHT) / Math.max(depth, 0.25));
    const halfWidth = Math.min(WIDTH, (bounds.width * PROJECTION_PLANE) / (2 * Math.max(depth, 0.25)));
    const groundY = VIEW_HEIGHT / 2 + (CAMERA_HEIGHT * VIEW_HEIGHT) / Math.max(depth, 0.25);
    return { distance, depth, screenX, size, halfWidth, groundY, top: groundY - size };
  }

  function wallDepthAtScreenX(screenX, camera = player) {
    const projectionPlane = WIDTH / (2 * Math.tan(FOV / 2));
    const angleOffset = Math.atan((screenX - WIDTH / 2) / projectionPlane);
    return castRayFrom(camera.x, camera.y, camera.angle + angleOffset).distance * Math.cos(angleOffset);
  }

  function dartTargetAtImpact(dart) {
    if (!dart.target?.alive) return null;
    const projection = projectEnemy(dart.target, dart.camera);
    if (!projection) return null;
    const withinX = Math.abs(dart.endX - projection.screenX) < projection.halfWidth * 0.9;
    const withinY = dart.endY > projection.top + projection.size * 0.05 && dart.endY < projection.groundY - projection.size * 0.04;
    const unobstructed = projection.depth < wallDepthAtScreenX(dart.endX, dart.camera) + 0.08;
    return withinX && withinY && unobstructed && hasLineOfSight(dart.camera.x, dart.camera.y, dart.target.x, dart.target.y) ? dart.target : null;
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
        damageEnemy(dartTargetAtImpact(dart));
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
      const withinX = Math.abs(aim.x - projection.screenX) < projection.halfWidth * 0.9;
      const withinY = aim.y > projection.top + projection.size * 0.05 && aim.y < projection.groundY - projection.size * 0.04;
      const visibleAtAim = projection.depth < wallDepthAtScreenX(aim.x) + 0.08;
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
      camera: { x: player.x, y: player.y, angle: player.angle },
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
    meshDebug = { models: 0, triangles: 0, visibleTriangles: 0, pixels: 0 };

    for (const sprite of sprites) {
      const dx = sprite.x - player.x;
      const dy = sprite.y - player.y;
      const distance = Math.hypot(dx, dy);
      const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
      if (sprite.kind === "enemy") {
        const projection = projectEnemy(sprite);
        if (!projection) continue;
        renderEnemyShadow(projection, distance);
        renderEnemyMesh(sprite);
        continue;
      }

      if (Math.abs(angle) > FOV * 0.78 || distance < 0.25) continue;
      const spriteDepth = distance * Math.cos(angle);
      const screenX = WIDTH / 2 + Math.tan(angle) * PROJECTION_PLANE;
      const size = Math.min(520, 170 / Math.max(spriteDepth, 0.25));
      const groundY = VIEW_HEIGHT / 2 + size * 0.48;
      const top = groundY - size;
      const image = drawPickupSprite(sprite, size);
      const left = Math.floor(screenX - size / 2);
      for (let sx = 0; sx < Math.ceil(size); sx += 3) {
        const screenColumn = left + sx;
        if (screenColumn < 0 || screenColumn >= WIDTH || spriteDepth >= depthBuffer[screenColumn]) continue;
        ctx.drawImage(image, (sx / size) * image.width, 0, Math.max(1, (3 / size) * image.width), image.height, screenColumn, top, 3, size);
      }
    }
  }

  function renderEnemyShadow(projection, distance) {
    const shadowRadiusX = projection.halfWidth * 0.88;
    const shadowRadiusY = Math.max(2, projection.halfWidth * 0.18);
    const shadowCenterY = projection.groundY - shadowRadiusY * 0.35;
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.72, 0.38 + 0.04 * distance)})`;
    for (let x = Math.floor(projection.screenX - shadowRadiusX); x <= projection.screenX + shadowRadiusX; x += 1) {
      if (x < 0 || x >= WIDTH || projection.depth >= depthBuffer[x]) continue;
      const normalizedX = (x - projection.screenX) / shadowRadiusX;
      const halfHeight = shadowRadiusY * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
      ctx.fillRect(x, shadowCenterY - halfHeight, 1, halfHeight * 2);
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

  const meshSurface = document.createElement("canvas");
  meshSurface.width = WIDTH;
  meshSurface.height = VIEW_HEIGHT;
  const meshContext = meshSurface.getContext("2d");
  meshContext.imageSmoothingEnabled = false;

  function rotateModelPoint(point, yaw) {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    return {
      x: point.x * cosine - point.y * sine,
      y: point.x * sine + point.y * cosine,
      z: point.z,
    };
  }

  function addTriangle(mesh, a, b, c, color) {
    mesh.push({ vertices: [a, b, c], color });
  }

  function addBox(mesh, x, y, z, width, depth, height, color, yaw = 0) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const halfHeight = height / 2;
    const points = [
      { x: -halfWidth, y: -halfDepth, z: -halfHeight }, { x: halfWidth, y: -halfDepth, z: -halfHeight },
      { x: halfWidth, y: halfDepth, z: -halfHeight }, { x: -halfWidth, y: halfDepth, z: -halfHeight },
      { x: -halfWidth, y: -halfDepth, z: halfHeight }, { x: halfWidth, y: -halfDepth, z: halfHeight },
      { x: halfWidth, y: halfDepth, z: halfHeight }, { x: -halfWidth, y: halfDepth, z: halfHeight },
    ].map((point) => {
      const rotated = rotateModelPoint(point, yaw);
      return { x: rotated.x + x, y: rotated.y + y, z: rotated.z + z };
    });
    const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
    for (const [a, b, c] of faces) addTriangle(mesh, points[a], points[b], points[c], color);
  }

  function addPyramid(mesh, x, y, z, width, depth, height, color, yaw = 0) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const points = [
      { x: -halfWidth, y: -halfDepth, z: 0 }, { x: halfWidth, y: -halfDepth, z: 0 },
      { x: halfWidth, y: halfDepth, z: 0 }, { x: -halfWidth, y: halfDepth, z: 0 },
      { x: 0, y: 0, z: height },
    ].map((point) => {
      const rotated = rotateModelPoint(point, yaw);
      return { x: rotated.x + x, y: rotated.y + y, z: rotated.z + z };
    });
    const faces = [[0,2,1],[0,3,2],[0,1,4],[1,2,4],[2,3,4],[3,0,4]];
    for (const [a, b, c] of faces) addTriangle(mesh, points[a], points[b], points[c], color);
  }

  function buildEnemyMesh(enemy) {
    const mesh = [];
    const stride = Math.sin(enemy.phase) * 0.045;
    if (enemy.type === "poacher") {
      addBox(mesh, -0.15, 0, 0.2 + Math.max(0, stride), 0.2, 0.24, 0.4, "#3b2722");
      addBox(mesh, 0.15, 0, 0.2 + Math.max(0, -stride), 0.2, 0.24, 0.4, "#3b2722");
      addBox(mesh, 0, 0, 0.58, 0.55, 0.32, 0.5, "#713e32");
      addBox(mesh, -0.36, 0.02, 0.6, 0.16, 0.2, 0.46, "#7e4938", -0.08);
      addBox(mesh, 0.36, 0.04, 0.6, 0.16, 0.2, 0.46, "#7e4938", 0.08);
      addBox(mesh, 0, 0.03, 0.96, 0.34, 0.31, 0.3, "#9f6547");
      addBox(mesh, 0, 0.02, 1.08, 0.56, 0.44, 0.07, "#1c2b1a");
      addBox(mesh, 0, 0, 1.16, 0.38, 0.32, 0.16, "#31442c");
      addBox(mesh, -0.08, 0.195, 1.0, 0.07, 0.035, 0.055, "#ff332a");
      addBox(mesh, 0.08, 0.195, 1.0, 0.07, 0.035, 0.055, "#ff332a");
      addBox(mesh, 0.03, 0.24, 0.65, 0.62, 0.13, 0.13, "#6d542f", -0.08);
      addBox(mesh, 0.18, 0.55, 0.67, 0.08, 0.62, 0.08, "#171b13");
    } else if (enemy.type === "leopard") {
      addBox(mesh, -0.23, -0.24, 0.22 + Math.max(0, stride), 0.16, 0.2, 0.44, "#73807d");
      addBox(mesh, 0.23, -0.24, 0.22 + Math.max(0, -stride), 0.16, 0.2, 0.44, "#73807d");
      addBox(mesh, -0.23, 0.28, 0.22 + Math.max(0, -stride), 0.16, 0.2, 0.44, "#9aa4a1");
      addBox(mesh, 0.23, 0.28, 0.22 + Math.max(0, stride), 0.16, 0.2, 0.44, "#9aa4a1");
      addBox(mesh, 0, -0.02, 0.5, 0.66, 0.84, 0.38, "#899492");
      addBox(mesh, 0, 0.34, 0.57, 0.7, 0.46, 0.43, "#aab3b0");
      addBox(mesh, 0, 0.62, 0.72, 0.48, 0.43, 0.42, "#b9c2bf");
      addBox(mesh, 0, 0.86, 0.64, 0.34, 0.27, 0.23, "#7a8582");
      addPyramid(mesh, -0.14, 0.64, 0.86, 0.17, 0.16, 0.2, "#687370", -0.08);
      addPyramid(mesh, 0.14, 0.64, 0.86, 0.17, 0.16, 0.2, "#687370", 0.08);
      addBox(mesh, -0.11, 0.846, 0.77, 0.07, 0.035, 0.06, "#ff382e");
      addBox(mesh, 0.11, 0.846, 0.77, 0.07, 0.035, 0.06, "#ff382e");
      addBox(mesh, 0, 1.005, 0.67, 0.09, 0.04, 0.07, "#111514");
      addBox(mesh, -0.09, 1.018, 0.56, 0.065, 0.035, 0.14, "#eee3c5", -0.08);
      addBox(mesh, 0.09, 1.018, 0.56, 0.065, 0.035, 0.14, "#eee3c5", 0.08);
      addBox(mesh, -0.08, -0.53, 0.57, 0.18, 0.38, 0.17, "#77827f", 0.2);
      addBox(mesh, -0.22, -0.82, 0.6, 0.16, 0.38, 0.15, "#56615e", 0.55);
      for (const [x, y, z] of [[-0.22,0.585,0.55],[0.22,0.585,0.62],[-0.12,0.585,0.42],[0.1,0.585,0.48]]) {
        addBox(mesh, x, y, z, 0.12, 0.04, 0.1, "#303a38");
      }
      for (const [x, y, z] of [[-0.342,-0.22,0.58],[-0.342,0.08,0.46],[-0.342,0.3,0.65],[0.342,-0.15,0.48],[0.342,0.18,0.62]]) {
        addBox(mesh, x, y, z, 0.035, 0.13, 0.11, "#303a38");
      }
    } else {
      addBox(mesh, -0.2, 0, 0.2 + Math.max(0, stride), 0.2, 0.24, 0.4, "#4c2015");
      addBox(mesh, 0.2, 0, 0.2 + Math.max(0, -stride), 0.2, 0.24, 0.4, "#4c2015");
      addPyramid(mesh, 0, 0, 0.2, 0.78, 0.62, 0.95 + stride, "#bc3c1d");
      addPyramid(mesh, -0.2, 0.02, 0.43, 0.43, 0.4, 0.83 - stride, "#e45b23", -0.2);
      addPyramid(mesh, 0.22, -0.03, 0.4, 0.42, 0.38, 0.92 + stride, "#d94b1e", 0.18);
      addBox(mesh, 0, 0.16, 0.66, 0.48, 0.34, 0.38, "#ef7627");
      addBox(mesh, -0.12, 0.345, 0.72, 0.09, 0.035, 0.075, "#ff2b20");
      addBox(mesh, 0.12, 0.345, 0.72, 0.09, 0.035, 0.075, "#ff2b20");
      addBox(mesh, 0, 0.35, 0.56, 0.24, 0.04, 0.06, "#2c100b");
    }
    return mesh;
  }

  function triangleNormal(vertices) {
    const ab = { x: vertices[1].x - vertices[0].x, y: vertices[1].y - vertices[0].y, z: vertices[1].z - vertices[0].z };
    const ac = { x: vertices[2].x - vertices[0].x, y: vertices[2].y - vertices[0].y, z: vertices[2].z - vertices[0].z };
    const normal = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  }

  function modelPointToWorld(enemy, point) {
    const cosine = Math.cos(enemy.facing);
    const sine = Math.sin(enemy.facing);
    return { x: enemy.x + cosine * point.y - sine * point.x, y: enemy.y + sine * point.y + cosine * point.x, z: point.z };
  }

  function scaleModelPoint(point) {
    return { x: point.x * 0.82, y: point.y * 0.52, z: point.z };
  }

  function modelNormalToWorld(enemy, normal) {
    const cosine = Math.cos(enemy.facing);
    const sine = Math.sin(enemy.facing);
    return { x: cosine * normal.y - sine * normal.x, y: sine * normal.y + cosine * normal.x, z: normal.z };
  }

  function worldPointToCamera(point) {
    const dx = point.x - player.x;
    const dy = point.y - player.y;
    return {
      side: -dx * Math.sin(player.angle) + dy * Math.cos(player.angle),
      depth: dx * Math.cos(player.angle) + dy * Math.sin(player.angle),
      z: point.z,
    };
  }

  function clipMeshNear(vertices) {
    const clipped = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const current = vertices[index];
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const currentInside = current.depth >= MESH_NEAR;
      const previousInside = previous.depth >= MESH_NEAR;
      if (currentInside !== previousInside) {
        const amount = (MESH_NEAR - previous.depth) / (current.depth - previous.depth);
        clipped.push({
          side: previous.side + (current.side - previous.side) * amount,
          depth: MESH_NEAR,
          z: previous.z + (current.z - previous.z) * amount,
        });
      }
      if (currentInside) clipped.push(current);
    }
    return clipped;
  }

  function projectMeshPoint(point) {
    return {
      x: WIDTH / 2 + (point.side / point.depth) * PROJECTION_PLANE,
      y: VIEW_HEIGHT / 2 + ((CAMERA_HEIGHT - point.z) / point.depth) * VIEW_HEIGHT,
      inverseDepth: 1 / point.depth,
    };
  }

  function shadeMeshColor(color, normal, depth, hitFlash) {
    const value = parseInt(color.slice(1), 16);
    const base = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    const light = { x: -0.52, y: -0.39, z: 0.76 };
    const diffuse = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z);
    const fog = clamp(1 - depth / (MAX_DEPTH * 1.25), 0.38, 1);
    const brightness = (0.3 + diffuse * 0.7) * fog;
    const flash = clamp(hitFlash * 0.78, 0, 0.78);
    return base.map((channel) => Math.round(channel * brightness * (1 - flash) + 255 * flash));
  }

  function rasterizeMeshTriangle(triangle, image, zBuffer, originX, originY) {
    const [a, b, c] = triangle.points;
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 0.0001) return;
    const minX = Math.max(Math.ceil(originX / MESH_PIXEL) * MESH_PIXEL, Math.floor(Math.min(a.x, b.x, c.x) / MESH_PIXEL) * MESH_PIXEL);
    const maxX = Math.min(originX + image.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(Math.ceil(originY / MESH_PIXEL) * MESH_PIXEL, Math.floor(Math.min(a.y, b.y, c.y) / MESH_PIXEL) * MESH_PIXEL);
    const maxY = Math.min(originY + image.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = minY; y <= maxY; y += MESH_PIXEL) {
      for (let x = minX; x <= maxX; x += MESH_PIXEL) {
        const sampleX = x + MESH_PIXEL * 0.5;
        const sampleY = y + MESH_PIXEL * 0.5;
        const wa = ((b.y - c.y) * (sampleX - c.x) + (c.x - b.x) * (sampleY - c.y)) / denominator;
        const wb = ((c.y - a.y) * (sampleX - c.x) + (a.x - c.x) * (sampleY - c.y)) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue;
        const inverseDepth = wa * a.inverseDepth + wb * b.inverseDepth + wc * c.inverseDepth;
        const depth = 1 / Math.max(0.0001, inverseDepth);
        for (let offsetY = 0; offsetY < MESH_PIXEL; offsetY += 1) {
          for (let offsetX = 0; offsetX < MESH_PIXEL; offsetX += 1) {
            const globalX = x + offsetX;
            const globalY = y + offsetY;
            if (globalX > maxX || globalY > maxY || globalX < 0 || globalX >= WIDTH || globalY < 0 || globalY >= VIEW_HEIGHT) continue;
            if (depth >= depthBuffer[globalX] - 0.015) continue;
            const localX = globalX - originX;
            const localY = globalY - originY;
            const pixel = localY * image.width + localX;
            if (depth >= zBuffer[pixel]) continue;
            zBuffer[pixel] = depth;
            const dataIndex = pixel * 4;
            image.data[dataIndex] = triangle.color[0];
            image.data[dataIndex + 1] = triangle.color[1];
            image.data[dataIndex + 2] = triangle.color[2];
            image.data[dataIndex + 3] = 255;
            meshDebug.pixels += 1;
          }
        }
      }
    }
  }

  function renderEnemyMesh(enemy) {
    const mesh = buildEnemyMesh(enemy);
    const projectedTriangles = [];
    let minX = WIDTH;
    let maxX = 0;
    let minY = VIEW_HEIGHT;
    let maxY = 0;
    meshDebug.models += 1;
    meshDebug.triangles += mesh.length;

    for (const triangle of mesh) {
      const modelVertices = triangle.vertices.map(scaleModelPoint);
      const worldVertices = modelVertices.map((point) => modelPointToWorld(enemy, point));
      const localNormal = triangleNormal(modelVertices);
      const normal = modelNormalToWorld(enemy, localNormal);
      const center = worldVertices.reduce((sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3, z: sum.z + point.z / 3 }), { x: 0, y: 0, z: 0 });
      const toCamera = { x: player.x - center.x, y: player.y - center.y, z: CAMERA_HEIGHT - center.z };
      if (normal.x * toCamera.x + normal.y * toCamera.y + normal.z * toCamera.z <= 0) continue;
      const cameraVertices = worldVertices.map(worldPointToCamera);
      const clipped = clipMeshNear(cameraVertices);
      if (clipped.length < 3) continue;
      for (let index = 1; index < clipped.length - 1; index += 1) {
        const points = [clipped[0], clipped[index], clipped[index + 1]].map(projectMeshPoint);
        if (points.every((point) => point.x < 0) || points.every((point) => point.x >= WIDTH) ||
            points.every((point) => point.y < 0) || points.every((point) => point.y >= VIEW_HEIGHT)) continue;
        const depth = 3 / (points[0].inverseDepth + points[1].inverseDepth + points[2].inverseDepth);
        const projected = { points, color: shadeMeshColor(triangle.color, normal, depth, enemy.hitFlash) };
        projectedTriangles.push(projected);
        minX = Math.min(minX, ...points.map((point) => point.x));
        maxX = Math.max(maxX, ...points.map((point) => point.x));
        minY = Math.min(minY, ...points.map((point) => point.y));
        maxY = Math.max(maxY, ...points.map((point) => point.y));
      }
    }

    if (!projectedTriangles.length) return;
    const originX = clamp(Math.floor(minX) - 1, 0, WIDTH - 1);
    const originY = clamp(Math.floor(minY) - 1, 0, VIEW_HEIGHT - 1);
    const endX = clamp(Math.ceil(maxX) + 1, 0, WIDTH - 1);
    const endY = clamp(Math.ceil(maxY) + 1, 0, VIEW_HEIGHT - 1);
    const width = endX - originX + 1;
    const height = endY - originY + 1;
    if (width <= 0 || height <= 0) return;
    const image = meshContext.createImageData(width, height);
    const zBuffer = new Float32Array(width * height);
    zBuffer.fill(Infinity);
    meshDebug.visibleTriangles += projectedTriangles.length;
    for (const triangle of projectedTriangles) rasterizeMeshTriangle(triangle, image, zBuffer, originX, originY);
    meshContext.clearRect(originX, originY, width, height);
    meshContext.putImageData(image, originX, originY);
    ctx.drawImage(meshSurface, originX, originY, width, height, originX, originY, width, height);
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
    const targetX = 3;
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
      player.angle = normalizeAngle(player.angle + event.movementX * 0.0024);
      setAim(aim.y + event.movementY * 0.9);
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
      enemies: enemies.map(({ type, x, y, hp, alive, facing }) => ({ type, x, y, hp, alive, facing })),
      mesh3d: { ...meshDebug },
    }),
    start: startGame,
    shoot,
    aimAt: (_x, y) => setAim(y),
    setInspectionMode: (enabled) => { inspectionMode = Boolean(enabled); },
    viewFrom: (x, y, angle) => {
      if (!canOccupy(x, y)) return false;
      player.x = x;
      player.y = y;
      player.angle = normalizeAngle(angle);
      return true;
    },
    modelStats: () => Object.fromEntries(Object.keys(enemyCatalog).map((type) => [type, {
      triangles: buildEnemyMesh({ type, phase: 0 }).length,
      billboard: false,
    }])),
    map: MAP.slice(),
  };
}());
