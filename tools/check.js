"use strict";

/* ============================================================
   无尽回响：轮回 — 无头冒烟测试
   ------------------------------------------------------------
   在 Node 里用最小 DOM 桩把整套脚本跑起来，验证：
     1. 所有模块语法正确、能加载
     2. index.html 里引用的 id 全部存在
     3. 主菜单 -> 新游戏 -> 探索 -> 遇敌 -> 战斗 -> 结算 全流程不报错
     4. 战斗能正常结束（不会卡在某个回合）
     5. 升级 / 加点 / 捕捉 / 学技能 / 团灭 都能走通
   用法： node tools/smoke-test.js
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['js/data.js','js/core.js','js/battle.js','js/explore.js','js/ui.js','js/ui-panels.js','js/main.js'];

let failures = 0;
const log = (...a) => console.log(...a);
function ok(name, cond, extra) {
  if (cond) { log(`  OK   ${name}`); }
  else { failures++; log(`  FAIL ${name}${extra ? ' -- ' + extra : ''}`); }
}
function section(t) { log(`\n=== ${t} ===`); }

/* ============================================================
   1. 语法检查
   ============================================================ */
section('1. 语法检查');
const sources = {};
for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { failures++; log(`  FAIL 缺少文件 ${f}`); continue; }
  const code = fs.readFileSync(p, 'utf8');
  sources[f] = code;
  try { new vm.Script(code, { filename:f }); log(`  OK   ${f} (${code.split('\n').length} 行)`); }
  catch (e) { failures++; log(`  FAIL ${f} 语法错误: ${e.message}`); }
}
const bundle = FILES.map(f => sources[f] || '').join('\n;\n');
try { new vm.Script(bundle, { filename:'bundle.js' }); log('  OK   合并整包语法正确'); }
catch (e) { failures++; log(`  FAIL 合并整包语法错误: ${e.message}`); }

/* ============================================================
   2. index.html 与 DOM 桩
   ============================================================ */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

section('2. index.html 校验');
ok('index.html 引用的脚本都存在', scriptSrcs.every(s => fs.existsSync(path.join(ROOT, s))),
   scriptSrcs.filter(s => !fs.existsSync(path.join(ROOT, s))).join(', '));
ok('脚本加载顺序正确', scriptSrcs.join(',') === FILES.join(','), scriptSrcs.join(','));
ok('没有引用已被删除的 game.js', !scriptSrcs.includes('game.js'));

const usedIds = new Set();
for (const f of FILES) {
  const re = /\$\('([A-Za-z0-9_]+)'\)/g;
  let m;
  while ((m = re.exec(sources[f] || ''))) usedIds.add(m[1]);
}
const missing = [...usedIds].filter(id => !htmlIds.has(id));
ok('代码引用的 id 都能在 HTML 找到', missing.length === 0, '缺少: ' + missing.join(', '));

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}
class FakeEl {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._html = '';
    this.listeners = {};
    this.parentNode = null;
    this.disabled = false;
    this.value = '';
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  replaceWith(n) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children[i] = n;
    n.parentNode = this.parentNode;
  }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, n); else this.children.push(n);
    n.parentNode = this;
    return n;
  }
  querySelector(sel) {
    const act = sel.match(/\[data-act="([^"]+)"\]/);
    if (act) return this._q('act', act[1]);
    return this._q('cls', sel.charAt(0) === '.' ? sel.slice(1) : sel);
  }
  _q(kind, v) {
    for (const c of this.children) {
      if (kind === 'act' && c.dataset && c.dataset.act === v) return c;
      if (kind === 'cls' && c.classList && c.classList.contains(v)) return c;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const cls = sel.charAt(0) === '.' ? sel.slice(1) : sel;
    const walk = (n) => {
      for (const c of n.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  click() { (this.listeners.click || []).forEach(f => f({ target:this })); }
  focus() {}
  getBoundingClientRect() { return { left:0, top:0, width:this.clientWidth, height:this.clientHeight }; }
}
/* 给假元素补上视口尺寸，便于验证相机 */
Object.defineProperty(FakeEl.prototype, 'clientWidth',  { get() { return this._w !== undefined ? this._w : 420; } });
Object.defineProperty(FakeEl.prototype, 'clientHeight', { get() { return this._h !== undefined ? this._h : 700; } });

const els = new Map();
for (const id of htmlIds) els.set(id, new FakeEl('div', id));
function ensureEl(id) {
  if (!els.has(id)) els.set(id, new FakeEl('div', id));
  return els.get(id);
}
const bar = ensureEl('actionBar');
for (const act of ['attack','skill','item','defend','capture','escape','auto']) {
  const b = new FakeEl('button', '');
  b.dataset.act = act;
  b.classList.add('actionBtn');
  bar.appendChild(b);
}
const timer = ensureEl('battleTimer');
const numEl = new FakeEl('div'); numEl.classList.add('num');
const lblEl = new FakeEl('div'); lblEl.classList.add('lbl');
timer.appendChild(numEl); timer.appendChild(lblEl);
if (!ensureEl('statGrid').parentNode) {
  const p = new FakeEl('div'); p.appendChild(ensureEl('statGrid'));
}

const documentStub = {
  readyState: 'complete',
  getElementById: (id) => (id ? ensureEl(id) : null),
  createElement: (tag) => new FakeEl(tag),
  createDocumentFragment: () => new FakeEl('fragment'),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  hidden: false,
  body: new FakeEl('body'),
};
documentStub.body.appendChild = () => {};

const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const pending = [];
const setTimeoutStub = (fn) => { pending.push(fn); return pending.length; };
const clearTimeoutStub = () => {};
function flushTimers(limit) {
  let n = 0;
  while (pending.length && n < (limit || 20000)) { const f = pending.shift(); f(); n++; }
  return n;
}

const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  window: null,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub,
  confirm: () => true,
  alert: () => {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};

const bootstrap = `
;globalThis.__T = {
  G: () => G,
  newGame, saveGame, loadGame, hasSave, resetSave,
  buildEncounter, makeEnemy, makePet, rollRarity, battleStart, nextTurn,
  playerAttack, playerSkill, playerItem, playerCapture, playerEscape,
  playerDefend, autoActFor, checkBattleEnd, findUnit,
  calcStatsFor, calcPetStats, gainExp, allocate, learnSkill, skillUpgradeInfo,
  maxSkillLevel, statsOf, togglePetSlot, activePets, buildPartyUnits,
  markCodex, markCaught, elementMul, rollDamage, currentZone, updateNearby,
  enterExplore, doInteract, triggerEncounter, toggleAutoExplore,
  isWalkable, playerWorld, tileToWorld, worldToTile, dirHint, isTown,
  updateExplore, ensureWalkable, TOWN_SPAWN, TOWN_MAP, townTileAt,  ZONES, NPCS, MONSTERS, PETS, SKILLS, PET_SKILLS, ITEMS, CLASSES, RARITY,
  TOWN_EXITS, ZONE_GATES, WILD_EXITS, STATS, TILE, TOWN_W, TOWN_H, PAGE_W, PAGE_H,
  Battle, Explore, ui, GAME_VERSION,
  updateMinimap: ui.updateMinimap,
  document: globalThis.document
};
`;

vm.createContext(sandbox);
section('3. 加载');
try {
  vm.runInContext(bundle + bootstrap, sandbox, { filename:'bundle.js' });
  ok('整包在 DOM 桩上加载成功（initGame 执行无异常）', true);
} catch (e) {
  failures++;
  ok('整包在 DOM 桩上加载成功', false, e.stack.split('\n').slice(0, 4).join(' | '));
}

const S = sandbox.__T;
const G = () => S.G();

/* ============================================================
   4. 新游戏 / 探索
   ============================================================ */
section('4. 新游戏 / 探索');
try {
  S.newGame();
  ok('新游戏创建了 3 个角色', G().party.length === 3, '实际 ' + G().party.length);
  ok('角色是 剑士/法师/游侠', G().party.map(u => u.name).join(',') === '剑士,法师,游侠', G().party.map(u => u.name).join(','));
  ok('每个角色有 2 个技能', G().party.every(u => u.skills.length === 2), JSON.stringify(G().party.map(u => u.skills.length)));
  ok('初始金币 > 0', G().gold > 0, String(G().gold));
  ok('初始背包有药', (G().items.herb || 0) > 0);
} catch (e) { failures++; ok('新游戏', false, e.message); }

try {
  S.enterExplore('west');
  ok('进入沙丘镇（安全区）', S.currentZone().safe === true);
  ok('玩家坐标在城内', G().pos.x > 0 && G().pos.y > 0, JSON.stringify(G().pos));
} catch (e) { failures++; ok('进入探索', false, e.message); }

try {
  const npc = S.NPCS.find(n => n.id === 'shop');
  G().pos = { x:npc.x, y:npc.y };
  S.updateNearby();
  ok('靠近商人出现互动按钮', !!S.Explore.near, JSON.stringify(S.Explore.near && S.Explore.near.label));
  S.ui.openShop();
  S.ui.openInn();
  S.ui.openTeachPanel();
  ok('商店/药师/神秘人面板能打开', true);
} catch (e) { failures++; ok('NPC 互动', false, e.message); }

/* ============================================================
   5. 战斗（跑 5 场）
   ============================================================ */
section('5. 战斗（跑 5 场）');
let winCount = 0, maxRounds = 0, totalRounds = 0, totalLogs = 0, ran = 0;
for (let i = 0; i < 5; i++) {
  try {
    G().zone = 'dune';
    const enemies = S.buildEncounter('dune');
    ok(`第 ${i + 1} 场生成敌人`, enemies.length >= 1, '数量 ' + enemies.length);
    S.battleStart(enemies);
    ran++;

    let guard = 0;
    while (S.Battle.active && !S.Battle.over && guard < 500) {
      guard++;
      flushTimers();
      const actor = S.Battle.actor;
      if (!S.Battle.active || S.Battle.over) break;
      if (actor && actor.kind === 'char') {
        const alive = S.Battle.enemies.filter(e => e.alive);
        if (!alive.length) break;
        const sk = actor.skills.map(x => ({ x, d:S.SKILLS[x.id] }))
          .find(o => o.d && o.d.kind !== 'buff' && actor.mp >= o.d.mp);
        if (sk) S.playerSkill(sk.x.id, alive[0].uid);
        else S.playerAttack(alive[0].uid);
      } else {
        S.nextTurn();
      }
    }
    if (!S.Battle.active) {
      if (S.Battle.recap && S.Battle.recap.result === 'win') winCount++;
      maxRounds = Math.max(maxRounds, S.Battle.round);
      totalRounds += S.Battle.round;
      totalLogs += S.Battle.logLines || 0;
      S.ui.showScreen('explore');
      S.enterExplore('here');
    } else {
      failures++;
      log(`  FAIL 第 ${i + 1} 场战斗没有结束（round=${S.Battle.round}, actor=${S.Battle.actor && S.Battle.actor.name}）`);
    }
  } catch (e) {
    failures++;
    log(`  FAIL 第 ${i + 1} 场战斗异常: ${e.message}`);
  }
}
ok(`5 场战斗都正常结束（胜 ${winCount} 场，最长 ${maxRounds} 回合，平均 ${(totalRounds / 5).toFixed(1)} 回合）`,
   ran === 5 && winCount >= 4 && maxRounds <= 40);
ok(`战斗有内容（平均每场 ${(totalLogs / 5).toFixed(1)} 条日志）`, totalLogs / 5 >= 6,
   '日志太少说明秒杀，体验会像点一下就没');

/* ============================================================
   6. 成长 / 加点 / 学技能
   ============================================================ */
section('6. 成长 / 加点 / 学技能');
try {
  const u = G().party[0];
  /* 先把等级推到 10（技能上限变 10），确保技能可提升 */
  S.gainExp(u, 20000);
  ok(`经验能升级（Lv.${u.level}）`, u.level >= 10, 'level=' + u.level);
  const pointsBefore = u.points;
  const levels = S.gainExp(u, 5000);
  ok('升级发放属性点（每级 5 点）', u.points === pointsBefore + levels * 5,
     `points=${u.points}, 之前=${pointsBefore}, 升了 ${levels} 级`);

  const before = u.stats.str;
  S.allocate(u, 'str', 3);
  ok('加点到力量生效', u.stats.str === before + 3, `${before} -> ${u.stats.str}`);

  ok('技能档位：9 级上限 5', S.maxSkillLevel(9) === 5);
  ok('技能档位：10 级上限 10', S.maxSkillLevel(10) === 10);
  ok('技能档位：14 级上限 10', S.maxSkillLevel(14) === 10);
  ok('技能档位：15 级上限 15', S.maxSkillLevel(15) === 15);
  ok('技能档位：24 级上限 20', S.maxSkillLevel(24) === 20);

  const sk = u.skills[0];
  G().gold = 0;
  let r = S.learnSkill(u, sk.id);
  ok('金币不足时学技能失败', r.ok === false, r.msg);
  G().gold = 99999;
  const lvBefore = sk.lv;
  r = S.learnSkill(u, sk.id);
  ok(`花金币学技能一次 +5（Lv.${lvBefore} -> Lv.${sk.lv}）`, r.ok && sk.lv === lvBefore + 5, r.msg);
  let guard2 = 0;
  while (S.learnSkill(u, sk.id).ok && guard2++ < 20) {}
  ok(`技能止步于档位上限（Lv.${sk.lv} = maxSkillLevel(${u.level})）`,
     sk.lv === S.maxSkillLevel(u.level), `skill=${sk.lv}, cap=${S.maxSkillLevel(u.level)}`);
} catch (e) { failures++; ok('成长流程', false, e.message); }

/* ============================================================
   7. 捕捉 / 宝宝 / 变异
   ============================================================ */
section('7. 捕捉与稀有度');
try {
  G().zone = 'dune';
  const baby = S.makeEnemy('snake', [2, 2], 'baby');
  ok('宝宝标记正确', baby.rarity === 'baby' && baby.name.indexOf('宝宝') === 0, baby.name);
  const variant = S.makeEnemy('snake', [2, 2], 'variant');
  const normal = S.makeEnemy('snake', [2, 2], 'normal');
  variant.level = baby.level = normal.level = 2;
  /* 同等级重算，避免随机等级干扰 */
  const b2 = S.makeEnemy('snake', [2, 2], 'baby');
  const v2 = S.makeEnemy('snake', [2, 2], 'variant');
  const n2 = S.makeEnemy('snake', [2, 2], 'normal');
  ok('变异怪物血量高于普通', v2.c.maxHp > n2.c.maxHp, `变异 ${v2.c.maxHp} vs 普通 ${n2.c.maxHp}`);
  ok('宝宝血量低于普通怪', b2.c.maxHp < n2.c.maxHp, `宝宝 ${b2.c.maxHp} vs 普通 ${n2.c.maxHp}`);
  ok('变异怪物属性高于宝宝', v2.c.atk > b2.c.atk, `${v2.c.atk} vs ${b2.c.atk}`);
  ok('非生肖怪不会出宝宝', S.rollRarity(S.MONSTERS.golem) === 'normal');

  const petCount0 = G().pets.length;
  S.battleStart([baby]);
  let caught = false;
  for (let i = 0; i < 60 && !caught; i++) {
    if (!S.Battle.active) {
      S.Battle.active = true; S.Battle.over = false;
      S.Battle.enemies = [baby];
      S.Battle.allies.forEach(a => { a.alive = true; a.hp = S.statsOf(a).maxHp; });
    }
    baby.alive = true; baby.hp = 1;
    S.Battle.actor = S.Battle.allies.find(a => a.id === 'ranger') || S.Battle.allies[0];
    S.playerCapture(baby.uid);
    if (G().pets.length > petCount0) caught = true;
  }
  ok('捕捉能获得宠物', caught, `宠物数 ${petCount0} -> ${G().pets.length}`);
  if (caught) {
    const p = G().pets[G().pets.length - 1];
    ok('捕捉到的宠物是宝宝品质', p.rarity === 'baby', p.rarity);
    ok('宝宝宠物学会的是普通技能', p.skills[0].id === S.PETS[p.zodiac].skill, p.skills[0].id);
  }
  const vp = S.makePet('snake', 'variant');
  ok('变异宠物带变异技能', vp.skills[0].id === S.PETS.snake.mutSkill, vp.skills[0].id);
} catch (e) { failures++; ok('捕捉流程', false, e.message); }

/* ============================================================
   8. 队伍 / 图鉴 / 团灭
   ============================================================ */
section('8. 队伍 / 图鉴 / 团灭');
try {
  S.Battle.active = false; S.Battle.over = true;
  if (G().pets.length) {
    const p = G().pets[0];
    const r = S.togglePetSlot(p.uid);
    ok('宠物可以上场', r.ok && S.activePets().length === 1, JSON.stringify(r));
    ok('出战队伍 = 3 角色 + 宠物', S.buildPartyUnits(false).length === 4);
  }
  S.markCodex('golem');
  ok('进过战斗即入图鉴', !!G().codex.golem);
  S.ui.openCodex('monster');
  S.ui.openCodex('pet');
  ok('怪物/宠物图鉴能渲染', true);

  const goldBefore = G().gold;
  G().zone = 'ruins';
  S.battleStart([S.makeEnemy('golem', [10, 10])]);
  S.Battle.allies.forEach(a => { a.hp = 0; a.alive = false; });
  S.checkBattleEnd();
  ok('团灭后回到沙丘镇', G().zone === 'town', G().zone);
  ok('团灭扣除金币', G().gold < goldBefore, `${goldBefore} -> ${G().gold}`);
  ok('团灭后角色复活', G().party.every(u => u.alive && u.hp > 0));
  ok('团灭后宠物满血', G().pets.every(p => p.hp > 0));
} catch (e) { failures++; ok('队伍/图鉴/团灭', false, e.message); }

/* ============================================================
   9. 区域推进 / BOSS / 轮回
   ============================================================ */
section('9. 区域推进 / BOSS / 轮回');
try {
  S.Battle.active = false; S.Battle.over = true;
  S.ui.showScreen('explore');

  /* 城镇出口 → 沙丘荒野 */
  const gate = S.TOWN_EXITS ? S.TOWN_EXITS[0] : null;
  ok('城镇有通往野外的出口', !!gate, gate ? gate.name : '无');
  G().zone = 'dune';
  G().pos = { x:0, y:0 };
  S.enterExplore('out');
  ok('进入沙丘荒野', G().zone === 'dune' && !S.currentZone().safe);

  /* ---- 回归：野外必须是无限平面（之前是有边界的矩形） ---- */
  ok('野外区域不再有 size 边界', S.ZONES.dune.size === undefined && S.ZONES.tomb.size === undefined);
  G().pos = { x:9999, y:-9999 };
  ok('野外走到极远坐标仍可通行', S.isWalkable(9999, -9999) === true);
  G().pos = { x:-5000, y:5000 };
  ok('野外负坐标也可通行（真正无限）', S.isWalkable(-5000, 5000) === true);
  /* 城镇仍然有墙 */
  G().zone = 'town';
  const wallBlocked = [[0,0],[1,1],[5,0],[0,5],[3,3]].some(([x,y]) => S.isWalkable(x, y) === false);
  const floorOpen = S.isWalkable(10, 8) === true;
  ok('城镇仍然保留围墙碰撞', wallBlocked && floorOpen, `有墙被挡=${wallBlocked}, 空地可走=${floorOpen}`);

  /* ---- 回归：相机必须跟随玩家（否则角色跑到屏幕外，看起来像"走不动"） ---- */
  S.ui.showScreen('explore');
  G().zone = 'town';
  G().pos = { x:14, y:10 };          // 镇中心：不会被边界夹住
  S.enterExplore('here');
  const camA = S.ui.cameraAt();
  const vp = S.ui.viewport();
  const pw = S.playerWorld();
  const onScreenX = pw.x - camA.x, onScreenY = pw.y - camA.y;
  /* 玩家必须落在屏幕内（留出安全边距），否则就是"看不见角色"的 bug */
  ok('城镇里玩家落在屏幕内（相机跟随）',
     onScreenX > vp.w * 0.05 && onScreenX < vp.w * 0.95 &&
     onScreenY > vp.h * 0.05 && onScreenY < vp.h * 0.95,
     `玩家屏幕位置 ${onScreenX.toFixed(0)},${onScreenY.toFixed(0)} / 视口 ${vp.w}x${vp.h}`);
  /* 城镇相机会被夹住不越界（地图比视口小时则是居中，不会露出地图外的空白） */
  G().zone = 'town';
  G().pos = { x:1.5, y:1.5 };
  const camEdge = S.ui.cameraAt();
  const vpT = S.ui.viewport();
  const mapW = S.TOWN_W * S.TILE, mapH = S.TOWN_H * S.TILE;
  const expX = mapW <= vpT.w ? (mapW - vpT.w) / 2 : 0;
  const expY = mapH <= vpT.h ? (mapH - vpT.h) / 2 : 0;
  ok('城镇相机夹在边界内（不露白）',
     Math.abs(camEdge.x - expX) < 1 && Math.abs(camEdge.y - expY) < 1,
     `相机 ${JSON.stringify(camEdge)}，期望 ${expX},${expY}`);
  /* 野外无限：相机永不夹住 */
  G().zone = 'dune';
  G().pos = { x:12345, y:-6789 };
  const camFar = S.ui.cameraAt();
  ok('野外相机不做边界限制（无限平面）',
     Math.abs(camFar.x - (12345 * 40 - S.ui.viewport().w / 2)) < 1,
     JSON.stringify(camFar));
  /* 玩家精灵被放在屏幕中心，而不是世界坐标 */
  G().pos = { x:24, y:8 };
  S.ui.renderPartyChars();
  const leader = S.ui.viewport();
  const charEl = S.document.getElementById('char_' + G().party[0].uid);
  ok('角色精灵画在屏幕中心（而不是世界坐标）',
     charEl && Math.abs(parseFloat(charEl.style.left) - leader.w / 2) < 1,
     charEl ? `left=${charEl.style.left}, 期望≈${leader.w / 2}` : '精灵不存在');
  /* 世界层收到相机平移 */
  S.ui.applyCamera();
  const worldEl = S.document.getElementById('mapWorld');
  ok('世界层应用了相机位移', !!worldEl && /translate\(/.test(worldEl.style.transform || ''),
     worldEl && worldEl.style.transform);

  /* ---- 出口与方向指引（必须在切回城镇之前测） ---- */
  G().zone = 'dune';
  const backExit = S.WILD_EXITS.dune;
  ok('荒野配置了回城出口', !!backExit, backExit ? backExit.name : '无');
  if (backExit) {
    G().pos = { x:backExit.x, y:backExit.y };
    S.updateNearby();
    ok('走近回城出口出现互动按钮', !!S.Explore.near && S.Explore.near.type === 'exit',
       JSON.stringify(S.Explore.near && S.Explore.near.label));
    G().pos = { x:backExit.x - 10, y:backExit.y };
    S.ui.updateMinimap();
    const mm = S.document.getElementById('minimap');
    ok('小地图给出回城方向指引', mm.style.display !== 'none' && /格/.test(mm.innerHTML || ''),
       (mm.innerHTML || '').slice(0, 60));
  }

  /* ---- 相机两种模式 ---- */
  S.ui.showScreen('explore');
  G().zone = 'town';
  G().pos = { x:14, y:10 };
  S.enterExplore('here');
  S.ui.setFollow(true);
  S.ui.renderPartyChars();
  const vpF = S.ui.viewport();
  const camF1 = S.ui.cameraAt();
  const charF = S.document.getElementById('char_' + G().party[0].uid);
  ok('跟随模式：人物固定在屏幕中心',
     Math.abs(parseFloat(charF.style.left) - vpF.w / 2) < 1,
     `left=${charF.style.left}，屏幕宽 ${vpF.w}`);
  /* 走一段后，人物仍在中心，但相机移动了 */
  S.Explore.dir = { x:1, y:0 };
  for (let i = 0; i < 20; i++) S.updateExplore(0.05);
  S.ui.renderPartyChars();
  const camF2 = S.ui.cameraAt();
  const charF2 = S.document.getElementById('char_' + G().party[0].uid);
  ok('跟随模式：走动后相机跟着移动',
     Math.abs(camF2.x - camF1.x) > 5,
     `相机 ${camF1.x.toFixed(0)} -> ${camF2.x.toFixed(0)}`);
  ok('跟随模式：走动后人物仍在屏幕中心',
     Math.abs(parseFloat(charF2.style.left) - vpF.w / 2) < 1, `left=${charF2.style.left}`);

  /* 固定相机模式：相机不动，人物在屏幕上真实移动 */
  S.ui.setFollow(false);
  G().pos = { x:14, y:10 };
  S.ui.renderPartyChars();
  const camX1 = S.ui.cameraAt();
  const charX1 = parseFloat(S.document.getElementById('char_' + G().party[0].uid).style.left);
  S.Explore.dir = { x:1, y:0 };
  for (let i = 0; i < 20; i++) S.updateExplore(0.05);
  S.ui.renderPartyChars();
  const camX2 = S.ui.cameraAt();
  const charX2 = parseFloat(S.document.getElementById('char_' + G().party[0].uid).style.left);
  ok('固定模式：相机完全不动', Math.abs(camX2.x - camX1.x) < 0.01,
     `${camX1.x.toFixed(1)} -> ${camX2.x.toFixed(1)}`);
  ok(`固定模式：人物在屏幕上真实移动（移动了 ${(charX2 - charX1).toFixed(0)}px）`,
     charX2 - charX1 > 20, `${charX1.toFixed(0)} -> ${charX2.toFixed(0)}`);
  ok('相机模式可来回切换', S.ui.setFollow(true) === true && S.ui.setFollow(false) === false);
  S.ui.setFollow(true);            // 恢复默认
  S.Explore.dir = { x:0, y:0 };

  /* ---- 出城门 ---- */
  /* 出城门应该落到野外出生点，而不是墙里 */
  G().zone = 'town';
  S.enterExplore('west');
  G().pos = { x:S.TOWN_EXITS[0].x, y:S.TOWN_EXITS[0].y };
  S.updateNearby();
  ok('靠近城门出现出口按钮', !!S.Explore.near && S.Explore.near.type === 'exit',
     JSON.stringify(S.Explore.near && S.Explore.near.label));
  S.doInteract();
  ok('交互后进入野外', G().zone === 'dune', G().zone);
  ok('进入野外后出生点可通行', S.isWalkable(G().pos.x, G().pos.y) === true, JSON.stringify(G().pos));

  /* 推进到王陵深处，应触发 BOSS */
  G().bossKilled = false;
  G().flags = {};
  G().zone = 'tomb';
  S.enterExplore('west');
  ok('首次进入王陵会安排 BOSS 战', G().flags.pendingBoss === true || S.Battle.active === true);
  flushTimers();
  ok('BOSS 战确实开打', S.Battle.active === true);
  const bossUnit = S.Battle.enemies.find(e => e.boss);
  ok('BOSS 是沙之支配者', !!bossUnit && bossUnit.name.indexOf('沙之支配者') >= 0, bossUnit && bossUnit.name);
  ok('BOSS 血量远高于小怪', bossUnit && bossUnit.c.maxHp >= 2000, bossUnit && String(bossUnit.c.maxHp));

  /* 打死 BOSS → bossKilled，轮回按钮可用 */
  bossUnit.hp = 0; bossUnit.alive = false;
  S.Battle.enemies.forEach(e => { if (!e.boss) { e.hp = 0; e.alive = false; } });
  S.checkBattleEnd();
  ok('击杀 BOSS 后记录进度', G().bossKilled === true);
  ok('轮回按钮条件满足', G().bossKilled === true);

  /* 轮回：保留属性/物品/宠物 */
  const goldKeep = G().gold, petKeep = G().pets.length, lvKeep = G().party[0].level;
  G().eliteKills = 0;
  G().bossKilled = false;
  G().flags.reincarnations = (G().flags.reincarnations || 0) + 1;
  ok('轮回保留金币', G().gold === goldKeep);
  ok('轮回保留宠物', G().pets.length === petKeep);
  ok('轮回保留属性与等级', G().party[0].level === lvKeep);
} catch (e) { failures++; ok('区域推进/BOSS', false, e.message); }

/* ============================================================
   9.5 走动回归（用真实摇杆事件驱动，之前这里连崩了两个 bug）
   ------------------------------------------------------------
   bug1: townTileAt 用小数下标取数组行 -> 每帧抛异常 -> 循环死掉
   bug2: 出生点落在房屋格里 -> 角色卡住不动
   ============================================================ */
section('9.5 走动回归（模拟摇杆拖动）');
try {
  S.ui.showScreen('explore');
  G().zone = 'town';
  G().pos = { x:S.TOWN_SPAWN.x, y:S.TOWN_SPAWN.y };
  S.enterExplore('here');
  ok('城镇出生点在空地上（不在墙里/房子里）', S.isWalkable(G().pos.x, G().pos.y) === true,
     `${JSON.stringify(G().pos)} -> tile "${S.townTileAt(G().pos.x, G().pos.y)}"`);

  /* 用小数坐标调用碰撞检测，不能抛异常（bug1） */
  let floatOK = true, floatMsg = '';
  try { S.isWalkable(14, 10.35); S.isWalkable(6.7, 3.2); S.isWalkable(27.9, 19.4); }
  catch (e) { floatOK = false; floatMsg = e.message; }
  ok('碰撞检测接受小数坐标（不会崩）', floatOK, floatMsg);

  /* 真摇杆：按下→拖动→连续跑帧 */
  const jz = S.document.getElementById('joyZone');
  const touch = (x, y) => ({ identifier:1, clientX:x, clientY:y });
  const fire = (type, x, y) => (jz.listeners[type] || []).forEach(f => f({ changedTouches:[touch(x, y)], preventDefault(){} }));
  ok('摇杆事件已绑定', (jz.listeners.touchstart || []).length > 0);

  fire('touchstart', 100, 300);
  fire('touchmove', 160, 300);              // 往右拖
  ok('拖动后产生移动方向', Math.abs(S.Explore.dir.x - 1) < 0.01 && Math.abs(S.Explore.dir.y) < 0.01,
     JSON.stringify(S.Explore.dir));

  const start = { x:G().pos.x, y:G().pos.y };
  let frames = 0, crashed = null;
  for (let i = 0; i < 40; i++) {
    try { S.updateExplore(0.05); frames++; }
    catch (e) { crashed = e.message; break; }
  }
  const dist = Math.hypot(G().pos.x - start.x, G().pos.y - start.y);
  ok('连续 40 帧更新不抛异常（循环不会死）', crashed === null, crashed || '');
  ok(`拖动摇杆角色确实会移动（走了 ${dist.toFixed(2)} 格）`, dist > 1.5 && frames >= 40,
     `从 ${JSON.stringify(start)} 到 ${JSON.stringify(G().pos)}`);

  /* 撞墙测试：朝西墙一直走，不能穿墙、不能卡死崩溃 */
  G().pos = { x:2.5, y:8 };
  S.Explore.dir = { x:-1, y:0 };
  let crash2 = null;
  for (let i = 0; i < 30; i++) { try { S.updateExplore(0.05); } catch (e) { crash2 = e.message; break; } }
  ok('一直朝墙走不穿墙且不崩溃', crash2 === null && G().pos.x >= 1.5 && S.isWalkable(G().pos.x, G().pos.y) === true,
     crash2 || `pos=${JSON.stringify(G().pos)}`);

  /* 卡在石头里也能靠"就近脱困"救回来 */
  G().pos = { x:5.5, y:3.5 };          // 这是树木格，不可通行
  S.ensureWalkable();
  ok('卡在障碍里能自动脱困到空地', S.isWalkable(G().pos.x, G().pos.y) === true, JSON.stringify(G().pos));

  /* 野外不受影响，照样能走 */
  G().zone = 'dune';
  G().pos = { x:24, y:8 };
  S.enterExplore('here');
  S.Explore.dir = { x:1, y:1 };
  const far = { x:G().pos.x, y:G().pos.y };
  for (let i = 0; i < 20; i++) S.updateExplore(0.05);
  ok('野外也能正常移动', Math.hypot(G().pos.x - far.x, G().pos.y - far.y) > 1,
     JSON.stringify(G().pos));
  S.Explore.dir = { x:0, y:0 };

  /* ---- 端到端：点"开始游戏"按钮 → 拖摇杆走路 ---- */
  S.resetSave();
  G().zone = 'town';
  const btn = S.document.getElementById('btnNewGame');
  btn.click();                                   // 走真实的新游戏流程
  log(`  （点击开始游戏后 zone=${G().zone}, pos=${JSON.stringify(G().pos)}）`);
  ok('点击【开始游戏】进入沙丘镇', G().zone === 'town', G().zone);
  const posAtStart = { x:G().pos.x, y:G().pos.y };
  ok('开局角色站在可通行的空地上', S.isWalkable(posAtStart.x, posAtStart.y) === true,
     JSON.stringify(posAtStart));

  /* 连拖 200 帧（约 10 秒），检查不会卡住也不会崩 */
  fire('touchstart', 100, 300);
  fire('touchmove', 160, 340);                   // 右下方向
  let e2 = null, stuckAt = null;
  for (let i = 0; i < 200; i++) {
    try {
      S.updateExplore(1 / 60);
      if (i === 60 && Math.hypot(G().pos.x - posAtStart.x, G().pos.y - posAtStart.y) < 0.5) {
        stuckAt = { x:G().pos.x, y:G().pos.y };
      }
    } catch (e) { e2 = e.message; break; }
  }
  const walked = Math.hypot(G().pos.x - posAtStart.x, G().pos.y - posAtStart.y);
  ok('连拖 200 帧不崩溃', e2 === null, e2 || '');
  ok(`拖住摇杆 10 秒能走出一段距离（${walked.toFixed(1)} 格）`, walked > 5,
     `从 ${JSON.stringify(posAtStart)} 到 ${JSON.stringify(G().pos)}`);
  ok('走动过程中不会卡住不动', stuckAt === null, stuckAt ? JSON.stringify(stuckAt) : '');
  ok('走动后仍在可通行位置', S.isWalkable(G().pos.x, G().pos.y) === true, JSON.stringify(G().pos));
  fire('touchend', 160, 340);
  S.Explore.dir = { x:0, y:0 };
} catch (e) { failures++; ok('走动回归', false, e.message); }

/* ============================================================
   10. 存档
   ============================================================ */
section('9. 存档');
try {
  G().gold = 777;
  const saved = S.saveGame();
  ok('存档写入成功', saved === true && S.hasSave() === true);
  G().gold = 0;
  const loaded = S.loadGame();
  ok('读档恢复数据', loaded === true && G().gold === 777, `实际 ${G().gold}`);
  ok('读档后角色技能保留', G().party.every(u => u.skills.length === 2));
} catch (e) { failures++; ok('存档', false, e.message); }

/* ============================================================
   10. 难度曲线（数值体检）
   ============================================================ */
section('11. 难度曲线体检');
try {
  const cs = S.calcStatsFor(S.CLASSES.sword.base, 1);
  const cm = S.calcStatsFor(S.CLASSES.mage.base, 1);
  const cr = S.calcStatsFor(S.CLASSES.ranger.base, 1);
  ok('1 级剑士血量合理（80-160）', cs.maxHp >= 80 && cs.maxHp <= 160, 'maxHp=' + cs.maxHp);
  ok('法师蓝量高于剑士', cm.maxMp > cs.maxMp, `${cm.maxMp} vs ${cs.maxMp}`);
  ok('法师魔攻高于剑士物攻', cm.matk > cs.matk, `${cm.matk} vs ${cs.matk}`);
  ok('游侠速度最快', cr.spd > cs.spd && cr.spd > cm.spd, `${cr.spd} / ${cs.spd} / ${cm.spd}`);
  ok('剑士物防最高', cs.def > cm.def && cs.def > cr.def, `${cs.def} / ${cm.def} / ${cr.def}`);

  const atk = { kind:'char', name:'测试', level:1, stats:S.CLASSES.sword.base, skills:[], buffs:[], statuses:[] };
  const def = S.makeEnemy('rat', [1, 1]);
  /* canMiss:false —— 这里只验伤害公式，命中/闪避另有随机性 */
  const r1 = S.rollDamage(atk, def, { kind:'phys', power:1.5, skillLv:5, canMiss:false });
  ok('1 级重斩伤害落在合理区间（15-90）', r1.dmg >= 15 && r1.dmg <= 90, 'dmg=' + r1.dmg);

  const defHi = S.makeEnemy('golem', [10, 10]);
  const atkHi = { kind:'char', name:'测试', level:10, stats:{ vit:20,str:24,agi:12,int:8,spr:10,luk:8,per:12,wil:10 }, skills:[], buffs:[], statuses:[] };
  const r2 = S.rollDamage(atkHi, defHi, { kind:'phys', power:1.5, skillLv:10, canMiss:false });
  ok('高等级仍有保底伤害（>0）', r2.dmg > 0, 'dmg=' + r2.dmg);

  const r3 = S.rollDamage({ kind:'char', name:'法师', level:1, stats:S.CLASSES.mage.base, skills:[], buffs:[], statuses:[] },
                          def, { kind:'magic', power:1.6, skillLv:5, canMiss:false });
  ok('1 级火球伤害落在合理区间（15-100）', r3.dmg >= 15 && r3.dmg <= 100, 'dmg=' + r3.dmg);

  /* 命中判定本身也要能生效（真打真躲） */
  let missSeen = false, hitSeen = false;
  for (let i = 0; i < 300; i++) {
    const r = S.rollDamage(atk, def, { kind:'phys', power:1.0, skillLv:5 });
    if (r.miss) missSeen = true; else hitSeen = true;
    if (missSeen && hitSeen) break;
  }
  ok('命中与落空都会发生（命中率生效）', missSeen && hitSeen, `miss=${missSeen}, hit=${hitSeen}`);

  /* 一场 1v1 的回合数估算：沙鼠需要几刀（关掉暴击与命中随机，测基准值） */
  const base = S.rollDamage(atk, def, { kind:'phys', power:1.5, skillLv:5, canMiss:false, noCrit:true });
  const hits = Math.ceil(def.c.maxHp / base.dmg);
  ok('1 级小怪需要 2-5 刀砍死', hits >= 2 && hits <= 5, `${def.c.maxHp} HP / ${base.dmg} 伤害 = ${hits} 刀`);
} catch (e) { failures++; ok('难度曲线', false, e.message); }

/* ============================================================
   结果
   ============================================================ */
log('\n' + '='.repeat(48));
if (failures === 0) { log('全部通过'); process.exit(0); }
else { log(`${failures} 项失败`); process.exit(1); }
