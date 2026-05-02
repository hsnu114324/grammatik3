const COLS = 8;
const ROWS = 11;
const DEFAULT_LEVEL_SIZE = 6;
const MIN_ROW_TOKENS = 5;
const MAX_ROW_TOKENS = 6;
const SHOT_SPEED = 760;
const TURN_STEP = Math.PI / 18;
const SETTINGS_DATASET_KEY = "german_bubble_dataset_v1";
const SETTINGS_LEVEL_SIZE_KEY = "german_bubble_level_size_v1";
const SETTINGS_PICK_COUNT_KEY = "german_bubble_pick_count_v1";
const SETTINGS_CATS_KEY = "german_bubble_cats_v1";
const COLORS = [
  "#ff7a7a",
  "#ffbe5c",
  "#7ed957",
  "#45d0e6",
  "#7ea6ff",
  "#c58bff",
  "#ff89d5",
  "#7bdcb5",
];

const FALLBACK_ROWS = [
  "陽性 der,der -e,des -en -s,dem -en,den -en",
  "陽性 ein,ein -er,eines -en -s,einem -en,einen -en",
  "中性 das,das -e,des -en -s,dem -en,das -e",
  "陰性 die,die -e,der -en,der -en,die -e",
  "複數 die,die -en,der -en,den -en n,die -en",
  "複數 keine,keine -en,keiner -en,keinen -en n,keine -en",
];

const GROUP_LABELS = [
  "群組 1：常用短句",
  "群組 2：動詞變化",
  "群組 3：所有格變化",
  "群組 4：冠詞格變化",
  "群組 5：形容詞字尾",
];

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const groupSelect = document.getElementById("groupSelect");
const levelSizeSelect = document.getElementById("levelSizeSelect");
const restartBtn = document.getElementById("restartBtn");
const leftBtn = document.getElementById("leftBtn");
const fireBtn = document.getElementById("fireBtn");
const rightBtn = document.getElementById("rightBtn");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const progressEl = document.getElementById("progress");
const rowCountEl = document.getElementById("rowCount");
const targetsEl = document.getElementById("targets");
const nextBubbleEl = document.getElementById("nextBubble");
const messageEl = document.getElementById("message");

let dataSets = [];
let board = createEmptyBoard();
let targets = [];
let shotQueue = [];
let activeBubble = null;
let movingShot = null;
let score = 0;
let level = 1;
let levelSize = DEFAULT_LEVEL_SIZE;
let selectedSetIndex = 0;
let aimAngle = -Math.PI / 2;
let lastFrame = performance.now();
let levelChanging = false;

let viewWidth = 640;
let viewHeight = 720;
let dpr = 1;
let radius = 30;
let rowStep = 52;
let topY = 44;
let gridLeft = 24;
let shooter = { x: 320, y: 660 };

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function parseRows(rows) {
  return rows
    .map((row, sourceIndex) => {
      const tokens = String(row)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (tokens.length < 2 || tokens.length > 6) return null;
      return {
        row: String(row),
        sourceIndex,
        tokens,
        key: normalizeTokens(tokens),
      };
    })
    .filter(Boolean);
}

function normalizeText(text) {
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTokens(tokens) {
  return tokens.map(normalizeText).join("|");
}

// ── Settings integration ──

let activeGroupIds = new Set();
let activeCatIds = null;
let pickCount = 0;

async function loadWordData() {
  try {
    const res = await fetch("./data/words.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const groups = Array.isArray(data.groups) ? data.groups : [];
    dataSets = groups.map((rows, index) => ({
      id: `group-${index}`,
      label: GROUP_LABELS[index] || `群組 ${index + 1}`,
      rows: parseRows(rows),
    }));
    if (groups.length >= 5) {
      dataSets.push({
        id: "combined-cases-190-261",
        label: "格變化總練習（所有格+冠詞+形容詞）",
        rows: parseRows([...groups[2], ...groups[3], ...groups[4]]),
      });
    }
    if (Array.isArray(data.vocabulary)) {
      dataSets.push({ id: "vocabulary", label: "字彙表：中文 / 德文", rows: parseRows(data.vocabulary) });
    }
    dataSets = dataSets.filter((set) => set.rows.length > 0);
  } catch (error) {
    console.warn("載入 data/words.json 失敗，使用內建範例。", error);
    setMessage("無法讀取 data/words.json，已改用內建範例。若要讀正式資料，請用本機靜態伺服器開啟。");
    dataSets = [{ id: "fallback", label: "內建範例：形容詞字尾", rows: parseRows(FALLBACK_ROWS) }];
  }

  if (dataSets.length === 0) {
    dataSets = [{ id: "fallback", label: "內建範例：形容詞字尾", rows: parseRows(FALLBACK_ROWS) }];
  }

  loadSavedSettings();
  populateGroupSelect();
  levelSizeSelect.value = String(levelSize);
  resetGame();
}

function loadSavedSettings() {
  try {
    const savedGroups = localStorage.getItem(SETTINGS_DATASET_KEY);
    if (savedGroups) {
      const ids = JSON.parse(savedGroups);
      if (Array.isArray(ids)) {
        activeGroupIds = new Set(ids.filter((id) => dataSets.some((set) => set.id === id)));
      }
    }
  } catch {}
  if (activeGroupIds.size === 0) {
    const combined = dataSets.find((set) => set.id === "combined-cases-190-261");
    activeGroupIds = new Set([combined ? combined.id : dataSets[0]?.id].filter(Boolean));
  }

  try {
    const savedCats = localStorage.getItem(SETTINGS_CATS_KEY);
    if (savedCats) {
      const catIds = JSON.parse(savedCats);
      if (Array.isArray(catIds) && catIds.length > 0) activeCatIds = new Set(catIds);
    }
  } catch {}

  const savedLevelSize = localStorage.getItem(SETTINGS_LEVEL_SIZE_KEY);
  const levelOptions = [...levelSizeSelect.options].map((opt) => opt.value);
  levelSize = Number(levelOptions.includes(savedLevelSize) ? savedLevelSize : DEFAULT_LEVEL_SIZE);

  const savedPick = localStorage.getItem(SETTINGS_PICK_COUNT_KEY);
  pickCount = savedPick ? Number(savedPick) : 0;

  selectedSetIndex = Math.max(0, dataSets.findIndex((set) => activeGroupIds.has(set.id)));
}

function populateGroupSelect() {
  groupSelect.innerHTML = "";
  dataSets.forEach((set, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${set.label}（${set.rows.length} 列）`;
    groupSelect.append(option);
  });
  groupSelect.value = String(selectedSetIndex);
}

function saveCurrentSettings() {
  try {
    activeGroupIds = new Set([dataSets[Number(groupSelect.value || 0)]?.id].filter(Boolean));
    if (activeGroupIds.size > 0) localStorage.setItem(SETTINGS_DATASET_KEY, JSON.stringify([...activeGroupIds]));
    localStorage.setItem(SETTINGS_LEVEL_SIZE_KEY, String(levelSizeSelect.value || DEFAULT_LEVEL_SIZE));
  } catch {}
}

// ── Game flow ──

function resetGame() {
  selectedSetIndex = Number(groupSelect.value || 0);
  activeGroupIds = new Set([dataSets[selectedSetIndex]?.id].filter(Boolean));
  levelSize = Number(levelSizeSelect.value || DEFAULT_LEVEL_SIZE);
  saveCurrentSettings();
  score = 0;
  level = 1;
  levelChanging = false;
  startLevel();
}

function startLevel() {
  board = createEmptyBoard();
  targets = buildLevelTargets();
  shotQueue = [];
  movingShot = null;
  aimAngle = -Math.PI / 2;
  levelChanging = false;
  seedBoard();
  refillShotQueue();
  activeBubble = nextBubbleFromQueue();
  setMessage("同組 5~6 顆連在一起就會消除，輔助線可幫助瞄準反彈路徑。", true);
  updateHud();
  draw();
}

function buildLevelTargets() {
  const rows = getPlayableRows();
  const shuffled = shuffle(rows.slice());
  const chosen = shuffled.slice(0, Math.min(levelSize, shuffled.length));
  return chosen.map((item, index) => {
    const missingIndex = Math.floor(Math.random() * item.tokens.length);
    return {
      ...item,
      id: `${level}-${item.sourceIndex}-${index}-${Math.random().toString(36).slice(2)}`,
      color: COLORS[index % COLORS.length],
      missingIndex,
      missingToken: item.tokens[missingIndex],
      cleared: false,
      dropped: false,
    };
  });
}

function getPlayableRows() {
  let rows = [];
  dataSets.forEach((set) => {
    if (activeGroupIds.has(set.id)) rows.push(...set.rows);
  });
  if (rows.length === 0) {
    rows = dataSets[selectedSetIndex]?.rows || [];
  }

  if (activeCatIds) {
    rows = rows.filter((item) => {
      const cat = getRowCategory(item.row);
      return !cat || activeCatIds.has(cat);
    });
  }

  const playable = rows.filter(isPlayableRow);
  if (playable.length > 0) {
    if (pickCount > 0 && pickCount < playable.length) {
      return shuffle(playable.slice()).slice(0, pickCount);
    }
    return playable;
  }

  const allPlayable = dataSets.flatMap((set) => set.rows.filter(isPlayableRow));
  if (allPlayable.length > 0) return allPlayable;
  return parseRows(FALLBACK_ROWS).filter(isPlayableRow);
}

function getRowCategory(row) {
  const first = row.split(",")[0].trim();
  if (first.startsWith("陽性")) return "masculine";
  if (first.startsWith("中性")) return "neuter";
  if (first.startsWith("陰性")) return "feminine";
  if (first.startsWith("複數")) return "plural";
  if (first.startsWith("der ")) return "masculine";
  if (first.startsWith("das ")) return "neuter";
  if (first.startsWith("die ")) return "feminine";
  if (first.startsWith("pl.")) return "plural";
  return null;
}

function isPlayableRow(row) {
  return row.tokens.length >= MIN_ROW_TOKENS && row.tokens.length <= MAX_ROW_TOKENS;
}

function seedBoard() {
  targets.forEach((target, index) => {
    const row = index % ROWS;
    const startCol = Math.floor((COLS - target.tokens.length) / 2);
    target.tokens.forEach((text, tokenIndex) => {
      if (tokenIndex === target.missingIndex) return;
      board[row][startCol + tokenIndex] = makeBubble(text, target, tokenIndex);
    });
  });
}

function makeBubble(text, target, tokenIndex) {
  return {
    text,
    targetId: target.id,
    tokenIndex,
    color: target.color,
  };
}

function refillShotQueue() {
  const remaining = targets
    .filter((target) => !target.cleared)
    .flatMap((target) => {
      const missingPieces = getMissingPiecesForTarget(target);
      return missingPieces.map((piece) => makeBubble(piece.text, target, piece.tokenIndex));
    });
  shotQueue = shuffle(remaining);
}

function getMissingPiecesForTarget(target) {
  const components = collectTargetComponents(target.id);
  if (components.length === 0) {
    return target.tokens.map((text, tokenIndex) => ({ text, tokenIndex }));
  }
  const best = components.reduce((bestComponent, component) => {
    if (!bestComponent) return component;
    if (component.tokenIndexes.size !== bestComponent.tokenIndexes.size) {
      return component.tokenIndexes.size > bestComponent.tokenIndexes.size ? component : bestComponent;
    }
    return component.cells.length > bestComponent.cells.length ? component : bestComponent;
  }, null);
  return target.tokens
    .map((text, tokenIndex) => ({ text, tokenIndex }))
    .filter((piece) => !best.tokenIndexes.has(piece.tokenIndex));
}

function collectTargetComponents(targetId) {
  const visited = new Set();
  const components = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const key = `${row},${col}`;
      if (visited.has(key)) continue;
      const bubble = board[row][col];
      if (!bubble || bubble.targetId !== targetId) continue;
      const component = { cells: [], tokenIndexes: new Set() };
      const queue = [{ row, col }];
      visited.add(key);
      while (queue.length > 0) {
        const cell = queue.shift();
        const cellBubble = board[cell.row][cell.col];
        component.cells.push(cell);
        if (cellBubble.tokenIndex !== undefined) component.tokenIndexes.add(cellBubble.tokenIndex);
        for (const next of neighbors(cell.row, cell.col)) {
          const nextKey = `${next.row},${next.col}`;
          if (visited.has(nextKey)) continue;
          const nextBubble = board[next.row][next.col];
          if (!nextBubble || nextBubble.targetId !== targetId) continue;
          visited.add(nextKey);
          queue.push(next);
        }
      }
      components.push(component);
    }
  }
  return components;
}

function nextBubbleFromQueue() {
  if (shotQueue.length === 0) {
    refillShotQueue();
    if (shotQueue.length === 0) return null;
  }
  return shotQueue.shift();
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ── Canvas sizing ──

function resizeCanvas() {
  const container = canvas.parentElement;
  const maxW = Math.min(container.clientWidth - 28, 760);
  const scale = maxW / 640;
  dpr = window.devicePixelRatio || 1;
  viewWidth = Math.round(640 * scale);
  viewHeight = Math.round(720 * scale);
  canvas.width = viewWidth * dpr;
  canvas.height = viewHeight * dpr;
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  radius = Math.round(30 * scale);
  rowStep = Math.round(52 * scale);
  topY = Math.round(44 * scale);
  gridLeft = Math.round(24 * scale);
  shooter.x = viewWidth / 2;
  shooter.y = viewHeight - Math.round(60 * scale);
  draw();
}

function cellCenter(row, col) {
  const offset = row % 2 === 1 ? radius : 0;
  return {
    x: gridLeft + col * radius * 2 + radius + offset,
    y: topY + row * rowStep + radius,
  };
}

function inBounds(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function isCellEmpty(row, col) {
  return inBounds(row, col) && !board[row][col];
}

function neighbors(row, col) {
  const even = row % 2 === 0;
  const offsets = even
    ? [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]]
    : [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
  return offsets
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter((n) => inBounds(n.row, n.col));
}

function nearestEmptyCell(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!isCellEmpty(row, col)) continue;
      const center = cellCenter(row, col);
      const dist = Math.hypot(center.x - x, center.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { row, col };
      }
    }
  }
  return best;
}

function nearestEmptyNeighbor(cell, px, py) {
  const candidates = neighbors(cell.row, cell.col).filter((n) => isCellEmpty(n.row, n.col));
  if (candidates.length === 0) return nearestEmptyCell(px, py);
  let best = null;
  let bestDist = Infinity;
  for (const n of candidates) {
    const center = cellCenter(n.row, n.col);
    const dist = Math.hypot(center.x - px, center.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  return best;
}

// ── Shooting ──

function fireBubble() {
  if (!activeBubble || movingShot || levelChanging) return;
  movingShot = {
    ...activeBubble,
    x: shooter.x,
    y: shooter.y - radius * 1.25,
    vx: Math.cos(aimAngle) * SHOT_SPEED,
    vy: Math.sin(aimAngle) * SHOT_SPEED,
  };
  activeBubble = null;
}

function rotateAim(delta) {
  aimAngle = clampAim(aimAngle + delta);
}

function clampAim(angle) {
  const min = -Math.PI + 0.15;
  const max = -0.15;
  return Math.max(min, Math.min(max, angle));
}

function aimAt(x, y) {
  const dx = x - shooter.x;
  const dy = y - (shooter.y - radius * 1.25);
  if (dy >= -5) return;
  aimAngle = clampAim(Math.atan2(dy, dx));
}

function updateShot(dt) {
  if (!movingShot) return;
  movingShot.x += movingShot.vx * dt;
  movingShot.y += movingShot.vy * dt;

  if (movingShot.x <= radius || movingShot.x >= viewWidth - radius) {
    movingShot.x = Math.max(radius, Math.min(viewWidth - radius, movingShot.x));
    movingShot.vx *= -1;
  }

  if (movingShot.y <= topY - radius * 0.5) {
    snapShot(nearestEmptyCell(movingShot.x, movingShot.y));
    return;
  }

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const hitBubble = board[row][col];
      if (!hitBubble) continue;
      const center = cellCenter(row, col);
      if (Math.hypot(center.x - movingShot.x, center.y - movingShot.y) <= radius * 1.95) {
        snapShot(nearestEmptyNeighbor({ row, col }, movingShot.x, movingShot.y));
        return;
      }
    }
  }

  if (movingShot.y > viewHeight + radius) {
    movingShot = null;
    activeBubble = nextBubbleFromQueue();
    setMessage("泡泡飛出界外，換下一顆。");
    updateHud();
  }
}

function snapShot(cell) {
  if (!movingShot) return;
  if (!cell) {
    endGame("盤面已滿，請重新開始。");
    return;
  }
  const placed = {
    text: movingShot.text,
    targetId: movingShot.targetId,
    tokenIndex: movingShot.tokenIndex,
    color: movingShot.color,
  };
  board[cell.row][cell.col] = placed;
  movingShot = null;
  resolvePlacement(cell.row, cell.col);
  activeBubble = nextBubbleFromQueue();
  updateHud();
}

function resolvePlacement(row, col) {
  const bubble = board[row][col];
  if (!bubble) return;
  const target = targets.find((item) => item.id === bubble.targetId);
  let clearedCount = 0;
  if (target && !target.cleared) {
    const component = collectSameTargetComponent(row, col, target.id);
    if (componentContainsTarget(component, target)) {
      component.forEach((cell) => {
        board[cell.row][cell.col] = null;
      });
      target.cleared = true;
      clearedCount = component.length;
      score += target.tokens.length * 120 + component.length * 20;
    }
  }

  const dropResult = dropFloatingBubbles();
  const dropped = dropResult.count;
  const droppedGroups = dropResult.clearedTargets.length;
  if (dropped > 0) score += dropped * 15 + droppedGroups * 80;

  if (clearedCount > 0) {
    const text = dropped > 0
      ? `完成「${target.tokens.join(" / ")}」，消除 ${clearedCount} 顆，${dropped} 顆失去支撐掉落${droppedGroups > 0 ? `，${droppedGroups} 組完成` : ""}。`
      : `完成「${target.tokens.join(" / ")}」，相連泡泡消除。`;
    setMessage(text, true);
  } else if (dropped > 0) {
    setMessage(`${dropped} 顆失去支撐掉落${droppedGroups > 0 ? `，${droppedGroups} 組完成` : ""}。`);
  }

  refillShotQueue();

  if (targets.every((t) => t.cleared)) {
    score += 500;
    level += 1;
    levelChanging = true;
    setMessage(`關卡完成！+500 分，進入第 ${level} 關…`, true);
    setTimeout(startLevel, 1200);
  }
}

function collectSameTargetComponent(startRow, startCol, targetId) {
  const visited = new Set();
  const component = [];
  const queue = [{ row: startRow, col: startCol }];
  visited.add(`${startRow},${startCol}`);
  while (queue.length > 0) {
    const cell = queue.shift();
    const bubble = board[cell.row][cell.col];
    if (!bubble || bubble.targetId !== targetId) continue;
    component.push(cell);
    for (const next of neighbors(cell.row, cell.col)) {
      const key = `${next.row},${next.col}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return component;
}

function componentContainsTarget(component, target) {
  const tokenIndexes = new Set(component.map((cell) => board[cell.row][cell.col]?.tokenIndex).filter((i) => i !== undefined));
  return target.tokens.every((_, index) => tokenIndexes.has(index));
}

function dropFloatingBubbles(protectedTargetId = null) {
  const anchored = new Set();
  const queue = [];
  const droppedTargetIds = new Set();
  for (let col = 0; col < COLS; col++) {
    if (board[0][col]) {
      const key = `0,${col}`;
      anchored.add(key);
      queue.push({ row: 0, col });
    }
  }
  while (queue.length > 0) {
    const cell = queue.shift();
    for (const next of neighbors(cell.row, cell.col)) {
      const key = `${next.row},${next.col}`;
      if (anchored.has(key) || !board[next.row][next.col]) continue;
      anchored.add(key);
      queue.push(next);
    }
  }
  let dropped = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!board[row][col]) continue;
      if (!anchored.has(`${row},${col}`)) {
        if (board[row][col].targetId) droppedTargetIds.add(board[row][col].targetId);
        board[row][col] = null;
        dropped += 1;
      }
    }
  }
  const clearedTargets = markFullyDroppedTargets(droppedTargetIds, protectedTargetId);
  return { count: dropped, clearedTargets };
}

function markFullyDroppedTargets(droppedTargetIds, protectedTargetId) {
  const cleared = [];
  for (const targetId of droppedTargetIds) {
    if (targetId === protectedTargetId) continue;
    const target = targets.find((t) => t.id === targetId);
    if (!target || target.cleared) continue;
    const remaining = countTargetBubblesOnBoard(targetId);
    if (remaining === 0) {
      target.cleared = true;
      cleared.push(target);
    }
  }
  return cleared;
}

function countTargetBubblesOnBoard(targetId) {
  let count = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (board[row][col]?.targetId === targetId) count++;
    }
  }
  return count;
}

function endGame(text) {
  movingShot = null;
  activeBubble = null;
  setMessage(text);
  updateHud();
}

// ── HUD ──

function updateHud() {
  const cleared = targets.filter((t) => t.cleared).length;
  scoreEl.textContent = String(score);
  levelEl.textContent = String(level);
  progressEl.textContent = `${cleared}/${targets.length}`;
  rowCountEl.textContent = `${targets.length} 列`;
  nextBubbleEl.textContent = activeBubble
    ? activeBubble.text
    : "完成";
  renderTargets();
}

function renderTargets() {
  targetsEl.innerHTML = "";
  targets.forEach((target) => {
    const item = document.createElement("div");
    item.className = `target-row${target.cleared ? " cleared" : ""}`;
    item.style.setProperty("--target-color", target.color);
    const title = document.createElement("div");
    title.className = "target-title";
    title.textContent = target.cleared ? "已消除" : "未消除";
    item.append(title);
    const chips = document.createElement("div");
    chips.className = "chips";
    target.tokens.forEach((token, index) => {
      const chip = document.createElement("span");
      chip.className = index === target.missingIndex && !target.cleared ? "chip missing" : "chip";
      chip.textContent = token;
      chips.append(chip);
    });
    item.append(chips);
    targetsEl.append(item);
  });
}

function setMessage(text, ok = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", ok);
}

// ── Drawing ──

function draw() {
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  drawBackground();
  drawBoardBubbles();
  drawAim();
  if (movingShot) drawBubble(movingShot.x, movingShot.y, movingShot);
  drawShooter();
}

function drawBackground() {
  ctx.fillStyle = "#091025";
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  ctx.strokeStyle = "rgba(126, 166, 255, 0.07)";
  ctx.lineWidth = 1;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const center = cellCenter(row, col);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius * 0.92, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawBoardBubbles() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const bubble = board[row][col];
      if (!bubble) continue;
      const center = cellCenter(row, col);
      drawBubble(center.x, center.y, bubble);
    }
  }
}

function drawAim() {
  if (!activeBubble || movingShot || levelChanging) return;
  drawAimAssistGuide();
}

function drawAimAssistGuide() {
  const points = predictAimPath();
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 209, 102, 0.9)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 209, 102, 0.45)";
  ctx.beginPath();
  ctx.arc(last.x, last.y, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function predictAimPath() {
  const maxBounces = 4;
  const step = 6;
  const maxSteps = 600;
  let x = shooter.x;
  let y = shooter.y - radius * 1.25;
  let vx = Math.cos(aimAngle);
  let vy = Math.sin(aimAngle);
  const points = [{ x, y }];

  for (let s = 0; s < maxSteps; s++) {
    x += vx * step;
    y += vy * step;
    if (x <= radius || x >= viewWidth - radius) {
      x = Math.max(radius, Math.min(viewWidth - radius, x));
      vx *= -1;
      points.push({ x, y });
    }
    if (y <= topY) {
      points.push({ x, y });
      break;
    }
    if (aimPathHitsBubble(x, y)) {
      points.push({ x, y });
      break;
    }
  }
  if (points.length === 1) points.push({ x, y });
  return points;
}

function aimPathHitsBubble(x, y) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!board[row][col]) continue;
      const center = cellCenter(row, col);
      if (Math.hypot(center.x - x, center.y - y) <= radius * 1.85) return true;
    }
  }
  return false;
}

function drawShooter() {
  ctx.save();
  ctx.fillStyle = "#24306a";
  ctx.strokeStyle = "#7ea6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(shooter.x, shooter.y, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (activeBubble) {
    drawBubble(shooter.x, shooter.y - radius * 1.25, { ...activeBubble, color: "#e8ecf8" });
  }
  ctx.restore();
}

function drawBubble(x, y, bubble) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = bubble.color;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = shadeColor(bubble.color, -28);
  ctx.lineWidth = 2;
  ctx.stroke();
  drawBubbleText(x, y, bubble.text);
  ctx.restore();
}

function drawBubbleText(x, y, text) {
  const maxWidth = radius * 1.58;
  const fontSize = Math.max(12, Math.floor(radius * 0.42));
  ctx.fillStyle = "#101426";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

  const visible = wrapBubbleText(text, maxWidth, 3);
  const lineHeight = fontSize * 0.98;
  const startY = y - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((part, index) => {
    ctx.fillText(part, x, startY + index * lineHeight, maxWidth);
  });
}

function wrapBubbleText(text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const measured = ctx.measureText(test).width;
    if (measured <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = fitWithEllipsis(trimmed[maxLines - 1], maxWidth);
    return trimmed;
  }
  return lines;
}

function fitWithEllipsis(text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + "…";
}

function shadeColor(hex, percent) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, r + Math.round(r * percent / 100)));
  g = Math.max(0, Math.min(255, g + Math.round(g * percent / 100)));
  b = Math.max(0, Math.min(255, b + Math.round(b * percent / 100)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Game loop ──

function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  updateShot(dt);
  draw();
  requestAnimationFrame(loop);
}

// ── Events ──

restartBtn.addEventListener("click", resetGame);
groupSelect.addEventListener("change", resetGame);
levelSizeSelect.addEventListener("change", resetGame);
leftBtn.addEventListener("click", () => rotateAim(-TURN_STEP));
rightBtn.addEventListener("click", () => rotateAim(TURN_STEP));
fireBtn.addEventListener("click", fireBubble);

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  aimAt(
    (event.clientX - rect.left) * (viewWidth / rect.width),
    (event.clientY - rect.top) * (viewHeight / rect.height)
  );
});

canvas.addEventListener("pointermove", (event) => {
  if (event.buttons === 0) return;
  const rect = canvas.getBoundingClientRect();
  aimAt(
    (event.clientX - rect.left) * (viewWidth / rect.width),
    (event.clientY - rect.top) * (viewHeight / rect.height)
  );
});

canvas.addEventListener("pointerup", () => {
  fireBubble();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") {
    event.preventDefault();
    rotateAim(-TURN_STEP);
  } else if (key === "arrowright" || key === "d") {
    event.preventDefault();
    rotateAim(TURN_STEP);
  } else if (key === " " || key === "enter" || key === "w" || key === "s") {
    event.preventDefault();
    fireBubble();
  }
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
loadWordData();
requestAnimationFrame(loop);
