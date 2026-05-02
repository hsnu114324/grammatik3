(() => {
  "use strict";

  const Shared = window.GermanBubbleShared;

  const BOARD = Object.freeze({ cols: 8, rows: 11 });
  const SHOT_SPEED = 760;
  const TURN_STEP = Math.PI / 90;
  const COLORS = Object.freeze([
    "#ff7a7a",
    "#ffbe5c",
    "#7ed957",
    "#45d0e6",
    "#7ea6ff",
    "#c58bff",
    "#ff89d5",
    "#7bdcb5",
  ]);

  const elements = {
    canvas: document.getElementById("board"),
    restartBtn: document.getElementById("restartBtn"),
    leftBtn: document.getElementById("leftBtn"),
    fireBtn: document.getElementById("fireBtn"),
    rightBtn: document.getElementById("rightBtn"),
    score: document.getElementById("score"),
    level: document.getElementById("level"),
    progress: document.getElementById("progress"),
    rowCount: document.getElementById("rowCount"),
    targets: document.getElementById("targets"),
    nextBubble: document.getElementById("nextBubble"),
    message: document.getElementById("message"),
  };

  const ctx = elements.canvas.getContext("2d");

  const state = {
    dataSets: [],
    settings: null,
    boardCols: BOARD.cols,
    board: createEmptyBoard(),
    targets: [],
    shotQueue: [],
    activeBubble: null,
    movingShot: null,
    score: 0,
    level: 1,
    aimAngle: -Math.PI / 2,
    levelChanging: false,
    levelTimer: null,
    pointerDragging: false,
    lastFrame: performance.now(),
  };

  const view = {
    width: 640,
    height: 720,
    dpr: 1,
    radius: 30,
    rowStep: 52,
    topY: 44,
    gridLeft: 24,
    shooter: { x: 320, y: 660 },
  };

  async function init() {
    bindEvents();
    resizeCanvas();
    await loadData();
    requestAnimationFrame(loop);
  }

  async function loadData() {
    const cachedData = Shared.loadWordDataCache();
    if (cachedData) {
      state.dataSets = Shared.buildDataSets(cachedData);
      resetGame();
      return;
    }

    try {
      const rawData = await Shared.fetchWordData();
      state.dataSets = Shared.buildDataSets(rawData);
    } catch (error) {
      console.warn("載入 data/words.json 失敗，使用內建範例。", error);
      state.dataSets = Shared.buildPlayableFallbackDataSet();
      setMessage("無法讀取 data/words.json，也沒有題庫快取，已改用內建範例。請先到設定頁載入 JSON。");
    }

    if (state.dataSets.length === 0) {
      state.dataSets = Shared.buildPlayableFallbackDataSet();
    }

    resetGame();
  }

  function createEmptyBoard(cols = BOARD.cols) {
    return Array.from({ length: BOARD.rows }, () => Array(cols).fill(null));
  }

  function loadCurrentSettings() {
    state.settings = Shared.loadSettings(state.dataSets);
  }

  function resetGame() {
    cancelPendingLevelChange();
    loadCurrentSettings();
    state.score = 0;
    state.level = 1;
    state.levelChanging = false;
    startLevel();
  }

  function cancelPendingLevelChange() {
    if (state.levelTimer) {
      clearTimeout(state.levelTimer);
      state.levelTimer = null;
    }
  }

  function startLevel() {
    cancelPendingLevelChange();
    state.targets = buildLevelTargets();
    state.boardCols = getBoardColsForTargets(state.targets);
    state.board = createEmptyBoard(state.boardCols);
    state.shotQueue = [];
    state.activeBubble = null;
    state.movingShot = null;
    state.aimAngle = -Math.PI / 2;
    state.levelChanging = false;

    if (state.targets.length === 0) {
      updateHud();
      setMessage("目前設定沒有可用題目，請到設定頁改選題庫或取消分類篩選。");
      draw();
      return;
    }

    seedBoard();
    refillShotQueue();
    state.activeBubble = nextBubbleFromQueue();
    resizeCanvas();
    setMessage("同組泡泡全部連在一起就會消除，輔助線可幫助瞄準反彈路徑。", true);
    updateHud();
    draw();
  }

  function buildLevelTargets() {
    const playableRows = Shared.getPlayableRows(state.dataSets, state.settings);
    const shuffled = Shared.shuffle(playableRows.slice());
    const chosen = shuffled.slice(0, Math.min(state.settings.levelSize, shuffled.length));

    return chosen.map((item, index) => {
      const missingIndex = Math.floor(Math.random() * item.tokens.length);
      return {
        ...item,
        id: `${state.level}-${item.sourceIndex}-${index}-${Math.random().toString(36).slice(2)}`,
        color: COLORS[index % COLORS.length],
        missingIndex,
        missingToken: item.tokens[missingIndex],
        cleared: false,
      };
    });
  }

  function getBoardColsForTargets(targets) {
    const maxTargetLength = targets.reduce((max, target) => Math.max(max, target.tokens.length), 0);
    return Math.max(BOARD.cols, maxTargetLength);
  }

  function seedBoard() {
    state.targets.forEach((target, index) => {
      const row = index % BOARD.rows;
      const startCol = Math.floor((state.boardCols - target.tokens.length) / 2);
      target.tokens.forEach((text, tokenIndex) => {
        if (tokenIndex === target.missingIndex) return;
        state.board[row][startCol + tokenIndex] = makeBubble(text, target, tokenIndex);
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
    const remaining = state.targets
      .filter((target) => !target.cleared)
      .flatMap((target) => {
        const missingPieces = getMissingPiecesForTarget(target);
        return missingPieces.map((piece) => makeBubble(piece.text, target, piece.tokenIndex));
      });
    state.shotQueue = Shared.shuffle(remaining);
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

    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        const key = cellKey(row, col);
        const bubble = state.board[row][col];
        if (visited.has(key) || !bubble || bubble.targetId !== targetId) continue;

        const component = { cells: [], tokenIndexes: new Set() };
        const queue = [{ row, col }];
        visited.add(key);

        while (queue.length > 0) {
          const cell = queue.shift();
          const cellBubble = state.board[cell.row][cell.col];
          component.cells.push(cell);
          if (cellBubble.tokenIndex !== undefined) component.tokenIndexes.add(cellBubble.tokenIndex);

          for (const next of neighbors(cell.row, cell.col)) {
            const nextKey = cellKey(next.row, next.col);
            const nextBubble = state.board[next.row][next.col];
            if (visited.has(nextKey) || !nextBubble || nextBubble.targetId !== targetId) continue;
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
    if (state.shotQueue.length === 0) refillShotQueue();
    return state.shotQueue.shift() || null;
  }

  function resizeCanvas() {
    const container = elements.canvas.parentElement;
    const maxWidth = Math.max(320, Math.min(container.clientWidth - 28, 760));
    const scale = maxWidth / 640;
    const sidePadding = Math.round(24 * scale);

    view.dpr = window.devicePixelRatio || 1;
    view.width = Math.round(640 * scale);
    view.height = Math.round(720 * scale);
    elements.canvas.width = view.width * view.dpr;
    elements.canvas.height = view.height * view.dpr;
    elements.canvas.style.width = `${view.width}px`;
    elements.canvas.style.height = `${view.height}px`;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    const maxRadiusForCols = (view.width - sidePadding * 2) / (state.boardCols * 2 + 0.92);
    view.radius = Math.max(14, Math.round(Math.min(30 * scale, maxRadiusForCols)));
    view.rowStep = Math.round(view.radius * 1.73);
    view.topY = Math.round(44 * scale);
    view.gridLeft = sidePadding;
    view.shooter.x = view.width / 2;
    view.shooter.y = view.height - Math.round(60 * scale);
    draw();
  }

  function cellCenter(row, col) {
    const offset = row % 2 === 1 ? view.radius : 0;
    return {
      x: view.gridLeft + col * view.radius * 2 + view.radius + offset,
      y: view.topY + row * view.rowStep + view.radius,
    };
  }

  function cellKey(row, col) {
    return `${row},${col}`;
  }

  function inBounds(row, col) {
    return row >= 0 && row < BOARD.rows && col >= 0 && col < state.boardCols;
  }

  function isCellEmpty(row, col) {
    return inBounds(row, col) && !state.board[row][col];
  }

  function neighbors(row, col) {
    const even = row % 2 === 0;
    const offsets = even
      ? [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]]
      : [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
    return offsets
      .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
      .filter((cell) => inBounds(cell.row, cell.col));
  }

  function nearestEmptyCell(x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        if (!isCellEmpty(row, col)) continue;
        const center = cellCenter(row, col);
        const distance = Math.hypot(center.x - x, center.y - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { row, col };
        }
      }
    }
    return best;
  }

  function nearestEmptyNeighbor(cell, x, y) {
    const candidates = neighbors(cell.row, cell.col).filter((candidate) => isCellEmpty(candidate.row, candidate.col));
    if (candidates.length === 0) return nearestEmptyCell(x, y);

    return candidates.reduce((best, candidate) => {
      const center = cellCenter(candidate.row, candidate.col);
      const distance = Math.hypot(center.x - x, center.y - y);
      if (!best || distance < best.distance) return { ...candidate, distance };
      return best;
    }, null);
  }

  function fireBubble() {
    if (!state.activeBubble || state.movingShot || state.levelChanging) return;
    state.movingShot = {
      ...state.activeBubble,
      x: view.shooter.x,
      y: view.shooter.y - view.radius * 1.25,
      vx: Math.cos(state.aimAngle) * SHOT_SPEED,
      vy: Math.sin(state.aimAngle) * SHOT_SPEED,
    };
    state.activeBubble = null;
  }

  function rotateAim(delta) {
    state.aimAngle = clampAim(state.aimAngle + delta);
  }

  function clampAim(angle) {
    const min = -Math.PI + 0.15;
    const max = -0.15;
    return Math.max(min, Math.min(max, angle));
  }

  function aimAt(x, y) {
    const dx = x - view.shooter.x;
    const dy = y - (view.shooter.y - view.radius * 1.25);
    if (dy >= -5) return;
    state.aimAngle = clampAim(Math.atan2(dy, dx));
  }

  function updateShot(dt) {
    if (!state.movingShot) return;

    state.movingShot.x += state.movingShot.vx * dt;
    state.movingShot.y += state.movingShot.vy * dt;

    if (state.movingShot.x <= view.radius || state.movingShot.x >= view.width - view.radius) {
      state.movingShot.x = Math.max(view.radius, Math.min(view.width - view.radius, state.movingShot.x));
      state.movingShot.vx *= -1;
    }

    if (state.movingShot.y <= view.topY - view.radius * 0.5) {
      snapShot(nearestEmptyCell(state.movingShot.x, state.movingShot.y));
      return;
    }

    const hitCell = findHitCell(state.movingShot.x, state.movingShot.y);
    if (hitCell) {
      snapShot(nearestEmptyNeighbor(hitCell, state.movingShot.x, state.movingShot.y));
      return;
    }

    if (state.movingShot.y > view.height + view.radius) {
      state.movingShot = null;
      state.activeBubble = nextBubbleFromQueue();
      setMessage("泡泡飛出界外，換下一顆。");
      updateHud();
    }
  }

  function findHitCell(x, y) {
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        if (!state.board[row][col]) continue;
        const center = cellCenter(row, col);
        if (Math.hypot(center.x - x, center.y - y) <= view.radius * 1.95) return { row, col };
      }
    }
    return null;
  }

  function snapShot(cell) {
    if (!state.movingShot) return;
    if (!cell) {
      endGame("盤面已滿，請重新開始。");
      return;
    }

    const { text, targetId, tokenIndex, color } = state.movingShot;
    state.board[cell.row][cell.col] = { text, targetId, tokenIndex, color };
    state.movingShot = null;
    resolvePlacement(cell.row, cell.col);
    state.activeBubble = nextBubbleFromQueue();
    updateHud();
  }

  function resolvePlacement(row, col) {
    const bubble = state.board[row][col];
    if (!bubble) return;

    const target = state.targets.find((item) => item.id === bubble.targetId);
    let clearedCount = 0;

    if (target && !target.cleared) {
      const component = collectSameTargetComponent(row, col, target.id);
      if (componentContainsTarget(component, target)) {
        component.forEach((cell) => {
          state.board[cell.row][cell.col] = null;
        });
        target.cleared = true;
        clearedCount = component.length;
        state.score += target.tokens.length * 120 + component.length * 20;
      }
    }

    const dropResult = dropFloatingBubbles();
    if (dropResult.count > 0) state.score += dropResult.count * 15 + dropResult.clearedTargets.length * 80;

    updateResolveMessage(target, clearedCount, dropResult);
    refillShotQueue();

    if (state.targets.every((item) => item.cleared)) {
      state.score += 500;
      state.level += 1;
      state.levelChanging = true;
      setMessage(`關卡完成！+500 分，進入第 ${state.level} 關…`, true);
      cancelPendingLevelChange();
      state.levelTimer = setTimeout(() => {
        state.levelTimer = null;
        startLevel();
      }, 1200);
    }
  }

  function updateResolveMessage(target, clearedCount, dropResult) {
    const dropped = dropResult.count;
    const droppedGroups = dropResult.clearedTargets.length;
    const dropText = dropped > 0
      ? `${dropped} 顆失去支撐掉落${droppedGroups > 0 ? `，${droppedGroups} 組完成` : ""}`
      : "";

    if (clearedCount > 0 && target) {
      setMessage(
        dropped > 0
          ? `完成「${target.tokens.join(" / ")}」，消除 ${clearedCount} 顆，${dropText}。`
          : `完成「${target.tokens.join(" / ")}」，相連泡泡消除。`,
        true
      );
    } else if (dropped > 0) {
      setMessage(`${dropText}。`);
    }
  }

  function collectSameTargetComponent(startRow, startCol, targetId) {
    const visited = new Set([cellKey(startRow, startCol)]);
    const component = [];
    const queue = [{ row: startRow, col: startCol }];

    while (queue.length > 0) {
      const cell = queue.shift();
      const bubble = state.board[cell.row][cell.col];
      if (!bubble || bubble.targetId !== targetId) continue;

      component.push(cell);
      for (const next of neighbors(cell.row, cell.col)) {
        const key = cellKey(next.row, next.col);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push(next);
      }
    }

    return component;
  }

  function componentContainsTarget(component, target) {
    const tokenIndexes = new Set(component
      .map((cell) => state.board[cell.row][cell.col]?.tokenIndex)
      .filter((index) => index !== undefined));
    return target.tokens.every((_, index) => tokenIndexes.has(index));
  }

  function dropFloatingBubbles(protectedTargetId = null) {
    const anchored = new Set();
    const queue = [];
    const droppedTargetIds = new Set();

    for (let col = 0; col < state.boardCols; col++) {
      if (!state.board[0][col]) continue;
      const key = cellKey(0, col);
      anchored.add(key);
      queue.push({ row: 0, col });
    }

    while (queue.length > 0) {
      const cell = queue.shift();
      for (const next of neighbors(cell.row, cell.col)) {
        const key = cellKey(next.row, next.col);
        if (anchored.has(key) || !state.board[next.row][next.col]) continue;
        anchored.add(key);
        queue.push(next);
      }
    }

    let count = 0;
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        const bubble = state.board[row][col];
        if (!bubble || anchored.has(cellKey(row, col))) continue;
        if (bubble.targetId) droppedTargetIds.add(bubble.targetId);
        state.board[row][col] = null;
        count += 1;
      }
    }

    return { count, clearedTargets: markFullyDroppedTargets(droppedTargetIds, protectedTargetId) };
  }

  function markFullyDroppedTargets(droppedTargetIds, protectedTargetId) {
    const cleared = [];
    for (const targetId of droppedTargetIds) {
      if (targetId === protectedTargetId) continue;
      const target = state.targets.find((item) => item.id === targetId);
      if (!target || target.cleared || countTargetBubblesOnBoard(targetId) > 0) continue;
      target.cleared = true;
      cleared.push(target);
    }
    return cleared;
  }

  function countTargetBubblesOnBoard(targetId) {
    let count = 0;
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        if (state.board[row][col]?.targetId === targetId) count += 1;
      }
    }
    return count;
  }

  function endGame(text) {
    state.movingShot = null;
    state.activeBubble = null;
    setMessage(text);
    updateHud();
  }

  function updateHud() {
    const cleared = state.targets.filter((target) => target.cleared).length;
    elements.score.textContent = String(state.score);
    elements.level.textContent = String(state.level);
    elements.progress.textContent = `${cleared}/${state.targets.length}`;
    elements.rowCount.textContent = `${state.targets.length} 列`;
    elements.nextBubble.textContent = state.activeBubble ? state.activeBubble.text : "完成";
    renderTargets();
  }

  function renderTargets() {
    elements.targets.innerHTML = "";
    state.targets.forEach((target) => {
      const item = document.createElement("div");
      item.className = `target-row${target.cleared ? " cleared" : ""}`;
      item.style.setProperty("--target-color", target.color);

      const title = document.createElement("div");
      title.className = "target-title";
      title.textContent = `${formatTargetSource(target)} · ${target.cleared ? "已消除" : "未消除"}`;
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
      elements.targets.append(item);
    });
  }

  function formatTargetSource(target) {
    const groupName = target.datasetLabel
      ? target.datasetLabel.split("：")[0]
      : "題庫";
    const sourceNumber = Number.isInteger(target.sourceIndex)
      ? `第 ${target.sourceIndex + 1} 題`
      : "題目";
    return `${groupName} · ${sourceNumber}`;
  }

  function setMessage(text, ok = false) {
    elements.message.textContent = text;
    elements.message.classList.toggle("ok", ok);
  }

  function draw() {
    ctx.clearRect(0, 0, view.width, view.height);
    drawBackground();
    drawBoardBubbles();
    drawAim();
    if (state.movingShot) drawBubble(state.movingShot.x, state.movingShot.y, state.movingShot);
    drawShooter();
  }

  function drawBackground() {
    ctx.fillStyle = "#091025";
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.strokeStyle = "rgba(126, 166, 255, 0.07)";
    ctx.lineWidth = 1;

    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        const center = cellCenter(row, col);
        ctx.beginPath();
        ctx.arc(center.x, center.y, view.radius * 0.92, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawBoardBubbles() {
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        const bubble = state.board[row][col];
        if (!bubble) continue;
        const center = cellCenter(row, col);
        drawBubble(center.x, center.y, bubble);
      }
    }
  }

  function drawAim() {
    if (!state.activeBubble || state.movingShot || state.levelChanging) return;
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
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 209, 102, 0.45)";
    ctx.beginPath();
    ctx.arc(last.x, last.y, view.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function predictAimPath() {
    const step = 6;
    const maxSteps = 600;
    let x = view.shooter.x;
    let y = view.shooter.y - view.radius * 1.25;
    let vx = Math.cos(state.aimAngle);
    const vy = Math.sin(state.aimAngle);
    const points = [{ x, y }];

    for (let i = 0; i < maxSteps; i++) {
      x += vx * step;
      y += vy * step;
      if (x <= view.radius || x >= view.width - view.radius) {
        x = Math.max(view.radius, Math.min(view.width - view.radius, x));
        vx *= -1;
        points.push({ x, y });
      }
      if (y <= view.topY || aimPathHitsBubble(x, y)) {
        points.push({ x, y });
        break;
      }
    }

    if (points.length === 1) points.push({ x, y });
    return points;
  }

  function aimPathHitsBubble(x, y) {
    return Boolean(findHitCellForRadius(x, y, view.radius * 1.85));
  }

  function findHitCellForRadius(x, y, hitRadius) {
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < state.boardCols; col++) {
        if (!state.board[row][col]) continue;
        const center = cellCenter(row, col);
        if (Math.hypot(center.x - x, center.y - y) <= hitRadius) return { row, col };
      }
    }
    return null;
  }

  function drawShooter() {
    ctx.save();
    ctx.fillStyle = "#24306a";
    ctx.strokeStyle = "#7ea6ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(view.shooter.x, view.shooter.y, view.radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (state.activeBubble) {
      drawBubble(view.shooter.x, view.shooter.y - view.radius * 1.25, { ...state.activeBubble, color: "#e8ecf8" });
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
    ctx.arc(x, y, view.radius * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = shadeColor(bubble.color, -28);
    ctx.lineWidth = 2;
    ctx.stroke();
    drawBubbleText(x, y, bubble.text);
    ctx.restore();
  }

  function drawBubbleText(x, y, text) {
    const maxWidth = view.radius * 1.58;
    const fontSize = Math.max(12, Math.floor(view.radius * 0.42));
    ctx.fillStyle = "#101426";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

    const visible = wrapBubbleText(text, maxWidth, 3);
    const lineHeight = fontSize * 0.98;
    const startY = y - ((visible.length - 1) * lineHeight) / 2;
    visible.forEach((part, index) => ctx.fillText(part, x, startY + index * lineHeight, maxWidth));
  }

  function wrapBubbleText(text, maxWidth, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = "";

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !current) {
        current = test;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    if (lines.length <= maxLines) return lines;
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = fitWithEllipsis(trimmed[maxLines - 1], maxWidth);
    return trimmed;
  }

  function fitWithEllipsis(text, maxWidth) {
    let value = text;
    if (ctx.measureText(value).width <= maxWidth) return value;
    while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
      value = value.slice(0, -1);
    }
    return `${value}…`;
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

  function loop(now) {
    const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
    state.lastFrame = now;
    updateShot(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function bindEvents() {
    elements.restartBtn.addEventListener("click", resetGame);
    elements.leftBtn.addEventListener("click", () => rotateAim(-TURN_STEP));
    elements.rightBtn.addEventListener("click", () => rotateAim(TURN_STEP));
    elements.fireBtn.addEventListener("click", fireBubble);

    elements.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      state.pointerDragging = true;
      const point = canvasPoint(event);
      aimAt(point.x, point.y);
    });

    elements.canvas.addEventListener("pointermove", (event) => {
      if (!state.pointerDragging) return;
      const point = canvasPoint(event);
      aimAt(point.x, point.y);
    });

    const releasePointer = () => {
      if (!state.pointerDragging) return;
      state.pointerDragging = false;
      fireBubble();
    };
    elements.canvas.addEventListener("pointerup", releasePointer);
    elements.canvas.addEventListener("pointercancel", () => {
      state.pointerDragging = false;
    });
    elements.canvas.addEventListener("pointerleave", () => {
      state.pointerDragging = false;
    });

    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      const code = event.code;
      const isLeft = key === "arrowleft" || key === "a" || code === "KeyA";
      const isRight = key === "arrowright" || key === "d" || code === "KeyD";
      const isFire = key === " " || key === "enter" || key === "w" || key === "s" || code === "Space" || code === "Enter" || code === "KeyW" || code === "KeyS";
      if (event.repeat && isFire) return;

      if (isLeft) {
        event.preventDefault();
        rotateAim(-TURN_STEP);
      } else if (isRight) {
        event.preventDefault();
        rotateAim(TURN_STEP);
      } else if (isFire) {
        event.preventDefault();
        fireBubble();
      }
    });

    window.addEventListener("resize", resizeCanvas);
  }

  function canvasPoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (view.width / rect.width),
      y: (event.clientY - rect.top) * (view.height / rect.height),
    };
  }

  init();
})();
