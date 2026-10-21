(function () {
  "use strict";
  const api = acquireTextusApi();
  const t =
    api.language === "zh"
      ? { fit: "适应窗口", actual: "原始大小", source: "源码", picture: "图片" }
      : { fit: "Fit", actual: "Actual size", source: "Source", picture: "Picture" };
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const image = $("image");
  let zoom = 1;
  let fit = true;

  $("fit").textContent = t.fit;
  $("actual").textContent = t.actual;
  $("source").textContent = t.source;

  const scaleNow = () =>
    image.naturalWidth ? image.width / image.naturalWidth : 1;

  function show() {
    stage.classList.toggle("fit", fit);
    image.style.width = fit ? "" : image.naturalWidth * zoom + "px";
    $("zoom").textContent = Math.round((fit ? scaleNow() : zoom) * 100) + "%";
  }
  function setZoom(next) {
    fit = false;
    zoom = Math.min(16, Math.max(0.05, next));
    show();
  }
  const current = () => (fit ? scaleNow() : zoom);
  $("zoom-in").onclick = () => setZoom(current() * 1.25);
  $("zoom-out").onclick = () => setZoom(current() / 1.25);
  $("actual").onclick = () => setZoom(1);
  $("fit").onclick = () => {
    fit = true;
    show();
  };
  stage.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(current() * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );
  window.addEventListener("resize", () => fit && show());

  const size = (bytes) =>
    bytes < 1024 * 1024
      ? Math.max(1, Math.round(bytes / 1024)) + " KB"
      : (bytes / 1024 / 1024).toFixed(1) + " MB";

  api.onMessage((message) => {
    if (message.type !== "file") return;
    const svg = /\.svg$/i.test(message.name);
    // Shown as a picture, an SVG's scripts never run.
    image.src = URL.createObjectURL(
      new Blob([message.bytes], { type: svg ? "image/svg+xml" : "" }),
    );
    image.alt = message.name;
    image.onload = () => {
      $("info").textContent =
        image.naturalWidth +
        " × " +
        image.naturalHeight +
        " · " +
        size(message.bytes.length);
      show();
    };
    if (!svg) return;
    const button = $("source");
    const code = $("code");
    button.hidden = false;
    code.textContent = new TextDecoder().decode(message.bytes);
    button.onclick = () => {
      const toSource = code.hidden;
      code.hidden = !toSource;
      stage.hidden = toSource;
      button.textContent = toSource ? t.picture : t.source;
    };
  });
  api.postMessage({ type: "ready" });
})();
