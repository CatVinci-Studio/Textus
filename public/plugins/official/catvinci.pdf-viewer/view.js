(function () {
  "use strict";
  const api = acquireTextusApi();
  const t =
    api.language === "zh"
      ? { fit: "适应宽度", loading: "正在打开…", failed: "无法打开这个 PDF：" }
      : {
          fit: "Fit width",
          loading: "Opening…",
          failed: "This PDF can't be opened: ",
        };
  const $ = (id) => document.getElementById(id);
  const viewer = $("viewer");
  const status = $("status");
  $("fit").textContent = t.fit;

  const libReady = new Promise((resolve) => {
    if (window.pdfjsLib) resolve();
    else window.addEventListener("pdfjs-ready", resolve, { once: true });
  });

  let pdf = null;
  let scale = 1;
  let fitWidth = true;
  let baseWidth = 612;
  let pages = [];
  let observer = null;

  function fitScale() {
    return Math.max(0.25, (viewer.clientWidth - 48) / baseWidth);
  }

  function showZoom() {
    $("zoom").textContent = Math.round(scale * 100) + "%";
  }

  // Each page is a placeholder of its size until it comes into view, then
  // drawn - a long PDF opens at once and draws only what is looked at.
  async function draw(div) {
    if (div.dataset.drawn === String(scale)) return;
    div.dataset.drawn = String(scale);
    const page = await pdf.getPage(Number(div.dataset.page));
    const viewport = page.getViewport({ scale: scale });
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    div.style.width = viewport.width + "px";
    div.style.height = viewport.height + "px";
    await page.render({
      canvas: canvas,
      viewport: viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    if (div.dataset.drawn !== String(scale)) return;
    const text = document.createElement("div");
    text.className = "textLayer";
    div.style.setProperty("--total-scale-factor", String(scale));
    div.replaceChildren(canvas, text);
    await new window.pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: text,
      viewport: viewport,
    }).render();
  }

  async function layout() {
    observer?.disconnect();
    const first = await pdf.getPage(1);
    const base = first.getViewport({ scale: 1 });
    baseWidth = base.width;
    if (fitWidth) scale = fitScale();
    showZoom();
    const at = currentPage();
    viewer.textContent = "";
    pages = [];
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) void draw(entry.target);
        updatePage();
      },
      { root: viewer, rootMargin: "300px 0px" },
    );
    for (let n = 1; n <= pdf.numPages; n++) {
      const div = document.createElement("div");
      div.className = "page";
      div.dataset.page = String(n);
      div.style.width = base.width * scale + "px";
      div.style.height = base.height * scale + "px";
      viewer.append(div);
      pages.push(div);
      observer.observe(div);
    }
    $("count").textContent = "/ " + pdf.numPages;
    $("page").max = String(pdf.numPages);
    if (at > 1) goTo(at);
  }

  function currentPage() {
    const top = viewer.scrollTop + viewer.clientHeight / 3;
    const page = pages.find((div) => div.offsetTop + div.offsetHeight > top);
    return page ? Number(page.dataset.page) : 1;
  }
  function updatePage() {
    if (document.activeElement !== $("page"))
      $("page").value = String(currentPage());
  }
  function goTo(n) {
    const page = pages[Math.min(pages.length, Math.max(1, n)) - 1];
    if (page) viewer.scrollTop = page.offsetTop - 16;
  }
  viewer.addEventListener("scroll", updatePage, { passive: true });

  function setScale(next) {
    fitWidth = false;
    scale = Math.min(5, Math.max(0.25, next));
    void layout();
  }
  $("zoom-in").onclick = () => setScale(scale * 1.2);
  $("zoom-out").onclick = () => setScale(scale / 1.2);
  $("fit").onclick = () => {
    fitWidth = true;
    void layout();
  };
  $("prev").onclick = () => goTo(currentPage() - 1);
  $("next").onclick = () => goTo(currentPage() + 1);
  $("page").addEventListener("change", () => goTo(Number($("page").value)));
  viewer.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );
  let resizing = 0;
  window.addEventListener("resize", () => {
    if (!pdf || !fitWidth) return;
    clearTimeout(resizing);
    resizing = setTimeout(() => void layout(), 150);
  });

  api.onMessage(async (message) => {
    if (message.type !== "file") return;
    status.textContent = t.loading;
    try {
      await libReady;
      const lib = window.pdfjsLib;
      pdf = await lib.getDocument({
        data: message.bytes,
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;
      fitWidth = message.zoom !== "100";
      scale = 1;
      status.textContent = "";
      await layout();
    } catch (err) {
      status.textContent = t.failed + ((err && err.message) || err);
    }
  });
  api.postMessage({ type: "ready" });
})();
