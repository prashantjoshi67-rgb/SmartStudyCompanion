/* === START OF FILE: app.js ===
   Smart Study Companion - Full client-side application logic
   - License (DEMO / FULL-ACCESS)
   - PDF text extraction via pdf.js
   - OCR fallback via Tesseract.js (if included)
   - Voice/TTS controls (browser speechSynthesis)
   - Library management (view, delete, delete all)
   - Summaries (quick/detailed), MCQ generation (heuristic)
   - Badges / daily target support
   - Backup / restore (export/import JSON)
   - Defensive checks and user notifications
   NOTE: This file expects pdf.js and optionally Tesseract.js to be included from index.html.
*/

/* =========================
   CONFIG & CONSTANTS
   ========================= */
const STORAGE_KEY = "ssc_state_v2";
const LICENSE_FULL_KEY = "FULL-ACCESS"; // exact key string to unlock full access
const DEMO_LABEL = "Demo";
const FULL_LABEL = "Full";

const DEFAULT_STATE = {
  version: 2,
  name: "Guest",
  licenseKey: "",
  fullAccess: false,
  voiceEnabled: false,
  voiceSettings: { voiceURI: "", lang: "en-IN", rate: 1.0, pitch: 1.0 },
  library: [], // { id, name, type, addedAt, text, meta }
  badges: {}, // example: { firstUpload: timestamp }
  targetDaily: 20,
  ocrLang: "eng", // tesseract language code default
  ui: {
    lastTab: "library"
  }
};

/* =========================
   APP STATE
   ========================= */
let STATE = {};
let VOICES = []; // available speechSynthesis voices

/* =========================
   SMALL HELPERS
   ========================= */
function $(id) { return document.getElementById(id); }
function el(tag, attrs = {}, children = []) {
  const d = document.createElement(tag);
  Object.keys(attrs).forEach(k => { if (k === "text") d.textContent = attrs[k]; else d.setAttribute(k, attrs[k]); });
  (Array.isArray(children) ? children : [children]).forEach(c => { if (!c) return; if (typeof c === "string") d.appendChild(document.createTextNode(c)); else d.appendChild(c); });
  return d;
}
function uid(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function nowISO(){ return new Date().toISOString(); }
function log(...args){ console.log("[SSC]", ...args); }
function alertConfirm(msg){ return window.confirm(msg); }

/* =========================
   PERSISTENCE
   ========================= */
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
  catch (e) { console.error("saveState failed", e); }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { STATE = JSON.parse(JSON.stringify(DEFAULT_STATE)); saveState(); return; }
    const parsed = JSON.parse(raw);
    // shallow merge to keep defaults
    STATE = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), parsed || {});
  } catch (e) {
    console.error("loadState failed, resetting to defaults", e);
    STATE = JSON.parse(JSON.stringify(DEFAULT_STATE));
    saveState();
  }
}

/* =========================
   UI NOTIFICATIONS
   ========================= */
function setStatus(text) {
  const elStatus = $("statusLabel");
  if (elStatus) elStatus.textContent = `Status: ${text}`;
  log("Status:", text);
}

/* =========================
   LICENSE HANDLING
   ========================= */
function applyLicenseFromUI() {
  const key = ($("licenseInput") && $("licenseInput").value || "").trim();
  if (!key) {
    STATE.licenseKey = "";
    STATE.fullAccess = false;
    setStatus(DEMO_LABEL);
    saveState();
    renderLicenseLabel();
    return;
  }
  if (key.toUpperCase() === LICENSE_FULL_KEY) {
    STATE.licenseKey = key;
    STATE.fullAccess = true;
    setStatus(FULL_LABEL + " access");
    saveState();
    renderLicenseLabel();
  } else {
    STATE.licenseKey = key;
    STATE.fullAccess = false;
    setStatus("Unknown license - Demo mode");
    saveState();
    renderLicenseLabel();
  }
}
function renderLicenseLabel(){
  const lbl = $("licenseStatus");
  if (lbl) lbl.textContent = STATE.fullAccess ? "Status: Full access" : "Status: Demo";
}

/* =========================
   VOICE / TTS
   ========================= */
function initVoices() {
  if (!("speechSynthesis" in window)) {
    log("TTS not available in this browser");
    return;
  }
  VOICES = speechSynthesis.getVoices() || [];
  const sel = $("voiceSelect");
  if (!sel) return;
  sel.innerHTML = ""; // populate voices
  // first populate preferred Indian & matching voices at top, then rest
  const preferLangs = ["hi-IN","en-IN","mr-IN","bn-IN","ta-IN","en-GB","en-US"];
  const seen = new Set();
  for (const lang of preferLangs) {
    VOICES.filter(v => v.lang && v.lang.startsWith(lang)).forEach(v => { if (!seen.has(v.voiceURI)) { sel.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI)); seen.add(v.voiceURI); } });
  }
  VOICES.forEach(v => { if (!seen.has(v.voiceURI)) { sel.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI)); seen.add(v.voiceURI); } });
  // try to set previously selected voice
  if (STATE.voiceSettings && STATE.voiceSettings.voiceURI) sel.value = STATE.voiceSettings.voiceURI;
}
function speakText(text, opts = {}) {
  if (!STATE.voiceEnabled) { log("Voice disabled — skipping speak."); return; }
  if (!("speechSynthesis" in window)) { log("No speechSynthesis available."); return; }
  if (!text) return;
  const msg = new SpeechSynthesisUtterance(text);
  try {
    const sel = $("voiceSelect");
    if (sel && sel.value) {
      const v = VOICES.find(x => x.voiceURI === sel.value);
      if (v) msg.voice = v;
    } else if (STATE.voiceSettings && STATE.voiceSettings.voiceURI) {
      const v = VOICES.find(x => x.voiceURI === STATE.voiceSettings.voiceURI);
      if (v) msg.voice = v;
    }
  } catch (e) { console.warn("voice choice failed", e); }
  msg.lang = (STATE.voiceSettings && STATE.voiceSettings.lang) || "en-IN";
  msg.rate = (STATE.voiceSettings && STATE.voiceSettings.rate) || 1.0;
  msg.pitch = (STATE.voiceSettings && STATE.voiceSettings.pitch) || 1.0;
  speechSynthesis.cancel();
  speechSynthesis.speak(msg);
}

/* =========================
   PDF + OCR
   - Requires pdfjsLib (pdf.js) included in HTML
   - Optionally Tesseract (Tesseract.js) included for OCR fallback
   ========================= */

async function extractTextFromPDFBuffer(arrayBuffer) {
  // Try pdf.js text extraction first
  if (typeof pdfjsLib !== "undefined") {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let extracted = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        try {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const pageText = content.items.map(i => i.str).join(" ").trim();
          if (pageText && pageText.length > 0) extracted += (extracted ? "\n\n" : "") + pageText;
        } catch (e) {
          console.warn("pdf page text failed", p, e);
        }
      }
      if (extracted && extracted.trim().length > 20) {
        return { text: extracted.trim(), method: "pdfjs", ocr: false };
      }
      // else fall through to OCR if available
    } catch (e) {
      console.warn("pdf.js extraction failed — will try OCR if available", e);
    }
  } else {
    console.warn("pdf.js not found in page; cannot do text extraction via pdf.js");
  }

  // OCR fallback (Tesseract) - render pages to canvas and OCR each
  if (typeof Tesseract !== "undefined" && typeof pdfjsLib !== "undefined") {
    const worker = Tesseract.createWorker ? await Tesseract.createWorker({}) : null;
    if (worker) {
      await worker.load();
      try { await worker.loadLanguage(STATE.ocrLang || "eng"); await worker.initialize(STATE.ocrLang || "eng"); } catch(e){ console.warn("Tesseract language load failed", e); }
      try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let ocrText = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const { data } = await worker.recognize(canvas);
          ocrText += (ocrText ? "\n\n" : "") + (data && data.text ? data.text : "");
        }
        await worker.terminate();
        return { text: ocrText.trim(), method: "tesseract", ocr: true };
      } catch (ocrErr) { console.warn("Tesseract OCR failed", ocrErr); try { await worker.terminate(); } catch(e){} }
    } else {
      console.warn("Tesseract createWorker not available; ensure Tesseract.js included.");
    }
  } else {
    console.warn("Tesseract not found — OCR not available");
  }
  // If everything fails:
  return { text: "", method: "none", ocr: false };
}

/* Utility to extract text from images using Tesseract if available */
async function extractTextFromImageFile(file) {
  if (typeof Tesseract === "undefined") return "";
  let worker = null;
  try {
    worker = Tesseract.createWorker ? await Tesseract.createWorker({}) : null;
    if (!worker) return "";
    await worker.load();
    try { await worker.loadLanguage(STATE.ocrLang || "eng"); await worker.initialize(STATE.ocrLang || "eng"); } catch(e){ console.warn("Tesseract language load failed", e); }
    const dataURL = await fileToDataURL(file);
    const { data } = await worker.recognize(dataURL);
    await worker.terminate();
    return data && data.text ? data.text : "";
  } catch (e) {
    console.error("image OCR failed", e);
    if (worker) try { await worker.terminate(); } catch(e) {}
    return "";
  }
}

/* =========================
   FILE PROCESSING
   ========================= */

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = err => rej(err);
    r.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    setStatus("No files chosen.");
    return;
  }
  setStatus("Processing files...");
  for (const f of files) {
    try {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
        const buf = await f.arrayBuffer();
        const { text, method, ocr } = await extractTextFromPDFBuffer(buf);
        STATE.library.push({
          id: uid("doc"),
          name: f.name,
          type: "pdf",
          addedAt: nowISO(),
          text: (text || "").trim(),
          meta: { method: method || "none", ocr: !!ocr, size: f.size }
        });
        setStatus(`Added ${f.name} (${method}${ocr ? " +OCR" : ""})`);
      } else if (f.type.startsWith("image/") || /\.(jpe?g|png|gif)$/i.test(f.name)) {
        const txt = await extractTextFromImageFile(f);
        STATE.library.push({
          id: uid("img"),
          name: f.name,
          type: "image",
          addedAt: nowISO(),
          text: (txt || "").trim(),
          meta: { ocr: !!txt }
        });
        setStatus(`Added image ${f.name}`);
      } else if (f.type === "text/plain" || /\.txt$/i.test(f.name)) {
        const txt = await f.text();
        STATE.library.push({
          id: uid("txt"),
          name: f.name,
          type: "text",
          addedAt: nowISO(),
          text: (txt || "").trim(),
          meta: {}
        });
        setStatus(`Added text ${f.name}`);
      } else if (f.type === "application/zip" || /\.zip$/i.test(f.name)) {
        // Optional: if JSZip available, unpack and process entries
        if (typeof JSZip !== "undefined") {
          setStatus("Unpacking ZIP...");
          const zip = await JSZip.loadAsync(f);
          const tasks = [];
          zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
              tasks.push((async () => {
                const content = await zipEntry.async("uint8array");
                // create File-like object for processing: using Blob
                const blob = new Blob([content]);
                const faux = new File([blob], zipEntry.name, { type: "" });
                await handleFiles([faux]);
              })());
            }
          });
          await Promise.all(tasks);
          setStatus("ZIP unpacked and processed");
        } else {
          setStatus("ZIP found but JSZip not included.");
        }
      } else {
        setStatus("Unsupported file type: " + f.name);
      }
    } catch (e) {
      console.error("handleFiles error for", f.name, e);
      setStatus("Error processing " + f.name);
    } finally {
      saveState();
      renderLibrary();
      updateBadges();
    }
  }
  setStatus("Processing complete");
}

/* =========================
   LIBRARY UI RENDER & ACTIONS
   ========================= */
function renderLibrary() {
  const container = $("libraryList");
  if (!container) return;
  container.innerHTML = "";
  if (!STATE.library || STATE.library.length === 0) {
    container.appendChild(el("div", { text: "(no documents)" }));
    return;
  }
  STATE.library.forEach(doc => {
    const card = el("div", { class: "doc-card" });
    const title = el("div", { class: "doc-title", text: doc.name });
    const meta = el("div", { class: "doc-meta", text: `Added: ${new Date(doc.addedAt).toLocaleString()} — ${doc.meta && doc.meta.method ? doc.meta.method : doc.type || ''}` });
    const btnView = el("button", { class: "btn small", text: "View" });
    btnView.onclick = () => {
      $("summaryOutput").textContent = doc.text || "(no text extracted)";
      // switch to summaries tab visually if applicable
      setActiveTab("summaries");
    };
    const btnDelete = el("button", { class: "btn small danger", text: "Delete" });
    btnDelete.onclick = () => {
      if (!alertConfirm("Delete this document?")) return;
      STATE.library = STATE.library.filter(x => x.id !== doc.id);
      saveState();
      renderLibrary();
    };
    const btnSummary = el("button", { class: "btn small", text: "Summary" });
    btnSummary.onclick = () => {
      $("summaryOutput").textContent = (doc.text || "").slice(0, 1000) || "(no text)";
      setActiveTab("summaries");
    };
    const actions = el("div", {}, [btnView, btnSummary, btnDelete]);
    card.appendChild(title); card.appendChild(meta); card.appendChild(actions);
    container.appendChild(card);
  });
}

/* Delete all documents */
function deleteAllDocuments() {
  if (!alertConfirm("Delete ALL documents? This cannot be undone.")) return;
  STATE.library = [];
  saveState();
  renderLibrary();
  setStatus("All documents deleted");
}

/* =========================
   SUMMARIES & MCQ (SIMPLE LOCAL HEURISTICS)
   ========================= */
function getAllText() {
  return (STATE.library || []).map(d => d.text || "").join("\n\n");
}

/* Quick summary: first N sentences across docs */
function quickSummary() {
  const text = getAllText();
  if (!text || text.trim().length < 50) { $("summaryOutput").textContent = "(no material)"; return; }
  // naive sentence split
  const sentences = text.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 20);
  const take = Math.min(5, sentences.length);
  const result = sentences.slice(0, take).join(" ");
  $("summaryOutput").textContent = result;
  if (STATE.voiceEnabled) speakText(result);
}

/* Detailed summary: longer excerpt (first 5-10 paragraphs) */
function detailedSummary() {
  const text = getAllText();
  if (!text || text.trim().length < 50) { $("summaryOutput").textContent = "(no material)"; return; }
  const paras = text.split(/\n{2,}/).filter(p => p.trim().length > 40);
  const take = Math.min(6, paras.length || 6);
  const result = paras.slice(0, take).join("\n\n");
  $("summaryOutput").textContent = result;
  if (STATE.voiceEnabled) speakText("Detailed summary ready. " + (result.slice(0,200)));
}

/* MCQ generation: naive approach — pick sentence, choose a keyword for correct choice */
function createMCQs(count = 5) {
  const text = getAllText();
  if (!text || text.trim().length < 80) { $("summaryOutput").textContent = "(Not enough material to create MCQs)"; return; }
  const sentences = text.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 40);
  const out = [];
  let attempts = 0;
  while (out.length < count && attempts < sentences.length * 3) {
    attempts++;
    const s = sentences[Math.floor(Math.random() * sentences.length)];
    // try to select a keyword (longer word) as answer
    const words = s.replace(/[^A-Za-z0-9\u00C0-\u017F\s]/g, "").split(/\s+/).filter(w => w.length > 4);
    if (!words.length) continue;
    const answer = words[Math.floor(Math.random() * words.length)];
    // create fake distractors by picking other words from text
    const pool = text.replace(new RegExp(answer, "gi"), "").replace(/[^A-Za-z0-9\u00C0-\u017F\s]/g, "").split(/\s+/).filter(w => w.length > 4 && w.toLowerCase() !== answer.toLowerCase());
    if (pool.length < 3) continue;
    const choices = new Set();
    choices.add(answer);
    while (choices.size < 4) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      choices.add(c);
      if (choices.size > 30) break;
    }
    const arr = Array.from(choices);
    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    out.push({ q: s.slice(0, 120) + "...", choices: arr, answer });
  }
  if (!out.length) { $("summaryOutput").textContent = "(Could not create MCQs)"; return; }
  // render MCQs textually in summary box
  const sb = out.map((m, idx) => {
    const choicesText = m.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n");
    return `Q${idx + 1}: ${m.q}\n${choicesText}\nAnswer: ${m.answer}\n`;
  }).join("\n\n");
  $("summaryOutput").textContent = sb;
}

/* =========================
   BADGES / TARGETS
   ========================= */
function updateBadges() {
  if (!STATE.badges) STATE.badges = {};
  if (!STATE.badges.firstUpload && (STATE.library && STATE.library.length > 0)) {
    STATE.badges.firstUpload = Date.now();
    setStatus("Badge earned: First upload");
  }
  saveState();
}

/* =========================
   BACKUP / RESTORE
   ========================= */
function exportBackup() {
  const data = JSON.stringify(STATE, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ssc-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = JSON.parse(e.target.result);
      // optional: check version compatibility
      STATE = Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), content || {});
      saveState();
      renderAll();
      setStatus("Backup restored");
    } catch (err) {
      console.error("importBackup failed", err);
      setStatus("Import failed");
    }
  };
  reader.readAsText(file);
}

/* =========================
   UI TAB MANAGEMENT
   ========================= */
function setActiveTab(tabId) {
  // tabs: library, summaries, quiz, manage, settings
  ["library","summaries","quiz","manage","settings","help"].forEach(t => {
    const btn = $(`tab_${t}`); const pane = $(`pane_${t}`);
    if (btn) btn.classList.toggle("active", t === tabId);
    if (pane) pane.style.display = (t === tabId) ? "block" : "none";
  });
  STATE.ui.lastTab = tabId;
  saveState();
}

/* =========================
   BIND UI EVENTS (DOMContentLoaded)
   ========================= */
function bindUI() {
  // name save
  if ($("saveName")) $("saveName").onclick = () => {
    STATE.name = ($("nameInput") && $("nameInput").value) || "Guest";
    saveState(); setStatus("Name saved");
  };
  // enable voice toggle
  if ($("toggleVoice")) $("toggleVoice").onclick = () => {
    STATE.voiceEnabled = !STATE.voiceEnabled;
    $("toggleVoice").textContent = STATE.voiceEnabled ? "Disable voice" : "Enable voice";
    saveState();
    setStatus(STATE.voiceEnabled ? "Voice enabled" : "Voice disabled");
  };
  // voice select change
  if ($("voiceSelect")) $("voiceSelect").onchange = () => {
    STATE.voiceSettings.voiceURI = $("voiceSelect").value || "";
    saveState();
  };
  // license apply
  if ($("applyLicense")) $("applyLicense").onclick = applyLicenseFromUI;
  // file input
  if ($("fileInput")) $("fileInput").onchange = (e) => {
    const files = e.target.files;
    if (files && files.length) handleFiles(files);
    // reset input so same file can be selected again if needed
    setTimeout(()=> { try { $("fileInput").value = ""; } catch(e){} }, 100);
  };
  // process button (alias)
  if ($("processBtn")) $("processBtn").onclick = () => {
    const el = $("fileInput");
    if (el && el.files && el.files.length) handleFiles(el.files);
    else setStatus("Choose files first");
  };
  // delete all
  if ($("deleteAll")) $("deleteAll").onclick = deleteAllDocuments;
  // quick/detailed/read/create MCQs
  if ($("quickSummary")) $("quickSummary").onclick = quickSummary;
  if ($("detailedSummary")) $("detailedSummary").onclick = detailedSummary;
  if ($("createMCQ")) $("createMCQ").onclick = () => createMCQs(5);
  if ($("readSummary")) $("readSummary").onclick = () => speakText(($("summaryOutput") && $("summaryOutput").textContent) || "");
  // export/import
  if ($("exportBackup")) $("exportBackup").onclick = exportBackup;
  if ($("importBackupFile")) $("importBackupFile").onchange = (e) => importBackupFile(e.target.files[0]);
  // tabs
  ["library","summaries","quiz","manage","settings","help"].forEach(t => {
    const b = $(`tab_${t}`);
    if (b) b.onclick = () => setActiveTab(t);
  });
  // target
  if ($("setTargetBtn")) $("setTargetBtn").onclick = () => {
    const v = parseInt(($("targetInput") && $("targetInput").value) || "", 10);
    if (!isNaN(v) && v > 0) { STATE.targetDaily = v; saveState(); setStatus(`Target set: ${v}`); } else setStatus("Invalid target");
  };
  // theme options (if present)
  if ($("themeSelect")) $("themeSelect").onchange = (e) => {
    const t = e.target.value;
    document.documentElement.setAttribute("data-theme", t);
    STATE.ui.theme = t;
    saveState();
  };
}

/* =========================
   RENDER ENTIRE UI BASED ON STATE
   ========================= */
function renderAll(){
  // name
  if ($("nameInput")) $("nameInput").value = STATE.name || "";
  // license
  if ($("licenseInput")) $("licenseInput").value = STATE.licenseKey || "";
  renderLicenseLabel();
  // voice toggle
  if ($("toggleVoice")) $("toggleVoice").textContent = STATE.voiceEnabled ? "Disable voice" : "Enable voice";
  // voice select
  initVoices();
  // library
  renderLibrary();
  // summary output blank
  if ($("summaryOutput")) {
    if (!($("summaryOutput").textContent || "").trim()) $("summaryOutput").textContent = "(Summaries will appear here...)";
  }
  // other controls
  if ($("targetInput")) $("targetInput").value = STATE.targetDaily || 20;
  // active tab
  setActiveTab(STATE.ui.lastTab || "library");
}

/* =========================
   STARTUP
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  bindUI();
  renderAll();
  setStatus(STATE.fullAccess ? "Full access" : DEMO_LABEL);
  // attempt to initialize voices after a short timeout (some browsers populate voices asynchronously)
  setTimeout(() => { initVoices(); }, 250);
  // show welcome if needed
  if (!STATE._welcomeShown) {
    STATE._welcomeShown = true;
    saveState();
    // do not auto-speak on load to avoid unexpected noise, but provide button
  }
});

/* =========================
   EXPORT: functions for debugging in console (optional)
   ========================= */
window.SSC = {
  STATE,
  saveState,
  loadState,
  handleFiles,
  extractTextFromPDFBuffer,
  extractTextFromImageFile,
  speakText,
  createMCQs,
  quickSummary,
  detailedSummary,
  exportBackup,
  importBackupFile,
  deleteAllDocuments,
  setActiveTab
};

/* === END OF FILE: app.js ===
   (copy-paste complete)
*/