const SETTINGS_DATASET_KEY = "german_bubble_dataset_v1";
const SETTINGS_LEVEL_SIZE_KEY = "german_bubble_level_size_v1";
const SETTINGS_PICK_COUNT_KEY = "german_bubble_pick_count_v1";
const SETTINGS_CATS_KEY = "german_bubble_cats_v1";
const DEFAULT_LEVEL_SIZE = "6";
const MIN_ROW_TOKENS = 5;
const MAX_ROW_TOKENS = 6;

const GROUP_LABELS = [
  "群組 1：常用短句",
  "群組 2：動詞變化",
  "群組 3：所有格變化",
  "群組 4：冠詞格變化",
  "群組 5：形容詞字尾",
];

const CATEGORIES = [
  { id: "masculine", label: "陽性" },
  { id: "neuter", label: "中性" },
  { id: "feminine", label: "陰性" },
  { id: "plural", label: "複數" },
];

const groupBtnBar = document.getElementById("groupBtnBar");
const catSection = document.getElementById("catSection");
const catBar = document.getElementById("catBar");
const levelSizeSetting = document.getElementById("levelSizeSetting");
const pickCountInput = document.getElementById("pickCount");
const totalCountEl = document.getElementById("totalCount");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const messageEl = document.getElementById("message");
const datasetList = document.getElementById("datasetList");
const datasetCount = document.getElementById("datasetCount");

let dataSets = [];
let activeGroups = new Set();
let activeCats = null;

function parseRows(rows) {
  return rows
    .map((row) => {
      const tokens = String(row).split(",").map((part) => part.trim()).filter(Boolean);
      return { row: String(row), tokens };
    })
    .filter((item) => item.tokens.length >= MIN_ROW_TOKENS && item.tokens.length <= MAX_ROW_TOKENS);
}

function getCategory(row) {
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

async function loadSettingsData() {
  try {
    const response = await fetch("./data/words.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
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

    dataSets = dataSets.filter((set) => set.rows.length > 0);
  } catch (error) {
    console.error("設定資料載入失敗:", error);
    dataSets = buildFallbackDataSets();
    setMessage("無法載入 data/words.json（直接開檔會被瀏覽器擋住）。仍可儲存設定，遊戲請用本機靜態伺服器開啟。");
  }

  loadSavedState();
  renderUI();
}

function buildFallbackDataSets() {
  const fallback = [
    { id: "group-0", label: "群組 1：常用短句", count: 19 },
    { id: "group-1", label: "群組 2：動詞變化", count: 130 },
    { id: "group-2", label: "群組 3：所有格變化", count: 36 },
    { id: "group-3", label: "群組 4：冠詞格變化", count: 20 },
    { id: "group-4", label: "群組 5：形容詞字尾", count: 12 },
    { id: "combined-cases-190-261", label: "格變化總練習（所有格+冠詞+形容詞）", count: 68 },
  ];
  return fallback.map((set) => ({
    id: set.id,
    label: set.label,
    rows: Array.from({ length: set.count }, () => ({ row: "", tokens: [] })),
  }));
}

function loadSavedState() {
  try {
    const savedGroups = localStorage.getItem(SETTINGS_DATASET_KEY);
    if (savedGroups) {
      const ids = JSON.parse(savedGroups);
      if (Array.isArray(ids)) {
        activeGroups = new Set(ids.filter((id) => dataSets.some((set) => set.id === id)));
      }
    }
    if (activeGroups.size === 0) {
      activeGroups = new Set(["combined-cases-190-261"]);
    }

    const savedCats = localStorage.getItem(SETTINGS_CATS_KEY);
    if (savedCats) {
      const catIds = JSON.parse(savedCats);
      if (Array.isArray(catIds) && catIds.length > 0) activeCats = new Set(catIds);
    }
  } catch {
    activeGroups = new Set(["combined-cases-190-261"]);
  }

  const savedLevelSize = localStorage.getItem(SETTINGS_LEVEL_SIZE_KEY);
  const levelOptions = [...levelSizeSetting.options].map((option) => option.value);
  levelSizeSetting.value = levelOptions.includes(savedLevelSize) ? savedLevelSize : DEFAULT_LEVEL_SIZE;

  const savedPickCount = localStorage.getItem(SETTINGS_PICK_COUNT_KEY);
  pickCountInput.value = savedPickCount || "0";
}

function renderUI() {
  renderGroupButtons();
  renderCatBar();
  renderDatasetList();
  updateTotalCount();
}

function renderGroupButtons() {
  groupBtnBar.innerHTML = "";
  dataSets.forEach((set) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-btn";
    btn.dataset.id = set.id;
    btn.textContent = set.label;
    btn.classList.toggle("active", activeGroups.has(set.id));
    btn.addEventListener("click", () => toggleGroup(set.id));
    groupBtnBar.append(btn);
  });
}

function toggleGroup(id) {
  if (activeGroups.has(id)) {
    activeGroups.delete(id);
  } else {
    activeGroups.add(id);
  }
  if (activeGroups.size === 0) activeGroups.add(id);
  renderGroupButtons();
  renderCatBar();
  updateTotalCount();
}

function renderCatBar() {
  const hasCats = getActiveRows().some((item) => getCategory(item.row) !== null);
  catSection.style.display = hasCats ? "block" : "none";
  if (!hasCats) return;

  catBar.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-btn";
    btn.textContent = cat.label;
    btn.classList.toggle("active", !activeCats || activeCats.has(cat.id));
    btn.addEventListener("click", () => toggleCat(cat.id));
    catBar.append(btn);
  });
}

function toggleCat(catId) {
  if (!activeCats) {
    activeCats = new Set(CATEGORIES.map((cat) => cat.id));
    activeCats.delete(catId);
  } else if (activeCats.has(catId)) {
    activeCats.delete(catId);
    if (activeCats.size === 0) activeCats = null;
  } else {
    activeCats.add(catId);
    if (activeCats.size === CATEGORIES.length) activeCats = null;
  }
  renderCatBar();
  updateTotalCount();
}

function getActiveRows() {
  let rows = [];
  dataSets.forEach((set) => {
    if (activeGroups.has(set.id)) rows.push(...set.rows);
  });
  return rows;
}

function getFilteredRows() {
  let rows = getActiveRows();
  if (activeCats) {
    rows = rows.filter((item) => {
      const cat = getCategory(item.row);
      return !cat || activeCats.has(cat);
    });
  }
  return rows;
}

function updateTotalCount() {
  const count = getFilteredRows().length;
  totalCountEl.textContent = String(count);
  datasetCount.textContent = `${dataSets.length} 個題庫`;
}

function renderDatasetList() {
  datasetList.innerHTML = "";
  dataSets.forEach((set) => {
    const item = document.createElement("article");
    item.className = "dataset-item";

    const title = document.createElement("h3");
    title.textContent = set.label;
    item.append(title);

    const meta = document.createElement("p");
    meta.textContent = `${set.rows.length} 題可用`;
    item.append(meta);

    if (set.rows[0]?.row) {
      const sample = document.createElement("code");
      sample.textContent = set.rows[0].row;
      item.append(sample);
    }

    datasetList.append(item);
  });
}

function saveSettings() {
  const groupIds = [...activeGroups];
  localStorage.setItem(SETTINGS_DATASET_KEY, JSON.stringify(groupIds));
  localStorage.setItem(SETTINGS_LEVEL_SIZE_KEY, levelSizeSetting.value);
  localStorage.setItem(SETTINGS_PICK_COUNT_KEY, pickCountInput.value || "0");
  if (activeCats) {
    localStorage.setItem(SETTINGS_CATS_KEY, JSON.stringify([...activeCats]));
  } else {
    localStorage.removeItem(SETTINGS_CATS_KEY);
  }
  setMessage("設定已儲存。回遊戲後會自動套用。", true);
}

function resetSettings() {
  localStorage.removeItem(SETTINGS_DATASET_KEY);
  localStorage.removeItem(SETTINGS_LEVEL_SIZE_KEY);
  localStorage.removeItem(SETTINGS_PICK_COUNT_KEY);
  localStorage.removeItem(SETTINGS_CATS_KEY);
  activeGroups = new Set(["combined-cases-190-261"]);
  activeCats = null;
  levelSizeSetting.value = DEFAULT_LEVEL_SIZE;
  pickCountInput.value = "0";
  renderUI();
  setMessage("已恢復預設設定。", true);
}

function setMessage(text, ok = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", ok);
}

saveBtn.addEventListener("click", saveSettings);
resetBtn.addEventListener("click", resetSettings);

loadSettingsData();
