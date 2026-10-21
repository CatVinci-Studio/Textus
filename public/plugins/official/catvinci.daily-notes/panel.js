(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const $ = (id) => document.getElementById(id);
  $("today").textContent = zh ? "今天" : "Today";
  $("nofolder").textContent = zh
    ? "打开一个文件夹后，每日笔记会放在里面。"
    : "Open a folder, and your daily notes are kept in it.";

  const pad = (n) => String(n).padStart(2, "0");
  const dateOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const saved = api.getState() || {};
  let shown = saved.month ? new Date(saved.month + "-01T00:00:00") : new Date();
  shown = new Date(shown.getFullYear(), shown.getMonth(), 1);
  let dates = new Set();
  let weekStart = "monday";
  let hasFolder = true;

  function render() {
    api.setState({ month: dateOf(shown).slice(0, 7) });
    $("month").textContent = shown.toLocaleDateString(api.language, { year: "numeric", month: "long" });
    $("nofolder").hidden = hasFolder;
    const grid = $("grid");
    grid.textContent = "";
    const first = weekStart === "sunday" ? 0 : 1;
    for (let i = 0; i < 7; i++) {
      const day = new Date(2024, 0, 7 + first + i); // 2024-01-07 is a Sunday
      const cell = document.createElement("div");
      cell.className = "weekday";
      cell.textContent = day.toLocaleDateString(api.language, { weekday: "narrow" });
      grid.append(cell);
    }
    const lead = (shown.getDay() - first + 7) % 7;
    const start = new Date(shown.getFullYear(), shown.getMonth(), 1 - lead);
    const today = dateOf(new Date());
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && day.getMonth() !== shown.getMonth()) break;
      const date = dateOf(day);
      const button = document.createElement("button");
      button.className = "day";
      if (day.getMonth() !== shown.getMonth()) button.classList.add("outside");
      if (date === today) button.classList.add("today");
      if (dates.has(date)) button.classList.add("has-note");
      button.textContent = String(day.getDate());
      button.dataset.date = date;
      button.setAttribute("aria-label", day.toLocaleDateString(api.language, { dateStyle: "full" }));
      button.onclick = () => api.postMessage({ type: "open", date: date });
      grid.append(button);
    }
  }

  $("prev").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1);
    render();
  };
  $("next").onclick = () => {
    shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1);
    render();
  };
  $("today").onclick = () => {
    const now = new Date();
    shown = new Date(now.getFullYear(), now.getMonth(), 1);
    render();
    api.postMessage({ type: "open", date: dateOf(now) });
  };

  api.onMessage((message) => {
    if (message.type !== "dates") return;
    hasFolder = message.dates !== null;
    dates = new Set(message.dates || []);
    weekStart = message.weekStart || "monday";
    render();
  });
  render();
  api.postMessage({ type: "ready" });
})();
