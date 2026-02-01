const $ = (id) => document.getElementById(id);

const periodEl = $("period");
const btnLoad = $("btnLoad");
const statusEl = $("status");
const logsEl = $("logs");
const highlightsEl = $("highlights");
const vocabStatsEl = $("vocabStats");
const vocabGrowthEl = $("vocabGrowth");

function setStatus(t, isError = false) {
  statusEl.textContent = t;
  statusEl.className = "status" + (isError ? " error" : "");
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logsEl.innerHTML = "<p class='empty'>会話ログがありません</p>";
    return;
  }

  logsEl.innerHTML = logs
    .map(
      (log) => `
    <div class="log-item">
      <div class="log-header">
        <span class="log-time">${formatDate(log.timestamp)}</span>
      </div>
      <div class="log-exchange">
        <div class="child-input">
          <span class="label">👧 こども:</span>
          <span class="text">${escapeHtml(log.childInput || "（音声のみ）")}</span>
        </div>
        <div class="rabbit-response">
          <span class="label">🐰 うさぎ:</span>
          <span class="text">${escapeHtml(log.rabbitResponse)}</span>
        </div>
      </div>
      ${
        log.vocabularyUsed && log.vocabularyUsed.length
          ? `<div class="vocab-used">語彙: ${log.vocabularyUsed.join(", ")}</div>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

function renderHighlights(highlights) {
  if (!highlights || highlights.length === 0) {
    highlightsEl.innerHTML = "<p class='empty'>ハイライトがありません</p>";
    return;
  }

  const typeLabels = {
    new_word: "🆕 新しい言葉",
    long_sentence: "📝 長い文章",
    emotional_moment: "💕 感情表現",
  };

  highlightsEl.innerHTML = highlights
    .map(
      (h) => `
    <div class="highlight-item ${h.type}">
      <div class="highlight-header">
        <span class="highlight-type">${typeLabels[h.type] || h.type}</span>
        <span class="highlight-time">${formatDate(h.timestamp)}</span>
      </div>
      <p class="highlight-desc">${escapeHtml(h.description)}</p>
      <blockquote class="highlight-excerpt">${escapeHtml(h.excerpt)}</blockquote>
    </div>
  `
    )
    .join("");
}

function renderVocabulary(data) {
  if (!data) {
    vocabStatsEl.innerHTML = "<p class='empty'>語彙データがありません</p>";
    vocabGrowthEl.innerHTML = "";
    return;
  }

  vocabStatsEl.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">総語彙数:</span>
      <span class="stat-value">${data.totalUniqueWords || 0} 語</span>
    </div>
    ${
      data.mostUsedWords && data.mostUsedWords.length
        ? `
      <div class="most-used">
        <span class="stat-label">よく使う言葉:</span>
        <div class="word-list">
          ${data.mostUsedWords
            .slice(0, 10)
            .map((w) => `<span class="word-chip">${escapeHtml(w.word)} (${w.count})</span>`)
            .join("")}
        </div>
      </div>
    `
        : ""
    }
  `;

  if (data.vocabularyGrowth && data.vocabularyGrowth.length) {
    vocabGrowthEl.innerHTML = `
      <h3>成長履歴</h3>
      <div class="growth-list">
        ${data.vocabularyGrowth
          .map(
            (g) => `
          <div class="growth-item">
            <span class="growth-date">${g.date}</span>
            <span class="growth-count">${g.uniqueWords} 語</span>
            ${
              g.newWords && g.newWords.length
                ? `<span class="growth-new">新規: ${g.newWords.join(", ")}</span>`
                : ""
            }
          </div>
        `
          )
          .join("")}
      </div>
    `;
  } else {
    vocabGrowthEl.innerHTML = "";
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadData() {
  const period = periodEl.value;
  setStatus("読み込み中…");

  try {
    const [logsResp, vocabResp, highlightsResp] = await Promise.all([
      fetch(`/api/parent/logs?limit=50`),
      fetch(`/api/parent/vocabulary?period=${period}`),
      fetch(`/api/parent/highlights`),
    ]);

    const [logsData, vocabData, highlightsData] = await Promise.all([
      logsResp.json(),
      vocabResp.json(),
      highlightsResp.json(),
    ]);

    if (logsData.error) throw new Error(logsData.error.message);
    if (vocabData.error) throw new Error(vocabData.error.message);
    if (highlightsData.error) throw new Error(highlightsData.error.message);

    renderLogs(logsData.logs);
    renderVocabulary(vocabData);
    renderHighlights(highlightsData.highlights);

    setStatus(`読み込み完了 (${new Date().toLocaleTimeString("ja-JP")})`);
  } catch (e) {
    setStatus("エラー: " + e.message, true);
    console.error(e);
  }
}

btnLoad.addEventListener("click", loadData);

window.addEventListener("load", loadData);
