// tech-trends: 1 日分の JSON を読んでカードを描く。ビルドなし、依存なし。
// 純粋関数は export してテストから使う。DOM を触るのは main() だけ。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const STALE_HOUR_JST = 9;

const jstDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const jstHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  hour12: false,
});
const jstDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** @param {number} n */
export function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** @param {number} n */
export function formatDelta(n) {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}`;
}

/** @param {string} date YYYY-MM-DD */
export function dateLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${date} (${weekday})`;
}

/** @param {string} date YYYY-MM-DD @param {number} days */
function shiftDate(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * 収集が止まっていそうなら true。
 * 最新日付が今日（JST）なら false。昨日なら JST 9:00 以降で true（cron の遅れを見込む）。
 * 一昨日以前なら時刻を問わず true。
 * @param {string} latestDate
 * @param {Date} now
 */
export function isStale(latestDate, now) {
  const today = jstDateFormatter.format(now);
  if (latestDate >= today) return false;
  if (latestDate < shiftDate(today, -1)) return true;
  const hour = Number(jstHourFormatter.format(now)) % 24;
  return hour >= STALE_HOUR_JST;
}

/**
 * @param {string} hash location.hash（"#2026-10-17" など）
 * @param {string[]} dates 新しい順
 * @returns {{ date: string | null, fallback: boolean }}
 */
export function resolveDate(hash, dates) {
  const latest = dates[0] ?? null;
  const wanted = hash.replace(/^#/, "");
  if (!wanted) return { date: latest, fallback: false };
  if (dates.includes(wanted)) return { date: wanted, fallback: false };
  return { date: latest, fallback: latest !== null };
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {import("../src/types.js").Item} item */
export function renderCard(item) {
  const isGithub = item.source === "github";
  const counter = isGithub ? "★" : "♥";
  const sub = isGithub
    ? (item.description ?? "")
    : item.author
      ? `@${item.author}`
      : "";
  const tag = isGithub
    ? (item.language ?? item.topics[0] ?? "")
    : (item.topics[0] ?? "");
  const titleText = isGithub
    ? item.title
    : `${item.emoji ? `${item.emoji} ` : ""}${item.title}`;
  const classes = item.hot ? "card hot" : "card";
  return `<article class="${classes}">
  <h2 class="title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${item.hot ? "🔥 " : ""}${escapeHtml(titleText)}</a></h2>
  <p class="sub">${escapeHtml(sub)}</p>
  <p class="meta">
    <span class="src ${isGithub ? "gh" : "zn"}">${isGithub ? "GitHub" : "Zenn"}</span>
    ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
    <span class="count">${counter} ${formatCount(item.total)} <span class="delta">${formatDelta(item.delta)}</span></span>
    ${item.isNew ? '<span class="new">NEW</span>' : ""}
  </p>
</article>`;
}

// ---- 以下は DOM を触る部分 -------------------------------------------------

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node;
}

function setNotices(notices, warnings) {
  el("notices").innerHTML = [
    ...warnings.map((w) => `<p class="warning">${escapeHtml(w)}</p>`),
    ...notices.map((n) => `<p class="notice">${escapeHtml(n)}</p>`),
  ].join("");
}

async function render(index) {
  const { date, fallback } = resolveDate(location.hash, index.dates);
  const notices = [];
  const warnings = [];

  if (!date) {
    el("date").textContent = "データがありません";
    el("grid").innerHTML = "";
    setNotices(["まだ収集結果がありません。"], []);
    return;
  }

  const i = index.dates.indexOf(date);
  const newer = index.dates[i - 1];
  const older = index.dates[i + 1];
  const prevBtn = el("prev");
  const nextBtn = el("next");
  prevBtn.disabled = !older;
  nextBtn.disabled = !newer;
  prevBtn.onclick = () => {
    if (older) location.hash = older;
  };
  nextBtn.onclick = () => {
    if (newer) location.hash = newer;
  };

  const day = await fetchJson(`data/${date}.json`);
  el("date").textContent = dateLabel(day.date);
  el("updated").textContent =
    `最終更新 ${jstDateTimeFormatter.format(new Date(day.generatedAt))} JST`;

  if (fallback) notices.push("指定の日付が無いため最新を表示しています。");
  for (const e of day.errors ?? []) {
    const scope = e.scope ? ` ${e.scope}` : "";
    notices.push(
      `${e.source === "github" ? "GitHub" : "Zenn"}${scope} の取得に失敗しました（${e.message}）`,
    );
  }
  if (isStale(index.dates[0], new Date())) {
    warnings.push(
      `収集が止まっている可能性があります（最新: ${index.dates[0]}）`,
    );
  }
  setNotices(notices, warnings);

  el("grid").innerHTML = day.items.length
    ? day.items.map(renderCard).join("\n")
    : '<p class="empty">本日は取得できませんでした。</p>';
}

async function main() {
  try {
    const index = await fetchJson("data/index.json");
    await render(index);
    window.addEventListener("hashchange", () => {
      render(index).catch(showError);
    });
  } catch (e) {
    showError(e);
  }
}

function showError(e) {
  setNotices(
    [],
    [`読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`],
  );
}

if (typeof document !== "undefined") main();
