"use strict";

/* ============================================================
   无尽回响：轮回 — 核心（core）
   ------------------------------------------------------------
   实体构造、属性计算、成长、技能学习、存档、五行克制
   依赖：data.js
   ============================================================ */

let G = null;   // 全局存档 / 运行时状态

/* ============================================================
   实体构造
   ============================================================ */
let _uid = 1;
const nextUid = () => 'u' + (_uid++);

/* 角色（三个固定角色之一） */
function makeCharacter(classId) {
  const cls = CLASSES[classId];
  return {
    kind:'char',
    uid: nextUid(),
    id: cls.id, name: cls.name, emoji: cls.emoji,
    level: 1, exp: 0,
    points: 0,                       // 未分配属性点
    stats: Object.assign(BLANK_STATS(), cls.base),
    skills: cls.skills.map(id => ({ id, lv:5 })),
    hp: 0, mp: 0, alive:true,
    equip: {},
  };
}

/* 宠物 */
function makePet(zodiacId, rarity) {
  const p = PETS[zodiacId];
  return {
    kind:'pet',
    uid: nextUid(),
    id: p.id, name: p.name, emoji: p.emoji,
    zodiac: p.id, element: p.element,
    rarity: rarity || 'normal',
    level: 1, exp: 0,
    stats: BLANK_STATS(),
    skills: [{ id: (rarity === 'variant' ? p.mutSkill : p.skill), lv:5 }],
    hp: 0, mp: 0, alive:true,
  };
}

/* ============================================================
   五行克制：克制 ×1.25，被克 ×0.8
   ============================================================ */
function elementMul(atkEl, defEl) {
  if (!atkEl || !defEl) return 1;
  if (ELEMENT_COUNTER[atkEl] === defEl) return 1.25;
  if (ELEMENT_COUNTER[defEl] === atkEl) return 0.8;
  return 1;
}

/* ============================================================
   属性计算
   ------------------------------------------------------------
   公式口径（第一版）：
     maxHp  = 45 + vit*8  + level*6
     maxMp  = 20 + int*3  + spr*2 + level*2
     atk    = 8  + str*2.2 + level*0.8
     def    = 4  + vit*1.2 + level*0.5
     matk   = 6  + int*2.2 + level*0.8
     mdef   = 4  + spr*1.2 + level*0.5
     spd    = 50 + agi*2.5
     crit   = 0.05 + luk*0.008
     hit    = 0.85 + per*0.008
     eva    = 0.02 + agi*0.004
   ============================================================ */
function calcStatsFor(stats, level, opts) {
  const o = opts || {};
  const s = stats;
  const st = {
    maxHp:  Math.round(45 + s.vit * 8 + level * 6),
    maxMp:  Math.round(20 + s.int * 3 + s.spr * 2 + level * 2),
    atk:    8 + s.str * 2.2 + level * 0.8,
    def:    4 + s.vit * 1.2 + level * 0.5,
    matk:   6 + s.int * 2.2 + level * 0.8,
    mdef:   4 + s.spr * 1.2 + level * 0.5,
    spd:    50 + s.agi * 2.5,
    crit:   0.05 + s.luk * 0.008,
    hit:    0.85 + s.per * 0.008,
    eva:    0.02 + s.agi * 0.004,
  };
  st.crit = Math.min(0.75, st.crit);
  st.hit  = Math.min(1.0, st.hit);
  st.eva  = Math.min(0.5, st.eva);
  if (o.mult) { for (const k in o.mult) if (k in st) st[k] *= o.mult[k]; }
  if (o.bonus) { for (const k in o.bonus) if (k in st) st[k] += o.bonus[k]; }
  for (const k in st) st[k] = Math.round(st[k] * 1000) / 1000;
  st.maxHp = Math.max(1, Math.round(st.maxHp));
  st.maxMp = Math.max(0, Math.round(st.maxMp));
  return st;
}

/* 宠物属性：偏科系数 + 稀有度加成 */
function calcPetStats(pet) {
  const bias = PETS[pet.zodiac].bias;
  const lv = pet.level;
  const base = { vit:2, str:2, agi:2, int:2, spr:2, luk:2, per:2, wil:2 };
  const stats = {};
  for (const k of STAT_IDS) {
    const b = bias[k] || 0.55;                  // 没写进偏科的就是 0.55 的成长
    stats[k] = Math.round((base[k] + (1 + b) * (lv - 1)) * 10) / 10;
  }
  const r = RARITY[pet.rarity] || RARITY.normal;
  for (const k of STAT_IDS) stats[k] += r.statBonus;
  return calcStatsFor(stats, lv, { mult:{ maxHp:r.hpMul } });
}

/* 统一的属性入口 */
function statsOf(unit) {
  if (unit.kind === 'char') return calcStatsFor(unit.stats, unit.level);
  if (unit.kind === 'pet')  return calcPetStats(unit);
  return unit.c;   // 敌人：c 在生成时就固定好了
}

/* ============================================================
   等级 / 经验
   ============================================================ */
function gainExp(unit, amount) {
  if (!unit || unit.kind === 'enemy' || amount <= 0) return 0;
  let levels = 0;
  unit.exp += Math.round(amount);
  while (unit.exp >= expNeed(unit.level)) {
    unit.exp -= expNeed(unit.level);
    unit.level++;
    unit.points = (unit.points || 0) + POINTS_PER_LEVEL;
    levels++;
    /* 升级自动回满，避免升级后残血被打死 */
    const c = statsOf(unit);
    unit.hp = c.maxHp;
    unit.mp = c.maxMp;
  }
  return levels;
}

/* 加点 */
function canAllocate(u) { return u && u.kind === 'char' && u.points > 0; }
function allocate(u, statId, n) {
  const times = Math.min(n || 1, u.points);
  for (let i = 0; i < times; i++) { u.stats[statId] += 1; u.points--; }
  if (times > 0 && u.hp > 0) {
    const c = statsOf(u);
    u.hp = Math.min(u.hp, c.maxHp);
    u.mp = Math.min(u.mp, c.maxMp);
  }
  return times;
}
function hasUnspentPoints() {
  return G.party.some(u => (u.points || 0) > 0);
}

/* ============================================================
   技能学习（找 NPC 花金币，每档 +5）
   ------------------------------------------------------------
   规则：角色等级达到档位后，可花金币把该技能从 N 提到 N+5，
        且 N+5 不能超过 maxSkillLevel(等级)。
   ============================================================ */
function skillOf(unit, skillId) { return unit.skills.find(s => s.id === skillId); }

function skillUpgradeInfo(unit, skillId) {
  const sk = skillOf(unit, skillId);
  if (!sk) return null;
  const def = SKILLS[skillId] || PET_SKILLS[skillId];
  if (!def) return null;
  const cap = maxSkillLevel(unit.level);
  const next = sk.lv + 5;
  const canCap = next <= cap;
  const cost = skillLearnCost(next);
  return {
    curLv: sk.lv, nextLv: next,
    cap, canCap,
    cost,
    affordable: G.gold >= cost,
    maxed: sk.lv >= cap,
    def,
  };
}

function learnSkill(unit, skillId) {
  const info = skillUpgradeInfo(unit, skillId);
  if (!info) return { ok:false, msg:'没有这个技能' };
  if (info.maxed) return { ok:false, msg:`${info.def.name} 已达到当前等级上限 Lv.${info.curLv}` };
  if (!info.canCap) return { ok:false, msg:`角色 ${unit.level} 级，技能上限 Lv.${info.cap}，需要提升角色等级` };
  if (!info.affordable) return { ok:false, msg:`金币不足（需要 ${info.cost}）` };
  const sk = skillOf(unit, skillId);
  G.gold -= info.cost;
  sk.lv = info.nextLv;
  return { ok:true, msg:`${info.def.name} 提升至 Lv.${sk.lv}`, cost:info.cost };
}

/* 全部可学的技能（给神秘人面板用） */
function learnableList(unit) {
  return unit.skills.map(s => ({ skillId:s.id, info:skillUpgradeInfo(unit, s.id) }));
}

/* ============================================================
   宠物仓库 / 出战
   ============================================================ */
function activePets() {
  return G.petSlots.map(uid => G.pets.find(p => p.uid === uid)).filter(Boolean);
}
function isPetActive(pet) { return G.petSlots.indexOf(pet.uid) >= 0; }

function togglePetSlot(petUid) {
  const i = G.petSlots.indexOf(petUid);
  if (i >= 0) { G.petSlots.splice(i, 1); return { ok:true, on:false }; }
  if (G.petSlots.length >= PET_SLOTS) return { ok:false, msg:`最多 ${PET_SLOTS} 只宠物出战` };
  G.petSlots.push(petUid);
  return { ok:true, on:true };
}

/* 出征队伍：3 角色 + 出战宠物 */
function buildPartyUnits(refill) {
  const units = G.party.concat(activePets());
  for (const u of units) {
    const c = statsOf(u);
    u.c = c;
    if (u.hp <= 0 && refill) u.hp = c.maxHp;
    u.hp = Math.min(u.hp, c.maxHp);
    u.mp = Math.min(u.mp, c.maxMp);
    u.alive = u.hp > 0;
    u.buffs = [];
    u.statuses = [];
  }
  return units;
}

/* 全队是否还活着（存档层面） */
function partyWiped() { return G.party.every(u => u.hp <= 0); }

/* ============================================================
   图鉴：进过战斗就算"遇到过"
   ============================================================ */
function markCodex(monsterId) {
  if (!G.codex[monsterId]) {
    G.codex[monsterId] = { seen:1, caught:0, firstAt:Date.now() };
    return true;   // 新发现
  }
  return false;
}
function markCaught(monsterId) {
  if (!G.codex[monsterId]) G.codex[monsterId] = { seen:1, caught:0, firstAt:Date.now() };
  G.codex[monsterId].caught++;
}

/* ============================================================
   物品
   ============================================================ */
function addItem(id, n) {
  if (!ITEMS[id]) return;
  G.items[id] = (G.items[id] || 0) + (n || 1);
}
function useItem(id) {
  if (!G.items[id]) return false;
  G.items[id]--;
  if (G.items[id] <= 0) delete G.items[id];
  return true;
}
function itemCount(id) { return G.items[id] || 0; }
function addGold(n) { G.gold = Math.max(0, G.gold + n); }

/* ============================================================
   精英进度：击杀精英后小怪永久变强
   ============================================================ */
function eliteProgress() { return G.eliteKills || 0; }
function eliteStatMul() { return 1 + eliteProgress() * 0.12; }

/* ============================================================
   存档
   ============================================================ */
function newGame() {
  _uid = 1;
  G = {
    version: GAME_VERSION,
    createdAt: Date.now(),
    gold: 120,
    party: CLASS_ORDER.map(id => makeCharacter(id)),
    pets: [],
    petSlots: [],
    items: { herb:5, ether:3, scroll:3 },
    codex: {},
    zone: 'town',
    pos: { x: 14 * TILE, y: 10 * TILE },
    eliteKills: 0,
    bossKilled: false,
    flags: {},
    playTime: 0,
    lastSave: Date.now(),
  };
  /* 初始满血 */
  for (const u of G.party) { const c = statsOf(u); u.hp = c.maxHp; u.mp = c.maxMp; }
  return G;
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

function saveGame() {
  if (!G) return false;
  try {
    G.lastSave = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      version:G.version, createdAt:G.createdAt, gold:G.gold,
      party:G.party, pets:G.pets, petSlots:G.petSlots, items:G.items,
      codex:G.codex, zone:G.zone, pos:G.pos,
      eliteKills:G.eliteKills, bossKilled:G.bossKilled,
      flags:G.flags, playTime:G.playTime, lastSave:G.lastSave,
    }));
    return true;
  } catch (e) { return false; }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.party)) return false;
    G = d;
    /* 兼容旧档：补齐可能缺失的字段 */
    G.petSlots = G.petSlots || [];
    G.pets = G.pets || [];
    G.items = G.items || {};
    G.codex = G.codex || {};
    G.flags = G.flags || {};
    G.eliteKills = G.eliteKills || 0;
    G.pos = G.pos || { x: 14 * TILE, y: 10 * TILE };
    G.zone = G.zone || 'town';
    for (const u of G.party) {
      u.points = u.points || 0;
      if (!u.skills || !u.skills.length) u.skills = CLASSES[u.id].skills.map(id => ({ id, lv:5 }));
      const c = statsOf(u);
      u.hp = clamp(u.hp || c.maxHp, 0, c.maxHp);
      u.mp = clamp(u.mp || 0, 0, c.maxMp);
    }
    for (const p of G.pets) {
      p.points = 0;
      p.rarity = p.rarity || 'normal';
      if (!p.skills || !p.skills.length) p.skills = [{ id: PETS[p.zodiac].skill, lv:5 }];
      const c = statsOf(p);
      p.hp = clamp(p.hp || c.maxHp, 0, c.maxHp);
      p.mp = clamp(p.mp || 0, 0, c.maxMp);
    }
    return true;
  } catch (e) { return false; }
}

function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

/* 自动存档节流 */
let _saveTimer = 0;
function autoSave(delay) {
  const d = delay === undefined ? 800 : delay;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveGame(), d);
}
