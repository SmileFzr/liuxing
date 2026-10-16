"use strict";

/* ============================================================
   无尽回响：轮回 — 界面（ui）· 续
   ------------------------------------------------------------
   背包 / 图鉴 / 商店 / 药店 / 学技能 / 对话框 / 战斗按钮绑定
   ============================================================ */

/* ============================================================
   背包
   ============================================================ */
ui.openBag = function (inBattle) {
  ui.bagBattle = !!inBattle;
  ui.renderBag();
  $('bagPanel').classList.remove('hidden');
};

ui.renderBag = function () {
  $('bagGold').textContent = G.gold;
  const list = $('bagList');
  list.innerHTML = '';
  const ids = ITEM_ORDER.filter(id => itemCount(id) > 0);
  if (!ids.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '背包空空如也';
    list.appendChild(e);
    return;
  }
  for (const id of ids) {
    const it = ITEMS[id];
    const row = document.createElement('div');
    row.className = 'itemRow';
    row.innerHTML =
      `<span class="itemName">${it.icon} ${it.name}</span>` +
      `<span class="itemQty">×${itemCount(id)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'useBtn';
    btn.textContent = ui.bagBattle ? '使用' : '丢弃';
    btn.onclick = () => {
      if (ui.bagBattle) {
        if (!Battle.active || Battle.over) { toast('战斗已结束'); return; }
        if (!Battle.actor || Battle.actor.kind !== 'char') { toast('还没轮到你行动'); return; }
        ui.closeAllOverlays();
        playerItem(id, null);
      } else {
        useItem(id);
        toast(`${it.name} 已丢弃`);
        ui.renderBag();
        autoSave();
      }
    };
    row.appendChild(btn);
    list.appendChild(row);
  }
};

/* ============================================================
   图鉴（怪物 / 宠物）
   ============================================================ */
ui.openCodex = function (kind) {
  ui.codexKind = kind;
  $('codexTitle').textContent = kind === 'pet' ? '🐾 宠 物 图 鉴' : '📚 怪 物 图 鉴';
  ui.renderCodex();
  $('codexPanel').classList.remove('hidden');
};

ui.renderCodex = function () {
  const grid = $('codexGrid');
  const sub = $('codexSub');
  grid.innerHTML = '';

  if (ui.codexKind === 'pet') {
    const owned = {};
    for (const p of G.pets) {
      if (!owned[p.zodiac]) owned[p.zodiac] = { normal:0, baby:0, variant:0 };
      owned[p.zodiac][p.rarity]++;
    }
    let caught = 0;
    for (const id of PET_ORDER) {
      const pet = PETS[id];
      const own = owned[id];
      const seen = !!own || Object.keys(G.codex).some(m => MONSTERS[m] && MONSTERS[m].zodiac === id);
      const card = document.createElement('div');
      card.className = 'codexCard' + (seen ? '' : ' locked');
      let detail = '';
      if (own) {
        detail = `${own.normal ? '普通×' + own.normal + ' ' : ''}${own.baby ? '⭐×' + own.baby + ' ' : ''}${own.variant ? '💜×' + own.variant : ''}`.trim();
        caught++;
      } else if (seen) detail = '已遇见';
      card.innerHTML =
        `<div class="ci">${seen ? pet.emoji : '❔'}</div>` +
        `<div class="cn">${seen ? pet.name : '???'}</div>` +
        `<div class="cd">${detail || '未发现'}</div>`;
      grid.appendChild(card);
    }
    sub.textContent = `已收服 ${caught}/${PET_ORDER.length} 种生肖`;
    return;
  }

  /* 怪物图鉴：遇到过的才展示 */
  let seenCount = 0;
  const ids = Object.keys(MONSTERS);
  for (const id of ids) {
    const m = MONSTERS[id];
    const rec = G.codex[id];
    const card = document.createElement('div');
    card.className = 'codexCard' + (rec ? '' : ' locked');
    if (rec) seenCount++;
    card.innerHTML =
      `<div class="ci">${rec ? m.emoji : '❔'}</div>` +
      `<div class="cn">${rec ? m.name : '???'}</div>` +
      `<div class="cd">${rec ? (rec.caught ? '已收服 ' + rec.caught : '已遇见') : '未遇见'}</div>`;
    grid.appendChild(card);
  }
  sub.textContent = `已遇见 ${seenCount}/${ids.length} 种怪物`;
};

/* ============================================================
   商店 / 药店 / 学技能（共用一个动态面板）
   ============================================================ */
ui.openShop = function () {
  ui.dyn = { kind:'shop' };
  ui.renderShop();
  $('dynPanel').classList.remove('hidden');
};

const SHOP_STOCK = ['herb','bigHerb','ether','scroll','revive','townScroll'];

ui.renderShop = function () {
  $('dynTitle').textContent = '🧑‍🌾 商 人';
  $('dynSub').textContent = `金币 ${G.gold}`;
  const body = $('dynBody');
  body.innerHTML = '';
  for (const id of SHOP_STOCK) {
    const it = ITEMS[id];
    const row = document.createElement('div');
    row.className = 'itemRow';
    row.innerHTML =
      `<span class="itemName">${it.icon} ${it.name}<div style="font-size:10.5px;opacity:.6">${it.desc}</div></span>` +
      `<span class="itemQty">${it.price} 金</span>`;
    const btn = document.createElement('button');
    btn.className = 'useBtn';
    btn.textContent = '购买';
    btn.disabled = G.gold < it.price;
    btn.onclick = () => {
      if (G.gold < it.price) { toast('金币不足'); return; }
      addGold(-it.price);
      addItem(id, 1);
      toast(`购买了 ${it.name}`);
      ui.renderShop();
      ui.renderBag();
      autoSave();
    };
    row.appendChild(btn);
    body.appendChild(row);
  }
};

ui.openInn = function () {
  ui.dyn = { kind:'inn' };
  ui.renderInn();
  $('dynPanel').classList.remove('hidden');
};

const INN_COST = 20;

ui.renderInn = function () {
  $('dynTitle').textContent = '👩‍⚕️ 药 师';
  $('dynSub').textContent = `金币 ${G.gold}`;
  const body = $('dynBody');
  body.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'itemRow';
  row.innerHTML = `<span class="itemName">💤 休息一晚<div style="font-size:10.5px;opacity:.6">全队回复满生命与法力</div></span><span class="itemQty">${INN_COST} 金</span>`;
  const btn = document.createElement('button');
  btn.className = 'useBtn';
  btn.textContent = '休息';
  btn.disabled = G.gold < INN_COST;
  btn.onclick = () => {
    if (G.gold < INN_COST) { toast('金币不足'); return; }
    addGold(-INN_COST);
    for (const u of G.party.concat(G.pets)) {
      const c = statsOf(u);
      u.hp = c.maxHp; u.mp = c.maxMp; u.alive = true;
    }
    toast('全队恢复了！');
    ui.renderInn();
    ui.renderPartyStats();
    autoSave();
  };
  row.appendChild(btn);
  body.appendChild(row);

  if (!G.pets.length) {
    const tip = document.createElement('div');
    tip.className = 'empty';
    tip.textContent = '还没有宠物可以治疗';
    body.appendChild(tip);
  }
};

/* 神秘人：花金币把技能整档 +5 */
ui.openTeachPanel = function () {
  ui.dyn = { kind:'teach' };
  ui.renderTeach();
  $('dynPanel').classList.remove('hidden');
};

ui.renderTeach = function () {
  $('dynTitle').textContent = '🧙‍♂️ 神 秘 人';
  $('dynSub').textContent = `金币 ${G.gold} · 每档 +5 级`;
  const body = $('dynBody');
  body.innerHTML = '';

  const tip = document.createElement('div');
  tip.style.cssText = 'font-size:11px;opacity:.7;line-height:1.7;margin-bottom:8px';
  tip.innerHTML = '技能的提升只能在这里进行：每次提升 5 级，且不能超过角色等级对应的上限（1-9→5，10-14→10，15-19→15 …）。';
  body.appendChild(tip);

  for (const u of G.party) {
    const title = document.createElement('div');
    title.className = 'sectionTitle';
    title.textContent = `${u.emoji} ${u.name}　Lv.${u.level}（技能上限 Lv.${maxSkillLevel(u.level)}）`;
    body.appendChild(title);

    for (const sk of u.skills) {
      const def = SKILLS[sk.id];
      if (!def) continue;
      const info = skillUpgradeInfo(u, sk.id);
      const row = document.createElement('div');
      row.className = 'itemRow';
      let status;
      if (info.maxed) status = '<span style="color:#6ee7a0">已达上限</span>';
      else if (!info.canCap) status = '<span style="color:#ffb347">角色等级不足</span>';
      else status = `${info.cost} 金`;
      row.innerHTML =
        `<span class="itemName">${def.icon} ${def.name}<div style="font-size:10.5px;opacity:.6">Lv.${sk.lv} → Lv.${info.nextLv}　${def.desc}</div></span>` +
        `<span class="itemQty">${status}</span>`;
      const btn = document.createElement('button');
      btn.className = 'useBtn';
      btn.textContent = '学习';
      btn.disabled = info.maxed || !info.canCap || !info.affordable;
      btn.onclick = () => {
        const r = learnSkill(u, sk.id);
        toast(r.msg);
        if (r.ok) { ui.renderTeach(); autoSave(); }
      };
      row.appendChild(btn);
      body.appendChild(row);
    }
  }

  /* 第 3 技能：剧情解锁（占位） */
  const locked = document.createElement('div');
  locked.className = 'sectionTitle';
  locked.textContent = '未解锁';
  body.appendChild(locked);
  const tip2 = document.createElement('div');
  tip2.className = 'empty';
  tip2.textContent = '神秘人：「还有更强的技艺…等你走得更远，再来找我。」（后续剧情解锁）';
  body.appendChild(tip2);
};

/* ============================================================
   对话框
   ============================================================ */
const DIALOGS = {
  elder: {
    who:'村长', emoji:'🧓',
    lines:[
      '欢迎来到沙丘镇，年轻人。这里曾是繁华的商道，如今只剩下风沙。',
      '往东走就是荒野，沙鼠、沙蜥到处都是。练练手可以，别走太深。',
      '荒野深处有风蚀遗迹，再往里是王陵。传说王陵里沉睡着「沙之支配者」。',
      '把队伍练强了再去。镇上商人卖药，药师能治病，铁匠那边…暂时还没开工。',
    ],
  },
  shop: {
    who:'商人', emoji:'🧑‍🌾',
    lines:[
      '客官，看看货？金创药、还灵散都有，捕捉宠物记得带封印符。',
      '十二生肖的怪物才有几率带上宝宝和变异体，遇到变异可别打死了，捕捉最值钱。',
    ],
  },
  smith: {
    who:'铁匠', emoji:'🧑‍🏭',
    lines:[
      '装备铺还没开张。等你轮回之后带来材料，我给你炼化词条。',
      '现在嘛…先用拳头说话吧。',
    ],
  },
  healer: {
    who:'药师', emoji:'👩‍⚕️',
    lines:[
      '累了就休息一晚，二十金，包你全队精神。',
      '野外倒下可不便宜，听说要丢不少金币呢。',
    ],
  },
  mystic: {
    who:'神秘人', emoji:'🧙‍♂️',
    lines:[
      '技能不是练出来的，是学出来的。等级到了，拿金币来找我。',
      '一次只能精进五级，贪多嚼不烂。',
      '若你能击败沙之支配者，开启轮回…我还有一个技艺可以教你。',
    ],
  },
};

ui.showDialog = function (key) {
  const d = DIALOGS[key] || DIALOGS.elder;
  const el = $('dialog');
  $('dlgAvatar').textContent = d.emoji;
  $('dlgName').textContent = d.who;
  $('dlgText').textContent = d.lines[0];
  const opts = $('dlgOptions');
  opts.innerHTML = '';
  let idx = 0;
  const next = () => {
    idx++;
    if (idx < d.lines.length) {
      $('dlgText').textContent = d.lines[idx];
      if (idx === d.lines.length - 1) renderClose();
      return;
    }
    el.classList.add('hidden');
  };
  const renderClose = () => {
    opts.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'dlgOpt';
    b.textContent = '（结束对话）';
    b.onclick = () => el.classList.add('hidden');
    opts.appendChild(b);
  };
  const b = document.createElement('button');
  b.className = 'dlgOpt';
  b.textContent = '继续 ▸';
  b.onclick = next;
  opts.appendChild(b);
  if (d.lines.length === 1) renderClose();
  el.classList.remove('hidden');
};

/* ============================================================
   战斗按钮绑定
   ============================================================ */
ui.bindBattleButtons = function () {
  const bar = $('actionBar');
  if (!bar) return;
  bar.querySelectorAll('.actionBtn').forEach(btn => {
    btn.onclick = () => {
      if (!Battle.active || Battle.over) return;
      if (ui._busy) return;
      const act = btn.dataset.act;
      const u = Battle.actor;
      if (act === 'auto') { toggleAuto(); return; }
      if (!u || u.kind !== 'char') return;

      switch (act) {
        case 'attack': {
          /* 只有一个敌人时直接打，否则选目标 */
          const alive = Battle.enemies.filter(e => e.alive);
          if (alive.length === 1) playerAttack(alive[0].uid);
          else { Battle.pendingSkill = '__attack__'; ui.enterTargetMode('enemy', '__attack__'); }
          break;
        }
        case 'skill': ui.openBattleSkill(); break;
        case 'item':  ui.openBag(true); break;
        case 'defend': playerDefend(); break;
        case 'capture': {
          const alive = Battle.enemies.filter(e => e.alive && e.zodiac);
          if (!alive.length) { toast('没有可捕捉的生肖怪'); return; }
          if (alive.length === 1) playerCapture(alive[0].uid);
          else { Battle.pendingSkill = '__capture__'; ui.enterTargetMode('enemy', '__capture__'); }
          break;
        }
        case 'escape': playerEscape(); break;
      }
    };
  });

  const back = $('subBack');
  if (back) back.onclick = () => {
    ui.clearTargetHighlight();
    Battle.pendingSkill = null;
    Battle.pendingItem = null;
    ui.targetMode = null;
    if (Battle.active && !Battle.over) ui.setActionBar(true);
    else if (!Battle.active) $('subMenu').classList.add('hidden');
  };
};

/* 战斗中的技能选择菜单 */
ui.openBattleSkill = function () {
  const u = Battle.actor;
  if (!u) return;
  const sub = $('subMenu');
  $('subTitle').textContent = `${u.name} 的技能`;
  const list = $('subList');
  list.innerHTML = '';
  for (const sk of u.skills) {
    const def = SKILLS[sk.id];
    if (!def || def.locked) continue;
    const b = document.createElement('button');
    b.className = 'subItem';
    b.innerHTML = `<span>${def.icon} ${def.name} <span style="opacity:.6;font-size:11px">Lv.${sk.lv}</span></span><span class="cost">MP ${def.mp}</span>`;
    if (u.mp < def.mp) b.classList.add('disabled');
    b.onclick = () => {
      $('subMenu').classList.add('hidden');
      const needTarget = def.target === 'enemy' || def.target === 'ally';
      if (needTarget) { playerSkill(sk.id, null); }
      else { playerSkill(sk.id, u.uid); }
    };
    list.appendChild(b);
  }
  $('subBack').textContent = '返 回';
  sub.classList.remove('hidden');
};

/* 攻击 / 捕捉 走统一的目标选择出口 */
const _origOnUnitClick = ui.onUnitClick;
ui.onUnitClick = function (uid) {
  const tm = ui.targetMode;
  if (tm && (tm.id === '__attack__' || tm.id === '__capture__')) {
    const u = findUnit(uid);
    if (!u || !u.alive || Battle.enemies.indexOf(u) < 0) return;
    ui.targetMode = null;
    ui.clearTargetHighlight();
    if (tm.id === '__attack__') playerAttack(uid);
    else playerCapture(uid);
    return;
  }
  _origOnUnitClick(uid);
};

/* ============================================================
   简易旁白：复用一个对话框（剧情提示 / BOSS 登场）
   ============================================================ */
ui.showDialogText = function (who, emoji, text, keepMs) {
  const el = $('dialog');
  if (!el) return;
  $('dlgAvatar').textContent = emoji;
  $('dlgName').textContent = who;
  $('dlgText').textContent = text;
  const opts = $('dlgOptions');
  opts.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'dlgOpt';
  b.textContent = '（继 续）';
  b.onclick = () => el.classList.add('hidden');
  opts.appendChild(b);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), keepMs || 3600);
};

/* ============================================================
   触发首领战（王陵 / 轮回后重刷）
   ============================================================ */
ui.startBossFight = function () {
  if (!G || !G.bossKilled) {
    ui.showDialogText('系统', '🔄',
      '轮回之门尚未开启。\n\n需要先前往【王陵深处】击败最终 BOSS「沙之支配者」。');
    return;
  }
  battleStart([makeEnemy('boss', [12, 14]),
               makeEnemy('eliteMummy', [10, 12]),
               makeEnemy('eliteScorpion', [10, 12])]);
};

/* 轮回按钮状态：未通关时置灰并说明原因 */
ui.updateReincarnateBtn = function () {
  const b = $('btnReincarnate');
  if (!b) return;
  const done = !!(G && G.bossKilled);
  b.textContent = done ? '🔄 轮 回（继续刷材料）' : '🔄 轮 回（需先击杀最终 BOSS）';
  b.style.opacity = done ? '1' : '0.6';
  b.disabled = false;   // 保持可点：点了会告诉玩家为什么
};
