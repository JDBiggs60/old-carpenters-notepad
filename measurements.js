/* Old Carpenter's Notepad — Measurements & Sketches (v1.5)
   Stores projects in a special synced note titled __SKETCHES__.
   Geometry is kept in inches internally; display units are for labels only. */
(function (global) {
  "use strict";

  const SKETCH_TITLE = "__SKETCHES__";
  const PPI = 10; // screen pixels per inch at zoom 1
  const DIM_OFFSET = 0.75; // inches away from shape edge for auto dims

  const WORD_NUM = {
    zero: 0, oh: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
  };
  const WORD_FRAC = {
    half: 1 / 2, "one half": 1 / 2, "a half": 1 / 2, quarter: 1 / 4, "one quarter": 1 / 4,
    "a quarter": 1 / 4, "three quarters": 3 / 4, eighth: 1 / 8, "one eighth": 1 / 8,
    "three eighths": 3 / 8, "five eighths": 5 / 8, "seven eighths": 7 / 8,
    sixteenth: 1 / 16, "one sixteenth": 1 / 16, "three sixteenths": 3 / 16,
    "five sixteenths": 5 / 16, "seven sixteenths": 7 / 16, "nine sixteenths": 9 / 16,
    "eleven sixteenths": 11 / 16, "thirteen sixteenths": 13 / 16,
    "fifteen sixteenths": 15 / 16
  };

  let sketchDirty = false;
  let currentProjectId = null;
  let currentDrawingId = null;
  let currentTool = "select";
  let selectedIds = [];
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let dimDraft = null;
  let freehandStroke = null;
  let panelOpen = null;
  let photoAnnotateId = null;
  let photoTool = "hdim";
  let photoDraft = null;
  let photoUndo = [];
  let photoRedo = [];
  let voicePending = null;
  let helpOpen = false;
  let polyDraft = null;

  function uid() {
    return global.crypto?.randomUUID?.() || ("id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  function sketchesNote() {
    let n = notes.find((x) => !x.trash && x.title === SKETCH_TITLE);
    if (!n) {
      n = {
        id: uid(),
        title: SKETCH_TITLE,
        body: "",
        type: "check",
        items: [],
        pinned: true,
        trash: false,
        modified: Date.now()
      };
      notes.push(n);
      persist();
    }
    n.type = "check";
    n.items = Array.isArray(n.items) ? n.items : [];
    return n;
  }

  function projects() {
    return sketchesNote().items;
  }

  function getProject(id) {
    return projects().find((p) => p.id === id) || null;
  }

  function currentProject() {
    return currentProjectId ? getProject(currentProjectId) : null;
  }

  function currentDrawing() {
    const p = currentProject();
    if (!p) return null;
    return (p.drawings || []).find((d) => d.id === currentDrawingId) || p.drawings?.[0] || null;
  }

  function emptyDrawing(name) {
    return {
      id: uid(),
      name: name || "Front View",
      zoom: 1,
      panX: 0,
      panY: 0,
      grid: true,
      snap: true,
      rulers: true,
      showDimensions: true,
      shapes: [],
      dimensions: [],
      strokes: [],
      texts: []
    };
  }

  function emptyProject(name) {
    const now = Date.now();
    return {
      id: uid(),
      name: name || "New Project",
      created: now,
      modified: now,
      description: "",
      notes: "",
      unit: "in",
      precision: "1/16",
      measurementList: [],
      drawings: [emptyDrawing("Front View")],
      photos: []
    };
  }

  let saveTimer = null;
  function markDirty() {
    sketchDirty = true;
    const el = document.getElementById("msUnsaved");
    if (el) el.textContent = "Unsaved changes";
    const p = currentProject();
    if (p) p.modified = Date.now();
    // Safe autosave: write complete project JSON after a short pause (same pattern as notes).
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const n = sketchesNote();
        n.modified = Date.now();
        // Validate projects are still an array before writing.
        if (!Array.isArray(n.items)) return;
        persist();
        clearDirty();
      } catch (e) {
        console.error("Sketch autosave failed:", e);
        const status = document.getElementById("msUnsaved");
        if (status) status.textContent = "Save problem — try Save again";
      }
    }, 600);
  }

  function clearDirty() {
    sketchDirty = false;
    const el = document.getElementById("msUnsaved");
    if (el) el.textContent = "Saved";
  }

  function saveSketches(force) {
    const n = sketchesNote();
    n.modified = Date.now();
    persist();
    clearDirty();
    if (force !== false) setSyncStatus?.(navigator.onLine ? "Cloud synced" : "Saved on this device");
    return true;
  }

  function pushUndo() {
    const d = currentDrawing();
    if (!d) return;
    undoStack.push(JSON.stringify({ shapes: d.shapes, dimensions: d.dimensions, strokes: d.strokes, texts: d.texts }));
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }

  function applySnapshot(raw) {
    const d = currentDrawing();
    if (!d || !raw) return;
    const s = JSON.parse(raw);
    d.shapes = s.shapes;
    d.dimensions = s.dimensions;
    d.strokes = s.strokes;
    d.texts = s.texts;
    selectedIds = [];
    markDirty();
    redraw();
  }

  function undo() {
    if (!undoStack.length) return;
    const d = currentDrawing();
    if (!d) return;
    redoStack.push(JSON.stringify({ shapes: d.shapes, dimensions: d.dimensions, strokes: d.strokes, texts: d.texts }));
    applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    const d = currentDrawing();
    if (!d) return;
    undoStack.push(JSON.stringify({ shapes: d.shapes, dimensions: d.dimensions, strokes: d.strokes, texts: d.texts }));
    applySnapshot(redoStack.pop());
  }

  /* ---------- measurement parsing / formatting ---------- */

  function parseFractionToken(token) {
    const t = String(token || "").trim().replace(/"/g, "").replace(/inches?/i, "").trim();
    if (!t) return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    let m = t.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const den = Number(m[3]);
      if (!den) return null;
      return Number(m[1]) + (Number(m[2]) / den) * (Number(m[1]) < 0 ? -1 : 1);
    }
    m = t.match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const den = Number(m[2]);
      if (!den) return null;
      return Number(m[1]) / den;
    }
    return null;
  }

  function parseMeasure(input) {
    const raw = String(input || "").trim();
    if (!raw) return { ok: false, error: "Enter a measurement." };
    let s = raw.toLowerCase().replace(/inches?/g, "").replace(/in\b/g, "").replace(/"/g, "").replace(/,/g, "").trim();
    if (/mm\b|millimeters?/.test(s)) {
      s = s.replace(/mm\b|millimeters?/g, "").trim();
      const n = parseFractionToken(s);
      if (n == null || !Number.isFinite(n)) return { ok: false, error: "Could not read that millimeter value." };
      if (n < 0) return { ok: false, error: "Measurements cannot be negative." };
      return { ok: true, inches: n / 25.4 };
    }
    const spoken = spokenToNumber(s);
    if (spoken != null) {
      if (spoken < 0) return { ok: false, error: "Measurements cannot be negative." };
      return { ok: true, inches: spoken };
    }
    const n = parseFractionToken(s);
    if (n == null || !Number.isFinite(n)) return { ok: false, error: "Unrecognized measurement. Try 36, 36 1/2, or 5 1/4." };
    if (n < 0) return { ok: false, error: "Measurements cannot be negative." };
    return { ok: true, inches: n };
  }

  function spokenToNumber(text) {
    let s = String(text || "").toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9\s./]/g, " ").replace(/\s+/g, " ").trim();
    if (!s || /\d/.test(s)) return null;
    for (const [phrase, val] of Object.entries(WORD_FRAC).sort((a, b) => b[0].length - a[0].length)) {
      if (s === phrase || s.endsWith(" " + phrase)) {
        const head = s.slice(0, Math.max(0, s.length - phrase.length)).replace(/\band\b/g, " ").replace(/\b(a|an)\b/g, " ").trim();
        if (!head) return val;
        const whole = wordsToInt(head);
        if (whole == null) return null;
        return whole + val;
      }
    }
    if (s.includes(" and ")) {
      const parts = s.split(/\s+and\s+/);
      if (parts.length === 2) {
        const whole = wordsToInt(parts[0]);
        const frac = WORD_FRAC[parts[1]] ?? spokenToNumber(parts[1]);
        if (whole != null && frac != null && frac < 1) return whole + frac;
      }
    }
    return wordsToInt(s);
  }

  function wordsToInt(text) {
    const words = String(text || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    let total = 0, current = 0;
    for (const w of words) {
      if (w === "and") continue;
      if (!(w in WORD_NUM)) return null;
      const v = WORD_NUM[w];
      if (v === 100) {
        current = (current || 1) * 100;
      } else {
        current += v;
      }
    }
    total += current;
    return total;
  }

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }

  function formatInches(inches, precision) {
    if (!Number.isFinite(inches)) return "—";
    const sign = inches < 0 ? "-" : "";
    const v = Math.abs(inches);
    if (precision === "mm") return sign + (v * 25.4).toFixed(1) + " mm";
    if (precision === "decimal") return sign + (Math.round(v * 1000) / 1000) + '"';
    let den = 16;
    if (precision === "1/4") den = 4;
    else if (precision === "1/8") den = 8;
    else if (precision === "1/16") den = 16;
    const whole = Math.floor(v + 1e-9);
    let num = Math.round((v - whole) * den);
    if (num === den) return sign + (whole + 1) + '"';
    if (num === 0) return sign + whole + '"';
    const g = gcd(num, den);
    num /= g; den /= g;
    return sign + (whole ? whole + " " : "") + num + "/" + den + '"';
  }

  function displayValue(inches, project) {
    const p = project || currentProject();
    const unit = p?.unit || "in";
    const precision = unit === "mm" ? "mm" : (p?.precision || "1/16");
    return formatInches(inches, precision);
  }

  function parseVoiceMeasurements(text) {
    const original = String(text || "").trim();
    if (!original) return { ok: false, error: "Paste or dictate a measurement phrase first.", original };
    const lower = original.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
    const result = { ok: true, ambiguous: false, messages: [], original, quantity: 1, length: null, width: null, thickness: null, item: "Board" };

    const qty = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+boards?\b/);
    if (qty) {
      const q = WORD_NUM[qty[1]] ?? Number(qty[1]);
      if (Number.isFinite(q)) result.quantity = q;
    }

    function extractBefore(keywords) {
      for (const key of keywords) {
        const re = new RegExp("([a-z0-9 /.-]+?)\\s*(?:inches?|in)?\\s*" + key + "\\b");
        const m = lower.match(re);
        if (!m) continue;
        let chunk = m[1].replace(/^(?:and|by|a|an|of)\s+/g, "").trim();
        chunk = chunk.replace(/.*\b(?:boards?|long|length|wide|width|thick|thickness|by)\s+/g, "").trim();
        const parsed = parseMeasure(chunk);
        if (parsed.ok) return parsed.inches;
        result.messages.push("Could not read value before “" + key + "”.");
        result.ambiguous = true;
      }
      return null;
    }

    result.length = extractBefore(["long", "length"]);
    result.width = extractBefore(["wide", "width"]);
    result.thickness = extractBefore(["thick", "thickness"]);

    // "three quarters thick" with no "inches"
    if (result.thickness == null) {
      const m = lower.match(/\b((?:one|two|three|four|five|six|seven|eight|nine|a|an)?\s*(?:half|quarter|quarters|eighth|eighths|sixteenth|sixteenths))\s+thick\b/);
      if (m) {
        const parsed = parseMeasure(m[1]);
        if (parsed.ok) result.thickness = parsed.inches;
      }
    }

    if (result.length == null && result.width == null && result.thickness == null) {
      const single = parseMeasure(original);
      if (single.ok) {
        result.length = single.inches;
      } else {
        return { ok: false, ambiguous: true, error: "Could not confidently read measurements from that phrase. Please correct it below.", original, quantity: 1, length: null, width: null, thickness: null, item: "Board" };
      }
    }
    return result;
  }

  /* ---------- geometry helpers ---------- */

  function snapVal(v, drawing) {
    if (!drawing?.snap) return v;
    const step = 0.125;
    return Math.round(v / step) * step;
  }

  function worldFromEvent(ev, canvas, drawing) {
    const rect = canvas.getBoundingClientRect();
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const x = drawing.panX + sx / (PPI * drawing.zoom);
    const y = drawing.panY + sy / (PPI * drawing.zoom);
    return { x: snapVal(x, drawing), y: snapVal(y, drawing), sx, sy };
  }

  function shapeBounds(sh) {
    if (sh.type === "rect" || sh.type === "ellipse") {
      return { x: sh.x, y: sh.y, w: sh.w, h: sh.h };
    }
    if (sh.type === "circle") {
      return { x: sh.cx - sh.r, y: sh.cy - sh.r, w: sh.r * 2, h: sh.r * 2 };
    }
    if (sh.type === "line") {
      return {
        x: Math.min(sh.x1, sh.x2),
        y: Math.min(sh.y1, sh.y2),
        w: Math.abs(sh.x2 - sh.x1) || 0.01,
        h: Math.abs(sh.y2 - sh.y1) || 0.01
      };
    }
    if (sh.type === "triangle" || sh.type === "gable" || sh.type === "polyline") {
      const pts = sh.points || [];
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX, y: minY, w: maxX - minX || 0.01, h: maxY - minY || 0.01 };
    }
    return { x: sh.x || 0, y: sh.y || 0, w: 1, h: 1 };
  }

  function hitShape(drawing, x, y) {
    const tol = 0.35 / drawing.zoom;
    for (let i = drawing.shapes.length - 1; i >= 0; i--) {
      const sh = drawing.shapes[i];
      const b = shapeBounds(sh);
      if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return sh;
    }
    for (let i = drawing.strokes.length - 1; i >= 0; i--) {
      const st = drawing.strokes[i];
      for (const p of st.points) {
        if (Math.hypot(p.x - x, p.y - y) < Math.max(tol, (st.width || 0.08) * 2)) return st;
      }
    }
    return null;
  }

  function ensureAutoDimensions(shape, drawing) {
    drawing.dimensions = (drawing.dimensions || []).filter((d) => d.shapeId !== shape.id);
    if (shape.autoDims === false) return;
    if (shape.type === "rect" || shape.type === "ellipse") {
      drawing.dimensions.push({
        id: uid(), shapeId: shape.id, kind: "linear", orient: "h",
        x1: shape.x, y1: shape.y + shape.h, x2: shape.x + shape.w, y2: shape.y + shape.h,
        offset: DIM_OFFSET, geometric: true
      });
      drawing.dimensions.push({
        id: uid(), shapeId: shape.id, kind: "linear", orient: "v",
        x1: shape.x + shape.w, y1: shape.y, x2: shape.x + shape.w, y2: shape.y + shape.h,
        offset: DIM_OFFSET, geometric: true
      });
    } else if (shape.type === "circle") {
      drawing.dimensions.push({
        id: uid(), shapeId: shape.id, kind: "linear", orient: "h",
        x1: shape.cx - shape.r, y1: shape.cy + shape.r, x2: shape.cx + shape.r, y2: shape.cy + shape.r,
        offset: DIM_OFFSET, geometric: true
      });
    } else if (shape.type === "line") {
      drawing.dimensions.push({
        id: uid(), shapeId: shape.id, kind: "linear", orient: "aligned",
        x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
        offset: DIM_OFFSET, geometric: true
      });
    } else if (shape.type === "triangle" || shape.type === "gable") {
      const pts = shape.points;
      if (pts?.length >= 3) {
        drawing.dimensions.push({
          id: uid(), shapeId: shape.id, kind: "linear", orient: "h",
          x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y,
          offset: DIM_OFFSET, geometric: true
        });
        drawing.dimensions.push({
          id: uid(), shapeId: shape.id, kind: "linear", orient: "v",
          x1: pts[1].x, y1: Math.min(pts[0].y, pts[2].y), x2: pts[1].x, y2: Math.max(pts[0].y, pts[2].y),
          offset: DIM_OFFSET, geometric: true
        });
        if (shape.type === "gable") {
          const rise = Math.abs(pts[2].y - pts[0].y);
          const half = Math.abs(pts[1].x - pts[0].x) / 2;
          const slope = Math.hypot(half, rise);
          drawing.dimensions.push({
            id: uid(), shapeId: shape.id, kind: "linear", orient: "aligned",
            x1: pts[0].x, y1: pts[0].y, x2: pts[2].x, y2: pts[2].y,
            offset: DIM_OFFSET * 1.2, geometric: true, note: "slope " + slope
          });
        }
      }
    }
  }

  function syncDimsFromShape(shape, drawing) {
    const dims = (drawing.dimensions || []).filter((d) => d.shapeId === shape.id && d.geometric);
    if (!dims.length) {
      if (shape.autoDims !== false) ensureAutoDimensions(shape, drawing);
      return;
    }
    for (const d of dims) {
      if (shape.type === "rect" || shape.type === "ellipse") {
        if (d.orient === "h") {
          d.x1 = shape.x; d.y1 = shape.y + shape.h; d.x2 = shape.x + shape.w; d.y2 = shape.y + shape.h;
        } else {
          d.x1 = shape.x + shape.w; d.y1 = shape.y; d.x2 = shape.x + shape.w; d.y2 = shape.y + shape.h;
        }
      } else if (shape.type === "circle") {
        d.x1 = shape.cx - shape.r; d.y1 = shape.cy + shape.r; d.x2 = shape.cx + shape.r; d.y2 = shape.cy + shape.r;
      } else if (shape.type === "line") {
        d.x1 = shape.x1; d.y1 = shape.y1; d.x2 = shape.x2; d.y2 = shape.y2;
      } else if ((shape.type === "triangle" || shape.type === "gable") && shape.points?.length >= 3) {
        const pts = shape.points;
        if (d.orient === "h") {
          d.x1 = pts[0].x; d.y1 = pts[0].y; d.x2 = pts[1].x; d.y2 = pts[1].y;
        } else if (d.orient === "v") {
          d.x1 = pts[1].x; d.y1 = Math.min(pts[0].y, pts[2].y); d.x2 = pts[1].x; d.y2 = Math.max(pts[0].y, pts[2].y);
        } else {
          d.x1 = pts[0].x; d.y1 = pts[0].y; d.x2 = pts[2].x; d.y2 = pts[2].y;
        }
      }
    }
  }

  function resizeShapeFromDim(shape, dim, newInches) {
    if (!shape || !Number.isFinite(newInches) || newInches <= 0) return false;
    if (shape.type === "rect" || shape.type === "ellipse") {
      if (dim.orient === "h") shape.w = newInches;
      else shape.h = newInches;
      return true;
    }
    if (shape.type === "circle" && dim.orient === "h") {
      shape.r = newInches / 2;
      return true;
    }
    if (shape.type === "line") {
      const ang = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
      shape.x2 = shape.x1 + Math.cos(ang) * newInches;
      shape.y2 = shape.y1 + Math.sin(ang) * newInches;
      return true;
    }
    return false;
  }

  function deleteSelected() {
    const d = currentDrawing();
    if (!d || !selectedIds.length) return;
    pushUndo();
    const ids = new Set(selectedIds);
    d.shapes = d.shapes.filter((s) => !ids.has(s.id));
    d.strokes = d.strokes.filter((s) => !ids.has(s.id));
    d.texts = d.texts.filter((s) => !ids.has(s.id));
    d.dimensions = d.dimensions.filter((dim) => !ids.has(dim.id) && !ids.has(dim.shapeId));
    selectedIds = [];
    markDirty();
    redraw();
    renderSelectionInfo();
  }

  /* ---------- canvas drawing ---------- */

  function canvasEl() {
    return document.getElementById("msCanvas");
  }

  function redraw() {
    const canvas = canvasEl();
    const d = currentDrawing();
    const p = currentProject();
    if (!canvas || !d) return;
    const ctx = canvas.getContext("2d");
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 420;
    const ratio = global.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(cssW * ratio) || canvas.height !== Math.floor(cssH * ratio)) {
      canvas.width = Math.floor(cssW * ratio);
      canvas.height = Math.floor(cssH * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    const z = PPI * d.zoom;
    ctx.save();
    ctx.translate(-d.panX * z, -d.panY * z);
    ctx.scale(z, z);

    if (d.grid) {
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = 1 / z;
      const x0 = Math.floor(d.panX);
      const y0 = Math.floor(d.panY);
      const x1 = d.panX + cssW / z;
      const y1 = d.panY + cssH / z;
      for (let x = x0; x <= x1; x++) {
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      }
      for (let y = y0; y <= y1; y++) {
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      }
    }

    for (const st of d.strokes || []) {
      if (!st.points?.length) continue;
      ctx.strokeStyle = st.color || "#2f2118";
      ctx.lineWidth = (st.width || 0.08);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      st.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
    }

    for (const sh of d.shapes || []) drawShape(ctx, sh, selectedIds.includes(sh.id));
    if (d.showDimensions !== false) {
      for (const dim of d.dimensions || []) drawDimension(ctx, dim, p, z);
    }
    for (const t of d.texts || []) {
      ctx.fillStyle = "#2f2118";
      ctx.font = `${(t.size || 0.35)}px sans-serif`;
      ctx.fillText(t.text || "", t.x, t.y);
    }

    if (dimDraft?.x1 != null && dimDraft.x2 != null) {
      drawDimension(ctx, dimDraft, p, z);
    }

    ctx.restore();

    if (d.rulers) drawRulers(ctx, d, cssW, cssH, p);
    const unitEl = document.getElementById("msUnitLabel");
    if (unitEl) unitEl.textContent = (p?.unit === "mm" ? "mm" : "inches") + " · " + (p?.precision || "1/16");
  }

  function drawShape(ctx, sh, selected) {
    ctx.strokeStyle = selected ? "#b44b3d" : "#2f2118";
    ctx.fillStyle = selected ? "#b44b3d18" : "#0000";
    ctx.lineWidth = selected ? 0.06 : 0.04;
    if (sh.type === "rect") {
      ctx.beginPath();
      ctx.rect(sh.x, sh.y, sh.w, sh.h);
      ctx.fill(); ctx.stroke();
      if (selected) drawHandles(ctx, shapeBounds(sh));
    } else if (sh.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.abs(sh.w / 2), Math.abs(sh.h / 2), 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (selected) drawHandles(ctx, shapeBounds(sh));
    } else if (sh.type === "circle") {
      ctx.beginPath();
      ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (selected) drawHandles(ctx, shapeBounds(sh));
    } else if (sh.type === "line") {
      ctx.beginPath();
      ctx.moveTo(sh.x1, sh.y1); ctx.lineTo(sh.x2, sh.y2); ctx.stroke();
    } else if (sh.type === "triangle" || sh.type === "gable" || sh.type === "polyline") {
      const pts = sh.points || [];
      if (pts.length) {
        ctx.beginPath();
        pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        if (sh.type !== "polyline") ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      if (selected) drawHandles(ctx, shapeBounds(sh));
    }
  }

  function drawHandles(ctx, b) {
    const s = 0.18;
    ctx.fillStyle = "#4b2d1b";
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(([x, y]) => {
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    });
  }

  function drawDimension(ctx, dim, project, z) {
    if (dim.kind === "angle") {
      const vx = dim.x2, vy = dim.y2;
      ctx.strokeStyle = "#4b2d1b";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(dim.x1, dim.y1); ctx.lineTo(vx, vy); ctx.lineTo(dim.x3 || dim.x1, dim.y3 || dim.y1);
      ctx.stroke();
      const label = dim.label || "";
      ctx.font = `${Math.max(0.28, 12 / z)}px Georgia, serif`;
      ctx.fillStyle = "#fffef6";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(vx + 0.2, vy - 0.35, tw + 0.16, 0.4);
      ctx.fillStyle = "#2f2118";
      ctx.fillText(label, vx + 0.28, vy);
      return;
    }
    const x1 = dim.x1, y1 = dim.y1, x2 = dim.x2, y2 = dim.y2;
    let ox = 0, oy = 0;
    const off = dim.offset || DIM_OFFSET;
    if (dim.orient === "h") { oy = off; }
    else if (dim.orient === "v") { ox = off; }
    else {
      const ang = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
      ox = Math.cos(ang) * off;
      oy = Math.sin(ang) * off;
    }
    const ax1 = x1 + ox, ay1 = y1 + oy, ax2 = x2 + ox, ay2 = y2 + oy;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const label = dim.annotation
      ? (dim.label || displayValue(len, project)) + " (ref)"
      : (dim.label || displayValue(len, project));

    ctx.strokeStyle = "#4b2d1b";
    ctx.fillStyle = "#4b2d1b";
    ctx.lineWidth = 0.03;
    // extension lines
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(ax1, ay1);
    ctx.moveTo(x2, y2); ctx.lineTo(ax2, ay2);
    ctx.stroke();
    // dim line
    ctx.beginPath();
    ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2);
    ctx.stroke();
    // ticks / arrowheads
    drawArrow(ctx, ax1, ay1, ax2, ay2);
    drawArrow(ctx, ax2, ay2, ax1, ay1);

    const mx = (ax1 + ax2) / 2 + (dim.labelDX || 0);
    const my = (ay1 + ay2) / 2 + (dim.labelDY || 0);
    ctx.save();
    ctx.font = `${Math.max(0.28, 12 / z)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "#fffef6";
    ctx.fillRect(mx - tw / 2 - 0.08, my - 0.2, tw + 0.16, 0.4);
    ctx.fillStyle = "#2f2118";
    ctx.fillText(label, mx, my);
    ctx.restore();
  }

  function drawArrow(ctx, x, y, towardX, towardY) {
    const ang = Math.atan2(towardY - y, towardX - x);
    const s = 0.18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang + 0.35) * s, y + Math.sin(ang + 0.35) * s);
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang - 0.35) * s, y + Math.sin(ang - 0.35) * s);
    ctx.stroke();
  }

  function drawRulers(ctx, d, w, h, project) {
    const size = 22;
    ctx.fillStyle = "#f3ebd0";
    ctx.fillRect(0, 0, w, size);
    ctx.fillRect(0, 0, size, h);
    ctx.fillStyle = "#4b2d1b";
    ctx.font = "10px sans-serif";
    const z = PPI * d.zoom;
    const step = project?.unit === "mm" ? 25.4 / 25.4 : 1; // 1 inch ticks
    const x0 = Math.floor(d.panX);
    const y0 = Math.floor(d.panY);
    for (let x = x0; x < d.panX + w / z; x += step) {
      const sx = (x - d.panX) * z;
      if (sx < size) continue;
      ctx.beginPath(); ctx.moveTo(sx, size); ctx.lineTo(sx, size - 6); ctx.strokeStyle = "#4b2d1b"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillText(displayValue(x, project).replace('"', ""), sx + 2, 12);
    }
    for (let y = y0; y < d.panY + h / z; y += step) {
      const sy = (y - d.panY) * z;
      if (sy < size) continue;
      ctx.beginPath(); ctx.moveTo(size, sy); ctx.lineTo(size - 6, sy); ctx.stroke();
      ctx.fillText(displayValue(y, project).replace('"', ""), 2, sy - 2);
    }
  }

  /* ---------- tools / pointer ---------- */

  function setTool(tool) {
    if (polyDraft && tool !== "polyline") polyDraft = null;
    currentTool = tool;
    document.querySelectorAll("[data-ms-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-ms-tool") === tool);
    });
    const canvas = canvasEl();
    if (canvas) {
      canvas.style.cursor = tool === "pan" ? "grab" : tool === "select" || tool === "move" ? "default" : "crosshair";
    }
  }

  function finishPolyline() {
    polyDraft = null;
    markDirty();
    redraw();
  }

  function onPointerDown(ev) {
    const canvas = canvasEl();
    const d = currentDrawing();
    if (!canvas || !d) return;
    if (ev.target === canvas) ev.preventDefault();
    const pt = worldFromEvent(ev, canvas, d);

    if (currentTool === "pan") {
      drag = { mode: "pan", lx: ev.touches ? ev.touches[0].clientX : ev.clientX, ly: ev.touches ? ev.touches[0].clientY : ev.clientY };
      return;
    }
    if (currentTool === "select" || currentTool === "move") {
      const hit = hitShape(d, pt.x, pt.y);
      selectedIds = hit ? [hit.id] : [];
      if (hit && (currentTool === "move" || currentTool === "select")) {
        drag = { mode: "move", id: hit.id, lx: pt.x, ly: pt.y, started: false };
      }
      redraw();
      renderSelectionInfo();
      return;
    }
    if (currentTool === "eraser") {
      const hit = hitShape(d, pt.x, pt.y);
      if (hit) {
        selectedIds = [hit.id];
        deleteSelected();
      }
      return;
    }
    if (currentTool === "pencil") {
      pushUndo();
      freehandStroke = { id: uid(), type: "stroke", width: Number(document.getElementById("msPencilWidth")?.value || 0.08), points: [{ x: pt.x, y: pt.y }] };
      d.strokes.push(freehandStroke);
      markDirty();
      return;
    }
    if (currentTool === "text") {
      const text = prompt("Text note:");
      if (text) {
        pushUndo();
        d.texts.push({ id: uid(), type: "text", x: pt.x, y: pt.y, text, size: 0.4 });
        markDirty();
        redraw();
      }
      return;
    }
    if (currentTool === "polyline") {
      if (!polyDraft) {
        pushUndo();
        polyDraft = { id: uid(), type: "polyline", points: [{ x: pt.x, y: pt.y }], autoDims: false };
        d.shapes.push(polyDraft);
        selectedIds = [polyDraft.id];
      } else {
        polyDraft.points.push({ x: pt.x, y: pt.y });
      }
      markDirty();
      redraw();
      return;
    }
    if (currentTool === "dimension" || currentTool === "angle") {
      if (!dimDraft) {
        dimDraft = {
          id: uid(),
          kind: currentTool === "angle" ? "angle" : "linear",
          orient: "aligned",
          x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
          offset: DIM_OFFSET, geometric: true, annotation: false, clicks: 1
        };
      } else if (dimDraft.kind === "angle" && dimDraft.clicks === 1) {
        dimDraft.x2 = pt.x; dimDraft.y2 = pt.y; dimDraft.clicks = 2;
      } else {
        finishDimension(pt);
      }
      redraw();
      return;
    }
    // create shapes by drag
    pushUndo();
    drag = { mode: "create", tool: currentTool, x0: pt.x, y0: pt.y };
  }

  function onPointerMove(ev) {
    const canvas = canvasEl();
    const d = currentDrawing();
    if (!canvas || !d) return;
    if (ev.target === canvas && (drag || freehandStroke || dimDraft)) ev.preventDefault();
    const pt = worldFromEvent(ev.touches && !ev.touches.length && ev.changedTouches ? { touches: ev.changedTouches, clientX: ev.changedTouches[0].clientX, clientY: ev.changedTouches[0].clientY } : ev, canvas, d);

    if (drag?.mode === "pan") {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const z = PPI * d.zoom;
      d.panX -= (cx - drag.lx) / z;
      d.panY -= (cy - drag.ly) / z;
      drag.lx = cx; drag.ly = cy;
      markDirty();
      redraw();
      return;
    }
    if (freehandStroke) {
      freehandStroke.points.push({ x: pt.x, y: pt.y });
      markDirty();
      redraw();
      return;
    }
    if (dimDraft && dimDraft.kind !== "angle" && dimDraft.clicks === 1) {
      dimDraft.x2 = pt.x; dimDraft.y2 = pt.y;
      const dx = Math.abs(dimDraft.x2 - dimDraft.x1), dy = Math.abs(dimDraft.y2 - dimDraft.y1);
      if (dx >= dy * 2) dimDraft.orient = "h";
      else if (dy >= dx * 2) dimDraft.orient = "v";
      else dimDraft.orient = "aligned";
      redraw();
      return;
    }
    if (dimDraft?.kind === "angle" && dimDraft.clicks === 2) {
      dimDraft.x3 = pt.x; dimDraft.y3 = pt.y;
      redraw();
      return;
    }
    if (drag?.mode === "move") {
      if (!drag.started) { pushUndo(); drag.started = true; }
      const dx = pt.x - drag.lx, dy = pt.y - drag.ly;
      drag.lx = pt.x; drag.ly = pt.y;
      const sh = d.shapes.find((s) => s.id === drag.id) || d.strokes.find((s) => s.id === drag.id) || d.texts.find((s) => s.id === drag.id);
      if (!sh) return;
      moveEntity(sh, dx, dy);
      if (sh.type && sh.type !== "stroke" && sh.type !== "text") syncDimsFromShape(sh, d);
      markDirty();
      redraw();
      renderSelectionInfo();
      return;
    }
    if (drag?.mode === "create") {
      // live preview via temp shape
      previewCreate(drag, pt);
    }
  }

  function moveEntity(sh, dx, dy) {
    if (sh.type === "rect" || sh.type === "ellipse" || sh.type === "text") { sh.x += dx; sh.y += dy; }
    else if (sh.type === "circle") { sh.cx += dx; sh.cy += dy; }
    else if (sh.type === "line") { sh.x1 += dx; sh.y1 += dy; sh.x2 += dx; sh.y2 += dy; }
    else if (sh.points) sh.points.forEach((p) => { p.x += dx; p.y += dy; });
    else if (sh.type === "stroke") sh.points.forEach((p) => { p.x += dx; p.y += dy; });
  }

  function previewCreate(dragState, pt) {
    const d = currentDrawing();
    d._preview = makeShapeFromDrag(dragState.tool, dragState.x0, dragState.y0, pt.x, pt.y);
    // draw with preview by temporarily inserting
    const preview = d._preview;
    const had = d.shapes;
    d.shapes = had.concat(preview ? [preview] : []);
    redraw();
    d.shapes = had;
  }

  function makeShapeFromDrag(tool, x0, y0, x1, y1) {
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (tool === "rect" && w > 0.05 && h > 0.05) return { id: "preview", type: "rect", x, y, w, h, autoDims: true };
    if (tool === "ellipse" && w > 0.05 && h > 0.05) return { id: "preview", type: "ellipse", x, y, w, h, autoDims: true };
    if (tool === "circle") {
      const r = Math.max(w, h) / 2;
      if (r > 0.05) return { id: "preview", type: "circle", cx: x0 + Math.sign(x1 - x0 || 1) * r, cy: y0 + Math.sign(y1 - y0 || 1) * r, r, autoDims: true };
    }
    if (tool === "line") return { id: "preview", type: "line", x1: x0, y1: y0, x2: x1, y2: y1, autoDims: true };
    return null;
  }

  function onPointerUp(ev) {
    const canvas = canvasEl();
    const d = currentDrawing();
    if (!canvas || !d) return;
    const pt = worldFromEvent(ev.changedTouches ? { touches: ev.changedTouches, clientX: ev.changedTouches[0].clientX, clientY: ev.changedTouches[0].clientY } : ev, canvas, d);

    if (freehandStroke) {
      freehandStroke = null;
      markDirty();
      redraw();
      drag = null;
      return;
    }
    if (drag?.mode === "create") {
      const sh = makeShapeFromDrag(drag.tool, drag.x0, drag.y0, pt.x, pt.y);
      if (sh) {
        sh.id = uid();
        d.shapes.push(sh);
        ensureAutoDimensions(sh, d);
        selectedIds = [sh.id];
        markDirty();
      }
      drag = null;
      redraw();
      renderSelectionInfo();
      return;
    }
    drag = null;
  }

  function finishDimension(pt) {
    const d = currentDrawing();
    if (!d || !dimDraft) return;
    pushUndo();
    if (dimDraft.kind === "angle") {
      const ang = angleBetween(dimDraft.x1, dimDraft.y1, dimDraft.x2, dimDraft.y2, pt.x, pt.y);
      d.dimensions.push({
        id: uid(), kind: "angle", orient: "aligned",
        x1: dimDraft.x1, y1: dimDraft.y1, x2: dimDraft.x2, y2: dimDraft.y2,
        x3: pt.x, y3: pt.y, offset: DIM_OFFSET, geometric: true,
        label: (Math.abs(ang) * 180 / Math.PI).toFixed(1) + "°"
      });
    } else {
      dimDraft.x2 = pt.x; dimDraft.y2 = pt.y;
      const dx = Math.abs(dimDraft.x2 - dimDraft.x1), dy = Math.abs(dimDraft.y2 - dimDraft.y1);
      if (dx >= dy * 2) dimDraft.orient = "h";
      else if (dy >= dx * 2) dimDraft.orient = "v";
      else dimDraft.orient = "aligned";
      if (Math.hypot(dimDraft.x2 - dimDraft.x1, dimDraft.y2 - dimDraft.y1) < 0.05) {
        dimDraft = null;
        redraw();
        return;
      }
      d.dimensions.push({
        id: uid(), kind: "linear", orient: dimDraft.orient || "aligned",
        x1: dimDraft.x1, y1: dimDraft.y1, x2: dimDraft.x2, y2: dimDraft.y2,
        offset: DIM_OFFSET, geometric: true, annotation: false
      });
    }
    dimDraft = null;
    markDirty();
    redraw();
  }

  function angleBetween(x1, y1, vx, vy, x3, y3) {
    const a = Math.atan2(y1 - vy, x1 - vx);
    const b = Math.atan2(y3 - vy, x3 - vx);
    let ang = b - a;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    return ang;
  }

  /* ---------- Draw From Measurements ---------- */

  function openDrawFromMeasures() {
    openPanel("msDrawPanel");
  }

  function createFromMeasurements() {
    const p = currentProject();
    const d = currentDrawing();
    if (!p || !d) return;
    const shape = document.getElementById("msShapeType").value;
    const err = document.getElementById("msDrawErr");
    err.textContent = "";

    function need(id, label) {
      const parsed = parseMeasure(document.getElementById(id).value);
      if (!parsed.ok) { err.textContent = label + ": " + parsed.error; return null; }
      if (parsed.inches <= 0) { err.textContent = label + " must be greater than zero."; return null; }
      return parsed.inches;
    }

    let sh = null;
    if (shape === "rect") {
      const w = need("msInA", "Width"); const h = need("msInB", "Height");
      if (w == null || h == null) return;
      sh = { id: uid(), type: "rect", x: 2, y: 2, w, h, autoDims: true };
    } else if (shape === "circle") {
      const diam = need("msInA", "Diameter");
      if (diam == null) return;
      sh = { id: uid(), type: "circle", cx: 2 + diam / 2, cy: 2 + diam / 2, r: diam / 2, autoDims: true };
    } else if (shape === "line") {
      const len = need("msInA", "Length");
      if (len == null) return;
      const angRaw = document.getElementById("msInB").value.trim();
      let ang = 0;
      if (angRaw) {
        const a = Number(angRaw);
        if (!Number.isFinite(a)) { err.textContent = "Angle must be a number in degrees."; return; }
        ang = a * Math.PI / 180;
      }
      sh = { id: uid(), type: "line", x1: 2, y1: 4, x2: 2 + Math.cos(ang) * len, y2: 4 + Math.sin(ang) * len, autoDims: true };
    } else if (shape === "triangle") {
      const base = need("msInA", "Base"); const height = need("msInB", "Height");
      if (base == null || height == null) return;
      sh = {
        id: uid(), type: "triangle", autoDims: true,
        points: [{ x: 2, y: 2 + height }, { x: 2 + base, y: 2 + height }, { x: 2, y: 2 }]
      };
    } else if (shape === "gable") {
      const width = need("msInA", "Width"); const rise = need("msInB", "Roof rise");
      if (width == null || rise == null) return;
      sh = {
        id: uid(), type: "gable", autoDims: true,
        points: [
          { x: 2, y: 2 + rise },
          { x: 2 + width, y: 2 + rise },
          { x: 2 + width / 2, y: 2 }
        ]
      };
    } else if (shape === "board") {
      const len = need("msInA", "Length"); const width = need("msInB", "Width"); const thick = need("msInC", "Thickness");
      if (len == null || width == null || thick == null) return;
      pushUndo();
      // Front (length x width) and side edge (thickness x width)
      const front = { id: uid(), type: "rect", x: 2, y: 2, w: len, h: width, autoDims: true };
      const side = { id: uid(), type: "rect", x: 2 + len + 1.5, y: 2, w: thick, h: width, autoDims: true };
      d.shapes.push(front, side);
      ensureAutoDimensions(front, d);
      ensureAutoDimensions(side, d);
      d.texts.push({ id: uid(), type: "text", x: 2, y: 1.5, text: "Front / top view", size: 0.35 });
      d.texts.push({ id: uid(), type: "text", x: 2 + len + 1.5, y: 1.5, text: "Edge (thickness)", size: 0.35 });
      selectedIds = [front.id];
      markDirty();
      closePanel();
      fitDrawing();
      renderSelectionInfo();
      return;
    }
    if (!sh) { err.textContent = "Choose a shape."; return; }
    pushUndo();
    d.shapes.push(sh);
    ensureAutoDimensions(sh, d);
    selectedIds = [sh.id];
    markDirty();
    closePanel();
    fitDrawing();
    renderSelectionInfo();
  }

  function updateShapeFields() {
    const shape = document.getElementById("msShapeType").value;
    const la = document.getElementById("msLabelA");
    const lb = document.getElementById("msLabelB");
    const lc = document.getElementById("msLabelC");
    const rowB = document.getElementById("msRowB");
    const rowC = document.getElementById("msRowC");
    rowB.classList.remove("hidden");
    rowC.classList.add("hidden");
    if (shape === "rect") { la.textContent = "Width"; lb.textContent = "Height"; }
    else if (shape === "circle") { la.textContent = "Diameter"; rowB.classList.add("hidden"); }
    else if (shape === "line") { la.textContent = "Length"; lb.textContent = "Angle (degrees, optional)"; }
    else if (shape === "triangle") { la.textContent = "Base"; lb.textContent = "Height"; }
    else if (shape === "gable") { la.textContent = "Width"; lb.textContent = "Roof rise"; }
    else if (shape === "board") { la.textContent = "Length"; lb.textContent = "Width"; lc.textContent = "Thickness"; rowC.classList.remove("hidden"); }
  }

  function applySelectedMeasureEdit() {
    const d = currentDrawing();
    const p = currentProject();
    if (!d || !selectedIds.length) return;
    const sh = d.shapes.find((s) => s.id === selectedIds[0]);
    if (!sh) return;
    const err = document.getElementById("msSelErr");
    err.textContent = "";
    if (sh.type === "rect" || sh.type === "ellipse") {
      const w = parseMeasure(document.getElementById("msSelW").value);
      const h = parseMeasure(document.getElementById("msSelH").value);
      if (!w.ok) { err.textContent = w.error; return; }
      if (!h.ok) { err.textContent = h.error; return; }
      if (w.inches <= 0 || h.inches <= 0) { err.textContent = "Width and height must be greater than zero."; return; }
      pushUndo();
      sh.w = w.inches; sh.h = h.inches;
      syncDimsFromShape(sh, d);
    } else if (sh.type === "circle") {
      const diam = parseMeasure(document.getElementById("msSelW").value);
      if (!diam.ok) { err.textContent = diam.error; return; }
      if (diam.inches <= 0) { err.textContent = "Diameter must be greater than zero."; return; }
      pushUndo();
      sh.r = diam.inches / 2;
      syncDimsFromShape(sh, d);
    } else if (sh.type === "line") {
      const len = parseMeasure(document.getElementById("msSelW").value);
      if (!len.ok) { err.textContent = len.error; return; }
      pushUndo();
      resizeShapeFromDim(sh, { orient: "aligned" }, len.inches);
      syncDimsFromShape(sh, d);
    } else {
      err.textContent = "Edit that shape using Draw From Measurements or by dragging.";
      return;
    }
    markDirty();
    redraw();
    renderSelectionInfo();
  }

  function renderSelectionInfo() {
    const box = document.getElementById("msSelectionInfo");
    if (!box) return;
    const d = currentDrawing();
    const sh = d?.shapes?.find((s) => selectedIds.includes(s.id));
    if (!sh) {
      box.innerHTML = "<div class='notice'>No shape selected. Use Select, or Draw From Measurements.</div>";
      return;
    }
    let html = `<div class="notice"><b>${esc(sh.type)}</b> selected</div>`;
    if (sh.type === "rect" || sh.type === "ellipse") {
      html += `<div class="row"><label>Width<input id="msSelW" value="${esc(displayValue(sh.w).replace('"', ""))}"></label>
        <label>Height<input id="msSelH" value="${esc(displayValue(sh.h).replace('"', ""))}"></label></div>`;
    } else if (sh.type === "circle") {
      html += `<div class="row"><label>Diameter<input id="msSelW" value="${esc(displayValue(sh.r * 2).replace('"', ""))}"></label></div>`;
    } else if (sh.type === "line") {
      const len = Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1);
      html += `<div class="row"><label>Length<input id="msSelW" value="${esc(displayValue(len).replace('"', ""))}"></label></div>`;
    }
    html += `<div class="row"><button type="button" onclick="MS.applySelectedMeasureEdit()">Update Size</button>
      <button type="button" class="secondary" onclick="MS.duplicateSelected()">Duplicate</button>
      <button type="button" class="danger" onclick="MS.deleteSelected()">Delete</button></div>
      <div id="msSelErr" class="authmsg"></div>`;
    box.innerHTML = html;
  }

  function duplicateSelected() {
    const d = currentDrawing();
    if (!d || !selectedIds.length) return;
    pushUndo();
    const neu = [];
    for (const id of selectedIds) {
      const sh = d.shapes.find((s) => s.id === id);
      if (!sh) continue;
      const copy = JSON.parse(JSON.stringify(sh));
      copy.id = uid();
      moveEntity(copy, 0.5, 0.5);
      d.shapes.push(copy);
      ensureAutoDimensions(copy, d);
      neu.push(copy.id);
    }
    selectedIds = neu;
    markDirty();
    redraw();
    renderSelectionInfo();
  }

  function fitDrawing() {
    const d = currentDrawing();
    const canvas = canvasEl();
    if (!d || !canvas) return;
    const all = [];
    for (const sh of d.shapes) {
      const b = shapeBounds(sh);
      all.push(b.x, b.y, b.x + b.w, b.y + b.h);
    }
    for (const st of d.strokes || []) for (const p of st.points || []) { all.push(p.x, p.y); }
    if (all.length < 4) {
      d.zoom = 1; d.panX = -0.5; d.panY = -0.5; redraw(); return;
    }
    const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 2;
    const minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 2;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 420;
    const zx = w / ((maxX - minX) * PPI);
    const zy = h / ((maxY - minY) * PPI);
    d.zoom = Math.max(0.15, Math.min(zx, zy, 4));
    d.panX = minX;
    d.panY = minY;
    markDirty();
    redraw();
  }

  function zoomBy(factor) {
    const d = currentDrawing();
    if (!d) return;
    d.zoom = Math.max(0.15, Math.min(6, d.zoom * factor));
    markDirty();
    redraw();
  }

  /* ---------- projects UI ---------- */

  function showMeasurements() {
    saveCurrent?.();
    if (typeof screens === "function") screens("measureScreen");
    document.getElementById("appRoot")?.classList.add("ms-wide");
    renderProjectList();
  }

  function leaveMeasurements() {
    if (sketchDirty && !confirm("You have unsaved drawing changes. Leave without saving?")) return false;
    document.getElementById("appRoot")?.classList.remove("ms-wide");
    return true;
  }

  function renderProjectList() {
    const q = (document.getElementById("msSearch")?.value || "").toLowerCase();
    const list = projects()
      .slice()
      .sort((a, b) => (b.modified || 0) - (a.modified || 0))
      .filter((p) => !q || (p.name + " " + (p.description || "") + " " + (p.notes || "")).toLowerCase().includes(q));
    const el = document.getElementById("msProjectList");
    if (!el) return;
    el.innerHTML = list.length
      ? list.map((p) => `<div class="card" onclick="MS.openProject('${p.id}')">
          <h3>${esc(p.name)}</h3>
          <div class="preview">${esc((p.description || p.notes || "No description").slice(0, 110))}</div>
          <div class="meta">Modified ${new Date(p.modified || p.created).toLocaleString()}</div>
        </div>`).join("")
      : `<div class="empty">No measurement projects yet. Tap New Project to start.</div>`;
  }

  function newProject() {
    if (sketchDirty && !confirm("Discard unsaved changes and start a new project?")) return;
    const name = prompt("Project name:", "Shop Project");
    if (name == null) return;
    const p = emptyProject(name.trim() || "New Project");
    projects().push(p);
    saveSketches();
    openProject(p.id);
  }

  function openProject(id) {
    if (sketchDirty && currentProjectId && currentProjectId !== id && !confirm("You have unsaved changes. Switch projects anyway?")) return;
    const p = getProject(id);
    if (!p) return;
    currentProjectId = id;
    currentDrawingId = p.drawings?.[0]?.id || null;
    undoStack = []; redoStack = []; selectedIds = []; sketchDirty = false;
    screens("measureProjectScreen");
    document.getElementById("appRoot")?.classList.add("ms-wide");
    document.getElementById("msProjectTitle").textContent = p.name;
    document.getElementById("msProjectDesc").value = p.description || "";
    document.getElementById("msProjectNotes").value = p.notes || "";
    document.getElementById("msUnit").value = p.unit || "in";
    document.getElementById("msPrecision").value = p.precision || "1/16";
    clearDirty();
    showMsTab("draw");
    renderDrawingTabs();
    renderMeasureList();
    renderPhotoList();
    setTool("select");
    setTimeout(() => { fitDrawing(); redraw(); }, 40);
  }

  function backToProjectList() {
    if (sketchDirty && !confirm("Leave this project with unsaved changes?")) return;
    saveSketches();
    currentProjectId = null;
    screens("measureScreen");
    renderProjectList();
  }

  function renameProject() {
    const p = currentProject();
    if (!p) return;
    const name = prompt("Rename project:", p.name);
    if (name == null || !name.trim()) return;
    p.name = name.trim();
    document.getElementById("msProjectTitle").textContent = p.name;
    markDirty();
    saveSketches();
  }

  function duplicateProject() {
    const p = currentProject();
    if (!p) return;
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    copy.name = p.name + " Copy";
    copy.created = Date.now();
    copy.modified = Date.now();
    (copy.drawings || []).forEach((d) => { d.id = uid(); });
    (copy.measurementList || []).forEach((m) => { m.id = uid(); });
    // photos keep same storage paths (shared reference) — duplicate annotations only
    (copy.photos || []).forEach((ph) => { ph.id = uid(); });
    projects().push(copy);
    saveSketches();
    openProject(copy.id);
  }

  function deleteProjectFromList(id) {
    const p = getProject(id || currentProjectId);
    if (!p) return;
    if (!confirm(`Delete project “${p.name}”? This cannot be undone from Trash.`)) return;
    const n = sketchesNote();
    n.items = n.items.filter((x) => x.id !== p.id);
    n.modified = Date.now();
    persist();
    currentProjectId = null;
    sketchDirty = false;
    screens("measureScreen");
    renderProjectList();
  }

  function exportProjectJson() {
    const p = currentProject();
    if (!p) return;
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (p.name || "project").replace(/[^\w\- ]+/g, "") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  function printProject() {
    const p = currentProject();
    if (!p) return;
    saveSketches();
    const d = currentDrawing();
    const canvas = canvasEl();
    const img = canvas ? canvas.toDataURL("image/png") : "";
    const win = window.open("", "_blank");
    if (!win) { alert("Allow pop-ups to print."); return; }
    const rows = (p.measurementList || []).map((m) =>
      `<tr><td>${esc(m.item)}</td><td>${m.qty}</td><td>${esc(displayValue(m.length, p))}</td><td>${esc(displayValue(m.width, p))}</td><td>${esc(displayValue(m.thickness, p))}</td><td>${esc(m.notes || "")}</td></tr>`
    ).join("");
    win.document.write(`<!doctype html><html><head><title>${esc(p.name)}</title>
      <style>body{font-family:Georgia,serif;padding:24px;color:#2f2118}
      table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #bbb;padding:6px;text-align:left}
      img{max-width:100%;border:1px solid #ccc;margin-top:12px}
      @page{size:letter;margin:0.6in}.note{white-space:pre-wrap}</style></head><body>
      <h1>${esc(p.name)}</h1>
      <p>Printed ${new Date().toLocaleString()} · Fit-to-page (not actual size)</p>
      <h2>Notes</h2><div class="note">${esc(p.notes || p.description || "")}</div>
      <h2>Measurement List</h2>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Length</th><th>Width</th><th>Thickness</th><th>Notes</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=6>None</td></tr>"}</tbody></table>
      <h2>Drawing: ${esc(d?.name || "")}</h2>
      ${img ? `<img src="${img}" alt="Drawing">` : ""}
      <p class="notice">Photograph annotations print from the Photos tab separately if needed. Labels are reference measurements when placed on photos.</p>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 250);
  }

  function exportDrawingSvg() {
    const d = currentDrawing();
    const p = currentProject();
    if (!d) return;
    let minX = 0, minY = 0, maxX = 20, maxY = 14;
    const boxes = d.shapes.map(shapeBounds);
    if (boxes.length) {
      minX = Math.min(...boxes.map((b) => b.x)) - 1;
      minY = Math.min(...boxes.map((b) => b.y)) - 1;
      maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 2;
      maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 2;
    }
    const scale = 20;
    let body = "";
    for (const sh of d.shapes) {
      if (sh.type === "rect") body += `<rect x="${sh.x * scale}" y="${sh.y * scale}" width="${sh.w * scale}" height="${sh.h * scale}" fill="none" stroke="#2f2118" stroke-width="1.5"/>`;
      if (sh.type === "circle") body += `<circle cx="${sh.cx * scale}" cy="${sh.cy * scale}" r="${sh.r * scale}" fill="none" stroke="#2f2118" stroke-width="1.5"/>`;
      if (sh.type === "line") body += `<line x1="${sh.x1 * scale}" y1="${sh.y1 * scale}" x2="${sh.x2 * scale}" y2="${sh.y2 * scale}" stroke="#2f2118" stroke-width="1.5"/>`;
      if (sh.type === "ellipse") body += `<ellipse cx="${(sh.x + sh.w / 2) * scale}" cy="${(sh.y + sh.h / 2) * scale}" rx="${Math.abs(sh.w / 2) * scale}" ry="${Math.abs(sh.h / 2) * scale}" fill="none" stroke="#2f2118" stroke-width="1.5"/>`;
      if ((sh.type === "triangle" || sh.type === "gable" || sh.type === "polyline") && sh.points) {
        body += `<polyline points="${sh.points.map((pt) => pt.x * scale + "," + pt.y * scale).join(" ")}" fill="none" stroke="#2f2118" stroke-width="1.5" ${sh.type === "polyline" ? "" : 'closepath="1"'} />`;
        if (sh.type !== "polyline") body += `<polygon points="${sh.points.map((pt) => pt.x * scale + "," + pt.y * scale).join(" ")}" fill="none" stroke="#2f2118" stroke-width="1.5"/>`;
      }
    }
    for (const dim of d.dimensions || []) {
      const len = Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1);
      const mx = ((dim.x1 + dim.x2) / 2) * scale;
      const my = ((dim.y1 + dim.y2) / 2) * scale - 8;
      body += `<text x="${mx}" y="${my}" text-anchor="middle" font-family="Georgia,serif" font-size="12">${esc(displayValue(len, p))}</text>`;
      body += `<line x1="${dim.x1 * scale}" y1="${dim.y1 * scale}" x2="${dim.x2 * scale}" y2="${dim.y2 * scale}" stroke="#4b2d1b" stroke-width="1"/>`;
    }
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${(maxX - minX) * scale}" height="${(maxY - minY) * scale}" viewBox="${minX * scale} ${minY * scale} ${(maxX - minX) * scale} ${(maxY - minY) * scale}">${body}</svg>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = (p?.name || "drawing") + ".svg";
    a.click();
  }

  function exportDrawingPng() {
    const canvas = canvasEl();
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = (currentProject()?.name || "drawing") + ".png";
    a.click();
  }

  /* ---------- drawing pages ---------- */

  function renderDrawingTabs() {
    const p = currentProject();
    const el = document.getElementById("msDrawingTabs");
    if (!p || !el) return;
    el.innerHTML = (p.drawings || []).map((d) =>
      `<button type="button" class="${d.id === currentDrawingId ? "active" : "secondary"}" onclick="MS.switchDrawing('${d.id}')">${esc(d.name)}</button>`
    ).join("") + `<button type="button" class="secondary" onclick="MS.addDrawingPage()">+ Page</button>`;
  }

  function switchDrawing(id) {
    if (sketchDirty) saveSketches();
    currentDrawingId = id;
    selectedIds = [];
    undoStack = []; redoStack = [];
    renderDrawingTabs();
    redraw();
    renderSelectionInfo();
  }

  function addDrawingPage() {
    const p = currentProject();
    if (!p) return;
    const name = prompt("Name for this drawing page:", "Side View");
    if (name == null) return;
    const d = emptyDrawing(name.trim() || "View");
    p.drawings.push(d);
    currentDrawingId = d.id;
    markDirty();
    saveSketches();
    renderDrawingTabs();
    redraw();
  }

  function renameDrawingPage() {
    const d = currentDrawing();
    if (!d) return;
    const name = prompt("Rename drawing page:", d.name);
    if (name == null || !name.trim()) return;
    d.name = name.trim();
    markDirty();
    renderDrawingTabs();
  }

  /* ---------- measurement list ---------- */

  function renderMeasureList() {
    const p = currentProject();
    const el = document.getElementById("msListBody");
    if (!p || !el) return;
    const rows = p.measurementList || [];
    el.innerHTML = rows.length ? rows.map((m, idx) => `<tr>
      <td><input value="${esc(m.item || "")}" onchange="MS.updateListField(${idx},'item',this.value)"></td>
      <td><input type="number" min="1" step="1" value="${m.qty || 1}" onchange="MS.updateListField(${idx},'qty',this.value)"></td>
      <td><input value="${esc(m.length == null ? "" : displayValue(m.length, p).replace(/"| mm/g, "").trim())}" onchange="MS.updateListMeasure(${idx},'length',this.value)"></td>
      <td><input value="${esc(m.width == null ? "" : displayValue(m.width, p).replace(/"| mm/g, "").trim())}" onchange="MS.updateListMeasure(${idx},'width',this.value)"></td>
      <td><input value="${esc(m.thickness == null ? "" : displayValue(m.thickness, p).replace(/"| mm/g, "").trim())}" onchange="MS.updateListMeasure(${idx},'thickness',this.value)"></td>
      <td><input value="${esc(m.notes || "")}" onchange="MS.updateListField(${idx},'notes',this.value)"></td>
      <td class="ms-list-actions">
        <button type="button" class="secondary smallbtn" onclick="MS.moveListItem(${idx},-1)">↑</button>
        <button type="button" class="secondary smallbtn" onclick="MS.moveListItem(${idx},1)">↓</button>
        <button type="button" class="secondary smallbtn" onclick="MS.duplicateListItem(${idx})">Copy</button>
        <button type="button" class="danger smallbtn" onclick="MS.deleteListItem(${idx})">×</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">No measurement rows yet.</td></tr>`;
  }

  function addListItem(seed) {
    const p = currentProject();
    if (!p) return;
    p.measurementList = p.measurementList || [];
    p.measurementList.push({
      id: uid(),
      item: seed?.item || "Board",
      qty: seed?.quantity || seed?.qty || 1,
      length: seed?.length ?? null,
      width: seed?.width ?? null,
      thickness: seed?.thickness ?? null,
      notes: seed?.notes || ""
    });
    markDirty();
    renderMeasureList();
  }

  function updateListField(idx, key, value) {
    const p = currentProject();
    const row = p?.measurementList?.[idx];
    if (!row) return;
    if (key === "qty") {
      const n = Math.max(1, parseInt(value, 10) || 1);
      row.qty = n;
    } else row[key] = value;
    markDirty();
  }

  function updateListMeasure(idx, key, value) {
    const p = currentProject();
    const row = p?.measurementList?.[idx];
    if (!row) return;
    if (!String(value).trim()) { row[key] = null; markDirty(); return; }
    const parsed = parseMeasure(value);
    if (!parsed.ok) { alert(parsed.error); renderMeasureList(); return; }
    row[key] = parsed.inches;
    markDirty();
    renderMeasureList();
  }

  function deleteListItem(idx) {
    const p = currentProject();
    if (!p?.measurementList?.[idx]) return;
    if (!confirm("Delete this measurement row?")) return;
    p.measurementList.splice(idx, 1);
    markDirty();
    renderMeasureList();
  }

  function duplicateListItem(idx) {
    const p = currentProject();
    const row = p?.measurementList?.[idx];
    if (!row) return;
    const copy = JSON.parse(JSON.stringify(row));
    copy.id = uid();
    p.measurementList.splice(idx + 1, 0, copy);
    markDirty();
    renderMeasureList();
  }

  function moveListItem(idx, dir) {
    const p = currentProject();
    if (!p?.measurementList) return;
    const j = idx + dir;
    if (j < 0 || j >= p.measurementList.length) return;
    const t = p.measurementList[idx];
    p.measurementList[idx] = p.measurementList[j];
    p.measurementList[j] = t;
    markDirty();
    renderMeasureList();
  }

  function copyListToProject() {
    const p = currentProject();
    if (!p?.measurementList?.length) { alert("Nothing to copy."); return; }
    const names = projects().filter((x) => x.id !== p.id).map((x) => x.name);
    if (!names.length) { alert("Create another project first."); return; }
    const targetName = prompt("Copy measurements into which project?\n\n" + names.join("\n"), names[0]);
    const target = projects().find((x) => x.name === targetName);
    if (!target) { alert("Project not found."); return; }
    target.measurementList = (target.measurementList || []).concat(JSON.parse(JSON.stringify(p.measurementList)).map((m) => ({ ...m, id: uid() })));
    target.modified = Date.now();
    saveSketches();
    alert("Copied into “" + target.name + "”.");
  }

  /* ---------- voice measurements ---------- */

  function runVoiceParse() {
    const text = document.getElementById("msVoiceInput").value;
    const parsed = parseVoiceMeasurements(text);
    voicePending = parsed;
    const box = document.getElementById("msVoiceConfirm");
    if (!parsed.ok && !parsed.length && parsed.length !== 0) {
      box.innerHTML = `<div class="notice">${esc(parsed.error || "Could not parse.")}</div>
        <div class="notice">Original: ${esc(parsed.original || text)}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="notice">${parsed.ambiguous ? "Please check these values — some parts were unclear." : "Confirm the readings below, then save."}</div>
      <div class="row"><label>Item<input id="msVoiceItem" value="${esc(parsed.item || "Board")}"></label>
        <label>Qty<input id="msVoiceQty" type="number" min="1" value="${parsed.quantity || 1}"></label></div>
      <div class="row"><label>Length<input id="msVoiceL" value="${parsed.length == null ? "" : esc(displayValue(parsed.length).replace('"', ""))}"></label>
        <label>Width<input id="msVoiceW" value="${parsed.width == null ? "" : esc(displayValue(parsed.width).replace('"', ""))}"></label>
        <label>Thickness<input id="msVoiceT" value="${parsed.thickness == null ? "" : esc(displayValue(parsed.thickness).replace('"', ""))}"></label></div>
      <div class="row"><button type="button" onclick="MS.confirmVoice()">Save to Measurement List</button>
        <button type="button" class="secondary" onclick="MS.drawBoardFromVoice()">Also Draw Board Views</button></div>
      <div class="notice">Original text kept for reference:<br>${esc(parsed.original || text)}</div>`;
  }

  function confirmVoice() {
    const item = document.getElementById("msVoiceItem")?.value || "Board";
    const qty = Math.max(1, parseInt(document.getElementById("msVoiceQty")?.value, 10) || 1);
    function read(id) {
      const v = document.getElementById(id)?.value?.trim();
      if (!v) return null;
      const p = parseMeasure(v);
      if (!p.ok) { alert(p.error); return undefined; }
      return p.inches;
    }
    const length = read("msVoiceL");
    const width = read("msVoiceW");
    const thickness = read("msVoiceT");
    if (length === undefined || width === undefined || thickness === undefined) return;
    addListItem({ item, quantity: qty, length, width, thickness });
    showMsTab("list");
    alert("Saved to the measurement list.");
  }

  function drawBoardFromVoice() {
    confirmVoice();
    const length = parseMeasure(document.getElementById("msVoiceL")?.value || "");
    const width = parseMeasure(document.getElementById("msVoiceW")?.value || "");
    const thickness = parseMeasure(document.getElementById("msVoiceT")?.value || "");
    if (!length.ok || !width.ok || !thickness.ok) return;
    document.getElementById("msShapeType").value = "board";
    updateShapeFields();
    document.getElementById("msInA").value = displayValue(length.inches).replace('"', "");
    document.getElementById("msInB").value = displayValue(width.inches).replace('"', "");
    document.getElementById("msInC").value = displayValue(thickness.inches).replace('"', "");
    showMsTab("draw");
    createFromMeasurements();
  }

  /* ---------- photos ---------- */

  function renderPhotoList() {
    const p = currentProject();
    const el = document.getElementById("msPhotoGrid");
    if (!p || !el) return;
    const photos = p.photos || [];
    el.innerHTML = photos.length
      ? photos.map((ph, idx) => `<div class="photo-card">
          <img data-photo-path="${esc(ph.path)}" alt="Project photo" onclick="MS.openPhotoAnnotate(${idx})">
          <button class="danger smallbtn" onclick="MS.deletePhoto(${idx});event.stopPropagation()">×</button>
          <input class="photo-caption" value="${esc(ph.caption || "")}" placeholder="Caption…" oninput="MS.updatePhotoCaption(${idx},this.value)">
          <div class="meta" style="padding:6px">Reference arrows: ${(ph.annotations || []).length} · Tap photo to annotate</div>
        </div>`).join("")
      : `<div class="empty">No photographs yet. Import a photo or an Apple Measure screenshot.</div>`;
    hydratePhotoUrls?.(el);
  }

  async function addPhoto(file) {
    const p = currentProject();
    if (!p || !file) return;
    const status = document.getElementById("msPhotoStatus");
    try {
      status.textContent = "Uploading…";
      const path = await uploadAppPhoto(file, `sketches/${p.id}`);
      p.photos = p.photos || [];
      p.photos.push({ id: uid(), path, created: Date.now(), caption: "", annotations: [] });
      markDirty();
      saveSketches();
      renderPhotoList();
      status.textContent = "Photo added. Annotations are reference marks only — a photo alone does not prove real-world scale.";
    } catch (e) {
      status.textContent = "Could not add photo.";
      alert("Could not add that photo: " + (friendlyError?.(e) || e.message || e));
    }
  }

  function pickPhoto() {
    const input = document.getElementById("msPhotoInput");
    input.value = "";
    input.click();
  }

  async function deletePhoto(idx) {
    const p = currentProject();
    const photo = p?.photos?.[idx];
    if (!photo || !confirm("Delete this photograph and its arrows?")) return;
    p.photos.splice(idx, 1);
    markDirty();
    saveSketches();
    renderPhotoList();
    await deleteAppPhoto?.(photo.path);
  }

  function updatePhotoCaption(idx, value) {
    const p = currentProject();
    if (!p?.photos?.[idx]) return;
    p.photos[idx].caption = value;
    markDirty();
  }

  async function openPhotoAnnotate(idx) {
    const p = currentProject();
    const photo = p?.photos?.[idx];
    if (!photo) return;
    photoAnnotateId = photo.id;
    photoUndo = []; photoRedo = [];
    openPanel("msPhotoPanel");
    document.getElementById("msPhotoWarn").textContent =
      "These arrows are manually entered reference marks. This app cannot accurately measure real objects from an ordinary photograph.";
    const img = document.getElementById("msPhotoImg");
    const canvas = document.getElementById("msPhotoCanvas");
    try {
      img.src = await signedPhotoUrl(photo.path);
    } catch {
      img.src = "";
    }
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      drawPhotoAnnotations();
    };
    photoTool = "hdim";
  }

  function currentPhoto() {
    const p = currentProject();
    return (p?.photos || []).find((ph) => ph.id === photoAnnotateId) || null;
  }

  function drawPhotoAnnotations() {
    const canvas = document.getElementById("msPhotoCanvas");
    const img = document.getElementById("msPhotoImg");
    const photo = currentPhoto();
    if (!canvas || !img?.naturalWidth || !photo) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const W = canvas.width, H = canvas.height;
    for (const a of photo.annotations || []) {
      ctx.strokeStyle = "#b44b3d";
      ctx.fillStyle = "#b44b3d";
      ctx.lineWidth = Math.max(2, W * 0.002);
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
      if (a.type === "circle") {
        const r = Math.hypot(x2 - x1, y2 - y1);
        ctx.beginPath(); ctx.arc(x1, y1, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (a.type === "hdim" || a.type === "vdim" || a.type === "adim") {
          drawArrow(ctx, x1, y1, x2, y2);
          drawArrow(ctx, x2, y2, x1, y1);
          ctx.font = `${Math.max(14, W * 0.025)}px Georgia,serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = "#fffef6";
          const label = (a.label || "") + " (ref)";
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 10;
          const tw = ctx.measureText(label).width;
          ctx.fillRect(mx - tw / 2 - 4, my - 16, tw + 8, 22);
          ctx.fillStyle = "#2f2118";
          ctx.fillText(label, mx, my);
        }
      }
      if (a.type === "text") {
        ctx.font = `${Math.max(14, W * 0.025)}px Georgia,serif`;
        ctx.fillStyle = "#2f2118";
        ctx.fillText(a.label || "", x1, y1);
      }
    }
    if (photoDraft) {
      const a = photoDraft;
      ctx.strokeStyle = "#4b2d1b";
      ctx.beginPath();
      ctx.moveTo(a.x1 * W, a.y1 * H);
      ctx.lineTo(a.x2 * W, a.y2 * H);
      ctx.stroke();
    }
  }

  function photoPointer(ev, end) {
    const canvas = document.getElementById("msPhotoCanvas");
    const photo = currentPhoto();
    if (!canvas || !photo) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = ev.touches ? (end ? ev.changedTouches[0].clientX : ev.touches[0].clientX) : ev.clientX;
    const clientY = ev.touches ? (end ? ev.changedTouches[0].clientY : ev.touches[0].clientY) : ev.clientY;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function onPhotoDown(ev) {
    ev.preventDefault();
    const pt = photoPointer(ev);
    if (!pt) return;
    if (photoTool === "text") {
      const label = prompt("Label text:");
      if (!label) return;
      pushPhotoUndo();
      currentPhoto().annotations.push({ id: uid(), type: "text", x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, label });
      markDirty();
      drawPhotoAnnotations();
      return;
    }
    photoDraft = { type: photoTool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
  }

  function onPhotoMove(ev) {
    if (!photoDraft) return;
    ev.preventDefault();
    const pt = photoPointer(ev);
    if (!pt) return;
    if (photoTool === "hdim") { photoDraft.x2 = pt.x; photoDraft.y2 = photoDraft.y1; }
    else if (photoTool === "vdim") { photoDraft.x2 = photoDraft.x1; photoDraft.y2 = pt.y; }
    else { photoDraft.x2 = pt.x; photoDraft.y2 = pt.y; }
    drawPhotoAnnotations();
  }

  function onPhotoUp(ev) {
    if (!photoDraft) return;
    ev.preventDefault();
    const pt = photoPointer(ev, true);
    if (pt) {
      if (photoTool === "hdim") { photoDraft.x2 = pt.x; photoDraft.y2 = photoDraft.y1; }
      else if (photoTool === "vdim") { photoDraft.x2 = photoDraft.x1; photoDraft.y2 = pt.y; }
      else { photoDraft.x2 = pt.x; photoDraft.y2 = pt.y; }
    }
    let label = "";
    if (photoTool === "hdim" || photoTool === "vdim" || photoTool === "adim") {
      label = prompt("Enter the reference measurement for this arrow (example: 36\"):", '36"') || "";
      if (!label.trim()) { photoDraft = null; drawPhotoAnnotations(); return; }
    }
    pushPhotoUndo();
    currentPhoto().annotations.push({ id: uid(), ...photoDraft, label });
    photoDraft = null;
    markDirty();
    drawPhotoAnnotations();
  }

  function pushPhotoUndo() {
    const photo = currentPhoto();
    if (!photo) return;
    photoUndo.push(JSON.stringify(photo.annotations || []));
    photoRedo = [];
  }

  function undoPhoto() {
    const photo = currentPhoto();
    if (!photo || !photoUndo.length) return;
    photoRedo.push(JSON.stringify(photo.annotations || []));
    photo.annotations = JSON.parse(photoUndo.pop());
    markDirty();
    drawPhotoAnnotations();
  }

  function redoPhoto() {
    const photo = currentPhoto();
    if (!photo || !photoRedo.length) return;
    photoUndo.push(JSON.stringify(photo.annotations || []));
    photo.annotations = JSON.parse(photoRedo.pop());
    markDirty();
    drawPhotoAnnotations();
  }

  function exportAnnotatedPhoto() {
    const canvas = document.getElementById("msPhotoCanvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = (currentProject()?.name || "photo") + "-annotated.png";
    a.click();
  }

  /* ---------- panels / tabs / settings ---------- */

  function showMsTab(tab) {
    ["draw", "list", "photos", "notes", "help"].forEach((t) => {
      document.getElementById("msTab_" + t)?.classList.toggle("hidden", t !== tab);
      document.getElementById("msTabBtn_" + t)?.classList.toggle("active", t === tab);
    });
    if (tab === "draw") setTimeout(redraw, 30);
  }

  function openPanel(id) {
    closePanel();
    panelOpen = id;
    document.getElementById(id)?.classList.remove("hidden");
  }

  function closePanel() {
    if (panelOpen) document.getElementById(panelOpen)?.classList.add("hidden");
    panelOpen = null;
    document.getElementById("msHelpPanel")?.classList.add("hidden");
  }

  function toggleGrid() {
    const d = currentDrawing();
    if (!d) return;
    d.grid = !d.grid;
    markDirty();
    redraw();
  }

  function toggleSnap() {
    const d = currentDrawing();
    if (!d) return;
    d.snap = !d.snap;
    markDirty();
  }

  function toggleRulers() {
    const d = currentDrawing();
    if (!d) return;
    d.rulers = !d.rulers;
    markDirty();
    redraw();
  }

  function toggleDims() {
    const d = currentDrawing();
    if (!d) return;
    d.showDimensions = d.showDimensions === false;
    markDirty();
    redraw();
  }

  function changeUnits() {
    const p = currentProject();
    if (!p) return;
    p.unit = document.getElementById("msUnit").value;
    // geometry unchanged — display only
    markDirty();
    redraw();
    renderMeasureList();
    renderSelectionInfo();
  }

  function changePrecision() {
    const p = currentProject();
    if (!p) return;
    p.precision = document.getElementById("msPrecision").value;
    markDirty();
    redraw();
    renderMeasureList();
    renderSelectionInfo();
  }

  function saveProjectFields() {
    const p = currentProject();
    if (!p) return;
    p.description = document.getElementById("msProjectDesc").value;
    p.notes = document.getElementById("msProjectNotes").value;
    markDirty();
    saveSketches();
  }

  function openHelp() {
    openPanel("msHelpPanel");
  }

  /* ---------- wiring ---------- */

  function bindCanvas() {
    const canvas = canvasEl();
    if (!canvas || canvas._msBound) return;
    canvas._msBound = true;
    const opts = { passive: false };
    canvas.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    canvas.addEventListener("touchstart", onPointerDown, opts);
    canvas.addEventListener("touchmove", onPointerMove, opts);
    canvas.addEventListener("touchend", onPointerUp, opts);
    canvas.addEventListener("wheel", (e) => {
      if (!currentDrawing()) return;
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    }, opts);
    window.addEventListener("keydown", (e) => {
      if (!document.getElementById("measureProjectScreen") || document.getElementById("measureProjectScreen").classList.contains("hidden")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      if (e.key === "Enter" && polyDraft) { e.preventDefault(); finishPolyline(); }
      if (e.key === "Escape" && (polyDraft || dimDraft)) { polyDraft = null; dimDraft = null; redraw(); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
        e.preventDefault();
        deleteSelected();
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (sketchDirty) { e.preventDefault(); e.returnValue = ""; }
    });
    window.addEventListener("resize", () => {
      if (!document.getElementById("measureProjectScreen")?.classList.contains("hidden")) redraw();
    });

    const pc = document.getElementById("msPhotoCanvas");
    if (pc && !pc._msBound) {
      pc._msBound = true;
      pc.addEventListener("mousedown", onPhotoDown);
      pc.addEventListener("mousemove", onPhotoMove);
      pc.addEventListener("mouseup", onPhotoUp);
      pc.addEventListener("touchstart", onPhotoDown, opts);
      pc.addEventListener("touchmove", onPhotoMove, opts);
      pc.addEventListener("touchend", onPhotoUp, opts);
    }
  }

  function selfTest() {
    const results = [];
    function check(name, cond) { results.push({ name, pass: !!cond }); }

    check("parse 36", parseMeasure('36"').inches === 36);
    check("parse 36 1/2", Math.abs(parseMeasure("36 1/2").inches - 36.5) < 1e-9);
    check("parse 5 1/4", Math.abs(parseMeasure("5 1/4").inches - 5.25) < 1e-9);
    check("parse 3/8", Math.abs(parseMeasure("3/8").inches - 0.375) < 1e-9);
    check("parse 7 5/8", Math.abs(parseMeasure("7 5/8").inches - 7.625) < 1e-9);
    check("parse 12.75", Math.abs(parseMeasure("12.75").inches - 12.75) < 1e-9);
    check("parse 24 3/16", Math.abs(parseMeasure("24 3/16").inches - (24 + 3 / 16)) < 1e-9);
    check("parse 1 1/16", Math.abs(parseMeasure("1 1/16").inches - (1 + 1 / 16)) < 1e-9);
    check("reject negative", parseMeasure("-2").ok === false);
    check("reject div0", parseMeasure("3/0").ok === false);
    check("spoken 36.5", Math.abs(parseMeasure("thirty-six and a half").inches - 36.5) < 1e-9);
    check("spoken 5.25", Math.abs(parseMeasure("five and a quarter").inches - 5.25) < 1e-9);
    check("spoken 0.75", Math.abs(parseMeasure("three quarters").inches - 0.75) < 1e-9);

    const v = parseVoiceMeasurements("Two boards, thirty-six and a half inches long, five and a quarter inches wide, three quarters thick.");
    check("voice qty", v.quantity === 2);
    check("voice length", Math.abs((v.length || 0) - 36.5) < 1e-9);
    check("voice width", Math.abs((v.width || 0) - 5.25) < 1e-9);
    check("voice thick", Math.abs((v.thickness || 0) - 0.75) < 1e-9);

    const amb = parseVoiceMeasurements("maybe about yay big");
    check("ambiguous not forced", amb.ok === false || amb.ambiguous === true || amb.length == null);

    // unit switch must not change stored inches
    let inches = 36.5;
    const asMm = formatInches(inches, "mm");
    const back = parseMeasure(asMm);
    check("mm roundtrip close", back.ok && Math.abs(back.inches - inches) < 0.01);
    check("format 1/16", formatInches(5.25, "1/16") === '5 1/4"');
    check("format 1/8", formatInches(0.375, "1/8") === '3/8"');

    // geometry sync: change width updates dim
    const drawing = emptyDrawing("test");
    const rect = { id: "r1", type: "rect", x: 0, y: 0, w: 36, h: 24, autoDims: true };
    drawing.shapes.push(rect);
    ensureAutoDimensions(rect, drawing);
    const hdim = drawing.dimensions.find((d) => d.orient === "h");
    check("auto h dim 36", Math.abs((hdim.x2 - hdim.x1) - 36) < 1e-9);
    rect.w = 42;
    syncDimsFromShape(rect, drawing);
    check("resized dim 42", Math.abs((hdim.x2 - hdim.x1) - 42) < 1e-9);
    check("height unchanged", rect.h === 24);

    const failed = results.filter((r) => !r.pass);
    console.table(results);
    return { passed: results.length - failed.length, failed: failed.length, results };
  }

  global.MS = {
    showMeasurements, newProject, openProject, backToProjectList, renderProjectList,
    renameProject, duplicateProject, deleteProjectFromList, saveSketches,
    exportProjectJson, printProject, exportDrawingSvg, exportDrawingPng,
    setTool, undo, redo, deleteSelected, duplicateSelected, fitDrawing, zoomBy,
    openDrawFromMeasures, createFromMeasurements, updateShapeFields, applySelectedMeasureEdit,
    toggleGrid, toggleSnap, toggleRulers, toggleDims, changeUnits, changePrecision,
    showMsTab, closePanel, openHelp, saveProjectFields,
    addDrawingPage, switchDrawing, renameDrawingPage,
    addListItem, updateListField, updateListMeasure, deleteListItem, duplicateListItem, moveListItem, copyListToProject,
    runVoiceParse, confirmVoice, drawBoardFromVoice,
    pickPhoto, addPhoto, deletePhoto, updatePhotoCaption, openPhotoAnnotate,
    undoPhoto, redoPhoto, exportAnnotatedPhoto, setPhotoTool: (t) => { photoTool = t; },
    leaveMeasurements, bindCanvas, selfTest, parseMeasure, parseVoiceMeasurements, formatInches,
    finishPolyline, SKETCH_TITLE
  };

  document.addEventListener("DOMContentLoaded", () => {
    // late bind if DOM already ready
  });
  if (document.readyState !== "loading") {
    setTimeout(bindCanvas, 0);
  } else {
    document.addEventListener("DOMContentLoaded", bindCanvas);
  }
})(window);
