"use strict";

/* ============================================================
   无尽回响：轮回 — 启动（main）
   ------------------------------------------------------------
   入口、主循环、所有按钮绑定
   加载顺序：data → core → battle → explore → ui → ui-panels → main
   ============================================================ */

/* 页面加载时不能有游戏逻辑自动跑，全部包在 init 里 */
function initGame() {
  ui.showScreen('menu');

  /* 先把运行时报错抓出来显示（免得又是"点了没反应"却看不到原因） */
  installErrorTrap();
  ui._debugOn = true;              // 调试面板默认打开，排查完再关
  toggleDebug();

  /* 连点左上角地名 5 次 → 开关调试面板 */
  let tapCount = 0, tapTimer = 0;
  $('locName').addEventListener('click', () => {
    clearTimeout(tapTimer);
    if (++tapCount >= 5) { tapCount = 0; toggleDebug(); return; }
    tapTimer = setTimeout(() => { tapCount = 0; }, 1200);
  });

  /* 连点右上角血条 3 次 → 切换相机模式（跟随 / 固定） */
  ui.bindCameraToggle();

  /* ---------- 主菜单 ---------- */
  $('btnNewGame').onclick = () => {
    if (hasSave() && !confirm('已有存档，重新开始会覆盖它。确定吗？')) return;
    resetSave();
    newGame();
    saveGame();
    ui.renderExplore();
    ui.showScreen('explore');
    enterExplore('west');
    toast('欢迎来到沙丘镇');
    updateTeamDot();
  };

  $('btnContinue').onclick = () => {
    if (!loadGame()) { toast('没有找到存档'); return; }
    ui.showScreen('explore');
    /* 城镇从镇中心继续；野外原地继续（无限平面，坐标就是存档里的） */
    enterExplore(ZONES[G.zone] && ZONES[G.zone].safe ? 'west' : 'here');
    toast('读取存档成功');
    updateTeamDot();
  };

  $('btnCodexMonster').onclick = () => {
    if (!G) newGame();
    ui.openCodex('monster');
  };

  $('btnCodexPet').onclick = () => {
    if (!G) newGame();
    ui.openCodex('pet');
  };

  $('btnReincarnate').onclick = () => {
    if (!G) { ui.showDialogText('系统', '🔄', '请先点击【开始游戏】。'); return; }
    if (!G.bossKilled) {
      ui.showDialogText('系统', '🔄',
        '轮回之门尚未开启。\n\n需要先前往【王陵深处】击败最终 BOSS「沙之支配者」。');
      return;
    }
    /* 已通关：直接再刷一次 BOSS（材料 / 稀有宠物） */
    ui.startBossFight();
  };

  /* ---------- 探索界面 ---------- */
  $('interactBtn').onclick = doInteract;
  $('btnAuto').onclick = () => {
    if (!G) return;
    const on = toggleAutoExplore();
    toast(on ? '自动探索开启' : '自动探索关闭');
  };
  $('btnBag').onclick = () => { if (!ui.hasOverlay()) ui.openBag(false); };
  $('btnTeam').onclick = () => { if (!ui.hasOverlay()) ui.openTeam(); };
  $('btnTown').onclick = () => {
    if (!G) return;
    if (Battle.active) { toast('战斗中无法回城'); return; }
    G.zone = 'town';
    enterExplore('gate');
    toast('回到了沙丘镇');
  };

  /* ---------- 面板关闭 ---------- */
  $('statClose').onclick = () => {
    $('statPanel').classList.add('hidden');
    ui.renderPartyChars();
    ui.renderPartyStats();
    updateTeamDot();
    autoSave();
  };
  $('bagClose').onclick  = () => $('bagPanel').classList.add('hidden');
  $('teamClose').onclick = () => $('teamPanel').classList.add('hidden');
  $('codexClose').onclick = () => $('codexPanel').classList.add('hidden');
  $('dynClose').onclick  = () => $('dynPanel').classList.add('hidden');
  $('resultClose').onclick = () => {
    $('resultPanel').classList.add('hidden');
    ui.showScreen('explore');
    enterExplore('here');
  };

  /* ---------- 战斗 ---------- */
  ui.bindBattleButtons();

  /* 点击遮罩关闭（非战斗结算） */
  for (const id of ['statPanel','bagPanel','teamPanel','codexPanel','dynPanel']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id) $(id).classList.add('hidden'); });
  }

  /* ---------- 输入 ---------- */
  bindExploreInput();

  /* 页面隐藏时存档 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G) saveGame();
  });
  window.addEventListener('beforeunload', () => { if (G) saveGame(); });

  /* ---------- 主循环 ---------- */
  requestAnimationFrame(mainLoop);
}

let _lastFrame = 0;

function mainLoop(now) {
  const dt = _lastFrame ? Math.min(0.05, (now - _lastFrame) / 1000) : 0;
  _lastFrame = now;

  /* 战斗倒计时 / 自动战斗 */
  if (Battle.active && !Battle.over) {
    if (Battle.actor && Battle.actor.kind === 'char') {
      if (Battle.countdown > 0) {
        Battle.countdown -= dt;
        ui.updateCountdown(Battle.countdown);
        if (Battle.countdown <= 0) {
          Battle.countdown = 0;
          /* 超时：自动接管这一回合 */
          if (!Battle.auto) {
            Battle.auto = true;
            ui.setAutoState(true);
            ui.addLog('⏱️ 超时，自动战斗接管', 'system');
          }
          if (!ui._busy) {
            ui._busy = true;
            const u = Battle.actor;
            setTimeout(() => {
              if (Battle.active && !Battle.over && Battle.actor === u) autoActFor(u);
              ui._busy = false;
            }, 300);
          }
        }
      }
    }
  }

  requestAnimationFrame(mainLoop);
}

/* 暴露给控制台调试 */
window.LL = {
  get G(){ return G; }, Battle, Explore, ui, newGame, saveGame, loadGame,
  debug: () => toggleDebug(),
  where: () => ({ zone:G && G.zone, pos:G && G.pos, dir:Explore.dir, walkable:G && isWalkable(G.pos.x, G.pos.y) }),
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGame);
else initGame();
