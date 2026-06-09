// ============================================================
//  轮转研究 - 排球站位分析工具
//  Volleyball Rotation Research Tool
// ============================================================

// ===== DOM 快捷访问 =====
const $ = id => document.getElementById(id);
const qs = (sel, p=document) => p.querySelector(sel);
const qsa = (sel, p=document) => p.querySelectorAll(sel);

// ===== 常量 =====
const POS_ORDER = [4, 3, 2, 5, 6, 1]; // 位置排列顺序：前排左→中→右，后排左→中→右
const ROLES = ['二传', '接应', '大主', '小主', '大副', '小副', '自由'];
const ROTATION_LABELS = ['第1轮', '第2轮', '第3轮', '第4轮', '第5轮', '第6轮'];
const PEN_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#424242'];
const STORAGE_KEY = 'circle_research_data';
const DATA_VERSION = 4; // v4: 对方坐标镜像翻转

// 默认初始坐标（相对值 0-1，基于全球场坐标系）
// 我方半场 y: 0.5-1.0，前排靠近网(y小)，后排靠近底线(y大)
// 对方半场 y: 0.0-0.5，前排靠近网(y大)，后排靠近底线(y小)
const DEFAULT_COORDS = {
  our: {
    4: { x: 0.22, y: 0.57 }, 3: { x: 0.50, y: 0.57 }, 2: { x: 0.78, y: 0.57 },
    5: { x: 0.22, y: 0.78 }, 6: { x: 0.50, y: 0.78 }, 1: { x: 0.78, y: 0.78 },
  },
  // 对方场地位于上半部分，左右方向镜像（对方左侧在我们右侧）
  // 所以 pos4(对方左) 在显示右侧 x≈0.78, pos2(对方右) 在显示左侧 x≈0.22
  opp: {
    4: { x: 0.78, y: 0.43 }, 3: { x: 0.50, y: 0.43 }, 2: { x: 0.22, y: 0.43 },
    5: { x: 0.78, y: 0.22 }, 6: { x: 0.50, y: 0.22 }, 1: { x: 0.22, y: 0.22 },
  },
};

// 违规检查的配对关系
const HORIZONTAL_PAIRS = [[4,3,'前排4应在3左侧'],[3,2,'前排3应在2左侧'],[5,6,'后排5应在6左侧'],[6,1,'后排6应在1左侧']];
const VERTICAL_PAIRS = [[4,5,'4应在5前方'],[3,6,'3应在6前方'],[2,1,'2应在1前方']];

// ===== 状态 =====
const state = {
  ourRoster: [],     // [{num, role}, ...] 对应位置 4,3,2,5,6,1
  oppRoster: [],     // [{num, role}, ...]
  scenarios: [],     // [rot][sc] = { ourMarkers, oppMarkers, strokes }
  currentRot: 0,     // 0-5
  currentSc: 0,      // 0=接发, 1=发球
  showOnlyReceive: true,
  displayMode: 'dual', // 'dual' | 'single'

  // 工具
  activeTool: 'select', // 'select' | 'pen' | 'eraser'
  penColor: '#E53935',
  penSize: 3,

  // 拖拽状态
  dragMarker: null,
  dragTeam: '',
  dragOffX: 0,
  dragOffY: 0,

  // 画线状态
  isDrawing: false,
  currentStroke: null,

  // 编辑状态
  editKey: null, // 'our-i' | 'opp-i'
};

// ============================================================
//  初始化
// ============================================================

function initApp() {
  if (loadFromStorage()) {
    enterMainUI();
    requestAnimationFrame(() => renderAll());
  } else {
    // 无保存数据时，使用默认数据直接初始化
    initDefaultData();
    enterMainUI();
    requestAnimationFrame(() => renderAll());
    saveToStorage();
  }
}

function initDefaultData() {
  state.ourRoster = [
    { num: 1, role: '二传' }, { num: 2, role: '大主' },
    { num: 3, role: '接应' }, { num: 4, role: '小主' },
    { num: 5, role: '大副' }, { num: 6, role: '小副' },
  ];
  state.oppRoster = [
    { num: 7, role: '二传' }, { num: 8, role: '大主' },
    { num: 9, role: '接应' }, { num: 10, role: '小主' },
    { num: 11, role: '大副' }, { num: 12, role: '小副' },
  ];
  generateAllScenarios();
}

function showSetupDialog() {
  $('setup-overlay').style.display = 'flex';
  const ourContainer = $('setup-our');
  const oppContainer = $('setup-opp');
  ourContainer.innerHTML = '';
  oppContainer.innerHTML = '';

  POS_ORDER.forEach((pos, i) => {
    ourContainer.appendChild(createSetupRow(pos, 'our', i));
    oppContainer.appendChild(createSetupRow(pos, 'opp', i));
  });
}

function createSetupRow(pos, team, idx) {
  const div = document.createElement('div');
  div.className = 'setup-row';
  const defaultNums = team === 'our' ? [1,2,3,4,5,6] : [7,8,9,10,11,12];
  div.innerHTML = `
    <span class="setup-pos">${pos}号</span>
    <input type="number" class="setup-num" id="setup-${team}-${idx}" value="${defaultNums[idx]}" min="0" max="99" placeholder="号">
    <select class="setup-role" id="setup-${team}-role-${idx}">
      ${ROLES.map(r => `<option value="${r}" ${idx===0&&r==='二传'||idx===1&&r==='大主'||idx===2&&r==='接应'||idx===3&&r==='小主'||idx===4&&r==='大副'||idx===5&&r==='小副' ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
  `;
  return div;
}

function onSetupConfirm() {
  // 读取我方阵容
  state.ourRoster = [];
  state.oppRoster = [];
  for (let i = 0; i < 6; i++) {
    const ourNum = parseInt($(`setup-our-${i}`).value) || 0;
    const ourRole = $(`setup-our-role-${i}`).value;
    state.ourRoster.push({ num: ourNum, role: ourRole });

    const oppNum = parseInt($(`setup-opp-${i}`).value) || 0;
    const oppRole = $(`setup-opp-role-${i}`).value;
    state.oppRoster.push({ num: oppNum, role: oppRole });
  }
  $('setup-overlay').style.display = 'none';
  generateAllScenarios();
  enterMainUI();
  requestAnimationFrame(() => renderAll());
  saveToStorage();
}

// ============================================================
//  轮转生成
// ============================================================

function rotateRoster(roster) {
  // 标准排球顺时针轮转
  // roster 顺序 [p4(0), p3(1), p2(2), p5(3), p6(4), p1(5)]
  // 轮转后：
  //   p4 ← 原 p5 (后排左侧→前排左侧)
  //   p3 ← 原 p4 (前排左侧→前排中间)
  //   p2 ← 原 p3 (前排中间→前排右侧)
  //   p5 ← 原 p6 (后排中间→后排左侧)
  //   p6 ← 原 p1 (后排右侧→后排中间)
  //   p1 ← 原 p2 (前排右侧→后排右侧/发球)
  return [roster[3], roster[0], roster[1], roster[4], roster[5], roster[2]];
}

function createMarkers(roster, team) {
  const isOur = team === 'our';
  const coords = isOur ? DEFAULT_COORDS.our : DEFAULT_COORDS.opp;
  return roster.map((player, i) => {
    const pos = POS_ORDER[i];
    const c = coords[pos];
    return {
      pos, num: player.num, role: player.role,
      x: c.x, y: c.y,
    };
  });
}

function generateAllScenarios() {
  // 按照 refree-tool 的 switchPossession 逻辑：
  //   接发方赢得回合 → 接发方轮转 → 球权切换
  // 所以 s=0(接发) 是当前轮次，s=1(发球) 是轮转一次后的轮次
  state.scenarios = [];
  let ourR = [...state.ourRoster];
  let oppR = [...state.oppRoster];
  for (let r = 0; r < 6; r++) {
    const scs = [];

    // 场景 0: 我方接发（对方发球）→ 双方都是当前轮次
    scs[0] = {
      ourMarkers: createMarkers(ourR, 'our'),
      oppMarkers: createMarkers(oppR, 'opp'),
      strokes: [],
    };

    // 场景 1: 我方发球（对方接发）→ 球权更替，我方轮转一次
    //   (refree-tool 的 switchPossession: 接发方轮转后变为发球方)
    const ourServed = rotateRoster(ourR);
    // 对方失去球权，不轮转
    scs[1] = {
      ourMarkers: createMarkers(ourServed, 'our'),
      oppMarkers: createMarkers(oppR, 'opp'),
      strokes: [],
    };

    state.scenarios.push(scs);
    ourR = rotateRoster(ourR);
    oppR = rotateRoster(oppR);
  }
}

function enterMainUI() {
  $('main-ui').style.display = 'flex';
}

// ============================================================
//  场景访问
// ============================================================

function getScene(rot, sc) {
  return state.scenarios[rot] && state.scenarios[rot][sc];
}

function getCurrentScene() {
  return getScene(state.currentRot, state.currentSc);
}

function getSceneKey(rot, sc) {
  return `${rot}-${sc}`;
}

// 获取当前显示的轮次列表
function getVisibleRotations() {
  if (state.showOnlyReceive) {
    // 只显示接发轮（sc=0）
    return [0,1,2,3,4,5].map(r => ({ rot: r, sc: 0 }));
  } else {
    // 显示全部 12 轮
    const result = [];
    for (let r = 0; r < 6; r++) {
      result.push({ rot: r, sc: 0 }); // 接发
      result.push({ rot: r, sc: 1 }); // 发球
    }
    return result;
  }
}

function getVisibleIndex(rot, sc) {
  const list = getVisibleRotations();
  return list.findIndex(item => item.rot === rot && item.sc === sc);
}

// ============================================================
//  渲染
// ============================================================

function renderAll() {
  renderRotationBar();
  renderSceneLabel();
  renderCourt();
  renderViolations();
}

function renderRotationBar() {
  const bar = $('rotation-bar');
  const list = getVisibleRotations();
  bar.innerHTML = list.map((item, i) => {
    const active = item.rot === state.currentRot && item.sc === state.currentSc;
    const label = state.showOnlyReceive
      ? ROTATION_LABELS[item.rot]
      : `${ROTATION_LABELS[item.rot]}·${item.sc === 0 ? '接' : '发'}`;
    const cls = `rot-chip ${active ? 'active' : ''} ${item.sc === 1 ? 'serve' : ''}`;
    return `<span class="${cls}" data-rot="${item.rot}" data-sc="${item.sc}">${label}</span>`;
  }).join('');

  // 绑定点击事件
  bar.querySelectorAll('.rot-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const rot = parseInt(chip.dataset.rot);
      const sc = parseInt(chip.dataset.sc);
      switchTo(rot, sc);
    });
  });
}

function renderSceneLabel() {
  const label = $('scene-label');
  const rot = state.currentRot;
  const sc = state.currentSc;
  if (state.showOnlyReceive) {
    label.textContent = `📋 ${ROTATION_LABELS[rot]} · 我方接发`;
  } else {
    const servingRot = (rot + 1) % 6;
    label.textContent = `📋 ${ROTATION_LABELS[rot]} · ${sc === 0 ? '我方接发' : `我方发球 (轮转→${ROTATION_LABELS[servingRot]})`}`;
  }
}

function renderViolations() {
  const scene = getCurrentScene();
  if (!scene) return;
  const bar = $('violation-bar');
  const text = $('violation-text');

  // 检测接球方的违规
  const receiveTeam = state.currentSc === 0 ? 'our' : 'opp';
  const violations = checkAllViolations(scene, receiveTeam);

  if (violations.length > 0) {
    bar.style.display = 'block';
    text.textContent = '⚠️ 站位违规：' + violations.join('；');
  } else {
    bar.style.display = 'none';
  }
}

function switchTo(rot, sc) {
  if (rot === state.currentRot && sc === state.currentSc) return;
  state.currentRot = rot;
  state.currentSc = sc;
  renderAll(); // renderAll → renderCourt → initCanvas
}

// ============================================================
//  球场渲染
// ============================================================

function renderCourt() {
  const wrap = $('court-wrap');
  const court = $('court');

  wrap.className = `court-wrap ${state.displayMode}`;

  // 清除旧标记
  court.querySelectorAll('.player-marker').forEach(el => el.remove());

  const scene = getCurrentScene();
  if (!scene) return;

  // 渲染球员
  if (state.displayMode === 'dual') {
    // 双场：显示双方
    scene.oppMarkers.forEach(m => renderMarker(m, 'opp'));
    scene.ourMarkers.forEach(m => renderMarker(m, 'our'));
  } else {
    // 单场：只显示我方
    scene.ourMarkers.forEach(m => renderMarker(m, 'our'));
  }

  // 初始化画布
  initCanvas();
}

// ============================================================
//  球员标记渲染
// ============================================================

function renderMarker(marker, team) {
  const court = $('court');
  const el = document.createElement('div');
  el.className = `player-marker ${team}-team`;
  el.dataset.pos = marker.pos;
  el.dataset.team = team;

  // 计算位置
  const pctX = marker.x * 100;
  const pctY = marker.y * 100;
  el.style.left = `${pctX}%`;
  el.style.top = `${pctY}%`;

  // 选中状态
  if (state.dragMarker && state.dragMarker.pos === marker.pos && state.dragTeam === team) {
    el.classList.add('selected');
  }

  // 违规状态 - 仅对接球方检测
  const receiveTeam = state.currentSc === 0 ? 'our' : 'opp';
  if (team === receiveTeam) {
    const scene = getCurrentScene();
    const allMarkers = receiveTeam === 'our' ? scene.ourMarkers : scene.oppMarkers;
    const violatedPositions = getViolatedPositions(allMarkers, receiveTeam);
    if (violatedPositions.has(marker.pos)) {
      el.classList.add('violated');
    }
  }

  const numText = marker.num > 0 ? marker.num : '?';
  el.innerHTML = `<span class="pm-num">${numText}</span><span class="pm-role">${marker.role}</span>`;

  // 鼠标事件 - 仅 select 模式下可交互
  el.addEventListener('mousedown', (e) => {
    if (state.activeTool !== 'select') return;
    potentialDragStart(e, marker, team);
  });
  el.addEventListener('dblclick', () => {
    if (state.activeTool !== 'select') return;
    openEditDialog(marker, team);
  });

  court.appendChild(el);
}

// ============================================================
//  拖拽（阈值判定：区分点击与拖拽）
// ============================================================

let _dragPending = null; // { marker, team, startX, startY, rect }
let _dragActive = false;

function potentialDragStart(e, marker, team) {
  const court = $('court');
  const rect = court.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  _dragPending = {
    marker, team, rect,
    startX: touch.clientX,
    startY: touch.clientY,
  };
  _dragActive = false;
  state.dragMarker = marker;
  state.dragTeam = team;

  // 添加选中效果
  const el = court.querySelector(`.player-marker[data-pos="${marker.pos}"][data-team="${team}"]`);
  if (el) el.classList.add('selected');

  const onMove = (e2) => {
    e2.preventDefault();
    const t = e2.touches ? e2.touches[0] : e2;
    if (!_dragActive && _dragPending) {
      const dx = t.clientX - _dragPending.startX;
      const dy = t.clientY - _dragPending.startY;
      if (Math.sqrt(dx * dx + dy * dy) < 5) return; // 未超过阈值，视为点击
      _dragActive = true;
      // 计算偏移
      _dragPending.rect = court.getBoundingClientRect();
      const r = _dragPending.rect;
      _dragPending.offX = t.clientX - r.left - marker.x * r.width;
      _dragPending.offY = t.clientY - r.top - marker.y * r.height;
    }
    if (!_dragActive) return;
    const r = _dragPending.rect;
    const newX = Math.max(0.04, Math.min(0.96, (t.clientX - r.left - _dragPending.offX) / r.width));
    const newY = Math.max(0.02, Math.min(0.98, (t.clientY - r.top - _dragPending.offY) / r.height));
    const isOur = team === 'our';
    if (isOur) {
      marker.y = Math.max(0.50, Math.min(0.98, newY));
    } else {
      marker.y = Math.max(0.02, Math.min(0.50, newY));
    }
    marker.x = newX;
    updateMarkerPosition(marker, team);

    // 实时更新违规高亮
    const receiveTeam = state.currentSc === 0 ? 'our' : 'opp';
    if (team === receiveTeam) {
      const scene = getCurrentScene();
      if (scene) {
        const allMarks = receiveTeam === 'our' ? scene.ourMarkers : scene.oppMarkers;
        const vp = getViolatedPositions(allMarks, receiveTeam);
        court.querySelectorAll(`.player-marker[data-team="${team}"]`).forEach(el => {
          el.classList.toggle('violated', vp.has(parseInt(el.dataset.pos)));
        });
      }
    }

    renderViolations();
  };

  const onEnd = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    _dragPending = null;
    _dragActive = false;
    state.dragMarker = null;
    state.dragTeam = '';
    // 移除选中效果
    const el = court.querySelector('.player-marker.selected');
    if (el) el.classList.remove('selected');
    renderViolations();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  e.preventDefault();
}

function updateMarkerPosition(marker, team) {
  const court = $('court');
  const markers = court.querySelectorAll('.player-marker');
  markers.forEach(el => {
    if (parseInt(el.dataset.pos) === marker.pos && el.dataset.team === team) {
      el.style.left = `${marker.x * 100}%`;
      el.style.top = `${marker.y * 100}%`;
    }
  });
}

// ============================================================
//  违规检测
// ============================================================

function getViolatedPositions(markers, team) {
  const byPos = {};
  markers.forEach(m => byPos[m.pos] = m);
  const violated = new Set();

  const isOur = team === 'our';

  // 前后排检测
  for (const [front, back, desc] of VERTICAL_PAIRS) {
    if (byPos[front] && byPos[back]) {
      if (isOur) {
        // 我方：前排y应小于后排y（更靠近网=y值小）
        if (byPos[front].y >= byPos[back].y) {
          violated.add(front);
          violated.add(back);
        }
      } else {
        // 对方：前排y应大于后排y（更靠近网=y值大，从对方视角）
        if (byPos[front].y <= byPos[back].y) {
          violated.add(front);
          violated.add(back);
        }
      }
    }
  }

  // 左右关系检测
  for (const [left, right, desc] of HORIZONTAL_PAIRS) {
    if (byPos[left] && byPos[right]) {
      if (isOur) {
        // 我方：x 递增（左<中<右）
        if (byPos[left].x >= byPos[right].x) {
          violated.add(left);
          violated.add(right);
        }
      } else {
        // 对方：左右镜像，x 递减（对方的左在我们右侧）
        if (byPos[left].x <= byPos[right].x) {
          violated.add(left);
          violated.add(right);
        }
      }
    }
  }

  return violated;
}

function checkAllViolations(scene, team) {
  const markers = team === 'our' ? scene.ourMarkers : scene.oppMarkers;
  const byPos = {};
  markers.forEach(m => byPos[m.pos] = m);
  const violations = [];
  const isOur = team === 'our';

  for (const [front, back] of VERTICAL_PAIRS) {
    if (byPos[front] && byPos[back]) {
      let bad = false;
      if (isOur) {
        if (byPos[front].y >= byPos[back].y) bad = true;
      } else {
        if (byPos[front].y <= byPos[back].y) bad = true;
      }
      if (bad) {
        violations.push(`${byPos[front].num}号(${front}号位) 应在 ${byPos[back].num}号(${back}号位) 前方`);
      }
    }
  }
  for (const [left, right] of HORIZONTAL_PAIRS) {
    if (byPos[left] && byPos[right]) {
      let bad = false;
      if (isOur) {
        if (byPos[left].x >= byPos[right].x) bad = true;
      } else {
        if (byPos[left].x <= byPos[right].x) bad = true;
      }
      if (bad) {
        violations.push(`${byPos[left].num}号(${left}号位) 应在 ${byPos[right].num}号(${right}号位) 左侧`);
      }
    }
  }
  return [...new Set(violations)];
}

// ============================================================
//  编辑球员
// ============================================================

function openEditDialog(marker, team) {
  state.editKey = { marker, team };
  $('edit-number').value = marker.num > 0 ? marker.num : '';
  const sel = $('edit-role');
  sel.innerHTML = ROLES.map(r => `<option value="${r}" ${r === marker.role ? 'selected' : ''}>${r}</option>`).join('');
  $('edit-dialog').style.display = 'flex';
  $('edit-number').focus();
}

function cancelEdit() {
  $('edit-dialog').style.display = 'none';
  state.editKey = null;
}

function confirmEdit() {
  if (!state.editKey) return;
  const { marker: editedMarker, team } = state.editKey;
  const newNum = parseInt($('edit-number').value) || 0;
  const newRole = $('edit-role').value;
  const oldNum = editedMarker.num;
  $('edit-dialog').style.display = 'none';
  state.editKey = null;

  // 保存当前轮次的拖拽位置
  const savedPositions = {};
  const curScene = getCurrentScene();
  if (curScene) {
    const allMarkers = [...curScene.ourMarkers, ...curScene.oppMarkers];
    allMarkers.forEach(m => {
      const t = curScene.ourMarkers.includes(m) ? 'our' : 'opp';
      savedPositions[`${m.pos}-${t}`] = { x: m.x, y: m.y };
    });
  }

  // 通过球员号码找到对应的 roster 条目并更新（号码在队内唯一）
  const roster = team === 'our' ? state.ourRoster : state.oppRoster;
  const idx = roster.findIndex(p => p.num === oldNum);
  if (idx >= 0) {
    roster[idx].num = newNum;
    roster[idx].role = newRole;
  }

  // 重新生成所有场景（确保轮转正确）
  generateAllScenarios();

  // 恢复当前轮次的拖拽位置
  const newScene = getCurrentScene();
  if (newScene && savedPositions) {
    const allNew = [...newScene.ourMarkers, ...newScene.oppMarkers];
    allNew.forEach(m => {
      const t = newScene.ourMarkers.includes(m) ? 'our' : 'opp';
      const key = `${m.pos}-${t}`;
      if (savedPositions[key]) {
        m.x = savedPositions[key].x;
        m.y = savedPositions[key].y;
      }
    });
  }

  renderCourt();
  renderViolations();
  saveToStorage();
}

// ============================================================
//  视图控制
// ============================================================

function toggleFilter() {
  state.showOnlyReceive = !state.showOnlyReceive;
  const btn = $('btn-filter');
  const icon = $('filter-icon');
  const text = $('filter-text');
  if (state.showOnlyReceive) {
    icon.textContent = '📋';
    text.textContent = '仅接发';
    // 如果当前在发球场景，切换到接发
    if (state.currentSc !== 0) {
      state.currentSc = 0;
    }
  } else {
    icon.textContent = '📋';
    text.textContent = '全部12轮';
  }
  renderAll();
}

function toggleDisplayMode() {
  state.displayMode = state.displayMode === 'dual' ? 'single' : 'dual';
  const btn = $('btn-display');
  const icon = $('display-icon');
  const text = $('display-text');
  if (state.displayMode === 'dual') {
    icon.textContent = '🔄';
    text.textContent = '双场';
  } else {
    icon.textContent = '🔄';
    text.textContent = '单场';
  }
  renderCourt();
}

// ============================================================
//  工具切换
// ============================================================

function setTool(tool) {
  state.activeTool = tool;
  // 更新按钮状态
  qsa('.tool-btn').forEach(btn => btn.classList.remove('active'));
  const btnMap = { select: 'tool-select', pen: 'tool-pen', eraser: 'tool-eraser' };
  $(btnMap[tool]).classList.add('active');

  // 更新 canvas 指针事件
  const canvas = $('draw-canvas');
  canvas.classList.remove('active', 'eraser');
  if (tool === 'pen') {
    canvas.classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else if (tool === 'eraser') {
    canvas.classList.add('active', 'eraser');
    canvas.style.cursor = 'cell';
  } else {
    canvas.style.cursor = 'default';
  }
}

function setPenColor(color) {
  state.penColor = color;
  qsa('.color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

// ============================================================
//  画布绘制
// ============================================================

function initCanvas() {
  const canvas = $('draw-canvas');
  const rect = $('court').getBoundingClientRect();

  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 存储 ctx 和 dpr 供后续使用
  canvas._ctx = ctx;
  canvas._dpr = dpr;

  // 重绘已有画线
  redrawCanvas();

  // 绑定绘制事件
  canvas.onmousedown = onCanvasDown;
  canvas.onmousemove = onCanvasMove;
  canvas.onmouseup = onCanvasUp;
  canvas.onmouseleave = onCanvasUp;
}

function getCanvasCoords(e) {
  const canvas = $('draw-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

function setupCanvasCtx() {
  const canvas = $('draw-canvas');
  const ctx = canvas._ctx;
  const dpr = canvas._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx, dpr };
}

function onCanvasDown(e) {
  if (state.activeTool === 'select') return;
  const { canvas, ctx, dpr } = setupCanvasCtx();
  const coords = getCanvasCoords(e);
  const rect = canvas.getBoundingClientRect();

  if (state.activeTool === 'pen') {
    state.isDrawing = true;
    state.currentStroke = {
      color: state.penColor,
      width: state.penSize,
      points: [{ x: coords.x, y: coords.y }],
    };
    // 绘制起始点
    ctx.beginPath();
    ctx.arc(coords.x * rect.width, coords.y * rect.height, state.penSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = state.penColor;
    ctx.fill();
  } else if (state.activeTool === 'eraser') {
    eraseStrokeAt(coords.x, coords.y);
  }
}

function onCanvasMove(e) {
  if (state.activeTool === 'pen' && state.isDrawing) {
    const { canvas, ctx, dpr } = setupCanvasCtx();
    const coords = getCanvasCoords(e);
    const rect = canvas.getBoundingClientRect();

    const stroke = state.currentStroke;
    const lastPt = stroke.points[stroke.points.length - 1];

    ctx.beginPath();
    ctx.moveTo(lastPt.x * rect.width, lastPt.y * rect.height);
    ctx.lineTo(coords.x * rect.width, coords.y * rect.height);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    stroke.points.push({ x: coords.x, y: coords.y });
  }
}

function onCanvasUp() {
  if (state.activeTool === 'pen' && state.isDrawing && state.currentStroke) {
    const scene = getCurrentScene();
    if (scene) {
      scene.strokes.push(state.currentStroke);
    }
    state.isDrawing = false;
    state.currentStroke = null;
    saveToStorage();
  }
}

function eraseStrokeAt(rx, ry) {
  const scene = getCurrentScene();
  if (!scene) return;
  const threshold = 0.04;
  let erased = false;
  for (let i = scene.strokes.length - 1; i >= 0; i--) {
    const stroke = scene.strokes[i];
    for (const pt of stroke.points) {
      const dx = pt.x - rx;
      const dy = pt.y - ry;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        scene.strokes.splice(i, 1);
        erased = true;
        break;
      }
    }
  }
  if (erased) {
    const canvas = $('draw-canvas');
    const dpr = canvas._dpr || 1;
    const ctx = canvas._ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    redrawCanvas();
    saveToStorage();
  }
}

function redrawCanvas() {
  const canvas = $('draw-canvas');
  const ctx = canvas._ctx;
  if (!ctx) return;
  const dpr = canvas._dpr || 1;
  const scene = getCurrentScene();
  if (!scene || !scene.strokes) return;
  const rect = canvas.getBoundingClientRect();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (const stroke of scene.strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * rect.width, stroke.points[0].y * rect.height);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * rect.width, stroke.points[i].y * rect.height);
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// ============================================================
//  复位
// ============================================================

function resetCurrent() {
  const scene = getCurrentScene();
  if (!scene) return;

  // 恢复接球方的站位为默认
  const ourCoords = DEFAULT_COORDS.our;
  const oppCoords = DEFAULT_COORDS.opp;

  scene.ourMarkers.forEach(m => {
    const c = ourCoords[m.pos];
    if (c) { m.x = c.x; m.y = c.y; }
  });
  scene.oppMarkers.forEach(m => {
    const c = oppCoords[m.pos];
    if (c) { m.x = c.x; m.y = c.y; }
  });

  // 清除画线
  scene.strokes = [];

  // 重绘
  renderCourt();
  renderViolations();
  saveToStorage();
  showToast('已复位当前轮次');
}

// ============================================================
//  保存 / 加载
// ============================================================

function saveData() {
  saveToStorage();
  showToast('✅ 已保存所有数据');
}

function saveToStorage() {
  try {
    const data = {
      version: DATA_VERSION,
      ourRoster: state.ourRoster,
      oppRoster: state.oppRoster,
      scenarios: state.scenarios,
      currentRot: state.currentRot,
      currentSc: state.currentSc,
      showOnlyReceive: state.showOnlyReceive,
      displayMode: state.displayMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch(e) {
    console.warn('Save failed:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.scenarios || !data.ourRoster || data.version !== DATA_VERSION) return false;

    state.ourRoster = data.ourRoster;
    state.oppRoster = data.oppRoster;
    state.scenarios = data.scenarios;
    state.currentRot = data.currentRot || 0;
    state.currentSc = data.currentSc || 0;
    state.showOnlyReceive = data.showOnlyReceive !== undefined ? data.showOnlyReceive : true;
    state.displayMode = data.displayMode || 'dual';
    return true;
  } catch(e) {
    return false;
  }
}

// ============================================================
//  Toast 提示
// ============================================================

let toastTimer = null;

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

// ============================================================
//  导出图片
// ============================================================

function exportImages() {
  // === 1. 检测所有接发轮次是否有违规 ===
  const violatedRots = [];
  for (let r = 0; r < 6; r++) {
    const scene = getScene(r, 0);
    if (!scene) continue;
    const violations = checkAllViolations(scene, 'our');
    if (violations.length > 0) {
      violatedRots.push(r + 1);
    }
  }
  if (violatedRots.length > 0) {
    showToast(`⚠️ 第 ${violatedRots.join('、')} 轮存在站位违规，请修正后重新导出`);
    return;
  }

  // === 2. 选择导出模式（单场/双场） ===
  const useSingle = !confirm('导出模式：确定=双场（含双方），取消=单场（仅我方）');

  // === 3. 导出 6 个接发轮次为 2×3 PNG ===
  const count = 6;
  const cols = 3;
  const rows = 2;
  const courtW = 260;
  const courtH = useSingle ? courtW : courtW * 2;
  const padding = 30;
  const labelH = 28;

  const imgW = cols * courtW + (cols + 1) * padding;
  const imgH = rows * (courtH + labelH) + (rows + 1) * padding;

  const offCanvas = document.createElement('canvas');
  offCanvas.width = imgW;
  offCanvas.height = imgH;
  const ctx = offCanvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, imgW, imgH);

  let idx = 0;
  for (let r = 0; r < 6; r++) {
    const scene = getScene(r, 0);
    if (!scene) continue;

    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = padding + col * (courtW + padding);
    const oy = padding + row * (courtH + labelH + padding);

    // 标签
    ctx.fillStyle = '#1565C0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ROTATION_LABELS[r]} · 我方接发`, ox + courtW / 2, oy + labelH / 2);

    drawCourtToCanvas(ctx, ox, oy + labelH, courtW, courtH, scene, useSingle);
    idx++;
  }

  const link = document.createElement('a');
  link.download = useSingle ? '轮转研究_接发站位_单场.png' : '轮转研究_接发站位.png';
  link.href = offCanvas.toDataURL('image/png');
  link.click();
  showToast(`📤 图片已导出（${useSingle ? '单场' : '双场'}）`);
}

function drawCourtToCanvas(ctx, ox, oy, w, h, scene, single) {
  if (single) {
    // 单场：只画我方半场（下半部分）
    ctx.fillStyle = '#E8F5E9';
    ctx.fillRect(ox, oy, w, h);
    ctx.strokeStyle = '#1565C0';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, w, h);
    // 球网（顶部）
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + w, oy);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 三米线（距离网 1/3 处）
    ctx.beginPath();
    ctx.moveTo(ox + w * 0.06, oy + h / 3);
    ctx.lineTo(ox + w * 0.94, oy + h / 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 我方标签
    ctx.fillStyle = '#1565C0';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('我方', ox + w - 4, oy + h - 2);
    // 球员（仅我方）
    const r = 16;
    for (const m of scene.ourMarkers) {
      const cx = ox + m.x * w;
      const cy = oy + (m.y - 0.5) * 2 * h; // 将全场的 y(0.5-1.0) 映射到单场 y(0-1)
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(33,150,243,0.12)';
      ctx.fill();
      ctx.strokeStyle = '#1565C0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#1565C0';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.num > 0 ? m.num.toString() : '?', cx, cy - 3);
      ctx.font = '8px sans-serif';
      ctx.fillText(m.role, cx, cy + 10);
    }
    // 画线
    if (scene.strokes) {
      for (const stroke of scene.strokes) {
        if (stroke.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(ox + stroke.points[0].x * w, oy + (stroke.points[0].y - 0.5) * 2 * h);
        for (let i = 1; i < stroke.points.length; i++) {
          const pt = stroke.points[i];
          ctx.lineTo(ox + pt.x * w, oy + (pt.y - 0.5) * 2 * h);
        }
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    return;
  }

  // 双场：画整个球场
  // 画球场背景
  ctx.fillStyle = '#FFF8E1';
  ctx.fillRect(ox, oy, w, h / 2); // 对方半场
  ctx.fillStyle = '#E8F5E9';
  ctx.fillRect(ox, oy + h / 2, w, h / 2); // 我方半场

  // 球场边框
  ctx.strokeStyle = '#1565C0';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, w, h);

  // 球网
  ctx.beginPath();
  ctx.moveTo(ox, oy + h / 2);
  ctx.lineTo(ox + w, oy + h / 2);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();

  // 三米线
  ctx.beginPath();
  ctx.moveTo(ox + w * 0.06, oy + h / 2 - h * 0.167);
  ctx.lineTo(ox + w * 0.94, oy + h / 2 - h * 0.167);
  ctx.moveTo(ox + w * 0.06, oy + h / 2 + h * 0.167);
  ctx.lineTo(ox + w * 0.94, oy + h / 2 + h * 0.167);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 标签
  ctx.fillStyle = '#C62828';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('对方', ox + w - 4, oy + 4);

  ctx.fillStyle = '#1565C0';
  ctx.fillText('我方', ox + w - 4, oy + h / 2 + 4);

  // 画球员
  const r = 16; // 球员圈半径
  const bothTeams = [...scene.ourMarkers, ...scene.oppMarkers];
  for (const m of bothTeams) {
    const cx = ox + m.x * w;
    const cy = oy + m.y * h;

    // 圆圈
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const isOur = scene.ourMarkers.includes(m);
    ctx.fillStyle = isOur ? 'rgba(33,150,243,0.12)' : 'rgba(239,83,80,0.10)';
    ctx.fill();
    ctx.strokeStyle = isOur ? '#1565C0' : '#C62828';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 号码和角色
    ctx.fillStyle = isOur ? '#1565C0' : '#C62828';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const numText = m.num > 0 ? m.num.toString() : '?';
    ctx.fillText(numText, cx, cy - 3);
    ctx.font = '8px sans-serif';
    ctx.fillText(m.role, cx, cy + 10);
  }

  // 画线（跑位轨迹）
  if (scene.strokes) {
    for (const stroke of scene.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      const p0 = stroke.points[0];
      ctx.moveTo(ox + p0.x * w, oy + p0.y * h);
      for (let i = 1; i < stroke.points.length; i++) {
        const pt = stroke.points[i];
        ctx.lineTo(ox + pt.x * w, oy + pt.y * h);
      }
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}

// ============================================================
//  帮助弹窗
// ============================================================

function showHelp() {
  $('help-dialog').style.display = 'flex';
}

function closeHelp() {
  $('help-dialog').style.display = 'none';
}

// ============================================================
//  窗口事件
// ============================================================

window.addEventListener('resize', () => {
  if (state.ourRoster.length > 0) {
    initCanvas();
  }
});

// ============================================================
//  启动
// ============================================================

document.addEventListener('DOMContentLoaded', initApp);
