(() => {
  "use strict";

  const Shared = window.GermanBubbleShared;
  const CONFIG = Shared.CONFIG;

  const elements = {
    groupBtnBar: document.getElementById("groupBtnBar"),
    catSection: document.getElementById("catSection"),
    catBar: document.getElementById("catBar"),
    levelSize: document.getElementById("levelSizeSetting"),
    pickCount: document.getElementById("pickCount"),
    totalCount: document.getElementById("totalCount"),
    saveBtn: document.getElementById("saveBtn"),
    saveAndBackBtn: document.getElementById("saveAndBackBtn"),
    resetBtn: document.getElementById("resetBtn"),
    message: document.getElementById("message"),
    datasetList: document.getElementById("datasetList"),
    datasetCount: document.getElementById("datasetCount"),
  };

  const state = {
    dataSets: [],
    settings: null,
  };

  init();

  async function init() {
    bindEvents();
    await loadDataSets();
    state.settings = Shared.saveSettings(Shared.loadSettings(state.dataSets), state.dataSets);
    render();
  }

  async function loadDataSets() {
    try {
      const rawData = await Shared.fetchWordData();
      state.dataSets = Shared.buildDataSets(rawData);
      setMessage("已從 data/words.json 載入題庫並儲存到瀏覽器。", true);
    } catch (error) {
      console.error("設定資料載入失敗:", error);
      const cachedData = Shared.loadWordDataCache();
      if (cachedData) {
        state.dataSets = Shared.buildDataSets(cachedData);
        setMessage("無法重新讀取 data/words.json，已使用上次儲存的題庫快取。", true);
      } else {
        state.dataSets = Shared.buildFallbackMetaDataSets();
        setMessage("無法載入 data/words.json，且尚未有題庫快取。請先在可讀取 JSON 的環境開啟一次設定頁。");
      }
    }

    if (state.dataSets.length === 0) {
      state.dataSets = Shared.buildFallbackMetaDataSets();
    }
  }

  function render() {
    renderDatasetButtons();
    renderCategoryButtons();
    renderControls();
    renderDatasetList();
    updateTotalCount();
  }

  function renderDatasetButtons() {
    elements.groupBtnBar.innerHTML = "";
    state.dataSets.forEach((dataSet) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-btn";
      button.dataset.id = dataSet.id;
      button.textContent = dataSet.label;
      button.classList.toggle("active", state.settings.datasetIds.includes(dataSet.id));
      button.addEventListener("click", () => toggleDataset(dataSet.id));
      elements.groupBtnBar.append(button);
    });
  }

  function toggleDataset(id) {
    syncControlsToState();
    const current = new Set(state.settings.datasetIds);
    const isDefaultOnly = current.size === 1 && current.has(CONFIG.defaultDatasetId);

    if (isDefaultOnly && id !== CONFIG.defaultDatasetId) {
      state.settings.datasetIds = [id];
    } else if (current.has(id)) {
      current.delete(id);
      state.settings.datasetIds = current.size > 0 ? [...current] : [id];
    } else {
      current.add(id);
      state.settings.datasetIds = [...current];
    }

    if (!Shared.shouldShowCategories(state.dataSets, state.settings.datasetIds)) {
      state.settings.categoryIds = null;
    }

    render();
  }

  function renderCategoryButtons() {
    const shouldShow = Shared.shouldShowCategories(state.dataSets, state.settings.datasetIds);
    if (!shouldShow) {
      state.settings.categoryIds = null;
      elements.catSection.hidden = true;
      elements.catBar.innerHTML = "";
      return;
    }

    elements.catSection.hidden = false;
    elements.catBar.innerHTML = "";
    const selected = state.settings.categoryIds ? new Set(state.settings.categoryIds) : null;

    Shared.CATEGORIES.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-btn";
      button.textContent = category.label;
      button.classList.toggle("active", !selected || selected.has(category.id));
      button.addEventListener("click", () => toggleCategory(category.id));
      elements.catBar.append(button);
    });
  }

  function toggleCategory(categoryId) {
    syncControlsToState();
    const allIds = Shared.CATEGORIES.map((category) => category.id);
    const selected = state.settings.categoryIds ? new Set(state.settings.categoryIds) : new Set(allIds);

    if (selected.has(categoryId)) selected.delete(categoryId);
    else selected.add(categoryId);

    state.settings.categoryIds = selected.size === 0 || selected.size === allIds.length ? null : [...selected];
    renderCategoryButtons();
    updateTotalCount();
  }

  function renderControls() {
    elements.levelSize.value = String(state.settings.levelSize);
    elements.pickCount.value = String(state.settings.pickCount);
  }

  function renderDatasetList() {
    elements.datasetList.innerHTML = "";
    elements.datasetCount.textContent = `${state.dataSets.length} 個題庫`;

    state.dataSets.forEach((dataSet) => {
      const item = document.createElement("article");
      item.className = "dataset-item";

      const title = document.createElement("h3");
      title.textContent = dataSet.label;
      item.append(title);

      const meta = document.createElement("p");
      const playableCount = dataSet.rows.filter(Shared.isPlayableRow).length || dataSet.rows.length;
      meta.textContent = `${playableCount} 題可用`;
      item.append(meta);

      const sampleRow = dataSet.rows.find((row) => row.row)?.row;
      if (sampleRow) {
        const sample = document.createElement("code");
        sample.textContent = sampleRow;
        item.append(sample);
      }

      elements.datasetList.append(item);
    });
  }

  function updateTotalCount() {
    syncControlsToState();
    elements.totalCount.textContent = String(Shared.countDisplayRows(state.dataSets, state.settings));
  }

  function saveCurrentSettings({ silent = false } = {}) {
    syncControlsToState();
    state.settings = Shared.saveSettings(state.settings, state.dataSets);
    renderControls();
    updateTotalCount();
    if (!silent) setMessage("設定已儲存。回遊戲重新開始後會套用。", true);
  }

  function resetCurrentSettings() {
    state.settings = Shared.resetSettings(state.dataSets);
    render();
    setMessage("已恢復預設設定。", true);
  }

  function syncControlsToState() {
    state.settings.levelSize = Shared.sanitizeLevelSize(elements.levelSize.value);
    state.settings.pickCount = Shared.sanitizePickCount(elements.pickCount.value);
  }

  function handleLevelSizeChange() {
    state.settings.levelSize = Shared.sanitizeLevelSize(elements.levelSize.value);
    elements.levelSize.value = String(state.settings.levelSize);
    updateTotalCount();
  }

  function handlePickCountInput() {
    state.settings.pickCount = Shared.sanitizePickCount(elements.pickCount.value);
    updateTotalCount();
  }

  function handlePickCountBlur() {
    state.settings.pickCount = Shared.sanitizePickCount(elements.pickCount.value);
    elements.pickCount.value = String(state.settings.pickCount);
    updateTotalCount();
  }

  function bindEvents() {
    elements.saveBtn.addEventListener("click", () => saveCurrentSettings());
    elements.saveAndBackBtn.addEventListener("click", () => {
      saveCurrentSettings({ silent: true });
      setMessage("設定已儲存，正在回到遊戲...", true);
      setTimeout(() => {
        window.location.href = "./index.html";
      }, 250);
    });
    elements.resetBtn.addEventListener("click", resetCurrentSettings);
    elements.levelSize.addEventListener("change", handleLevelSizeChange);
    elements.pickCount.addEventListener("input", handlePickCountInput);
    elements.pickCount.addEventListener("blur", handlePickCountBlur);
  }

  function setMessage(text, ok = false) {
    elements.message.textContent = text;
    elements.message.classList.toggle("ok", ok);
  }
})();
