"use strict";

/* ============================================================
   无尽回响：轮回 — 探索（explore）
   ------------------------------------------------------------
   坐标：以"格"为单位的无限平面世界
     城镇 = 固定地图（格坐标 + 围墙/房屋碰撞 + 固定 NPC/出口）
     野外 = 无限平面（没有边界，可以一直往一个方向走）
   相机跟随在 ui.js 里实现（把世界层整体平移）
   依赖：data.js / core.js / battle.js
   ============================================================ */

const TILE_SPEED = 4.2;          // 每秒移动格数
const TILE_SPEED_AUTO = 3.4;
const INTERACT_RANGE = 1.6;      // 靠近多少格出现互动按钮

const Explore = {
  active: false,
  dir: { x:0, y:0 },
  keys: {},
  steps: 0,
  stepNeed: 0,                   // 还差几步触发遇敌
  near: null,                    // 当前可互动的对象
  auto: false,
  autoTarget: null,
  autoTimer: 0,
  lastFrame: 0,
};

/* ============================================================
   地形：世界是无限的，只有城镇有碰撞
   ============================================================ */
function currentZone() { return ZONES[G.zone]; }
function isTown() { return !!ZONES[G.zone].safe; }
function zoneW() { return ZONES[G.zone].w || TOWN_W; }
function zoneH() { return ZONES[G.zone].h || TOWN_H; }

function townTileAt(gx, gy) {
  /* 坐标是小数（角色可以在格与格之间），取整后才能当下标用 */
  const cx = Math.floor(gx), cy = Math.floor(gy);
  if (cy < 0 || cy >= TOWN_H || cx < 0 || cx >= TOWN_W) return '1';
  return TOWN_MAP[cy][cx];
}

/* 世界坐标（像素）←→ 格坐标：统一世界原点，负坐标也成立 */
function tileToWorld(tx, ty) { return { x:tx * TILE, y:ty * TILE }; }
function worldToTile(wx, wy) { return { x:wx / TILE, y:wy / TILE }; }

/* 世界像素坐标（玩家一直朝屏幕中心移动） */
function playerWorld() { return tileToWorld(G.pos.x, G.pos.y); }

/* 能否走到这一格：野外永远可以；城镇有围墙与房屋
   注意：传入的坐标可能是小数，必须先取整，否则数组下标为小数会抛异常 */
function isWalkable(gx, gy) {
  if (!isTown()) return true;
  const t = townTileAt(gx, gy);
  return t === '0' || t === '3';
}

/* ============================================================
   固定坐标：NPC / 出口 / 区域通道
   ============================================================ */
function npcPos(n) { return { x:n.x, y:n.y }; }
function townExitPos(e) { return { x:e.x, y:e.y }; }

function wildExitPos(zoneId) {
  const ex = WILD_EXITS[zoneId];
  return ex ? { x:ex.x, y:ex.y } : null;
}

function zoneGatePos(zoneId, gate) {
  return { x:gate.x, y:gate.y };
}

/* 从某点朝目标点的方向描述，用于"回城方向"提示 */
function dirHint(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const parts = [];
  if (Math.abs(dy) > 2) parts.push(dy < 0 ? '北' : '南');
  if (Math.abs(dx) > 2) parts.push(dx < 0 ? '西' : '东');
  const dist = Math.round(Math.hypot(dx, dy));
  return (parts.length ? parts.join('') : '就在附近') + ` ${dist} 格`;
}

/* 城镇出生点：一块空旷地（不要在房子里或墙里） */
const TOWN_SPAWN = { x:14, y:7 };

/* 万一角色落在了墙里/房子里（比如存档坐标过时），就近挪到空地上 */
function ensureWalkable() {
  if (!isTown()) return;
  if (isWalkable(G.pos.x, G.pos.y)) return;
  const cx = Math.floor(G.pos.x), cy = Math.floor(G.pos.y);
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (isWalkable(tx + 0.5, ty + 0.5)) { G.pos = { x:tx + 0.5, y:ty + 0.5 }; return; }
      }
    }
  }
}

/* ============================================================
   进入探索
   ============================================================ */
function enterExplore(spawn) {
  Explore.active = true;
  Explore.auto = false;
  Explore.near = null;
  Explore.steps = 0;
  Explore.stepNeed = rndi(ENCOUNTER_STEPS[0], ENCOUNTER_STEPS[1]);
  Explore.dir = { x:0, y:0 };

  if (spawn === 'west')       G.pos = { x:TOWN_SPAWN.x, y:TOWN_SPAWN.y };  // 镇中心空地
  else if (spawn === 'gate')  G.pos = { x:TOWN_W - 3, y:1.5 };             // 从城门回城
  else if (spawn === 'out')   G.pos = { x:SPAWN.wild.x, y:SPAWN.wild.y };  // 出城进野外
  else if (spawn === 'ruins') G.pos = { x:SPAWN.ruins.x, y:SPAWN.ruins.y };
  else if (spawn === 'tomb')  G.pos = { x:SPAWN.tomb.x, y:SPAWN.tomb.y };
  else if (spawn === 'town')  G.pos = { x:TOWN_SPAWN.x, y:TOWN_SPAWN.y };
  /* 'here'：原地继续 */

  if (isTown()) {
    const sz = townSizeTiles();
    G.pos.x = clamp(G.pos.x, 1.5, sz.w - 1.5);
    G.pos.y = clamp(G.pos.y, 1.5, sz.h - 1.5);
    ensureWalkable();
  }

  ui.showScreen('explore');
  ui.renderExplore(true);
  ui.setAutoButton(false);
  ui.updateLocName();
  ui.updateHint();
  setTimeout(ui.updateHint, 3600);

  ui.showScreen('explore');
  ui.renderExplore();
  ui.setAutoButton(false);
  ui.updateLocName();
  ui.updateHint();
  setTimeout(ui.updateHint, 3600);

  Explore.lastFrame = performance.now();
  requestAnimationFrame(loopExplore);

  /* 城外提示：告诉玩家怎么回城、下一个区域在哪 */
  if (!isTown()) updateWorldHint();

  /* 王陵深处：首次进入直接触发 BOSS 战 */
  if (G.zone === 'tomb' && !G.bossKilled && !G.flags.bossMet) {
    G.flags.bossMet = true;
    G.flags.pendingBoss = true;
    ui.showDialogText('沙之支配者', '🐲',
      '「又一个来送死的凡人…」\n\n风沙骤然聚拢，沙之支配者从王座后升起。');
    setTimeout(() => { pendingBossFight(); }, 2600);
  }
}

function townSizeTiles() { return { w:TOWN_W, h:TOWN_H }; }

/* 待触发的 BOSS 战（对话框播完再打） */
function pendingBossFight() {
  if (!G || !G.flags.pendingBoss) return;
  if (Battle.active || !Explore.active) return;
  G.flags.pendingBoss = false;
  battleStart([makeEnemy('boss', [12, 14]),
               makeEnemy('eliteMummy', [10, 12]),
               makeEnemy('eliteScorpion', [10, 12])]);
}

function updateWorldHint() {
  const back = wildExitPos(G.zone);
  const gate = (ZONE_GATES[G.zone] || [])[0];
  let text = '';
  if (back && gate) text = `⚠️ ${currentZone().name} · 回城：${dirHint(G.pos, back)}　│　${gate.name}：${dirHint(G.pos, gate)}`;
  else if (back)    text = `⚠️ ${currentZone().name} · 回城：${dirHint(G.pos, back)}`;
  else              text = `⚠️ ${currentZone().name} · 小心暗雷`;
  G.worldHint = text;
  ui.updateHint();
}

/* ============================================================
   调试数值面板（排查"走不动"用）
   ------------------------------------------------------------
   打开方式：连点左上角地名 5 次，或控制台执行 LL.debug()
   ============================================================ */
function debugPanelEl() {
  let el = document.getElementById('debugPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debugPanel';
    document.body.appendChild(el);
  }
  return el;
}

function toggleDebug() {
  const el = debugPanelEl();
  const on = el.style.display !== 'block';
  el.style.display = on ? 'block' : 'none';
  ui._debugOn = on;
  if (on) updateDebugPanel();
  return on;
}
function updateDebugPanel() {
  if (!ui._debugOn) return;
  const el = debugPanelEl();
  const w = document.createElement('div');
  if (!G) {
    w.textContent = '尚未开始游戏\n（点【开始游戏】后这里显示实时数值）';
    el.innerHTML = '';
    el.appendChild(w);
    return;
  }
  const dir = Explore.dir;
  const tile = Math.floor(G.pos.x) + ',' + Math.floor(G.pos.y);
  const walk = isWalkable(G.pos.x, G.pos.y);
  const nextX = G.pos.x + dir.x * TILE_SPEED * 0.05;
  const nextY = G.pos.y + dir.y * TILE_SPEED * 0.05;
  const cam = ui.cameraAt();
  const lines = [
    'pos  ' + G.pos.x.toFixed(2) + ', ' + G.pos.y.toFixed(2),
    'dir  ' + dir.x.toFixed(2) + ', ' + dir.y.toFixed(2),
    'tile ' + tile + '  walk=' + (walk ? 'Y' : 'N'),
    'next walk=' + (isWalkable(nextX, nextY) ? 'Y' : 'N'),
    '走了 ' + (Explore.odometer || 0).toFixed(1) + ' 格',
    'zone ' + G.zone + '  相机 ' + cam.x.toFixed(0) + ',' + cam.y.toFixed(0),
    '帧   ' + (ui._frameCount || 0) + '  区域重绘 ' + (ui._zoneSig || '-'),
  ];
  w.textContent = lines.join('\n');
  el.innerHTML = '';
  el.appendChild(w);
}

/* ============================================================
   运行时报错直接显示在屏幕上（排查"点了没反应"用）
   ============================================================ */
function showRuntimeError(msg) {
  let el = document.getElementById('errPanel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'errPanel';
    document.body.appendChild(el);
  }
  el.textContent = '⚠️ 运行时报错：\n' + msg;
  el.style.display = 'block';
}

function installErrorTrap() {
  window.addEventListener('error', (e) => {
    showRuntimeError((e.message || 'unknown') + (e.filename ? '\n' + e.filename + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    showRuntimeError('Promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
}

/* ============================================================
   主循环
   ============================================================ */
function loopExplore(now) {
  if (!Explore.active) return;
  const dt = Math.min(0.05, (now - Explore.lastFrame) / 1000) || 0;
  Explore.lastFrame = now;
  updateExplore(dt);
  requestAnimationFrame(loopExplore);
}

function updateExplore(dt) {
  if (!Explore.active || Battle.active) return;

  ui._frameCount = (ui._frameCount || 0) + 1;
  /* 自动探索：朝随机目标点走，走到就换点 */
  if (Explore.auto && !ui.hasOverlay()) {
    Explore.autoTimer -= dt;
    if (!Explore.autoTarget || Explore.autoTimer <= 0 || nearPoint(G.pos, Explore.autoTarget, 1.2)) {
      Explore.autoTarget = randomWalkTarget();
      Explore.autoTimer = rnd(2.5, 5);
    }
    const d = { x:Explore.autoTarget.x - G.pos.x, y:Explore.autoTarget.y - G.pos.y };
    const len = Math.hypot(d.x, d.y) || 1;
    Explore.dir = { x:d.x / len, y:d.y / len };
  }

  /* 摇杆 / 键盘方向 */
  let dx = Explore.dir.x, dy = Explore.dir.y;
  if (Explore.keys.up)    dy -= 1;
  if (Explore.keys.down)  dy += 1;
  if (Explore.keys.left)  dx -= 1;
  if (Explore.keys.right) dx += 1;
  const mag = Math.hypot(dx, dy);
  if (mag < 0.05) { ui.updatePlayer(); return; }
  dx /= mag; dy /= mag;

  const speed = Explore.auto ? TILE_SPEED_AUTO : TILE_SPEED;
  const stepX = dx * speed * dt, stepY = dy * speed * dt;

  /* 分轴移动：撞到墙/房子时，停在当前格中心（不会穿墙，也不会卡死） */
  let moved = 0;
  if (stepX) {
    const nx = G.pos.x + stepX;
    if (isWalkable(nx, G.pos.y)) {
      G.pos.x = nx;
      moved += Math.abs(stepX);
    } else {
      const center = Math.floor(G.pos.x) + 0.5;
      const d = Math.abs(center - G.pos.x);
      if (d > 0.001) { G.pos.x = center; moved += d; }
    }
  }
  if (stepY) {
    const ny = G.pos.y + stepY;
    if (isWalkable(G.pos.x, ny)) {
      G.pos.y = ny;
      moved += Math.abs(stepY);
    } else {
      const center = Math.floor(G.pos.y) + 0.5;
      const d = Math.abs(center - G.pos.y);
      if (d > 0.001) { G.pos.y = center; moved += d; }
    }
  }

  /* 保险：万一卡进了不可通行的格子（存档坐标过时等），立刻脱困 */
  if (!isWalkable(G.pos.x, G.pos.y)) ensureWalkable();

  /* 累计行走距离（调试面板显示，用来确认"到底有没有在动"） */
  Explore.odometer = (Explore.odometer || 0) + moved;

  if (dx) ui.setFacing(dx < 0 ? -1 : 1);

  /* 暗雷：城镇安全，野外按步数累计 */
  if (!isTown() && moved > 0) {
    Explore.steps += moved;
    if (Explore.steps >= Explore.stepNeed) {
      Explore.steps = 0;
      Explore.stepNeed = rndi(ENCOUNTER_STEPS[0], ENCOUNTER_STEPS[1]);
      triggerEncounter();
      return;
    }
  }

  updateNearby();
  ui.updatePlayer();
  ui.updateMinimap();
  updateDebugPanel();
}

function nearPoint(a, b, r) { return Math.hypot(a.x - b.x, a.y - b.y) <= r; }

/* 野外随机目标：在玩家周围一圈里挑 */
function randomWalkTarget() {
  for (let i = 0; i < 30; i++) {
    const t = { x:G.pos.x + rnd(-8, 8), y:G.pos.y + rnd(-8, 8) };
    if (isTown() && !isWalkable(t.x, t.y)) continue;
    if (isTown()) {
      const sz = townSizeTiles();
      if (t.x < 1.5 || t.y < 1.5 || t.x > sz.w - 1.5 || t.y > sz.h - 1.5) continue;
    }
    return t;
  }
  return { x:G.pos.x, y:G.pos.y };
}

/* ============================================================
   互动：NPC / 出口
   ============================================================ */
function updateNearby() {
  let best = null, bestD = INTERACT_RANGE;
  const consider = (cand) => {
    if (!cand) return;
    const d = Math.hypot(cand.x - G.pos.x, cand.y - G.pos.y);
    if (d <= bestD) { bestD = d; best = cand; }
  };

  if (isTown()) {
    for (const n of NPCS) {
      const p = npcPos(n);
      consider({ type:'npc', obj:n, x:p.x, y:p.y, label:`${n.emoji} 与${n.name}交谈`, cls:'' });
    }
    for (const e of TOWN_EXITS) {
      const p = townExitPos(e);
      consider({ type:'exit', obj:e, x:p.x, y:p.y, label:`${e.emoji} ${e.name}`, cls:'exit' });
    }
  } else {
    const back = WILD_EXITS[G.zone];
    if (back) {
      const p = wildExitPos(G.zone);
      consider({ type:'exit', obj:back, x:p.x, y:p.y, label:`${back.emoji} ${back.name}`, cls:'exit' });
    }
    for (const g of (ZONE_GATES[G.zone] || [])) {
      const p = zoneGatePos(G.zone, g);
      consider({ type:'exit', obj:g, x:p.x, y:p.y, label:`${g.emoji} ${g.name}`, cls:'exit' });
    }
  }

  const changed = (Explore.near && best && Explore.near.label === best.label) || (!Explore.near && !best);
  Explore.near = best;
  if (!changed) ui.updateInteractButton(best);
}

function doInteract() {
  const near = Explore.near;
  if (!near) return;
  if (near.type === 'exit') {
    G.zone = near.obj.to;
    enterExplore(near.obj.spawn || (ZONES[G.zone].safe ? 'gate' : 'out'));
    saveGame();
    return;
  }
  const npc = near.obj;
  switch (npc.kind) {
    case 'dialog': ui.showDialog(npc.dialog); break;
    case 'shop':   ui.openShop(); break;
    case 'inn':    ui.openInn(); break;
    case 'skill':  ui.openTeachPanel(); break;
    case 'board':  ui.openBounty(); break;
    default:       ui.showDialog(npc.dialog);
  }
}

/* ============================================================
   遇敌
   ============================================================ */
function triggerEncounter() {
  if (isTown()) return;
  Explore.auto = false;
  ui.setAutoButton(false);

  /* BOSS 遭遇优先于普通暗雷 */
  if (G.zone === 'tomb') {
    if (G.flags.pendingBoss || (!G.bossKilled && !G.flags.bossMet)) {
      pendingBossFight();
      if (Battle.active) return;
    } else if (G.bossKilled && chance(0.10)) {
      battleStart([makeEnemy('boss', [12, 14]),
                   makeEnemy('eliteMummy', [10, 12]),
                   makeEnemy('eliteScorpion', [10, 12])]);
      return;
    }
  }

  battleStart(buildEncounter(G.zone));
}

/* ============================================================
   自动探索
   ============================================================ */
function toggleAutoExplore() {
  Explore.auto = !Explore.auto;
  Explore.autoTarget = null;
  Explore.autoTimer = 0;
  if (!Explore.auto) Explore.dir = { x:0, y:0 };
  ui.setAutoButton(Explore.auto);
  return Explore.auto;
}

/* ============================================================
   输入绑定（在 main.js 里调用）
   ============================================================ */
function bindExploreInput() {
  const joyZone = $('joyZone');
  const joyBase = $('joyBase');
  const joyKnob = $('joyKnob');
  let pointerId = null;
  let origin = { x:0, y:0 };

  const setKnob = (dx, dy) => {
    joyBase.style.left = origin.x + 'px';
    joyBase.style.top  = origin.y + 'px';
    joyKnob.style.left = (origin.x + dx) + 'px';
    joyKnob.style.top  = (origin.y + dy) + 'px';
  };
  const showJoy = (on) => {
    joyBase.classList.toggle('on', on);
    joyKnob.classList.toggle('on', on);
  };

  const start = (e) => {
    if (!Explore.active) return;
    if (ui.hasOverlay()) return;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    pointerId = e.changedTouches ? t.identifier : 'mouse';
    origin = { x:t.clientX, y:t.clientY };
    Explore.dir = { x:0, y:0 };
    setKnob(0, 0);
    showJoy(true);
  };
  const move = (e) => {
    if (pointerId === null) return;
    let t = null;
    if (e.changedTouches) {
      for (const ct of e.changedTouches) if (ct.identifier === pointerId) t = ct;
      if (!t) return;
    } else t = e;
    let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
    const len = Math.hypot(dx, dy);
    const max = 48;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    setKnob(dx, dy);
    if (len < 8) { Explore.dir = { x:0, y:0 }; return; }
    Explore.dir = { x:dx / max, y:dy / max };
  };
  const end = () => {
    if (pointerId === null) return;
    pointerId = null;
    Explore.dir = { x:0, y:0 };
    showJoy(false);
  };

  joyZone.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive:false });
  joyZone.addEventListener('touchmove',  (e) => { e.preventDefault(); move(e); },  { passive:false });
  joyZone.addEventListener('touchend',   end);
  joyZone.addEventListener('touchcancel',end);
  joyZone.addEventListener('mousedown',  start);
  window.addEventListener('mousemove',   move);
  window.addEventListener('mouseup',     end);

  /* 键盘（桌面调试） */
  const KEYMAP = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
                   w:'up', s:'down', a:'left', d:'right', W:'up', S:'down', A:'left', D:'right' };
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.key]) { Explore.keys[KEYMAP[e.key]] = true; e.preventDefault(); }
    if (e.key === 'Enter' || e.key === ' ') { if (Explore.near) doInteract(); }
  });
  window.addEventListener('keyup', (e) => {
    if (KEYMAP[e.key]) Explore.keys[KEYMAP[e.key]] = false;
  });
}
