(() => {
  "use strict";

  const Shared = window.GermanBubbleShared;
  const VISIBLE_GROUP_IDS = Object.freeze(["group-0", "group-1"]);

  const elements = {
    groupBtnBar: document.getElementById("groupBtnBar"),
    message: document.getElementById("message"),
  };

  const state = {
    dataSets: [],
    settings: null,
  };

  init();

  async function init() {
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

    state.dataSets = state.dataSets.filter((dataSet) => VISIBLE_GROUP_IDS.includes(dataSet.id));

    if (state.dataSets.length === 0) {
      state.dataSets = Shared.buildFallbackMetaDataSets().filter((dataSet) => VISIBLE_GROUP_IDS.includes(dataSet.id));
    }
  }

  function render() {
    renderDatasetButtons();
  }

  function renderDatasetButtons() {
    elements.groupBtnBar.innerHTML = "";
    state.dataSets.forEach((dataSet) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-btn";
      button.dataset.id = dataSet.id;
      button.textContent = buttonLabel(dataSet);
      button.classList.toggle("active", state.settings.datasetIds.includes(dataSet.id));
      button.addEventListener("click", () => selectDataset(dataSet.id));
      elements.groupBtnBar.append(button);
    });
  }

  function buttonLabel(dataSet) {
    const playableCount = dataSet.rows.filter(Shared.isPlayableRow).length || dataSet.rows.length;
    const prefix = dataSet.id === "group-0" ? "群組 1" : "群組 2";
    return `${prefix}（${playableCount} 題）`;
  }

  function selectDataset(id) {
    state.settings = Shared.saveSettings({
      ...state.settings,
      datasetIds: [id],
      categoryIds: null,
    }, state.dataSets);
    renderDatasetButtons();
    setMessage(`${buttonLabelById(id)} 已儲存。`, true);
  }

  function buttonLabelById(id) {
    return id === "group-0" ? "群組 1" : "群組 2";
  }

  function setMessage(text, ok = false) {
    elements.message.textContent = text;
    elements.message.classList.toggle("ok", ok);
  }
})();
