(() => {
  "use strict";

  const CONFIG = Object.freeze({
    minRowTokens: 2,
    defaultDatasetId: "combined-cases-190-261",
    defaultLevelSize: 6,
    levelSizeOptions: [4, 6, 8, 10],
    storageKeys: Object.freeze({
      wordData: "german_bubble_word_data_v1",
      datasetIds: "german_bubble_dataset_v1",
      levelSize: "german_bubble_level_size_v1",
      pickCount: "german_bubble_pick_count_v1",
      categoryIds: "german_bubble_cats_v1",
    }),
  });

  const GROUP_LABELS = Object.freeze([
    "群組 1：常用短句",
    "群組 2：動詞變化",
    "群組 3：所有格變化",
    "群組 4：冠詞格變化",
    "群組 5：形容詞字尾",
  ]);

  const CATEGORY_GROUP_IDS = Object.freeze(new Set([
    "group-2",
    "group-3",
    "group-4",
    CONFIG.defaultDatasetId,
  ]));

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "masculine", label: "陽性" }),
    Object.freeze({ id: "neuter", label: "中性" }),
    Object.freeze({ id: "feminine", label: "陰性" }),
    Object.freeze({ id: "plural", label: "複數" }),
  ]);

  const FALLBACK_ROWS = Object.freeze([
    "陽性 der,der -e,des -en -s,dem -en,den -en",
    "陽性 ein,ein -er,eines -en -s,einem -en,einen -en",
    "中性 das,das -e,des -en -s,dem -en,das -e",
    "陰性 die,die -e,der -en,der -en,die -e",
    "複數 die,die -en,der -en,den -en n,die -en",
    "複數 keine,keine -en,keiner -en,keinen -en n,keine -en",
  ]);

  const FALLBACK_DATASET_META = Object.freeze([
    Object.freeze({ id: "group-0", label: "群組 1：常用短句", count: 52 }),
    Object.freeze({ id: "group-1", label: "群組 2：動詞變化", count: 130 }),
    Object.freeze({ id: "group-2", label: "群組 3：所有格變化", count: 36 }),
    Object.freeze({ id: "group-3", label: "群組 4：冠詞格變化", count: 20 }),
    Object.freeze({ id: "group-4", label: "群組 5：形容詞字尾", count: 12 }),
    Object.freeze({ id: CONFIG.defaultDatasetId, label: "格變化總練習（所有格+冠詞+形容詞）", count: 68 }),
  ]);

  function normalizeText(text) {
    return String(text).trim().replace(/\s+/g, " ").toLowerCase();
  }

  function normalizeTokens(tokens) {
    return tokens.map(normalizeText).join("|");
  }

  function parseRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row, sourceIndex) => {
        const tokens = String(row)
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (tokens.length < CONFIG.minRowTokens) return null;
        return {
          row: String(row),
          sourceIndex,
          tokens,
          key: normalizeTokens(tokens),
        };
      })
      .filter(Boolean);
  }

  function isPlayableRow(row) {
    return row.tokens.length >= CONFIG.minRowTokens;
  }

  function getRowCategory(row) {
    const first = String(row).split(",")[0].trim();
    if (first.startsWith("陽性") || first.startsWith("der ")) return "masculine";
    if (first.startsWith("中性") || first.startsWith("das ")) return "neuter";
    if (first.startsWith("陰性") || first.startsWith("die ")) return "feminine";
    if (first.startsWith("複數") || first.startsWith("pl.")) return "plural";
    return null;
  }

  function withDataSetInfo(rows, datasetId, datasetLabel) {
    return rows.map((row) => ({
      ...row,
      datasetId,
      datasetLabel,
    }));
  }

  function buildDataSets(rawData) {
    const groups = Array.isArray(rawData?.groups) ? rawData.groups : [];
    const dataSets = groups.map((rows, index) => {
      const id = `group-${index}`;
      const label = GROUP_LABELS[index] || `群組 ${index + 1}`;
      return {
        id,
        label,
        rows: withDataSetInfo(parseRows(rows), id, label),
        source: "words.json",
      };
    });

    if (groups.length >= 5) {
      const id = CONFIG.defaultDatasetId;
      const label = "格變化總練習（所有格+冠詞+形容詞）";
      dataSets.push({
        id,
        label,
        rows: withDataSetInfo(parseRows([...groups[2], ...groups[3], ...groups[4]]), id, label),
        source: "combined",
      });
    }

    return dataSets.filter((set) => set.rows.some(isPlayableRow));
  }

  function buildFallbackMetaDataSets() {
    return FALLBACK_DATASET_META.map((set) => ({
      id: set.id,
      label: set.label,
      rows: Array.from({ length: set.count }, (_, index) => ({
          row: index === 0 ? "找不到題庫資料，請先在設定頁載入 data/words.json" : "",
          sourceIndex: index,
          tokens: [],
          key: `${set.id}-${index}`,
        }))
        .map((row) => ({
          ...row,
          datasetId: set.id,
          datasetLabel: set.label,
        })),
      source: "fallback-meta",
    }));
  }

  function buildPlayableFallbackDataSet() {
    return [{
      id: "fallback",
      label: "內建範例：形容詞字尾",
      rows: withDataSetInfo(parseRows(FALLBACK_ROWS), "fallback", "內建範例：形容詞字尾"),
      source: "fallback-playable",
    }];
  }

  async function fetchWordData() {
    const response = await fetch("./data/words.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    saveWordDataCache(data);
    return data;
  }

  function isValidWordData(data) {
    return Boolean(data && Array.isArray(data.groups));
  }

  function loadWordDataCache() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKeys.wordData);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return isValidWordData(data) ? data : null;
    } catch {
      return null;
    }
  }

  function saveWordDataCache(data) {
    if (!isValidWordData(data)) return null;
    localStorage.setItem(CONFIG.storageKeys.wordData, JSON.stringify(data));
    return data;
  }

  function clearWordDataCache() {
    localStorage.removeItem(CONFIG.storageKeys.wordData);
  }

  function parseJsonArray(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "string");
      if (typeof parsed === "string") return [parsed];
    } catch {
      if (typeof value === "string") return [value];
    }
    return [];
  }

  function availableDatasetIds(dataSets) {
    return new Set(dataSets.map((set) => set.id));
  }

  function defaultDatasetIds(dataSets) {
    const ids = availableDatasetIds(dataSets);
    if (ids.has(CONFIG.defaultDatasetId)) return [CONFIG.defaultDatasetId];
    return dataSets[0]?.id ? [dataSets[0].id] : [];
  }

  function sanitizeDatasetIds(ids, dataSets) {
    const available = availableDatasetIds(dataSets);
    const sanitized = ids.filter((id) => available.has(id));
    return sanitized.length > 0 ? Array.from(new Set(sanitized)) : defaultDatasetIds(dataSets);
  }

  function sanitizeCategoryIds(ids) {
    const allowed = new Set(CATEGORIES.map((category) => category.id));
    const sanitized = ids.filter((id) => allowed.has(id));
    return sanitized.length > 0 && sanitized.length < CATEGORIES.length ? sanitized : null;
  }

  function sanitizeLevelSize(value) {
    const numberValue = Number(value);
    return CONFIG.levelSizeOptions.includes(numberValue) ? numberValue : CONFIG.defaultLevelSize;
  }

  function sanitizePickCount(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
  }

  function loadSettings(dataSets) {
    const keys = CONFIG.storageKeys;
    const datasetIds = sanitizeDatasetIds(parseJsonArray(localStorage.getItem(keys.datasetIds)), dataSets);
    const categoryIds = sanitizeCategoryIds(parseJsonArray(localStorage.getItem(keys.categoryIds)));
    const levelSize = sanitizeLevelSize(localStorage.getItem(keys.levelSize));
    const pickCount = sanitizePickCount(localStorage.getItem(keys.pickCount));
    return { datasetIds, categoryIds, levelSize, pickCount };
  }

  function saveSettings(settings, dataSets) {
    const keys = CONFIG.storageKeys;
    const datasetIds = sanitizeDatasetIds(settings.datasetIds || [], dataSets);
    const categoryIds = sanitizeCategoryIds(settings.categoryIds || []);
    const levelSize = sanitizeLevelSize(settings.levelSize);
    const pickCount = sanitizePickCount(settings.pickCount);

    localStorage.setItem(keys.datasetIds, JSON.stringify(datasetIds));
    localStorage.setItem(keys.levelSize, String(levelSize));
    localStorage.setItem(keys.pickCount, String(pickCount));
    if (categoryIds) {
      localStorage.setItem(keys.categoryIds, JSON.stringify(categoryIds));
    } else {
      localStorage.removeItem(keys.categoryIds);
    }

    return { datasetIds, categoryIds, levelSize, pickCount };
  }

  function resetSettings(dataSets) {
    const defaults = {
      datasetIds: defaultDatasetIds(dataSets),
      categoryIds: null,
      levelSize: CONFIG.defaultLevelSize,
      pickCount: 0,
    };
    return saveSettings(defaults, dataSets);
  }

  function getSelectedRows(dataSets, datasetIds) {
    const ids = new Set(datasetIds);
    return dataSets.flatMap((set) => ids.has(set.id) ? set.rows : []);
  }

  function getFilteredRows(dataSets, settings) {
    let rows = getSelectedRows(dataSets, settings.datasetIds);
    if (settings.categoryIds) {
      const categories = new Set(settings.categoryIds);
      rows = rows.filter((row) => {
        const category = getRowCategory(row.row);
        return !category || categories.has(category);
      });
    }
    return rows;
  }

  function getPlayableRows(dataSets, settings) {
    const rows = getFilteredRows(dataSets, settings).filter(isPlayableRow);
    if (settings.pickCount > 0 && settings.pickCount < rows.length) {
      return shuffle(rows.slice()).slice(0, settings.pickCount);
    }
    return rows;
  }

  function shouldShowCategories(dataSets, datasetIds) {
    const ids = new Set(datasetIds);
    if ([...ids].some((id) => CATEGORY_GROUP_IDS.has(id))) return true;
    return getSelectedRows(dataSets, datasetIds).some((row) => getRowCategory(row.row));
  }

  function countDisplayRows(dataSets, settings) {
    const selectedRows = getSelectedRows(dataSets, settings.datasetIds);
    const hasRealData = selectedRows.some((row) => row.tokens.length > 0);
    if (!hasRealData) return selectedRows.length;
    return getFilteredRows(dataSets, settings).filter((row) => row.tokens.length > 0).length;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  window.GermanBubbleShared = Object.freeze({
    CONFIG,
    CATEGORIES,
    FALLBACK_ROWS,
    buildDataSets,
    buildFallbackMetaDataSets,
    buildPlayableFallbackDataSet,
    countDisplayRows,
    defaultDatasetIds,
    fetchWordData,
    getFilteredRows,
    getPlayableRows,
    getRowCategory,
    getSelectedRows,
    isPlayableRow,
    loadSettings,
    loadWordDataCache,
    normalizeText,
    normalizeTokens,
    parseRows,
    resetSettings,
    saveSettings,
    saveWordDataCache,
    sanitizeCategoryIds,
    sanitizeDatasetIds,
    sanitizeLevelSize,
    sanitizePickCount,
    shouldShowCategories,
    shuffle,
    clearWordDataCache,
  });
})();
