"use strict";

/* ============================================================
   无尽回响：轮回 — 数据表（data）
   ============================================================
   所有可调数值都集中在本文件，改平衡只需要动这里。
   加载顺序：data.js → core.js → battle.js → explore.js → ui.js → main.js
   ============================================================ */

const GAME_VERSION  = 'v0.3.0';
const GAME_CODENAME = '轮回';
const SAVE_KEY      = 'endless_echo_turn_save_v1';

/* ---------------- 工具 ---------------- */
const TAU   = Math.PI * 2;
const rnd   = (a, b) => a + Math.random() * (b - a);
const rndi  = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const pick  = a => a[Math.floor(Math.random() * a.length)];
const $     = id => document.getElementById(id);
const chance = p => Math.random() < p;

/* 稳定伪随机：同一个坐标永远得到同一个值（草木分布不会随走动而变化） */
function hashSeed(x, y) {
  let h = Math.imul(Math.round(x) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(Math.round(y) ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/* 带稳定性：用世界格坐标抽一个 0-1 的值 */
function hashAt(x, y, salt) { return hashSeed(x * 131 + (salt || 0) * 7, y * 977 + (salt || 0) * 13); }

/* 队伍上限：3 固定角色 + 3 宠物 = 6v6 */
const TEAM_SIZE  = 3;
const PET_SLOTS  = 3;
const PET_STORE  = 12;
const MAX_ENEMY  = 6;

/* ============================================================
   属性：8 项
   ============================================================ */
const STATS = [
  { id:'vit', name:'体质', icon:'❤️', desc:'生命上限、物理防御' },
  { id:'str', name:'力量', icon:'💪', desc:'物理攻击' },
  { id:'agi', name:'敏捷', icon:'💨', desc:'速度、闪避' },
  { id:'int', name:'智力', icon:'🧠', desc:'魔法攻击、法力上限' },
  { id:'spr', name:'精神', icon:'🕊️', desc:'魔法防御、法力回复' },
  { id:'luk', name:'幸运', icon:'🍀', desc:'暴击率、捕捉率' },
  { id:'per', name:'感知', icon:'👁️', desc:'命中、遇敌与掉落' },
  { id:'wil', name:'意志', icon:'🔥', desc:'生命回复、抗控制' },
];
const STAT_IDS = STATS.map(s => s.id);
const BLANK_STATS = () => ({ vit:0, str:0, agi:0, int:0, spr:0, luk:0, per:0, wil:0 });

/* ============================================================
   三个固定角色
   ============================================================ */
const CLASSES = {
  sword: {
    id:'sword', name:'剑士', emoji:'🧙', role:'物理 · 防御',
    desc:'物理输出与物理防御最高，队伍的前排。',
    base:{ vit:6, str:7, agi:4, int:2, spr:3, luk:3, per:4, wil:5 },
    growth:{ vit:1.2, str:1.4, agi:0.8, int:0.4, spr:0.6, luk:0.6, per:0.8, wil:1.0 },
    skills:['slash','ironwall'],
  },
  mage: {
    id:'mage', name:'法师', emoji:'🧝', role:'魔法 · 高蓝',
    desc:'法力上限与魔法伤害最高，脆但爆发强。',
    base:{ vit:3, str:2, agi:4, int:9, spr:7, luk:3, per:5, wil:3 },
    growth:{ vit:0.6, str:0.4, agi:0.8, int:1.8, spr:1.4, luk:0.6, per:1.0, wil:0.6 },
    skills:['fireball','freeze'],
  },
  ranger: {
    id:'ranger', name:'游侠', emoji:'🦹', role:'速度 · 控制',
    desc:'速度最快、控制技能强，负责封印与捕捉。',
    base:{ vit:4, str:4, agi:8, int:5, spr:4, luk:6, per:7, wil:3 },
    growth:{ vit:0.8, str:0.8, agi:1.6, int:1.0, spr:0.8, luk:1.2, per:1.4, wil:0.6 },
    skills:['seal','gale'],
  },
};
const CLASS_ORDER = ['sword','mage','ranger'];

/* ============================================================
   技能表
   ------------------------------------------------------------
   power  : 倍率（随技能等级线性放大，见 skillMult）
   mp     : 消耗
   kind   : phys 物理 / magic 魔法 / heal 治疗 / buff 增益 / ctrl 控制
   target : enemy 敌方单体 / enemyAll 敌方全体 / ally 我方单体 / self 自身
   ============================================================ */
const SKILLS = {
  /* ---- 剑士 ---- */
  slash: {
    id:'slash', name:'重斩', icon:'⚔️', kind:'phys', target:'enemy', mp:4, power:1.5,
    desc:'对单个敌人造成物理伤害',
    learn:0,
  },
  ironwall: {
    id:'ironwall', name:'铁壁', icon:'🛡️', kind:'buff', target:'self', mp:5, power:0.5,
    desc:'2 回合内自身物理防御与魔法防御提升',
    learn:0,
    buff:{ key:'def', turns:2 },   // 数值由 data 里的 BUFF_POWER 决定
  },

  /* ---- 法师 ---- */
  fireball: {
    id:'fireball', name:'火球术', icon:'🔥', kind:'magic', target:'enemy', mp:6, power:1.6,
    desc:'对单个敌人造成火焰魔法伤害',
    learn:0,
  },
  freeze: {
    id:'freeze', name:'冰封', icon:'❄️', kind:'ctrl', target:'enemy', mp:7, power:0.9,
    desc:'造成少量魔法伤害，并冻结目标 1 回合',
    learn:0,
    status:{ id:'freeze', turns:1 },
  },

  /* ---- 游侠 ---- */
  seal: {
    id:'seal', name:'封印符', icon:'🔮', kind:'ctrl', target:'enemy', mp:5, power:0.6,
    desc:'造成少量魔法伤害，并降低目标防御与速度 2 回合',
    learn:0,
    status:{ id:'seal', turns:2 },
  },
  gale: {
    id:'gale', name:'疾风步', icon:'💨', kind:'buff', target:'self', mp:4, power:0.4,
    desc:'2 回合内自身速度与闪避提升',
    learn:0,
    buff:{ key:'spd', turns:2 },
  },

  /* ---- 神秘人处解锁的第 3 技能（占位，剧情解锁后启用） ---- */
  meteor: {
    id:'meteor', name:'陨星', icon:'☄️', kind:'magic', target:'enemyAll', mp:18, power:1.1,
    desc:'对全体敌人造成魔法伤害', locked:true,
  },
  warcry: {
    id:'warcry', name:'战吼', icon:'📢', kind:'buff', target:'ally', mp:10, power:0.6,
    desc:'提升单个队友攻击 2 回合', locked:true,
    buff:{ key:'atk', turns:2 },
  },
  shadow: {
    id:'shadow', name:'影袭', icon:'🗡️', kind:'phys', target:'enemy', mp:10, power:1.9,
    desc:'高额物理伤害，必定命中要害', locked:true, alwaysCrit:true,
  },
};

/* 增益强度：按施法者等级与技能倍率换算 */
const BUFF_POWER = {
  def: { label:'防御', calc:(u, lv) => 0.2 + 0.08 * (lv / 5) },
  spd: { label:'速度', calc:(u, lv) => 0.2 + 0.08 * (lv / 5) },
  atk: { label:'攻击', calc:(u, lv) => 0.2 + 0.08 * (lv / 5) },
};

/* 状态效果 */
const STATUS = {
  freeze: { id:'freeze', name:'冰封', icon:'❄️', color:'#7ec8ff', skip:true },
  seal:   { id:'seal',   name:'封印', icon:'🔒', color:'#c99cff', defDown:0.35, spdDown:0.35 },
  poison: { id:'poison', name:'中毒', icon:'🧪', color:'#8ef07a', dot:0.06 },
  burn:   { id:'burn',   name:'灼烧', icon:'🔥', color:'#ff8c42', dot:0.08 },
  stun:   { id:'stun',   name:'昏迷', icon:'💫', color:'#ffd76a', skip:true },
};

/* ============================================================
   技能档位：每 5 级一档，只能整档提升
   ============================================================ */
function maxSkillLevel(charLevel) {
  if (charLevel < 10) return 5;
  return Math.floor((charLevel - 10) / 5) * 5 + 10;
}
/* 技能倍率：5 级 = 1.0 倍 */
function skillMult(lv) { return lv / 5; }
/* 学技能的价钱：越往后越贵 */
function skillLearnCost(toLv) { return 80 * (toLv / 5) * (toLv / 5); }

/* ============================================================
   道具
   ============================================================ */
const ITEMS = {
  herb:    { id:'herb',    name:'金创药',   icon:'🧪', desc:'回复 60 点生命', price:30,  battle:true, use:{ hp:60 } },
  bigHerb: { id:'bigHerb', name:'上品金创药', icon:'⚗️', desc:'回复 180 点生命', price:90, battle:true, use:{ hp:180 } },
  ether:   { id:'ether',   name:'还灵散',   icon:'💙', desc:'回复 40 点法力', price:40,  battle:true, use:{ mp:40 } },
  scroll:  { id:'scroll',  name:'封印符',   icon:'📜', desc:'捕捉宠物时使用，提高成功率', price:60, battle:true, use:{ capture:0.25 } },
  revive:  { id:'revive',  name:'还魂丹',   icon:'💖', desc:'复活一名倒下的角色（半血）', price:150, battle:true, use:{ revive:0.5 } },
  townScroll:{ id:'townScroll', name:'回城卷轴', icon:'🏠', desc:'战斗中直接返回沙丘镇', price:50, battle:true, use:{ escape:true } },
};
const ITEM_ORDER = ['herb','bigHerb','ether','scroll','revive','townScroll'];

/* ============================================================
   怪物（沙漠奇幻）
   ------------------------------------------------------------
   hp/atk/def/matk/mdef/spd 为基准值，按等级缩放（见 makeEnemy）
   zodiac  : 该怪对应的生肖 id（只有生肖怪会出宝宝/变异）
   rarities: 各稀有度的出现权重
   ============================================================ */
const MONSTERS = {
  rat: {
    id:'rat', name:'沙鼠', emoji:'🐭', zodiac:'rat', tier:1,
    hp:76, atk:9, def:2, matk:6, mdef:2, spd:13, exp:12, gold:6,
    skills:['bite'],
  },
  lizard: {
    id:'lizard', name:'沙蜥', emoji:'🦎', zodiac:null, tier:1,
    hp:88, atk:11, def:4, matk:4, mdef:3, spd:10, exp:14, gold:7,
    skills:['bite'],
  },
  scorpion: {
    id:'scorpion', name:'毒蝎', emoji:'🦂', zodiac:null, tier:1,
    hp:80, atk:10, def:3, matk:5, mdef:3, spd:12, exp:13, gold:8,
    skills:['poisonSting'],
  },
  snake: {
    id:'snake', name:'沙蛇', emoji:'🐍', zodiac:'snake', tier:2,
    hp:105, atk:14, def:4, matk:8, mdef:4, spd:15, exp:20, gold:10,
    skills:['slash','poisonSting'],
  },
  bandit: {
    id:'bandit', name:'沙漠盗匪', emoji:'🥷', zodiac:null, tier:2,
    hp:120, atk:16, def:6, matk:5, mdef:4, spd:12, exp:24, gold:20,
    skills:['slash'],
  },
  wolf: {
    id:'wolf', name:'荒狼', emoji:'🐺', zodiac:null, tier:2,
    hp:110, atk:17, def:5, matk:4, mdef:3, spd:18, exp:22, gold:12,
    skills:['slash'],
  },
  mummy: {
    id:'mummy', name:'木乃伊', emoji:'🧟', zodiac:null, tier:3,
    hp:180, atk:15, def:10, matk:12, mdef:9, spd:8, exp:32, gold:16,
    skills:['curse'],
  },
  golem: {
    id:'golem', name:'沙岩傀儡', emoji:'🗿', zodiac:null, tier:3,
    hp:250, atk:20, def:16, matk:6, mdef:12, spd:6, exp:40, gold:24,
    skills:['smash'],
  },
  vulture: {
    id:'vulture', name:'沙漠秃鹫', emoji:'🦅', zodiac:'rooster', tier:3,
    hp:150, atk:18, def:6, matk:10, mdef:6, spd:22, exp:30, gold:15,
    skills:['slash','galeWind'],
  },
  /* ---- 精英（击杀后小怪永久变强，见 core.eliteStatMul） ---- */
  eliteScorpion: {
    id:'eliteScorpion', name:'蝎王', emoji:'🦂', zodiac:null, tier:4, elite:true,
    hp:520, atk:26, def:16, matk:14, mdef:12, spd:16, exp:140, gold:120,
    skills:['poisonSting','smash'],
  },
  eliteMummy: {
    id:'eliteMummy', name:'法老卫兵', emoji:'🧟', zodiac:null, tier:4, elite:true,
    hp:600, atk:24, def:20, matk:20, mdef:18, spd:12, exp:160, gold:150,
    skills:['curse','smash'],
  },
  /* ---- 最终 BOSS ---- */
  boss: {
    id:'boss', name:'沙之支配者', emoji:'🐲', zodiac:null, tier:5, boss:true,
    hp:2600, atk:38, def:26, matk:34, mdef:26, spd:20, exp:800, gold:800,
    skills:['smash','curse','sandStorm'],
  },
};

/* 怪物技能（比角色技能简单，够用就行） */
const MONSTER_SKILLS = {
  bite:       { id:'bite',       name:'啃咬',   icon:'🦷', kind:'phys',  power:1.0, mp:0, weight:3 },
  slash:      { id:'slash',      name:'斩击',   icon:'⚔️', kind:'phys',  power:1.2, mp:0, weight:3 },
  smash:      { id:'smash',      name:'重砸',   icon:'🔨', kind:'phys',  power:1.5, mp:4, weight:2 },
  poisonSting:{ id:'poisonSting',name:'毒刺',   icon:'🦂', kind:'phys',  power:1.0, mp:3, weight:2,
                status:{ id:'poison', turns:3 } },
  curse:      { id:'curse',      name:'诅咒',   icon:'💀', kind:'magic', power:1.3, mp:5, weight:2,
                status:{ id:'seal', turns:2 } },
  galeWind:   { id:'galeWind',   name:'旋风',   icon:'🌪️', kind:'phys',  power:1.1, mp:3, weight:2 },
  sandStorm:  { id:'sandStorm',  name:'沙暴',   icon:'🌊', kind:'magic', power:1.1, mp:10, weight:3,
                target:'enemyAll' },
};

/* ============================================================
   地点与遇敌
   ------------------------------------------------------------
   safe:true 为安全区（城镇，不遇怪）
   野外为"无限平面"：没有边界，可以一直往一个方向走
   encounter: 每个怪的出现权重；数量范围 [min,max]
   ============================================================ */
const ZONES = {
  town: {
    id:'town', name:'沙丘镇', sub:'起点 · 安全区', safe:true,
    bg:'linear-gradient(180deg,#3a2a1a,#5a4028 55%,#6b4e2e)',
    ground:'#7a5a38',
    w:29, h:20,          // 城镇是固定地图（格）
  },
  dune: {
    id:'dune', name:'沙丘荒野', sub:'Lv.1-4 · 常有沙鼠与沙蜥出没', safe:false,
    bg:'linear-gradient(180deg,#8a6a34,#c9a25c 58%,#d8b877)',
    ground:'#d8b877',
    encounter:{ rat:4, lizard:3, scorpion:2, snake:1 },
    count:[1,3],
  },
  ruins: {
    id:'ruins', name:'风蚀遗迹', sub:'Lv.4-7 · 木乃伊与傀儡的领域', safe:false,
    bg:'linear-gradient(180deg,#4a4256,#6a6070 58%,#7d7286)',
    ground:'#7d7286',
    encounter:{ snake:2, bandit:2, wolf:2, mummy:3, golem:2, vulture:2 },
    count:[2,4],
  },
  tomb: {
    id:'tomb', name:'王陵深处', sub:'Lv.8+ · 法老的卫兵仍在巡逻', safe:false,
    bg:'linear-gradient(180deg,#241c30,#3a2c44 58%,#4a3854)',
    ground:'#4a3854',
    encounter:{ mummy:3, golem:3, vulture:2, eliteScorpion:1, eliteMummy:1 },
    count:[3,6],
  },
};
const ZONE_ORDER = ['town','dune','ruins','tomb'];

/* 各地图的出生点（格坐标） */
const SPAWN = {
  wild:  { x:24, y:8 },     // 出城门后落在野外这里
  ruins: { x:0,  y:0 },     // 从沙丘荒野东侧进入遗迹
  tomb:  { x:0,  y:0 },     // 从遗迹东侧进入王陵
};

/* ============================================================
   沙丘镇地图：格坐标（每格 40px），共 29 × 20 格
   ------------------------------------------------------------
   0 空地  1 围墙  2 房屋  3 道路  4 城门  5 树  6 灌木  7 岩石
   ------------------------------------------------------------
   围墙四面封闭，只在东侧 (28,1) 留一个城门（4）。
   房屋每处 3×2：四个角落各一处（对应 4 位 NPC），镇中心一处（神秘人）。
   其余空地随机散布树木/灌木/岩石，让场景丰富起来（与野外同一套渲染）。
   ============================================================ */
const TILE = 40;
const TOWN_MAP = [
  '11111111111111111111111111114',
  '11000000000000000000000000000',
  '11002220000000000000522000000',
  '11602220000000000000222000000',
  '11000000000000000000000000000',
  '11000000000000000000000000000',
  '11000000000600000000000000000',
  '11000000000000000000000000000',
  '11000000000000000000000000000',
  '11000000000002220000000000000',
  '11000000000002220000000000000',
  '11000000000000000000000000000',
  '11000000000000000000000000000',
  '11000500000000000000000000000',
  '11002220000000000000222000000',
  '11002220000000000000222000000',
  '11000000000000000000000000000',
  '11000000000006000000000000000',
  '11000000000000000000000000000',
  '11111111111111111111111111111',
];
const TOWN_W = TOWN_MAP[0].length;
const TOWN_H = TOWN_MAP.length;

/* 每格对应的装饰：emoji + 尺寸（按真实比例：树/房子大，草/石头小） */
const TILE_DECOR = {
  '2': { emoji:['🏠','🏡','🏘️'], size:58 },
  '3': { emoji:['', ''], size:0 },          // 道路只铺地，不放 emoji
  '4': { emoji:['🚪'], size:44 },
  '5': { emoji:['🌳','🌲','🌴'], size:66 },  // 树：大
  '6': { emoji:['🌿','🌾'], size:26 },       // 灌木/草：小
  '7': { emoji:['🪨'], size:28 },            // 石头：小
};
/* 同一个坐标永远长同一棵树 */
function tileDecorAt(t, x, y) {
  const d = TILE_DECOR[t];
  if (!d || !d.emoji.length || !d.emoji[0]) return null;
  const r = hashSeed(x, y);
  return { emoji: d.emoji[Math.floor(r * d.emoji.length)], size: d.size };
}

/* 城镇 NPC（格坐标）：每家一个，站在自己房子前面 */
const NPCS = [
  { id:'elder',  name:'村长',   emoji:'🧓',   x:6,  y:3,  kind:'dialog', dialog:'elder' },
  { id:'shop',   name:'商人',   emoji:'🧑‍🌾', x:20, y:3,  kind:'shop',   dialog:'shop'   },
  { id:'smith',  name:'铁匠',   emoji:'🧑‍🏭', x:6,  y:15, kind:'shop',   dialog:'smith'  },
  { id:'healer', name:'药师',   emoji:'👩‍⚕️', x:20, y:15, kind:'inn',    dialog:'healer' },
  { id:'mystic', name:'神秘人', emoji:'🧙‍♂️', x:13, y:10, kind:'skill',  dialog:'mystic' },
];
/* 城门出口（格坐标）→ 通向的野外区域 */
const TOWN_EXITS = [
  { id:'gateDune', name:'前往 沙丘荒野', emoji:'🏜️', x:28, y:0.5, to:'dune', spawn:'out' },
];

/* 野外：回城出口 + 通往下一个区域的通道（格坐标，绝对坐标） */
const WILD_EXITS = {
  dune:  { id:'backTown',  name:'返回 沙丘镇',   emoji:'🏠', to:'town',  spawn:'gate', x:18, y:8 },
  ruins: { id:'backDune',  name:'返回 沙丘荒野', emoji:'🏜️', to:'dune',  spawn:'out',  x:-10, y:0 },
  tomb:  { id:'backRuins', name:'返回 风蚀遗迹', emoji:'🏛️', to:'ruins', spawn:'out',  x:-10, y:0 },
};
const ZONE_GATES = {
  dune:  [{ id:'toRuins', name:'前往 风蚀遗迹', emoji:'🏛️', to:'ruins', spawn:'out', x:44, y:8 }],
  ruins: [{ id:'toTomb',  name:'前往 王陵深处', emoji:'⚰️', to:'tomb',  spawn:'out', x:44, y:8 }],
  tomb:  [],
};

/* ============================================================
   宠物：十二生肖（只有生肖怪会生宝宝/变异）
   ------------------------------------------------------------
   bias    : 成长偏科
   skill   : 普通技能；mutSkill: 变异技能（更强）
   ============================================================ */
const PETS = {
  rat:     { id:'rat',     name:'灵鼠', emoji:'🐭', element:'土', bias:{ agi:1.4, luk:1.2, per:0.8 },
             skill:'steal',    mutSkill:'stealPlus',    desc:'偷取金币并造成伤害' },
  ox:      { id:'ox',      name:'铁牛', emoji:'🐮', element:'土', bias:{ vit:1.6, str:1.2, wil:1.0 },
             skill:'charge',   mutSkill:'greatCharge',  desc:'冲撞击退敌人' },
  tiger:   { id:'tiger',   name:'猛虎', emoji:'🐯', element:'金', bias:{ str:1.6, agi:1.1, vit:0.8 },
             skill:'pounce',   mutSkill:'greatPounce',  desc:'扑击血量最高的敌人' },
  rabbit:  { id:'rabbit',  name:'玉兔', emoji:'🐰', element:'木', bias:{ agi:1.7, luk:1.3, spr:0.8 },
             skill:'tripleHop',mutSkill:'moonHop',      desc:'连续跃击三次，伤害递增' },
  dragon:  { id:'dragon',  name:'炎龙', emoji:'🐲', element:'火', bias:{ int:1.7, str:1.1, spr:0.8 },
             skill:'breath',   mutSkill:'greatBreath',  desc:'喷吐龙息，附加灼烧' },
  snake:   { id:'snake',   name:'沙蛇', emoji:'🐍', element:'火', bias:{ int:1.3, agi:1.3, per:0.8 },
             skill:'venom',    mutSkill:'greatVenom',   desc:'剧毒咬击，持续掉血' },
  horse:   { id:'horse',   name:'骏马', emoji:'🐴', element:'火', bias:{ agi:1.8, str:1.0, vit:0.7 },
             skill:'swift',    mutSkill:'swiftPlus',    desc:'提升全队速度' },
  goat:    { id:'goat',    name:'灵羊', emoji:'🐑', element:'土', bias:{ spr:1.6, vit:1.2, wil:1.0 },
             skill:'mend',     mutSkill:'greatMend',    desc:'治疗生命最少的队友' },
  monkey:  { id:'monkey',  name:'灵猴', emoji:'🐵', element:'金', bias:{ agi:1.5, luk:1.4, per:0.9 },
             skill:'trick',    mutSkill:'doubleTrick',  desc:'连击并降低敌人命中' },
  rooster: { id:'rooster', name:'金鸡', emoji:'🐔', element:'金', bias:{ per:1.7, luk:1.3, agi:0.8 },
             skill:'crow',     mutSkill:'greatCrow',    desc:'提高全队暴击率' },
  dog:     { id:'dog',     name:'忠犬', emoji:'🐶', element:'土', bias:{ vit:1.4, wil:1.3, str:1.0 },
             skill:'guard',    mutSkill:'greatGuard',   desc:'为队友抵挡伤害' },
  pig:     { id:'pig',     name:'福猪', emoji:'🐷', element:'水', bias:{ vit:1.7, spr:1.1, wil:1.2 },
             skill:'fortune',  mutSkill:'greatFortune', desc:'战斗结束获得额外金币' },
};
const PET_ORDER = Object.keys(PETS);
const ELEMENTS = ['金','木','水','火','土'];
/* 五行相克：金克木、木克土、土克水、水克火、火克金 */
const ELEMENT_COUNTER = { 金:'木', 木:'土', 土:'水', 水:'火', 火:'金' };

/* 宠物技能（回合制版） */
const PET_SKILLS = {
  steal:      { id:'steal',      name:'鼠窃',   icon:'🐭', kind:'phys',  power:0.9, mp:3, gold:6 },
  stealPlus:  { id:'stealPlus',  name:'窃运',   icon:'🐭', kind:'phys',  power:1.4, mp:3, gold:16 },
  charge:     { id:'charge',     name:'冲撞',   icon:'🐮', kind:'phys',  power:1.2, mp:4 },
  greatCharge:{ id:'greatCharge',name:'蛮牛冲撞',icon:'🐮', kind:'phys',  power:1.8, mp:4, status:{ id:'stun', turns:1 } },
  pounce:     { id:'pounce',     name:'猛虎扑食',icon:'🐯', kind:'phys',  power:1.5, mp:5 },
  greatPounce:{ id:'greatPounce',name:'虎啸扑击',icon:'🐯', kind:'phys',  power:2.1, mp:5 },
  tripleHop:  { id:'tripleHop',  name:'狡兔三跃',icon:'🐰', kind:'phys',  power:0.7, mp:4, hits:3, ramp:0.5 },
  moonHop:    { id:'moonHop',    name:'月影连跃',icon:'🐰', kind:'phys',  power:0.8, mp:4, hits:4, ramp:0.6 },
  breath:     { id:'breath',     name:'龙息',   icon:'🐲', kind:'magic', power:1.3, mp:7, status:{ id:'burn', turns:3 } },
  greatBreath:{ id:'greatBreath',name:'焚天龙息',icon:'🐲', kind:'magic', power:1.8, mp:7, status:{ id:'burn', turns:3 } },
  venom:      { id:'venom',      name:'剧毒咬', icon:'🐍', kind:'phys',  power:1.1, mp:4, status:{ id:'poison', turns:3 } },
  greatVenom: { id:'greatVenom', name:'万毒噬', icon:'🐍', kind:'phys',  power:1.5, mp:4, status:{ id:'poison', turns:4 } },
  swift:      { id:'swift',      name:'千里疾风',icon:'🐴', kind:'buff', power:0.5, mp:5, buff:{ key:'spd', turns:2 }, target:'allyAll' },
  swiftPlus:  { id:'swiftPlus',  name:'踏云疾风',icon:'🐴', kind:'buff', power:0.8, mp:5, buff:{ key:'spd', turns:3 }, target:'allyAll' },
  mend:       { id:'mend',       name:'祥和之息',icon:'🐑', kind:'heal', power:1.6, mp:6 },
  greatMend:  { id:'greatMend',  name:'暖阳之息',icon:'🐑', kind:'heal', power:2.3, mp:6 },
  trick:      { id:'trick',      name:'灵猴妙手',icon:'🐵', kind:'phys', power:0.9, mp:4, hits:2 },
  doubleTrick:{ id:'doubleTrick',name:'分身妙手',icon:'🐵', kind:'phys', power:1.0, mp:4, hits:3 },
  crow:       { id:'crow',       name:'金鸡报晓',icon:'🐔', kind:'buff', power:0.5, mp:5, buff:{ key:'atk', turns:2 }, target:'allyAll' },
  greatCrow:  { id:'greatCrow',  name:'晨鸣破晓',icon:'🐔', kind:'buff', power:0.6, mp:5, buff:{ key:'atk', turns:3 }, target:'allyAll' },
  guard:      { id:'guard',      name:'忠犬护主',icon:'🐶', kind:'buff', power:0.5, mp:4, buff:{ key:'def', turns:2 }, target:'allyAll' },
  greatGuard: { id:'greatGuard', name:'忠魂守护',icon:'🐶', kind:'buff', power:0.7, mp:4, buff:{ key:'def', turns:3 }, target:'allyAll' },
  fortune:    { id:'fortune',    name:'福猪拱财',icon:'🐷', kind:'buff', power:0.3, mp:3, buff:{ key:'atk', turns:2 }, target:'allyAll', gold:10 },
  greatFortune:{ id:'greatFortune',name:'财源广进',icon:'🐷', kind:'buff', power:0.4, mp:3, buff:{ key:'atk', turns:3 }, target:'allyAll', gold:30 },
};

/* ============================================================
   遇敌与稀有度
   ============================================================ */
/* 稀有度：普通 / 宝宝 / 变异（只有生肖怪能出后两种） */
const RARITY = {
  normal:  { id:'normal',  name:'',      hpMul:1.00, statMul:1.00, statBonus:0, expMul:1.0, captureMul:1.00 },
  baby:    { id:'baby',    name:'宝宝',  hpMul:0.80, statMul:0.85, statBonus:2, expMul:1.2, captureMul:2.00 },
  variant: { id:'variant', name:'变异',  hpMul:1.30, statMul:1.20, statBonus:4, expMul:1.6, captureMul:0.55 },
};
const RARITY_RATES = { normal:0.80, baby:0.14, variant:0.06 };

/* 抓捕基础成功率 */
const CAPTURE_BASE = 0.30;

/* 遇敌步数范围（暗雷） */
const ENCOUNTER_STEPS = [6, 14];

/* 升级经验曲线 */
function expNeed(level) { return Math.floor(40 * Math.pow(level, 1.72)); }
const POINTS_PER_LEVEL = 5;

/* 团灭惩罚 */
const WIPE_GOLD_LOSS = 0.05;   // 扣 5% 金币
const WIPE_GOLD_MIN  = 10;

/* 遇敌规模：队伍超过 4 人时更容易遇到 6 只 */
function rollEnemyCount(partySize, min, max) {
  if (partySize >= 4 && max >= 6) {
    /* 40% 直接满编 6 只 */
    if (chance(0.40)) return 6;
    return Math.max(4, rndi(4, max));
  }
  return rndi(min, Math.min(max, partySize + 2));
}
