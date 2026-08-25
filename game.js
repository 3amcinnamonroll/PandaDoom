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
      moveEntity(player, dx, dy);
      player.walkPhase += dt * 10;
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

    const wallDistance = castRay(player.angle).distance;
    let target = null;
    let targetDistance = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = Math.hypot(dx, dy);
      const angle = Math.abs(normalizeAngle(Math.atan2(dy, dx) - player.angle));
      const hitWindow = Math.min(0.18, 0.36 / Math.max(distance, 1));
      if (angle < hitWindow && distance < wallDistance + 0.15 && distance < targetDistance) {
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
    const bob = state === "playing" ? Math.sin(player.walkPhase) * 2 : 0;
    const shakeX = shake ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY + bob);
    renderWorld();
    renderSprites();
    renderWeapon();
    ctx.restore();
    renderHud();
  }

  function renderWorld() {
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT / 2);
    sky.addColorStop(0, "#0a1116");
    sky.addColorStop(0.72, "#263a35");
    sky.addColorStop(1, "#ad8950");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT / 2);

    ctx.fillStyle = "#d7dbbd";
    ctx.beginPath();
    ctx.arc(790, 75, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c1c5aa";
    ctx.beginPath();
    ctx.arc(778, 65, 6, 0, Math.PI * 2);
    ctx.arc(805, 82, 8, 0, Math.PI * 2);
    ctx.fill();

    const floor = ctx.createLinearGradient(0, VIEW_HEIGHT / 2, 0, VIEW_HEIGHT);
    floor.addColorStop(0, "#5d4b2c");
    floor.addColorStop(1, "#13150e");
    ctx.fillStyle = floor;
    ctx.fillRect(0, VIEW_HEIGHT / 2, WIDTH, VIEW_HEIGHT / 2);

    const rayCount = 480;
    const stripWidth = WIDTH / rayCount;
    for (let ray = 0; ray < rayCount; ray += 1) {
      const rayAngle = player.angle - FOV / 2 + (ray / rayCount) * FOV;
      const hit = castRay(rayAngle);
      const corrected = Math.max(0.01, hit.distance * Math.cos(rayAngle - player.angle));
      const wallHeight = Math.min(VIEW_HEIGHT * 1.8, VIEW_HEIGHT / corrected);
      const top = VIEW_HEIGHT / 2 - wallHeight / 2;
      const shade = Math.max(0.2, 1 - corrected / MAX_DEPTH) * (hit.side ? 0.8 : 1);
      const stripe = Math.floor(hit.textureOffset * 8) % 2;
      let color;
      if (hit.cell === "2") {
        const base = stripe ? [92, 117, 49] : [128, 151, 65];
        color = `rgb(${base.map((value) => Math.floor(value * shade)).join(",")})`;
      } else {
        const base = stripe ? [81, 76, 55] : [105, 96, 65];
        color = `rgb(${base.map((value) => Math.floor(value * shade)).join(",")})`;
      }
      ctx.fillStyle = color;
      ctx.fillRect(ray * stripWidth, top, Math.ceil(stripWidth + 1), wallHeight);
      if (hit.cell === "2" && Math.floor(hit.textureOffset * 20) % 10 === 0) {
        ctx.fillStyle = `rgba(25,35,18,${0.28 * shade})`;
        ctx.fillRect(ray * stripWidth, top, Math.ceil(stripWidth + 1), wallHeight);
      }
      const start = Math.floor(ray * stripWidth);
      const end = Math.min(WIDTH, Math.ceil((ray + 1) * stripWidth));
      for (let x = start; x < end; x += 1) depthBuffer[x] = corrected;
    }

    renderExitGate();
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
      const screenX = WIDTH / 2 + Math.tan(angle) * (WIDTH / (2 * Math.tan(FOV / 2)));
      const size = Math.min(520, (sprite.kind === "enemy" ? 360 : 170) / distance);
      const top = VIEW_HEIGHT / 2 - size * (sprite.kind === "enemy" ? 0.62 : 0.05);
      const image = sprite.kind === "enemy" ? drawEnemySprite(sprite, size) : drawPickupSprite(sprite, size);
      const left = Math.floor(screenX - size / 2);
      for (let sx = 0; sx < Math.ceil(size); sx += 2) {
        const screenColumn = left + sx;
        if (screenColumn < 0 || screenColumn >= WIDTH || distance >= depthBuffer[screenColumn]) continue;
        ctx.drawImage(image, (sx / size) * image.width, 0, Math.max(1, (2 / size) * image.width), image.height, screenColumn, top, 2, size);
      }
    }
  }

  function spriteCanvas() {
    const offscreen = document.createElement("canvas");
    offscreen.width = 96;
    offscreen.height = 96;
    return [offscreen, offscreen.getContext("2d")];
  }

  function drawEnemySprite(enemy) {
    const [sprite, s] = spriteCanvas();
    const data = enemyCatalog[enemy.type];
    s.translate(48, 48 + Math.sin(enemy.phase) * 2);
    s.fillStyle = "#0008";
    s.beginPath();
    s.ellipse(0, 38, 31, 7, 0, 0, Math.PI * 2);
    s.fill();
    if (enemy.type === "fire") {
      s.fillStyle = data.color;
      s.beginPath();
      s.moveTo(-27, 33); s.quadraticCurveTo(-38, 2, -15, -13);
      s.quadraticCurveTo(-17, -36, 2, -46); s.quadraticCurveTo(28, -20, 18, -2);
      s.quadraticCurveTo(42, 13, 25, 34); s.closePath(); s.fill();
      s.fillStyle = data.accent;
      s.beginPath();
      s.moveTo(-11, 27); s.quadraticCurveTo(-19, 2, 1, -19);
      s.quadraticCurveTo(19, 6, 11, 29); s.closePath(); s.fill();
      s.fillStyle = "#1d120b"; s.fillRect(-15, -1, 9, 6); s.fillRect(8, -1, 9, 6);
    } else if (enemy.type === "leopard") {
      s.fillStyle = data.color;
      s.beginPath(); s.ellipse(0, 8, 35, 25, 0, 0, Math.PI * 2); s.fill();
      s.beginPath(); s.arc(27, -12, 20, 0, Math.PI * 2); s.fill();
      s.beginPath(); s.arc(17, -28, 8, 0, Math.PI * 2); s.arc(37, -28, 8, 0, Math.PI * 2); s.fill();
      s.lineWidth = 8; s.strokeStyle = data.color; s.beginPath(); s.arc(-31, -4, 25, 1.5, 4.8); s.stroke();
      s.fillStyle = data.accent;
      for (const [x, y] of [[-20,-2],[-5,8],[12,4],[-12,20],[23,16],[22,-13],[34,-13]]) {
        s.beginPath(); s.arc(x, y, 3.5, 0, Math.PI * 2); s.fill();
      }
      s.fillStyle = "#e8ff82"; s.fillRect(20, -17, 5, 4); s.fillRect(32, -17, 5, 4);
      s.fillStyle = "#303534"; s.fillRect(-25, 23, 9, 15); s.fillRect(15, 23, 9, 15);
    } else {
      s.fillStyle = data.color;
      s.fillRect(-21, -5, 42, 45);
      s.fillStyle = "#a88763";
      s.beginPath(); s.arc(0, -20, 17, 0, Math.PI * 2); s.fill();
      s.fillStyle = "#34452c";
      s.beginPath(); s.ellipse(0, -30, 28, 7, 0, 0, Math.PI * 2); s.fill();
      s.fillRect(-16, -40, 32, 11);
      s.strokeStyle = data.accent; s.lineWidth = 7;
      s.beginPath(); s.moveTo(13, 3); s.lineTo(31, 30); s.stroke();
      s.fillStyle = "#15170f"; s.fillRect(-15, -24, 8, 5); s.fillRect(7, -24, 8, 5);
      s.fillStyle = "#28271f"; s.fillRect(-20, 35, 15, 9); s.fillRect(5, 35, 15, 9);
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

  function renderWeapon() {
    const recoil = muzzleFlash * 18;
    ctx.save();
    ctx.translate(WIDTH / 2, VIEW_HEIGHT - 4 + recoil);
    ctx.fillStyle = "#1a1d16";
    ctx.beginPath(); ctx.ellipse(-62, 44, 82, 54, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(62, 44, 82, 54, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d8d4c3";
    ctx.beginPath(); ctx.ellipse(-63, 42, 44, 32, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(63, 42, 44, 32, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#557436"; ctx.fillRect(-18, -26, 36, 94);
    ctx.fillStyle = "#91ad52"; ctx.fillRect(-10, -26, 10, 94);
    ctx.fillStyle = "#2b3e23"; ctx.fillRect(-21, -11, 42, 8); ctx.fillRect(-21, 23, 42, 8);
    if (muzzleFlash > 0.15) {
      ctx.fillStyle = `rgba(255,214,74,${muzzleFlash})`;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(-38, -78); ctx.lineTo(-7, -67);
      ctx.lineTo(0, -108); ctx.lineTo(10, -66); ctx.lineTo(38, -78); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function renderHud() {
    ctx.fillStyle = "#161913";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH, HEIGHT - VIEW_HEIGHT);
    ctx.fillStyle = "#30352a";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH, 5);
    ctx.fillStyle = "#8ea04f";
    ctx.fillRect(0, VIEW_HEIGHT, WIDTH * (player.health / 100), 5);

    drawHudNumber(36, 493, player.health, "HEALTH", player.health <= 30 ? "#e84d37" : "#f1edda");
    drawPandaFace(WIDTH / 2, 496);
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

  function startGame() {
    resetGame();
    setState("playing");
    canvas.focus();
    canvas.requestPointerLock?.();
  }

  function togglePause() {
    if (state === "playing") {
      setState("paused");
      document.exitPointerLock?.();
    } else if (state === "paused") {
      setState("playing");
      canvas.requestPointerLock?.();
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
    else canvas.requestPointerLock?.();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      pointerWasLocked = true;
      return;
    }
    if (state === "playing" && pointerWasLocked && !matchMedia("(pointer: coarse)").matches) setState("paused");
    pointerWasLocked = false;
  });

  document.querySelectorAll("[data-control]").forEach((button) => {
    const control = button.dataset.control;
    const on = (event) => { event.preventDefault(); touch[control] = true; button.classList.add("active"); };
    const off = (event) => { event.preventDefault(); touch[control] = false; button.classList.remove("active"); };
    button.addEventListener("pointerdown", on);
    button.addEventListener("pointerup", off);
    button.addEventListener("pointercancel", off);
    button.addEventListener("pointerleave", off);
  });
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
