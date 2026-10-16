"use strict";

/* ============================================================
   无尽回响：轮回 — 界面（ui）
   ------------------------------------------------------------
   屏幕切换、探索渲染、战斗渲染、面板、日志、对话框
   依赖：data.js / core.js / battle.js / explore.js
   ============================================================ */

const ui = {
  screen: 'menu',
  facing: 1,
  lastFrame: 0,
  autoTimer: 0,
  logCount: 0,
  targetMode: null,     // { side, id, isItem }
  _busy: false,
};

/* ============================================================
   屏幕切换
   ============================================================ */
ui.showScreen = function (name) {
  ui.screen = name;
  for (const id of ['menu','explore','battle']) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== name);
  }
  ui.closeAllOverlays();
  if (typeof ui.updateReincarnateBtn === 'function') ui.updateReincarnateBtn();
  if (name === 'explore') ui.renderExplore();
  if (name === 'battle') ui.renderBattle();
};

ui.hasOverlay = function () {
  return ['statPanel','bagPanel','teamPanel','codexPanel','shopPanel','innPanel','teachPanel','resultPanel']
    .some(id => { const el = $(id); return el && !el.classList.contains('hidden'); })
    || (($('dialog') && !$('dialog').classList.contains('hidden')));
};

ui.closeAllOverlays = function () {
  for (const id of ['statPanel','bagPanel','teamPanel','codexPanel','shopPanel','innPanel','teachPanel','resultPanel']) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }
  const dlg = $('dialog');
  if (dlg) dlg.classList.add('hidden');
  ui.targetMode = null;
  ui.clearTargetHighlight();
};

/* ============================================================
   通用提示
   ============================================================ */
let _toastTimer = 0;
function toast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}

let _hintTimer = 0;
ui.updateHint = function () {
  const bar = $('hintBar');
  if (!bar) return;
  const z = currentZone();
  let text = '';
  if (z.safe) {
    text = '🏠 沙丘镇 · 安全区（不会遇怪）';
  } else {
    text = `⚠️ ${z.name} · 小心暗雷遇敌`;
  }
  if (G.worldHint) text = G.worldHint;
  if (bar.textContent !== text) {
    bar.textContent = text;
    bar.classList.remove('hidden');
    bar.classList.remove('fade');
    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => {
      bar.classList.add('fade');
      setTimeout(() => bar.classList.add('hidden'), 500);
    }, 3500);
  }
};

/* ============================================================
   相机跟随
   ------------------------------------------------------------
   两种模式（ui.follow）：
     true （默认）相机跟随：人物固定在屏幕中心，地图从脚下滑过
     false        固定相机：地图整张不动，人物在屏幕上真实移动
   在城镇里相机还会被地图边界夹住，不会露出地图外的空白。
   ============================================================ */
ui.follow = true;
/* 固定相机模式下，地图在屏幕上的左上角偏移 */
ui.originOffset = { x:0, y:0 };

ui.viewport = function () {
  const el = $('explore');
  const inner = $('exploreUI');
  const vw = el.clientWidth || window.innerWidth || 400;
  const vh = (inner && inner.clientHeight) || el.clientHeight || 700;
  return { w:vw, h:vh };
};

ui.cameraAt = function () {
  const vp = ui.viewport();
  const pw = playerWorld();

  if (!ui.follow) {
    /* 固定相机：按地图尺寸居中（比屏幕小就居中，大就从左上角开始） */
    const wW = zoneW() * TILE, wH = zoneH() * TILE;
    const cam = { x:wW <= vp.w ? -(vp.w - wW) / 2 : 0,
                  y:wH <= vp.h ? -(vp.h - wH) / 2 : 0 };
    return cam;
  }

  let camX = pw.x - vp.w / 2, camY = pw.y - vp.h / 2;
  if (isTown()) {
    const wW = zoneW() * TILE, wH = zoneH() * TILE;
    camX = wW <= vp.w ? -(vp.w - wW) / 2 : clamp(camX, 0, wW - vp.w);
    camY = wH <= vp.h ? -(vp.h - wH) / 2 : clamp(camY, 0, wH - vp.h);
  }
  return { x:camX, y:camY };
};

ui.applyCamera = function () {
  const cam = ui.cameraAt();
  const world = $('mapWorld');
  if (world) world.style.transform = `translate(${-cam.x}px, ${-cam.y}px)`;
  return cam;
};

/* ============================================================
   探索界面渲染
   ============================================================ */
ui.renderExplore = function (force) {
  const z = currentZone();
  const bg = $('mapBg');
  if (bg) bg.style.background = z.bg;
  const ground = $('mapGround');
  if (ground) ground.style.background = z.ground || '#7a5a38';

  /* 静态内容只在换区域时重建一次，避免走动时每秒重建几百个 DOM */
  const sig = G.zone + '|' + (z.safe ? 'town' : 'wild');
  if (force || ui._zoneSig !== sig) {
    ui._zoneSig = sig;
    const tex = $('mapTexture');
    if (z.safe) {
      buildTownTexture();
      buildTownGround();
      buildTownDecor();
    } else {
      if (tex) tex.innerHTML = '';
      setGroundSize(0, 0);
      renderWildPages();
    }
  }

  ui.renderPartyChars();
  ui.renderPartyStats();
  ui.updateLocName();
  ui.updatePlayer();
  ui.updateInteractButton(Explore.near);
  ui.updateMinimap();
};

/* ---- 地面与纹理层 ---- */
function setGroundSize(w, h) {
  const ground = $('mapGround');
  if (!ground) return;
  ground.style.left = '0px';
  ground.style.top = '0px';
  ground.style.width = w + 'px';
  ground.style.height = h + 'px';
}

/* 城镇纹理（墙/路/城门）只画一次；人物走动不再重建 */
function buildTownTexture() {
  const tex = $('mapTexture');
  if (!tex) return;
  tex.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let y = 0; y < TOWN_H; y++) {
    for (let x = 0; x < TOWN_W; x++) {
      const t = TOWN_MAP[y][x];
      if (t !== '1' && t !== '3' && t !== '4') continue;
      const el = document.createElement('div');
      if (t === '3') {
        el.className = 'road';
      } else if (t === '4') {
        el.className = 'gate';
      } else {
        el.className = 'wall';
      }
      el.style.left = (x * TILE + TILE / 2) + 'px';
      el.style.top  = (y * TILE + TILE / 2) + 'px';
      el.style.width  = TILE + 'px';
      el.style.height = TILE + 'px';
      frag.appendChild(el);
    }
  }
  tex.appendChild(frag);
}

/* 地面层：城镇铺整块地；野外为无限平面不需要 */
function buildTownGround() {
  setGroundSize(TOWN_W * TILE, TOWN_H * TILE);
}

/* 装饰层：城镇按地图格子摆（含房屋/树/草），野外分页生成 */
function buildTownDecor() {
  const decor = $('mapDecor');
  decor.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let y = 0; y < TOWN_H; y++) {
    for (let x = 0; x < TOWN_W; x++) {
      const t = TOWN_MAP[y][x];
      const d = tileDecorAt(t, x, y);
      if (!d) continue;
      const el = document.createElement('div');
      el.className = 'decor';
      el.textContent = d.emoji;
      el.style.fontSize = d.size + 'px';
      el.style.left = Math.round(x * TILE + TILE / 2) + 'px';
      el.style.top  = Math.round(y * TILE + TILE / 2) + 'px';
      el.style.zIndex = d.size;              // 大的物件压在小的上面
      frag.appendChild(el);
    }
  }
  /* 房屋以外再撒一些草木石头，让场景更丰富（稳定随机，不会闪）
     注意：不能在墙/房屋内或紧贴它们生成，否则会盖住房子，看起来一团糟 */
  const scatter = [WILD_ICONS[0], WILD_ICONS[1], WILD_ICONS[4], WILD_ICONS[3], WILD_ICONS[5], WILD_ICONS[9]];
  const isBlockedNear = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const row = TOWN_MAP[y + dy];
        const t = row ? row[x + dx] : '1';
        if (t !== '0') return true;          // 自身或周围有墙/房屋/城门
      }
    }
    /* NPC 站位与出生点也要留空，别挡住交互 */
    if (NPCS.some(n => Math.abs(n.x - x) <= 1 && Math.abs(n.y - y) <= 1)) return true;
    if (Math.abs(TOWN_SPAWN.x - x) <= 1 && Math.abs(TOWN_SPAWN.y - y) <= 1) return true;
    return false;
  };
  for (let y = 1; y < TOWN_H - 1; y++) {
    for (let x = 1; x < TOWN_W - 1; x++) {
      if (TOWN_MAP[y][x] !== '0') continue;
      const r = hashAt(x, y, 11);
      if (r > 0.18) continue;
      if (isBlockedNear(x, y)) continue;
      const kind = hashAt(x, y, 12);
      const item = scatter[Math.floor(kind * scatter.length)] || WILD_ICONS[4];
      const el = document.createElement('div');
      el.className = 'decor';
      el.textContent = item.e;
      el.style.fontSize = Math.round(item.s * 0.8) + 'px';
      el.style.opacity = '0.9';
      el.style.left = Math.round(x * TILE + TILE / 2) + 'px';
      el.style.top  = Math.round(y * TILE + TILE / 2) + 'px';
      el.style.zIndex = Math.round(item.s * 0.8);
      frag.appendChild(el);
    }
  }
  for (const n of NPCS) frag.appendChild(worldMark(n.emoji, n.x, n.y));
  for (const e of TOWN_EXITS) frag.appendChild(worldMark(e.emoji, e.x, e.y));
  decor.appendChild(frag);
}

function worldMark(emoji, tx, ty) {
  const el = document.createElement('div');
  el.className = 'npcMark';
  el.textContent = emoji;
  el.style.left = (tx * TILE) + 'px';
  el.style.top  = (ty * TILE) + 'px';
  el.style.zIndex = 90;
  return el;
}

/* 野外：无限平面用「分页」实现。每页固定 420×560 像素，
   页面上按 [0,420)×[0,560) 生成内容，整体绝对定位。
   相机移动后页内容偏移不变，配合按需补页就得到无限世界。 */
const PAGE_W = 420, PAGE_H = 560;

function pageKey(px, py) { return px + ',' + py; }

const WILD_ICONS = [
  { e:'🌳', s:66 }, { e:'🌲', s:62 }, { e:'🌵', s:54 }, { e:'🪨', s:30 },
  { e:'🌿', s:24 }, { e:'🌾', s:26 }, { e:'💀', s:26 }, { e:'🦴', s:24 },
  { e:'🪵', s:30 }, { e:'⛰️', s:64 }, { e:'🕳️', s:34 },
];

function fillDecoPage(page, px, py) {
  const frag = document.createDocumentFragment();
  const perX = 3, perY = 4;
  for (let i = 0; i < perX; i++) {
    for (let j = 0; j < perY; j++) {
      const gx = px * perX + i, gy = py * perY + j;
      const r1 = hashAt(gx, gy, 1);
      if (r1 > 0.72) continue;                       // 有些格子不长东西
      const r2 = hashAt(gx, gy, 2);
      const r3 = hashAt(gx, gy, 3);
      const r4 = hashAt(gx, gy, 4);
      const item = WILD_ICONS[Math.floor(r2 * WILD_ICONS.length)];
      const el = document.createElement('div');
      el.className = 'decor';
      el.textContent = item.e;
      el.style.fontSize = Math.round(item.s * (0.75 + r3 * 0.5)) + 'px';
      el.style.opacity = '0.88';
      el.style.left = Math.round(i * (PAGE_W / perX) + r4 * 70) + 'px';
      el.style.top  = Math.round(j * (PAGE_H / perY) + r3 * 70) + 'px';
      el.style.zIndex = Math.round(item.s);
      frag.appendChild(el);
    }
  }
  page.appendChild(frag);
}

/* 地面细节：稳定随机的小色斑，让野外有参照物、走动时能看出在移动 */
function buildWildPatches(cx, cy) {
  const decor = $('mapDecor');
  if (!decor) return;
  const R = 3;
  const tones = {
    dune:  ['rgba(160,120,60,.30)', 'rgba(240,215,150,.28)', 'rgba(120,90,45,.22)'],
    ruins: ['rgba(40,34,48,.35)',   'rgba(150,140,160,.22)', 'rgba(90,80,100,.28)'],
    tomb:  ['rgba(20,14,28,.40)',   'rgba(110,90,140,.22)',  'rgba(70,50,90,.30)'],
  };
  const pal = tones[G.zone] || tones.dune;
  const frag = document.createDocumentFragment();
  for (let px = cx - R; px <= cx + R; px++) {
    for (let py = cy - R; py <= cy + R; py++) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 6; j++) {
          const gx = px * 5 + i, gy = py * 6 + j;
          const r1 = hashAt(gx, gy, 21);
          if (r1 > 0.55) continue;
          const r2 = hashAt(gx, gy, 22);
          const r3 = hashAt(gx, gy, 23);
          const el = document.createElement('div');
          el.className = 'patch';
          const w = Math.round(30 + r2 * 110);
          el.style.width = w + 'px';
          el.style.height = Math.round(w * (0.5 + r3 * 0.6)) + 'px';
          el.style.background = pal[Math.floor(r3 * pal.length)];
          el.style.left = Math.round(px * PAGE_W + i * (PAGE_W / 5) + r2 * 60) + 'px';
          el.style.top  = Math.round(py * PAGE_H + j * (PAGE_H / 6) + r3 * 60) + 'px';
          frag.appendChild(el);
        }
      }
    }
  }
  decor.appendChild(frag);
}

/* 野外：无限平面用「分页」实现 —— 每页固定 420×560 像素，
   相机每帧按需补页，内容用稳定随机生成（走远再回来不会变） */
function renderWildPages() {
  const decor = $('mapDecor');
  decor.innerHTML = '';
  decor.style.display = 'block';
  const pw = playerWorld();
  const cx = Math.floor(pw.x / PAGE_W), cy = Math.floor(pw.y / PAGE_H);
  const R = 3;   // 3×3 = 9 页，足够铺满任何手机视口

  /* 先铺地面斑块，再放草木，最后放出口标记 */
  buildWildPatches(cx, cy);

  for (let px = cx - R; px <= cx + R; px++) {
    for (let py = cy - R; py <= cy + R; py++) {
      const page = document.createElement('div');
      page.className = 'page';
      page.style.left = (px * PAGE_W) + 'px';
      page.style.top  = (py * PAGE_H) + 'px';
      page.style.width  = PAGE_W + 'px';
      page.style.height = PAGE_H + 'px';
      fillDecoPage(page, px, py);
      decor.appendChild(page);
    }
  }

  /* 出口与区域通道：世界坐标固定 */
  const back = WILD_EXITS[G.zone];
  if (back) decor.appendChild(worldMark(back.emoji, back.x, back.y));
  for (const g of (ZONE_GATES[G.zone] || [])) {
    decor.appendChild(worldMark(g.emoji, g.x, g.y));
  }
}

/* 玩家与队伍：固定在屏幕中心附近（相机跟随） */
ui.renderPartyChars = function () {
  const box = $('party');
  box.innerHTML = '';
  const units = G.party.concat(activePets());
  units.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'char ' + (i === 0 ? 'leader' : 'follower');
    el.id = 'char_' + u.uid;
    el.textContent = u.emoji;
    box.appendChild(el);
  });
  ui.updatePlayer();
};

ui.updatePlayer = function () {
  const units = G.party.concat(activePets());
  const vp = ui.viewport();
  const cam = ui.applyCamera();          // 相机（每帧一次）
  const pw = playerWorld();
  units.forEach((u, i) => {
    const el = $('char_' + u.uid);
    if (!el) return;
    const trail = i * 0.5;
    const wx = pw.x - Explore.dir.x * trail * TILE;
    const wy = pw.y - Explore.dir.y * trail * TILE;
    const sx = ui.follow ? (vp.w / 2 - Explore.dir.x * trail * TILE) : (wx - cam.x);
    const sy = ui.follow ? (vp.h / 2 - Explore.dir.y * trail * TILE) : (wy - cam.y);
    el.style.left = sx + 'px';
    el.style.top  = sy + 'px';
    el.style.transform = 'translate(-50%,-50%) scaleX(' + ui.facing + ')';
    el.style.zIndex = 10 - i;
  });
};

/* 相机模式：true 跟随（人物在屏幕中心），false 固定（地图不动、人物真实移动） */
ui.setFollow = function (on) {
  ui.follow = !!on;
  if (typeof toast === 'function') {
    toast(ui.follow ? '相机：跟随人物（地图滚动）' : '相机：固定（地图不动，人物移动）');
  }
  return ui.follow;
};

/* 连点右上角血条 3 次 → 切换相机模式 */
ui.bindCameraToggle = function () {
  let taps = 0, timer = 0;
  const el = $('partyStats');
  if (!el || el._cameraBound) return;
  el._cameraBound = true;
  el.style.pointerEvents = 'auto';
  el.addEventListener('click', () => {
    clearTimeout(timer);
    if (++taps >= 3) { taps = 0; toggleFollow(); return; }
    timer = setTimeout(() => { taps = 0; }, 900);
  });
};

function toggleFollow() { return ui.setFollow(!ui.follow); }

ui.setFacing = function (f) { ui.facing = f; };

/* ============================================================
   小地图 / 出口方向指引
   ============================================================ */
ui.updateMinimap = function () {
  const box = $('minimap');
  if (!box) return;
  const back = WILD_EXITS[G.zone];
  const gate = (ZONE_GATES[G.zone] || [])[0];
  const items = [];
  if (back) items.push({ emoji:back.emoji, label:back.name, dx:back.x - G.pos.x, dy:back.y - G.pos.y });
  if (gate) items.push({ emoji:gate.emoji, label:gate.name, dx:gate.x - G.pos.x, dy:gate.y - G.pos.y });
  if (!items.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = items.map(it => {
    const dist = Math.round(Math.hypot(it.dx, it.dy));
    if (dist <= 2) return `<div class="mmRow near">${it.emoji} ${it.label} · 已到达</div>`;
    const ax = Math.abs(it.dx) > 2 ? (it.dx < 0 ? '←' : '→') : '';
    const ay = Math.abs(it.dy) > 2 ? (it.dy < 0 ? '↑' : '↓') : '';
    return `<div class="mmRow">${it.emoji} ${it.label} ${ay}${ax} ${dist}格</div>`;
  }).join('');
};

ui.renderPartyChars = function () {
  const box = $('party');
  box.innerHTML = '';
  const units = G.party.concat(activePets());
  units.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'char ' + (i === 0 ? 'leader' : 'follower');
    el.id = 'char_' + u.uid;
    el.textContent = u.emoji;
    box.appendChild(el);
  });
};

ui.setFacing = function (f) { ui.facing = f; };

ui.renderPartyStats = function () {
  const box = $('partyStats');
  box.innerHTML = '';
  for (const u of G.party) {
    const c = statsOf(u);
    const line = document.createElement('div');
    line.innerHTML = `<span class="hp">❤️${u.hp}/${c.maxHp}</span> <span class="mp">💙${u.mp}/${c.maxMp}</span>`;
    box.appendChild(line);
  }
  for (const p of activePets()) {
    const c = statsOf(p);
    const line = document.createElement('div');
    line.innerHTML = `<span style="color:#ffb347">${p.emoji}${p.hp}/${c.maxHp}</span>`;
    box.appendChild(line);
  }
};

ui.updateLocName = function () {
  const z = currentZone();
  $('locName').textContent = z.name;
  $('locSub').textContent  = z.sub;
};

ui.updateInteractButton = function (near) {
  const btn = $('interactBtn');
  if (!btn) return;
  if (!near) { btn.classList.add('hidden'); return; }
  btn.textContent = near.label;
  btn.className = '';
  if (near.cls) btn.classList.add(near.cls);
  btn.style.left = near.x * TILE + 'px';
  btn.style.top  = (near.y * TILE - 34) + 'px';
  btn.classList.remove('hidden');
};

ui.setAutoButton = function (on) {
  const b = $('btnAuto');
  if (!b) return;
  b.classList.toggle('on', !!on);
  if (on) { b.textContent = '⏸'; } else { b.textContent = '🚶'; }
};

/* ============================================================
   战斗渲染
   ============================================================ */
ui.renderBattle = function () {
  ui.logCount = 0;
  const list = $('battleLogList');
  if (list) list.innerHTML = '';
  ui.renderUnits();
  ui.updateCountdown(0);
  $('battleTimer').classList.add('hidden');
};

function unitCard(u) {
  const c = statsOf(u);
  const hpPct = clamp(u.hp / c.maxHp * 100, 0, 100);
  const mpPct = c.maxMp ? clamp(u.mp / c.maxMp * 100, 0, 100) : 0;
  const hpCls = hpPct < 25 ? 'crit' : (hpPct < 55 ? 'low' : '');
  const el = document.createElement('div');
  el.className = 'unit' + (u.alive ? '' : ' dead');
  if (u.kind === 'pet') el.classList.add('pet');
  if (u.rarity === 'baby') el.classList.add('baby');
  if (u.rarity === 'variant') el.classList.add('variant');
  el.id = 'unit_' + u.uid;
  el.dataset.uid = u.uid;

  const badge = u.rarity === 'baby' ? '⭐ 宝宝' : (u.rarity === 'variant' ? '💜 变异' : '');
  el.innerHTML =
    (badge ? `<div style="font-size:9px;font-weight:800;color:${u.rarity === 'variant' ? '#f0abfc' : '#ffb347'}">${badge}</div>` : '') +
    `<div class="unitSprite">${u.emoji}</div>` +
    `<div class="unitName">${u.name}${u.elite ? ' 👹' : ''}</div>` +
    `<div class="unitHPWrap"><div class="unitHP ${hpCls}" style="width:${hpPct}%"></div></div>` +
    (c.maxMp > 0 ? `<div class="unitMPWrap"><div class="unitMP" style="width:${mpPct}%"></div></div>` : '') +
    `<div class="speedBar"><div class="speedFill" style="width:${speedPct(u)}%"></div></div>`;

  el.addEventListener('click', () => ui.onUnitClick(u.uid));
  return el;
}

function speedPct(u) {
  const all = Battle.allies.concat(Battle.enemies).filter(x => x.alive);
  if (!all.length) return 0;
  const max = Math.max.apply(null, all.map(x => statsOf(x).spd));
  return clamp(statsOf(u).spd / (max || 1) * 100, 0, 100);
}

ui.renderUnits = function () {
  const enemyRow = $('enemyRow');
  const playerRow = $('playerRow');
  enemyRow.innerHTML = '';
  playerRow.innerHTML = '';
  for (const e of Battle.enemies) enemyRow.appendChild(unitCard(e));
  for (const a of Battle.allies) playerRow.appendChild(unitCard(a));
  ui.highlightActor();
};

ui.refreshUnit = function (uid) {
  const u = findUnit(uid);
  if (!u) return;
  const el = $('unit_' + uid);
  if (!el) return;
  const fresh = unitCard(u);
  el.replaceWith(fresh);
  ui.highlightActor();
};

ui.refreshAllUnits = function () { ui.renderUnits(); };

ui.highlightActor = function () {
  document.querySelectorAll('.unit').forEach(el => el.classList.remove('active'));
  if (Battle.actor && Battle.actor.alive) {
    const el = $('unit_' + Battle.actor.uid);
    if (el) el.classList.add('active');
  }
};

ui.shakeUnit = function (uid) {
  const el = $('unit_' + uid);
  if (!el) return;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 320);
  ui.refreshUnit(uid);
};

ui.flashUnit = function (uid) {
  const el = $('unit_' + uid);
  if (!el) return;
  el.style.opacity = '0.4';
  setTimeout(() => { el.style.opacity = ''; }, 200);
};

ui.addLog = function (text, kind) {
  const list = $('battleLogList');
  if (!list) return;
  const el = document.createElement('div');
  el.className = 'logItem' + (kind ? ' log-' + kind : '');
  el.textContent = text;
  list.appendChild(el);
  ui.logCount++;
  if (Battle) Battle.logLines = (Battle.logLines || 0) + 1;
  const area = $('battleLogArea');
  if (area) area.scrollTop = area.scrollHeight;
};

ui.setBattleMsg = function (text, force) {
  const el = $('battleMsg');
  if (!el) return;
  if (Battle.auto && !text) {
    el.textContent = Battle.actor ? `${Battle.actor.name} 的回合（自动）` : '自动战斗中…';
    return;
  }
  el.textContent = text || '';
};

/* 轮到玩家选择指令 */
ui.onPlayerTurn = function (u) {
  ui._busy = false;
  ui.pendingAuto = false;
  ui.refreshAllUnits();
  ui.setBattleMsg(`${u.name} 的回合`);
  ui.setActionBar(true);
  const timer = $('battleTimer');
  timer.classList.remove('hidden');
  timer.classList.toggle('auto', Battle.auto);
  ui.updateCountdown(Battle.countdown);
};

ui.onAutoTurn = function (u) {
  ui._busy = true;
  ui.setBattleMsg(`${u.name} 的回合（自动）`);
  ui.setActionBar(false);
  ui.refreshAllUnits();
  const timer = $('battleTimer');
  timer.classList.remove('hidden');
  timer.classList.add('auto');
  ui.updateCountdown(Battle.countdown);
  /* 自动战斗节奏：0.6 秒后行动 */
  setTimeout(() => {
    if (!Battle.active || Battle.over) return;
    if (Battle.actor !== u) return;
    autoActFor(u);
    ui._busy = false;
  }, 600);
};

ui.updateCountdown = function (t) {
  const timer = $('battleTimer');
  if (!timer) return;
  const num = timer.querySelector('.num');
  const lbl = timer.querySelector('.lbl');
  if (!num) return;
  const val = Math.max(0, Math.ceil(t));
  num.textContent = val;
  lbl.textContent = Battle.auto ? '自动战斗' : '选择行动';
  timer.classList.toggle('warn', val <= 5 && !Battle.auto);
  num.classList.add('tick');
  setTimeout(() => num.classList.remove('tick'), 90);
};

ui.setActionBar = function (on) {
  const bar = $('actionBar');
  if (!bar) return;
  bar.querySelectorAll('.actionBtn').forEach(b => {
    if (b.dataset.act === 'auto') return;
    b.classList.toggle('disabled', !on);
  });
  /* 没有可捕捉目标时禁用捕捉 */
  const capBtn = bar.querySelector('[data-act="capture"]');
  if (capBtn) {
    const anyCatchable = Battle.enemies.some(e => e.alive && e.zodiac);
    capBtn.classList.toggle('disabled', !on || !anyCatchable);
  }
};

ui.setAutoState = function (on) {
  const bar = $('actionBar');
  const btn = bar && bar.querySelector('[data-act="auto"]');
  if (btn) btn.classList.toggle('on', !!on);
  const timer = $('battleTimer');
  if (timer) timer.classList.toggle('auto', !!on);
  ui.setBattleMsg('');
};

/* ============================================================
   目标选择
   ============================================================ */
ui.enterTargetMode = function (side, id, isItem) {
  ui.targetMode = { side, id, isItem:!!isItem };
  const pool = side === 'enemy' ? Battle.enemies : Battle.allies;
  ui.setBattleMsg(side === 'enemy' ? '请选择目标敌人（再次点击取消）' : '请选择目标队友');
  ui.setActionBar(false);
  ui.clearTargetHighlight();
  for (const u of pool) {
    if (!u.alive) continue;
    const el = $('unit_' + u.uid);
    if (el) { el.classList.add('active'); el.style.outline = '2px solid #ffd76a'; el.style.borderRadius = '8px'; }
  }
  const sub = $('subMenu');
  const list = $('subList');
  sub.classList.remove('hidden');
  $('subTitle').textContent = side === 'enemy' ? '选择目标' : '选择队友';
  list.innerHTML = '';
  for (const u of pool) {
    if (!u.alive) continue;
    const c = statsOf(u);
    const b = document.createElement('button');
    b.className = 'subItem';
    b.innerHTML = `<span>${u.emoji} ${u.name}</span><span class="cost">HP ${u.hp}/${c.maxHp}</span>`;
    b.onclick = () => ui.onUnitClick(u.uid);
    list.appendChild(b);
  }
  $('subBack').textContent = '取 消';
};

ui.clearTargetHighlight = function () {
  document.querySelectorAll('.unit').forEach(el => {
    el.style.outline = ''; el.style.borderRadius = '';
  });
  const sub = $('subMenu');
  if (sub) sub.classList.add('hidden');
};

ui.onUnitClick = function (uid) {
  const tm = ui.targetMode;
  if (!tm) {
    /* 非选择模式下点单位 = 查看简略信息 */
    const u = findUnit(uid);
    if (u && u.kind === 'enemy') toast(`${u.name} Lv.${u.level}　HP ${u.hp}/${statsOf(u).maxHp}`);
    return;
  }
  const u = findUnit(uid);
  if (!u || !u.alive) return;
  const validSide = tm.side === 'enemy' ? Battle.enemies : Battle.allies;
  if (validSide.indexOf(u) < 0) return;

  ui.targetMode = null;
  ui.clearTargetHighlight();
  if (tm.isItem) playerItem(tm.id, uid);
  else playerSkill(tm.id, uid);
};

/* ============================================================
   战斗结算界面
   ============================================================ */
ui.showBattleResult = function (result, recap) {
  const panel = $('resultPanel');
  const title = $('resultTitle');
  const body  = $('resultBody');
  const timer = $('battleTimer');
  if (timer) timer.classList.add('hidden');
  ui.setActionBar(false);

  if (!panel) return;
  if (result === 'win') {
    title.textContent = '🏆 战斗胜利';
    title.style.color = '#6ee7a0';
  } else if (result === 'lose') {
    title.textContent = '💀 全队倒下';
    title.style.color = '#ff6b6b';
  } else {
    title.textContent = '🏃 脱离战斗';
    title.style.color = '#8ab4ff';
  }

  let html = '';
  if (result === 'win') {
    html += `<div class="itemRow"><span class="itemName">获得经验</span><span class="itemQty">+${recap.exp}</span></div>`;
    html += `<div class="itemRow"><span class="itemName">获得金币</span><span class="itemQty">+${recap.gold}</span></div>`;
    if (recap.newCodex && recap.newCodex.length) {
      html += `<div class="itemRow"><span class="itemName">📚 图鉴新增</span><span class="itemQty">${recap.newCodex.length} 种</span></div>`;
    }
    if (recap.caught && recap.caught.length) {
      for (const p of recap.caught) {
        const rn = p.rarity === 'variant' ? '💜 变异' : (p.rarity === 'baby' ? '⭐ 宝宝' : '普通');
        html += `<div class="itemRow petRow ${p.rarity === 'variant' ? 'variant' : ''}"><span class="itemName">${p.emoji} ${p.name}</span><span class="itemQty">${rn}</span></div>`;
      }
    }
    if (hasUnspentPoints()) {
      html += `<div class="itemRow" style="border-color:#ffb347"><span class="itemName" style="color:#ffb347">🔴 有未分配的属性点</span><span class="itemQty">点队伍分配</span></div>`;
    }
  } else if (result === 'lose') {
    html += `<div class="itemRow"><span class="itemName">损失金币</span><span class="itemQty">-${Math.max(WIPE_GOLD_MIN, Math.round((G.gold / (1 - WIPE_GOLD_LOSS)) * WIPE_GOLD_LOSS))}</span></div>`;
    html += `<div class="itemRow"><span class="itemName">队伍已回到沙丘镇</span><span class="itemQty">恢复一半生命</span></div>`;
  } else {
    html += `<div class="itemRow"><span class="itemName">没有获得经验</span><span class="itemQty">—</span></div>`;
  }
  body.innerHTML = html;
  panel.classList.remove('hidden');
  ui.markTeamDot(hasUnspentPoints());
};

/* ============================================================
   队伍 / 加点
   ============================================================ */
ui.markTeamDot = function (on) {
  const btn = $('btnTeam');
  if (!btn) return;
  btn.style.borderColor = on ? '#ff6b6b' : '';
  btn.style.boxShadow   = on ? '0 0 0 3px rgba(255,80,80,.45)' : '';
  btn.dataset.dot = on ? '1' : '';
};

function updateTeamDot() { ui.markTeamDot(hasUnspentPoints()); }

ui.openTeam = function () {
  const panel = $('teamPanel');
  if (!panel) return;
  ui.renderTeam();
  panel.classList.remove('hidden');
};

ui.renderTeam = function () {
  const list = $('teamList');
  const petList = $('petList');
  list.innerHTML = '';
  petList.innerHTML = '';

  for (const u of G.party) {
    const c = statsOf(u);
    const row = document.createElement('div');
    row.className = 'itemRow';
    row.innerHTML =
      `<span class="itemName">${u.emoji} ${u.name} <span style="color:#8ab4ff">Lv.${u.level}</span>` +
      (u.points > 0 ? ` <span style="color:#6ee7a0;font-weight:800">(+${u.points})</span>` : '') +
      `</span><span class="itemQty">HP ${u.hp}/${c.maxHp}　MP ${u.mp}/${c.maxMp}</span>`;
    const btn = document.createElement('button');
    btn.className = 'useBtn';
    btn.textContent = u.points > 0 ? '加点' : '查看';
    btn.onclick = () => ui.openStatPanel(u.uid);
    row.appendChild(btn);
    list.appendChild(row);
  }

  /* 出战宠物 */
  const actives = activePets();
  if (actives.length) {
    const t = document.createElement('div');
    t.className = 'sectionTitle';
    t.textContent = `出战中（${actives.length}/${PET_SLOTS}）`;
    petList.appendChild(t);
    for (const p of actives) petList.appendChild(petRow(p, true));
  }
  const rest = G.pets.filter(p => !isPetActive(p));
  if (rest.length) {
    const t = document.createElement('div');
    t.className = 'sectionTitle';
    t.textContent = `宠物仓库（${G.pets.length}/${PET_STORE}）`;
    petList.appendChild(t);
    for (const p of rest) petList.appendChild(petRow(p, false));
  }
  if (!G.pets.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '还没有宠物，去野外捕捉 12 生肖吧';
    petList.appendChild(e);
  }
};

function petRow(p, active) {
  const c = statsOf(p);
  const row = document.createElement('div');
  row.className = 'itemRow petRow' + (p.rarity === 'variant' ? ' variant' : '');
  const rn = p.rarity === 'variant' ? '💜变异' : (p.rarity === 'baby' ? '⭐宝宝' : '');
  row.innerHTML =
    `<span class="itemName">${p.emoji} ${p.name} ${rn} <span style="color:#8ab4ff">Lv.${p.level}</span></span>` +
    `<span class="itemQty">HP ${p.hp}/${c.maxHp}</span>`;
  const btn = document.createElement('button');
  btn.className = 'useBtn';
  btn.textContent = active ? '下场' : '上场';
  btn.onclick = () => {
    const r = togglePetSlot(p.uid);
    if (!r.ok) { toast(r.msg); return; }
    toast(r.on ? `${p.name} 已上场` : `${p.name} 已下场`);
    ui.renderTeam();
    ui.renderPartyChars();
    autoSave();
  };
  row.appendChild(btn);
  return row;
}

ui.openStatPanel = function (uid) {
  const u = G.party.concat(G.pets).find(x => x.uid === uid);
  if (!u) return;
  ui.statUid = uid;
  ui.renderStatPanel();
  $('statPanel').classList.remove('hidden');
};

ui.renderStatPanel = function () {
  const u = G.party.concat(G.pets).find(x => x.uid === ui.statUid);
  if (!u) return;
  const c = statsOf(u);
  $('statWho').textContent = `${u.emoji} ${u.name}`;
  $('statSub').textContent = `Lv.${u.level}　经验 ${u.exp}/${expNeed(u.level)}　HP ${u.hp}/${c.maxHp}　MP ${u.mp}/${c.maxMp}`;
  $('ptLeft').textContent = u.points || 0;

  const grid = $('statGrid');
  grid.innerHTML = '';
  for (const st of STATS) {
    const cell = document.createElement('div');
    cell.className = 'statCell';
    const val = u.stats[st.id];
    const canPlus = u.kind === 'char' && u.points > 0;
    cell.innerHTML =
      `<span class="statName">${st.icon} ${st.name}</span>` +
      `<span><span class="statVal">${val}</span>` +
      (u.kind === 'char' ? `<button class="plusBtn" ${canPlus ? '' : 'disabled'}>+</button>` : '') +
      `</span>`;
    const btn = cell.querySelector('.plusBtn');
    if (btn) btn.onclick = () => { allocate(u, st.id, 1); ui.renderStatPanel(); ui.renderPartyStats(); autoSave(); };
    grid.appendChild(cell);
  }

  /* 详细数值 */
  const old = grid.parentNode.querySelector('#statDetail');
  if (old) old.remove();
  const detail = document.createElement('div');
  detail.id = 'statDetail';
  detail.style.cssText = 'font-size:11px;opacity:.7;line-height:1.7;margin-bottom:10px';
  detail.innerHTML =
    `攻击 ${Math.round(c.atk)}　防御 ${Math.round(c.def)}　魔攻 ${Math.round(c.matk)}　魔防 ${Math.round(c.mdef)}<br>` +
    `速度 ${Math.round(c.spd)}　暴击 ${(c.crit * 100).toFixed(1)}%　命中 ${(c.hit * 100).toFixed(0)}%　闪避 ${(c.eva * 100).toFixed(1)}%`;
  grid.parentNode.insertBefore(detail, grid.nextSibling);

  /* 技能 */
  const sl = $('skillList');
  sl.innerHTML = '';
  for (const sk of u.skills) {
    const def = SKILLS[sk.id] || PET_SKILLS[sk.id];
    if (!def) continue;
    const info = u.kind === 'char' ? skillUpgradeInfo(u, sk.id) : null;
    const row = document.createElement('div');
    row.className = 'skillRow';
    let extra = '';
    if (u.kind === 'char' && info) {
      if (info.maxed) extra = `<span style="color:#6ee7a0">已满 Lv.${sk.lv}</span>`;
      else if (!info.canCap) extra = `<span style="color:#ffb347">需 Lv.${(info.nextLv - 10) + 10} 角色等级</span>`;
      else extra = `<span style="color:#ffd76a">可学 Lv.${info.nextLv} · ${info.cost} 金币</span>`;
    }
    row.innerHTML =
      `<span class="icon">${def.icon}</span>` +
      `<span class="info"><span class="name">${def.name} <span class="lv">Lv.${sk.lv}</span></span>` +
      `<span class="desc">${def.desc}${def.mp ? ' · MP ' + def.mp : ''}</span>` +
      (extra ? `<span class="desc">${extra}</span>` : '') +
      `</span>`;
    sl.appendChild(row);
  }
};
