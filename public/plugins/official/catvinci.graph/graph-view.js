// A force-directed graph on a canvas: nodes pushed apart, links pulling
// together, settling over a few seconds. Drag the background to move, the
// wheel (or a pinch) to zoom, a node to place it; hover lights its links,
// a click opens it. Repulsion is computed on a grid of nearby nodes, so a
// folder of thousands of documents still moves smoothly.
(function (root) {
  "use strict";

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  }

  function createGraphView(canvas, options) {
    const ctx = canvas.getContext("2d");
    let nodes = [];
    let edges = [];
    let byId = new Map();
    let neighbours = new Map();
    let focus = null;
    let query = "";
    let hover = null;
    let dragging = null;
    let panning = null;
    let alpha = 0;
    let frame = 0;
    let view = { x: 0, y: 0, k: 1 };
    let size = { w: 0, h: 0, ratio: 1 };
    let colors = {};

    function readColors() {
      colors = {
        bg: cssVar("--bg", "#fff"),
        text: cssVar("--editor-text", "#24272e"),
        muted: cssVar("--chrome-muted", "#646b77"),
        line: cssVar("--border-color", "#e1e4ea"),
        accent: cssVar("--chrome-accent", "#315ed1"),
        node: cssVar("--sidebar-text", "#505866"),
        font: cssVar("--font-sans", "sans-serif"),
      };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size = { w: rect.width, h: rect.height, ratio: ratio };
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      draw();
    }

    function radius(node) {
      return 3.5 + Math.min(9, Math.sqrt(node.degree || 0) * 1.8);
    }

    function setData(data, focusId) {
      const old = byId;
      byId = new Map();
      nodes = data.nodes.map(function (n, i) {
        const prev = old.get(n.id);
        // Kept where it was; a new one starts near the middle, on a spiral.
        const angle = i * 2.4;
        const r = 30 * Math.sqrt(i + 1);
        const node = Object.assign({}, n, {
          x: prev ? prev.x : Math.cos(angle) * r,
          y: prev ? prev.y : Math.sin(angle) * r,
          vx: 0,
          vy: 0,
          degree: 0,
        });
        byId.set(n.id, node);
        return node;
      });
      neighbours = new Map(nodes.map((n) => [n.id, new Set()]));
      edges = [];
      for (const e of data.edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        edges.push({ a: a, b: b });
        a.degree++;
        b.degree++;
        neighbours.get(a.id).add(b.id);
        neighbours.get(b.id).add(a.id);
      }
      focus = focusId || null;
      heat(1);
    }

    function setFocus(id) {
      focus = id;
      draw();
    }

    function setQuery(text) {
      query = String(text || "").toLowerCase();
      draw();
    }

    function heat(value) {
      alpha = Math.max(alpha, value);
      if (!frame) frame = requestAnimationFrame(tick);
    }

    function step() {
      const cell = 120;
      const grid = new Map();
      for (const n of nodes) {
        const key = Math.floor(n.x / cell) + "," + Math.floor(n.y / cell);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(n);
      }
      const strength = 900;
      for (const n of nodes) {
        const gx = Math.floor(n.x / cell);
        const gy = Math.floor(n.y / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(gx + dx + "," + (gy + dy));
            if (!bucket) continue;
            for (const m of bucket) {
              if (m === n) continue;
              let x = n.x - m.x;
              let y = n.y - m.y;
              let d2 = x * x + y * y;
              if (d2 < 0.01) {
                x = Math.random() - 0.5;
                y = Math.random() - 0.5;
                d2 = 0.5;
              }
              if (d2 > cell * cell) continue;
              const f = (strength / d2) * alpha;
              n.vx += x * f * 0.01;
              n.vy += y * f * 0.01;
            }
          }
        // A gentle pull to the middle keeps islands in view.
        n.vx -= n.x * 0.002 * alpha;
        n.vy -= n.y * 0.002 * alpha;
      }
      for (const e of edges) {
        const x = e.b.x - e.a.x;
        const y = e.b.y - e.a.y;
        const d = Math.sqrt(x * x + y * y) || 1;
        const f = ((d - 70) / d) * 0.06 * alpha;
        e.a.vx += x * f;
        e.a.vy += y * f;
        e.b.vx -= x * f;
        e.b.vy -= y * f;
      }
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx *= 0.6;
        n.vy *= 0.6;
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha *= 0.985;
    }

    function tick() {
      frame = 0;
      // Several small steps a frame at first, so a big graph settles fast.
      const steps = nodes.length > 1500 ? 1 : 2;
      for (let i = 0; i < steps; i++) step();
      draw();
      if (alpha > 0.02 || dragging) frame = requestAnimationFrame(tick);
    }

    function toScreen(n) {
      return {
        x: size.w / 2 + (n.x + view.x) * view.k,
        y: size.h / 2 + (n.y + view.y) * view.k,
      };
    }
    function toWorld(px, py) {
      return {
        x: (px - size.w / 2) / view.k - view.x,
        y: (py - size.h / 2) / view.k - view.y,
      };
    }

    function draw() {
      if (!size.w) return;
      ctx.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, size.w, size.h);
      const lit = hover ? neighbours.get(hover.id) : null;
      const matches = (n) => !query || n.name.toLowerCase().includes(query);
      ctx.lineWidth = 1;
      for (const e of edges) {
        const on = hover && (e.a === hover || e.b === hover);
        ctx.strokeStyle = on ? colors.accent : colors.line;
        ctx.globalAlpha = hover && !on ? 0.35 : 1;
        const a = toScreen(e.a);
        const b = toScreen(e.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const showLabels = view.k > 0.6 || nodes.length < 60;
      ctx.font =
        Math.round(11 * Math.min(1.4, Math.max(0.9, view.k))) +
        "px " +
        colors.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of nodes) {
        const p = toScreen(n);
        const r = radius(n) * Math.min(1.6, Math.max(0.6, view.k));
        if (p.x < -50 || p.y < -50 || p.x > size.w + 50 || p.y > size.h + 50)
          continue;
        const dim =
          (hover && n !== hover && !(lit && lit.has(n.id))) || !matches(n);
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle =
          n.id === focus || n === hover
            ? colors.accent
            : n.missing
              ? colors.bg
              : colors.node;
        ctx.fill();
        if (n.missing) {
          ctx.strokeStyle = colors.muted;
          ctx.stroke();
        }
        if (showLabels || n === hover || n.id === focus) {
          ctx.fillStyle = n.missing ? colors.muted : colors.text;
          ctx.fillText(n.name, p.x, p.y + r + 3);
        }
      }
      ctx.globalAlpha = 1;
    }

    function nodeAt(px, py) {
      let best = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const p = toScreen(n);
        const r = radius(n) * Math.min(1.6, Math.max(0.6, view.k)) + 4;
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < r * r && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    function point(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    let downAt = null;
    canvas.addEventListener("pointerdown", function (e) {
      const p = point(e);
      downAt = p;
      canvas.setPointerCapture(e.pointerId);
      const n = nodeAt(p.x, p.y);
      if (n) {
        dragging = n;
        heat(0.3);
      } else panning = { x: p.x, y: p.y, vx: view.x, vy: view.y };
    });
    canvas.addEventListener("pointermove", function (e) {
      const p = point(e);
      if (dragging) {
        const w = toWorld(p.x, p.y);
        dragging.x = w.x;
        dragging.y = w.y;
        dragging.vx = dragging.vy = 0;
        heat(0.3);
      } else if (panning) {
        view.x = panning.vx + (p.x - panning.x) / view.k;
        view.y = panning.vy + (p.y - panning.y) / view.k;
        draw();
      } else {
        const n = nodeAt(p.x, p.y);
        if (n !== hover) {
          hover = n;
          canvas.style.cursor = n ? "pointer" : "grab";
          canvas.title = n ? n.rel || n.name : "";
          draw();
        }
      }
    });
    canvas.addEventListener("pointerup", function (e) {
      const p = point(e);
      const moved = downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4;
      if (dragging && !moved && !dragging.missing) options.onOpen(dragging.id);
      dragging = null;
      panning = null;
    });
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        const p = point(e);
        const before = toWorld(p.x, p.y);
        view.k = Math.min(
          4,
          Math.max(0.15, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)),
        );
        const after = toWorld(p.x, p.y);
        view.x += after.x - before.x;
        view.y += after.y - before.y;
        draw();
      },
      { passive: false },
    );
    canvas.addEventListener("pointerleave", function () {
      if (hover) {
        hover = null;
        draw();
      }
    });

    readColors();
    new ResizeObserver(resize).observe(canvas);
    new MutationObserver(function () {
      readColors();
      draw();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const styles = document.getElementById("textus-theme");
    if (styles)
      new MutationObserver(function () {
        readColors();
        draw();
      }).observe(styles, {
        childList: true,
        characterData: true,
        subtree: true,
      });

    return {
      setData: setData,
      setFocus: setFocus,
      setQuery: setQuery,
      zoomToFit: function () {
        if (!nodes.length) return;
        const xs = nodes.map((n) => n.x);
        const ys = nodes.map((n) => n.y);
        const w = Math.max(...xs) - Math.min(...xs) + 80;
        const h = Math.max(...ys) - Math.min(...ys) + 80;
        view.k = Math.min(2, Math.max(0.15, Math.min(size.w / w, size.h / h)));
        view.x = -(Math.max(...xs) + Math.min(...xs)) / 2;
        view.y = -(Math.max(...ys) + Math.min(...ys)) / 2;
        draw();
      },
      nodeCount: () => nodes.length,
      edgeCount: () => edges.length,
    };
  }

  root.createGraphView = createGraphView;
})(window);
