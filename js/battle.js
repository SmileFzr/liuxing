"use strict";

/* ============================================================
   无尽回响：轮回 — 战斗（battle）
   ------------------------------------------------------------
   传统回合制：每回合按 spd 从高到低各行动一次
   伤害：max(1, 攻击*倍率*技能倍率*五行 - 防御)
   依赖：data.js / core.js
   ============================================================ */

const Battle = {
  active: false,
  enemies: [],
  allies: [],
  round: 0,
  queue: [],
  turnIdx: 0,
  actor: null,        // 当前等待指令的单位
  auto: false,
  countdown: 0,
  countdownMax: 18,
  pendingItem: null,  // 使用道具后等待选择目标
  pendingSkill: null, // 使用技能后等待选择目标
  over: false,
  recap: null,        // 战斗结算数据
};

/* ============================================================
   敌人生成
   ============================================================ */
function zoneLevelRange(zoneId) {
  const t = { dune:[1,4], ruins:[4,7], tomb:[8,11] }[zoneId] || [1,3];
  return t;
}

function rollRarity(monster) {
  if (!monster.zodiac) return 'normal';        // 只有生肖怪才有宝宝/变异
  const r = Math.random();
  if (r < RARITY_RATES.variant) return 'variant';
  if (r < RARITY_RATES.variant + RARITY_RATES.baby) return 'baby';
  return 'normal';
}

function makeEnemy(monsterId, levelHint, forceRarity) {
  const m = MONSTERS[monsterId];
  const [lo, hi] = levelHint || [1, 3];
  const level = rndi(lo, hi);
  const rarity = forceRarity || rollRarity(m);
  const r = RARITY[rarity];
  const k = level - 1;
  const em = eliteStatMul();
  const statMul = r.statMul * em;
  const hpMul = r.hpMul * em;

  const raw = {
    maxHp: m.hp + k * m.hp * 0.22,
    maxMp: 20 + k * 4,
    atk:   (m.atk  + k * m.atk  * 0.18) * statMul,
    def:   (m.def  + k * m.def  * 0.16) * statMul,
    matk:  (m.matk + k * m.matk * 0.18) * statMul,
    mdef:  (m.mdef + k * m.mdef * 0.16) * statMul,
    spd:    m.spd + k * 1.2,
    crit:   0.05 + level * 0.005,
    hit:    0.90,
    eva:    0.02 + level * 0.004,
  };
  const c = {};
  for (const key in raw) c[key] = Math.round(raw[key] * (key === 'maxHp' ? hpMul : 1));
  c.maxHp = Math.max(1, c.maxHp);
  c.maxMp = Math.max(0, c.maxMp);

  const isBaby = rarity === 'baby';
  const name = (isBaby ? '宝宝·' : '') + (rarity === 'variant' ? '变异' : '') + m.name;

  return {
    kind:'enemy',
    uid: nextUid(),
    id: m.id, monsterId: m.id,
    name, emoji: m.emoji,
    level, rarity, zodiac: m.zodiac,
    element: PETS[m.zodiac] ? PETS[m.zodiac].element : null,
    elite: !!m.elite, boss: !!m.boss,
    skills: m.skills.slice(),
    c,
    hp: c.maxHp, mp: c.maxMp, alive:true,
    buffs:[], statuses:[],
    expReward: Math.round(m.exp * r.expMul * (1 + k * 0.35)),
    goldReward: Math.round(m.gold * (1 + k * 0.30) * r.expMul),
  };
}

function buildEncounter(zoneId) {
  const z = ZONES[zoneId];
  const pool = Object.keys(z.encounter);
  const weights = pool.map(id => z.encounter[id]);
  const partySize = G.party.length + G.petSlots.length;
  const n = rollEnemyCount(partySize, z.count[0], z.count[1]);
  const [lo, hi] = zoneLevelRange(zoneId);
  const list = [];
  for (let i = 0; i < n; i++) {
    const id = weightedPick(pool, weights);
    list.push(makeEnemy(id, [lo, hi]));
  }
  return list;
}

function weightedPick(list, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/* ============================================================
   战斗开始 / 结束
   ============================================================ */
function battleStart(enemies) {
  Battle.active = true;
  Battle.over = false;
  Battle.round = 0;
  Battle.auto = false;
  Battle.countdown = 0;
  Battle.pendingItem = null;
  Battle.pendingSkill = null;
  Battle.logLines = 0;
  Battle.allies = buildPartyUnits(false);
  Battle.enemies = enemies;
  Battle.recap = { exp:0, gold:0, caught:[], newCodex:[] };

  for (const e of Battle.enemies) {
    if (markCodex(e.monsterId)) Battle.recap.newCodex.push(e.monsterId);
  }

  ui.showScreen('battle');
  ui.renderBattle();
  battleLog(`⚔️ 战斗开始！遭遇 ${Battle.enemies.length} 个敌人`, 'system');
  const babies = Battle.enemies.filter(e => e.rarity === 'baby').length;
  const variants = Battle.enemies.filter(e => e.rarity === 'variant').length;
  if (variants) battleLog(`💜 出现 ${variants} 只变异！能力更强，但更难捕捉`, 'variant');
  if (babies) battleLog(`⭐ 出现 ${babies} 只宝宝！可用【捕捉】收服`, 'baby');
  const sealed = Battle.enemies.filter(e => e.elite || e.boss);
  if (sealed.length) battleLog(`👹 强敌出现：${sealed.map(e => e.name).join('、')}`, 'elite');
  startRound();
}

function startRound() {
  if (Battle.over) return;
  Battle.round++;
  Battle.queue = Battle.allies.concat(Battle.enemies)
    .filter(u => u.alive)
    .sort((a, b) => {
      const d = statsOf(b).spd - statsOf(a).spd;
      if (Math.abs(d) > 0.001) return d;
      return a.kind === 'enemy' ? 1 : -1;      // 同速我方优先
    });
  Battle.turnIdx = 0;
  battleLog(`—— 第 ${Battle.round} 回合 ——`, 'system');
  nextTurn();
}

/* 取出下一个可行动单位 */
function nextTurn() {
  if (Battle.over) return;
  while (Battle.turnIdx < Battle.queue.length) {
    const u = Battle.queue[Battle.turnIdx++];
    if (!u || !u.alive) continue;

    /* 回合开始结算：持续伤害 / 跳过判定 */
    tickUnitStart(u);
    if (Battle.over) return;
    if (!u.alive) continue;
    if (u.skipTurn) { u.skipTurn = false; battleLog(`${u.name} 无法行动`, 'system'); continue; }

    Battle.actor = u;
    if (u.kind === 'char' && !Battle.auto) {
      /* 等玩家指令 */
      Battle.countdown = Battle.countdownMax;
      ui.onPlayerTurn(u);
      return;
    }
    if (u.kind === 'char' && Battle.auto) {
      Battle.countdown = 3;
      ui.onAutoTurn(u);
      return;
    }
    /* 敌人 / 宠物自动行动 */
    ui.setBattleMsg(`${u.name} 行动中…`);
    setTimeout(() => { enemyAct(u); }, u.kind === 'pet' ? 380 : 520);
    return;
  }
  /* 本回合结束 */
  endRound();
}

function tickUnitStart(u) {
  /* 状态持续伤害与倒计时 */
  for (let i = u.statuses.length - 1; i >= 0; i--) {
    const s = u.statuses[i];
    const def = STATUS[s.id];
    if (def && def.dot) {
      const dmg = Math.max(1, Math.round(statsOf(u).maxHp * def.dot));
      u.hp = Math.max(0, u.hp - dmg);
      battleLog(`${def.icon} ${u.name} 受到 ${def.name} ${dmg} 伤害`, 'damage');
    }
    s.turns--;
    if (s.turns <= 0) { u.statuses.splice(i, 1); battleLog(`${u.name} 的${def ? def.name : '状态'}已解除`, 'system'); }
  }
  for (let i = u.buffs.length - 1; i >= 0; i--) {
    u.buffs[i].turns--;
    if (u.buffs[i].turns <= 0) u.buffs.splice(i, 1);
  }
  checkDeaths();
}

function endRound() {
  if (Battle.over) return;
  if (checkBattleEnd()) return;
  startRound();
}

/* ============================================================
   属性修正（增益 / 减益）
   ============================================================ */
function effectiveStats(u) {
  const c = Object.assign({}, statsOf(u));
  for (const b of u.buffs) {
    const p = BUFF_POWER[b.key];
    if (!p) continue;
    const amt = p.calc(u, b.lv || 5);
    if (b.key === 'def')  { c.def *= (1 + amt); c.mdef *= (1 + amt); }
    if (b.key === 'spd')  { c.spd *= (1 + amt); }
    if (b.key === 'atk')  { c.atk *= (1 + amt); c.matk *= (1 + amt); }
  }
  for (const s of u.statuses) {
    const def = STATUS[s.id];
    if (!def) continue;
    if (def.defDown) { c.def *= (1 - def.defDown); c.mdef *= (1 - def.defDown); }
    if (def.spdDown) { c.spd *= (1 - def.spdDown); }
  }
  for (const k in c) c[k] = Math.round(c[k] * 1000) / 1000;
  return c;
}

/* ============================================================
   伤害计算
   ============================================================ */
function rollDamage(attacker, target, opts) {
  const o = opts || {};
  const ac = effectiveStats(attacker);
  const tc = effectiveStats(target);
  const power = o.power || 1;
  const isMagic = o.kind === 'magic';

  /* 命中：目标闪避高于攻击者命中时可能落空 */
  const hitRate = clamp(ac.hit - tc.eva * 0.6, 0.55, 1.0);
  if (o.canMiss !== false && !chance(hitRate)) {
    return { miss:true, text:`${attacker.name} 的攻击落空了` };
  }

  /* 暴击 */
  const critRate = o.alwaysCrit ? 1 : (o.noCrit ? 0 : clamp(ac.crit, 0, 0.75));
  const crit = chance(critRate);
  const critMul = crit ? 1.6 : 1;

  /* 五行克制 */
  const elMul = elementMul(attacker.element, target.element);

  const raw = isMagic
    ? ac.matk * 1.6 * power * skillMult(o.skillLv || 5)
    : ac.atk  * 1.5 * power * skillMult(o.skillLv || 5);
  const armor = isMagic ? tc.mdef : tc.def;

  let dmg = raw * critMul * elMul - armor;
  /* 防御过高时保留 8% 保底伤害，避免完全打不动 */
  dmg = Math.max(raw * 0.08, dmg);
  dmg = Math.max(1, Math.round(dmg + rnd(-2, 2)));

  return { dmg, crit, elMul, isMagic, miss:false };
}

function applyDamage(target, dmg, srcName) {
  target.hp = Math.max(0, target.hp - dmg);
  target.justHit = true;
  if (target.kind === 'char' || target.kind === 'pet') ui.shakeUnit(target.uid);
  if (target.hp <= 0) {
    target.alive = false;
    battleLog(`💀 ${target.name} 倒下了`, 'damage');
  }
}

function dealTo(attacker, target, opts) {
  const r = rollDamage(attacker, target, opts);
  if (r.miss) { battleLog(r.text, 'system'); ui.flashUnit(target.uid); return 0; }
  applyDamage(target, r.dmg, attacker.name);
  const tag = r.crit ? ' 💥会心' : '';
  const el = r.elMul > 1 ? ' ✨克制' : (r.elMul < 1 ? ' 🍃被克' : '');
  battleLog(`⚔️ ${attacker.name} 对 ${target.name} 造成 ${r.dmg} 伤害${tag}${el}`, 'damage');
  return r.dmg;
}

/* ============================================================
   玩家指令入口（供 ui.js 调用）
   ============================================================ */
function playerAttack(targetUid) {
  const u = Battle.actor;
  if (!u) return;
  const t = findUnit(targetUid) || pickAlive(Battle.enemies);
  if (!t) return;
  Battle.pendingSkill = null;
  dealTo(u, t, { kind:'phys', power:1.0 });
  afterPlayerAction();
}

function playerSkill(skillId, targetUid) {
  const u = Battle.actor;
  const sk = skillOf(u, skillId);
  if (!sk) return;
  const def = SKILLS[skillId];
  if (!def) return;
  const cost = def.mp || 0;
  if (u.mp < cost) { toast('法力不足'); return; }

  /* 需要选目标但没给目标 → 进入选择模式 */
  const needTarget = (def.target === 'enemy' || def.target === 'ally');
  if (needTarget && !targetUid) {
    Battle.pendingSkill = skillId;
    ui.enterTargetMode(def.target === 'enemy' ? 'enemy' : 'ally', skillId);
    return;
  }
  Battle.pendingSkill = null;
  u.mp -= cost;
  castSkill(u, def, sk.lv, targetUid ? findUnit(targetUid) : null);
  afterPlayerAction();
}

/* 技能结算（角色 / 敌人 / 宠物通用） */
function castSkill(caster, def, lv, target) {
  const targets = resolveTargets(caster, def, target);
  battleLog(`${def.icon} ${caster.name} 使用 ${def.name}！`, 'skill');

  for (const t of targets) {
    switch (def.kind) {
      case 'phys':
      case 'magic': {
        const hits = def.hits || 1;
        for (let i = 0; i < hits; i++) {
          const power = def.power * (1 + (def.ramp || 0) * i);
          dealTo(caster, t, { kind:def.kind, power, skillLv:lv });
          if (!t.alive) break;
        }
        if (def.status && t.alive) applyStatus(t, def.status);
        if (def.gold) { addGold(def.gold); battleLog(`💰 额外获得 ${def.gold} 金币`, 'item'); }
        break;
      }
      case 'heal': {
        const amt = Math.round((effectiveStats(caster).matk * 1.4 + 15) * def.power * skillMult(lv));
        const tc = statsOf(t);
        const real = Math.min(amt, tc.maxHp - t.hp);
        t.hp += real;
        battleLog(`💚 ${caster.name} 为 ${t.name} 回复 ${real} 生命`, 'heal');
        break;
      }
      case 'buff': {
        if (def.buff) {
          for (const bt of targets) addBuff(bt, def.buff, lv);
          battleLog(`✨ ${targets.map(x => x.name).join('、')} 获得强化`, 'skill');
        }
        if (def.gold) { addGold(def.gold); battleLog(`💰 额外获得 ${def.gold} 金币`, 'item'); }
        break;
      }
      case 'ctrl': {
        dealTo(caster, t, { kind:'magic', power:def.power, skillLv:lv });
        if (def.status && t.alive) applyStatus(t, def.status);
        break;
      }
    }
  }
  checkDeaths();
}

function resolveTargets(caster, def, chosen) {
  const foeSide = caster.kind === 'enemy' ? Battle.allies : Battle.enemies;
  const allySide = caster.kind === 'enemy' ? Battle.enemies : Battle.allies;
  switch (def.target) {
    case 'enemyAll': return foeSide.filter(u => u.alive);
    case 'allyAll':  return allySide.filter(u => u.alive);
    case 'self':     return [caster];
    case 'ally':     return [chosen && chosen.alive ? chosen : lowestHp(allySide) || caster];
    default:         return [chosen && chosen.alive ? chosen : highestThreat(foeSide) || pickAlive(foeSide)].filter(Boolean);
  }
}

function addBuff(unit, buff, lv) {
  const exist = unit.buffs.find(b => b.key === buff.key);
  if (exist) { exist.turns = Math.max(exist.turns, buff.turns); exist.lv = lv; }
  else unit.buffs.push({ key:buff.key, turns:buff.turns, lv });
}

function applyStatus(unit, status) {
  const def = STATUS[status.id];
  if (!def) return;
  const resist = clamp((unit.stats && unit.stats.wil ? unit.stats.wil : 3) * 0.01, 0, 0.3);
  if (!status.noResist && chance(resist)) {
    battleLog(`🛡️ ${unit.name} 抵抗了${def.name}`, 'system');
    return;
  }
  const exist = unit.statuses.find(s => s.id === status.id);
  if (exist) exist.turns = Math.max(exist.turns, status.turns);
  else unit.statuses.push({ id:status.id, turns:status.turns });
  battleLog(`${def.icon} ${unit.name} 陷入${def.name}（${status.turns} 回合）`, 'skill');
}

/* 道具 */
function playerItem(itemId, targetUid) {
  const u = Battle.actor;
  const item = ITEMS[itemId];
  if (!item || !itemCount(itemId)) return;
  const needTarget = item.use.hp || item.use.mp || item.use.revive;
  if (needTarget && !targetUid) {
    Battle.pendingItem = itemId;
    ui.enterTargetMode('ally', itemId, true);
    return;
  }
  Battle.pendingItem = null;
  useItem(itemId);
  battleLog(`🎒 ${u.name} 使用 ${item.name}`, 'item');

  if (item.use.escape) {
    battleLog('🏠 队伍被卷轴送回了沙丘镇', 'item');
    battleEnd('escape');
    return;
  }
  const t = targetUid ? findUnit(targetUid) : u;
  if (item.use.hp && t) {
    const c = statsOf(t);
    const real = Math.min(item.use.hp, c.maxHp - t.hp);
    t.hp += real;
    battleLog(`💚 ${t.name} 回复 ${real} 生命`, 'heal');
  }
  if (item.use.mp && t) {
    const c = statsOf(t);
    const real = Math.min(item.use.mp, c.maxMp - t.mp);
    t.mp += real;
    battleLog(`💙 ${t.name} 回复 ${real} 法力`, 'heal');
  }
  if (item.use.revive && t && !t.alive) {
    const c = statsOf(t);
    t.alive = true;
    t.hp = Math.round(c.maxHp * item.use.revive);
    battleLog(`💖 ${t.name} 重新站了起来`, 'heal');
  }
  if (item.use.capture) {
    Battle.captureBonus = item.use.capture;
    battleLog('📜 封印符的力量附着在游侠手中，下次捕捉成功率提升', 'capture');
  }
  afterPlayerAction();
}

function playerDefend() {
  const u = Battle.actor;
  addBuff(u, { key:'def', turns:1 }, 10);
  battleLog(`🛡️ ${u.name} 进入防御姿态`, 'action');
  afterPlayerAction();
}

function playerCapture(targetUid) {
  const u = Battle.actor;
  const t = findUnit(targetUid);
  if (!t) return;
  if (!t.zodiac) { toast('这只怪物无法收服'); return; }
  if (t.rarity === 'normal' && !t.boss) {
    /* 普通怪也能收，但概率较低 */
  }
  const bonus = Battle.captureBonus || 0;
  Battle.captureBonus = 0;

  const c = statsOf(t);
  const ratio = t.hp / c.maxHp;
  const rar = RARITY[t.rarity];
  let p = (CAPTURE_BASE + (statsOf(u).crit * 0.5) + bonus) * rar.captureMul;
  p *= (1 - ratio * 0.75);                 // 血越少越好抓
  p = clamp(p, 0.02, 0.95);

  battleLog(`🔮 ${u.name} 投出封印符，目标 ${t.name}…`, 'capture');
  if (chance(p)) {
    const pet = makePet(t.zodiac, t.rarity);
    pet.level = Math.max(1, t.level);
    const pc = statsOf(pet);
    pet.hp = pc.maxHp; pet.mp = pc.maxMp;
    G.pets.push(pet);
    markCaught(t.monsterId);
    t.alive = false; t.hp = 0;
    Battle.recap.caught.push(pet);
    const label = t.rarity === 'variant' ? '💜 变异' : (t.rarity === 'baby' ? '⭐ 宝宝' : '');
    battleLog(`✨ 成功捕捉了 ${label} ${pet.name}！`, 'capture');
    if (G.pets.length > PET_STORE) {
      battleLog(`⚠️ 宠物仓库已满（${PET_STORE} 只上限），请前往队伍面板放生`, 'system');
    }
    checkDeaths();
  } else {
    battleLog(`💨 ${t.name} 挣脱了封印`, 'system');
  }
  afterPlayerAction();
}

function playerEscape() {
  const u = Battle.actor;
  if (Battle.enemies.some(e => e.boss)) {
    battleLog('🚫 最终 BOSS 战无法逃跑！', 'system');
    return;
  }
  if (chance(0.7)) {
    battleLog('🏃 成功脱离了战斗', 'action');
    battleEnd('escape');
  } else {
    battleLog('🏃 逃跑失败！', 'system');
    afterPlayerAction();
  }
}

function toggleAuto() {
  Battle.auto = !Battle.auto;
  battleLog(Battle.auto ? '🤖 自动战斗开启' : '🤖 自动战斗关闭', 'system');
  ui.setAutoState(Battle.auto);
  if (!Battle.auto && Battle.actor && Battle.actor.kind === 'char') {
    Battle.autoTurns = 0;
    ui.onPlayerTurn(Battle.actor);
  }
}

function afterPlayerAction() {
  Battle.countdown = 0;
  if (checkBattleEnd()) return;
  nextTurn();
}

/* ============================================================
   敌人 / 宠物 AI
   ============================================================ */
function enemyAct(u) {
  if (!Battle.active || Battle.over || !u.alive) { nextTurn(); return; }
  const foeSide = u.kind === 'enemy' ? Battle.allies : Battle.enemies;
  const alive = foeSide.filter(x => x.alive);
  if (!alive.length) { checkBattleEnd(); return; }

  /* 宠物 AI */
  if (u.kind === 'pet') {
    petAct(u, alive);
    checkBattleEnd();
    return;
  }

  /* 敌人 AI：优先技能，蓝不够就普攻 */
  const usable = (u.skills || []).map(id => MONSTER_SKILLS[id]).filter(Boolean)
    .filter(s => u.mp >= (s.mp || 0));
  let acted = false;
  if (usable.length) {
    const total = usable.reduce((a, s) => a + s.weight, 0);
    if (chance(clamp(0.35 + u.level * 0.03, 0.35, 0.75))) {
      let r = Math.random() * total, chosen = usable[0];
      for (const s of usable) { r -= s.weight; if (r <= 0) { chosen = s; break; } }
      u.mp -= chosen.mp || 0;
      castSkill(u, chosen, 5, null);
      acted = true;
    }
  }
  if (!acted) {
    const t = highestThreat(alive);
    if (t) dealTo(u, t, { kind:'phys', power:1.0 });
  }
  checkBattleEnd();
}

function petAct(u, alive) {
  const sk = u.skills[0];
  const def = PET_SKILLS[sk.id];
  if (!def) { dealTo(u, highestThreat(alive), { kind:'phys', power:1.0 }); return; }
  if (u.mp < (def.mp || 0)) {
    const t = highestThreat(alive);
    if (t) dealTo(u, t, { kind:'phys', power:1.0 });
    return;
  }
  u.mp -= def.mp || 0;
  castSkill(u, def, sk.lv, def.target === 'allyAll' ? null : null);
}

/* 自动战斗时角色的行动 */
function autoActFor(u) {
  const alive = Battle.enemies.filter(e => e.alive);
  if (!alive.length) { checkBattleEnd(); return; }

  /* 1. 残血先喝药 */
  const c = statsOf(u);
  if (u.hp / c.maxHp < 0.3 && itemCount('herb')) {
    playerItem('herb', u.uid);
    return;
  }
  /* 2. 遇到可捕捉目标时改用捕捉（宝宝优先） */
  const catchable = alive.filter(e => e.zodiac);
  const baby = catchable.find(e => e.rarity === 'baby' || e.rarity === 'variant');
  const target = baby || catchable[0];
  if (target && !G.pets.some(p => p.zodiac === target.zodiac)) {
    Battle.actor = u;
    playerCapture(target.uid);
    return;
  }
  /* 3. 用技能 */
  const skill = u.skills.map(s => ({ s, def:SKILLS[s.id] }))
    .find(x => x.def && (x.def.kind === 'phys' || x.def.kind === 'magic' || x.def.kind === 'ctrl') && u.mp >= x.def.mp);
  if (skill) {
    const t = target || highestThreat(alive);
    Battle.actor = u;
    playerSkill(skill.s.id, t ? t.uid : null);
    return;
  }
  /* 4. 普攻 */
  const t = highestThreat(alive);
  Battle.actor = u;
  playerAttack(t ? t.uid : null);
}

/* ============================================================
   目标筛选工具
   ============================================================ */
function findUnit(uid) {
  return Battle.allies.concat(Battle.enemies).find(u => u.uid === uid) || null;
}
function pickAlive(list) { return list.filter(u => u.alive)[0] || null; }
function lowestHp(list) {
  let best = null, bestRatio = 2;
  for (const u of list) {
    if (!u.alive) continue;
    const ratio = u.hp / statsOf(u).maxHp;
    if (ratio < bestRatio) { bestRatio = ratio; best = u; }
  }
  return best;
}
function highestThreat(list) {
  let best = null, bestScore = -1;
  for (const u of list) {
    if (!u.alive) continue;
    const c = statsOf(u);
    let score = c.atk + c.matk + u.hp * 0.05;
    if (u.kind === 'char') score *= 1.15;      // 敌人更倾向打角色
    if (bestScore < 0 || score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

/* ============================================================
   死亡与结束判定
   ============================================================ */
function checkDeaths() {
  for (const u of Battle.allies.concat(Battle.enemies)) {
    if (u.alive && u.hp <= 0) { u.alive = false; battleLog(`💀 ${u.name} 倒下了`, 'damage'); }
  }
}

function checkBattleEnd() {
  if (Battle.over) return true;
  const enemiesAlive = Battle.enemies.some(e => e.alive);
  const alliesAlive = Battle.allies.some(a => a.alive);
  if (!enemiesAlive) { battleEnd('win'); return true; }
  if (!alliesAlive) { battleEnd('lose'); return true; }
  return false;
}

function battleEnd(result) {
  if (Battle.over) return;
  Battle.over = true;
  Battle.active = false;
  Battle.countdown = 0;

  /* 立刻收起倒计时与指令栏，避免结算面板后面还闪着 "0" */
  if (typeof ui !== 'undefined') {
    const t = document.getElementById('battleTimer');
    if (t) t.classList.add('hidden');
    if (ui.setActionBar) ui.setActionBar(false);
  }

  const recap = Battle.recap;
  if (result === 'win') {
    /* 经验只给上场的单位（角色 + 出战宠物） */
    let totalExp = 0, totalGold = 0;
    for (const e of Battle.enemies) { totalExp += e.expReward; totalGold += e.goldReward; }
    const aliveUnits = Battle.allies.filter(u => u.alive);
    const share = aliveUnits.length ? Math.round(totalExp / aliveUnits.length) : 0;
    const levelUps = [];

    if (share > 0) {
      for (const u of Battle.allies) {
        if (!u.alive) continue;
        const before = u.level;
        const lv = gainExp(u, share);
        if (lv > 0) levelUps.push({ name:u.name, from:before, to:u.level, points:u.points });
      }
    }
    if (totalGold > 0) addGold(totalGold);
    recap.exp = share;
    recap.gold = totalGold;

    battleLog(`🏆 战斗胜利！获得经验 ${share} / 金币 ${totalGold}`, 'system');
    for (const lu of levelUps) {
      battleLog(`🎉 ${lu.name} 升到 Lv.${lu.to}（+${POINTS_PER_LEVEL} 属性点）`, 'capture');
    }
    /* 击杀精英与 BOSS 的进度 */
    for (const e of Battle.enemies) {
      if (e.elite && e.alive === false) {
        G.eliteKills++;
        battleLog('👹 精英被击杀，荒野中的怪物变得更强了…', 'elite');
      }
      if (e.boss) {
        G.bossKilled = true;
        battleLog('🐲 沙之支配者倒下了！【轮回】之门已开启', 'elite');
      }
    }
    if (typeof ui !== 'undefined' && ui.updateReincarnateBtn) ui.updateReincarnateBtn();
    if (levelUps.length && hasUnspentPoints()) ui.markTeamDot(true);
    if (recap.newCodex.length) battleLog(`📚 图鉴新增 ${recap.newCodex.length} 种怪物`, 'system');
    if (recap.caught.length) {
      for (const p of recap.caught) battleLog(`🐾 新宠物：${p.name}${p.rarity !== 'normal' ? '（' + RARITY[p.rarity].name + '）' : ''}`, 'capture');
    }
  } else if (result === 'lose') {
    const lost = Math.max(WIPE_GOLD_MIN, Math.round(G.gold * WIPE_GOLD_LOSS));
    addGold(-lost);
    battleLog(`💀 全队倒下…被送回沙丘镇，损失 ${lost} 金币`, 'elite');
    /* 团灭：回城、全体复活回复一半 */
    for (const u of G.party) {
      const c = statsOf(u);
      u.hp = Math.round(c.maxHp * 0.5);
      u.mp = Math.round(c.maxMp * 0.5);
      u.alive = true;
    }
    for (const p of G.pets) { const c = statsOf(p); p.hp = c.maxHp; p.mp = c.maxMp; p.alive = true; }
    G.zone = 'town';
    G.pos = { x: 14 * TILE, y: 10 * TILE };
    saveGame();
  } else {
    battleLog('🏃 脱离了战斗', 'system');
  }

  /* 战后保存血量 */
  for (const u of Battle.allies) {
    const target = G.party.concat(G.pets).find(x => x.uid === u.uid);
    if (target) { target.hp = u.hp; target.mp = u.mp; }
  }
  saveGame();
  recap.result = result;
  ui.showBattleResult(result, recap);
}

/* 战斗中自动战斗倒计时推进 */
function battleTick(dt) {
  if (!Battle.active || Battle.over) return;
  if (Battle.actor && Battle.actor.kind === 'char' && Battle.countdown > 0) {
    Battle.countdown -= dt;
    ui.updateCountdown(Battle.countdown);
    if (Battle.countdown <= 0) {
      Battle.countdown = 0;
      if (!Battle.auto) toggleAuto();
      autoActFor(Battle.actor);
    }
  } else if (Battle.actor && Battle.actor.kind === 'char' && Battle.auto) {
    /* 自动战斗由 ui 的节奏驱动 */
  }
}

/* 日志 */
function battleLog(text, kind) {
  if (typeof ui !== 'undefined' && ui.addLog) ui.addLog(text, kind);
}
