"use strict";

/* ============================================================
   无尽回响：轮回 — 游戏主逻辑
   ============================================================
   版本记录（重要：以后每次改动都加一行，方便回滚）
   ------------------------------------------------------------
   v0.1.0 · P1 原型    —— 探索+战斗双视角，1城镇，基础怪物
   v0.2.0 · 宠物系统    —— 12生肖捕捉，战斗召唤，技能熟练度
   v0.3.0 · 轮回        —— 悬赏任务/图鉴/技能档位/6v6/轮回系统
   ============================================================ */

const GAME_VERSION = 'v0.3.0';
const GAME_CODENAME = '轮回';

const TAU = Math.PI * 2;
const rnd  = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const pick = a => a[Math.floor(Math.random() * a.length)];
const $ = id => document.getElementById(id);

/* ============================================================
   技能档位：5 级一档
   ============================================================ */
function maxSkillLevel(charLevel) {
  if (charLevel < 10) return 5;
  return Math.floor((charLevel - 10) / 5) * 5 + 10;
}
function skillMult(lv) { return lv / 5; }

/* ============================================================
   属性
   ============================================================ */
const STATS = [
  { id:'vit',  name:'体质', icon:'❤️' },
  { id:'str',  name:'力量', icon:'💪' },
  { id:'agi',  name:'敏捷', icon:'💨' },
  { id:'int',  name:'智力', icon:'🧠' },
  { id:'spr',  name:'精神', icon:'🕊️' },
  { id:'luk',  name:'幸运', icon:'🍀' },
  { id:'per',  name:'感知', icon:'👁️' },
  { id:'wil',  name:'意志', icon:'🔥' },
];

function calcStats(u) {
  const s = u.stats;
  return {
    maxHp: 50 + s.vit * 8 + u.level * 5,
    maxMp: 20 + s.int * 3 + s.spr * 2 + u.level * 2,
    atk:   8 + s.str * 2.2,
    def:   4 + s.vit * 1.2,
    matk:  6 + s.int * 2.2,
    mdef:  4 + s.spr * 1.2,
    spd:   50 + s.agi * 2.5,
    crit:  0.05 + s.luk * 0.008,
    hit:   0.85 + s.per * 0.008,
    eva:   0.02 + s.agi * 0.004,
    hpReg: 0.5 + s.wil * 0.15,
    mpReg: 0.3 + s.spr * 0.1,
  };
}

/* ============================================================
   12 生肖
   ============================================================ */
const ZODIAC = {
  rat:     { id:'rat',     name:'鼠', emoji:'🐭', element:'土', petSkill:'bite',     bias:{agi:2, luk:1} },
  ox:      { id:'ox',      name:'牛', emoji:'🐮', element:'土', petSkill:'slash',    bias:{vit:3, str:1} },
  tiger:   { id:'tiger',   name:'虎', emoji:'🐯', element:'金', petSkill:'slash',    bias:{str:3, agi:1} },
  rabbit:  { id:'rabbit',  name:'兔', emoji:'🐰', element:'木', petSkill:'haste',    bias:{agi:3, luk:1} },
  dragon:  { id:'dragon',  name:'龙', emoji:'🐲', element:'火', petSkill:'fireball', bias:{int:3, str:1} },
  snake:   { id:'snake',   name:'蛇', emoji:'🐍', element:'火', petSkill:'freeze',   bias:{int:2, agi:2} },
  horse:   { id:'horse',   name:'马', emoji:'🐴', element:'火', petSkill:'haste',    bias:{agi:3, str:1} },
  goat:    { id:'goat',    name:'羊', emoji:'🐑', element:'土', petSkill:'heal',     bias:{spr:3, vit:1} },
  monkey:  { id:'monkey',  name:'猴', emoji:'🐵', element:'金', petSkill:'slash',    bias:{agi:2, luk:2} },
  rooster: { id:'rooster', name:'鸡', emoji:'🐔', element:'金', petSkill:'fireball', bias:{per:3, luk:1} },
  dog:     { id:'dog',     name:'狗', emoji:'🐶', element:'土', petSkill:'slash',    bias:{vit:2, wil:2} },
  pig:     { id:'pig',     name:'猪', emoji:'🐷', element:'水', petSkill:'heal',     bias:{vit:3, spr:1} },
};

/* ============================================================
   技能
   ============================================================ */
const SKILLS = {
  fireball: { id:'fireball', name:'火球术', icon:'🔥', type:'damage', target:'enemy', mp:6,
    desc:'火焰单体伤害',
    effect: (self, tgt, lv) => {
      const m = skillMult(lv);
      const dmg = Math.round(self.c.matk * 1.6 * m + rnd(-3, 3));
      return { dmg, text:`${self.name} 火球术！` };
    }
  },
  slash: { id:'slash', name:'重斩', icon:'⚔️', type:'damage', target:'enemy', mp:4,
    desc:'物理单体伤害',
    effect: (self, tgt, lv) => {
      const m = skillMult(lv);
      const dmg = Math.round(self.c.atk * 1.5 * m + rnd(-2, 2));
      return { dmg, text:`${self.name} 重斩！` };
    }
  },
  heal: { id:'heal', name:'治疗术', icon:'💚', type:'heal', target:'ally', mp:8,
    desc:'回复单个队友HP',
    effect: (self, tgt, lv) => {
      const m = skillMult(lv);
      const heal = Math.round((self.c.matk * 2.5 + 20) * m);
      return { heal, text:`${self.name} 治疗术！` };
    }
  },
  meditate: { id:'meditate', name:'冥想', icon:'💙', type:'mp', target:'ally', mp:0,
    desc:'回复自身MP',
    effect: (self, tgt, lv) => {
      const m = skillMult(lv);
      const mp = Math.round((self.c.maxMp * 0.3 + 10) * m);
      return { mp, text:`${self.name} 冥想` };
    }
  },
  freeze: { id:'freeze', name:'冰封', icon:'❄️', type:'control', target:'enemy', mp:7,
    desc:'冻结敌人1回合',
    effect: (self, tgt, lv) => {
      const m = skillMult(lv);
      const dmg = Math.round(self.c.matk * 0.8 * m);
