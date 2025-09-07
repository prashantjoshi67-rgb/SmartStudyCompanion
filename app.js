/* START OF FILE: app.js */
/* Smart Study Companion — client-only app.js
   Expanded & commented version. Version: expanded-client-v1
   Author: assistant (as project collaborator)
   Notes:
     - Uses pdf.js and Tesseract.js (client-side). Ensure both libs are included in index.html before this script:
       * pdf.js (pdf.min.js) and pdf.worker.js (or set pdfjsLib.GlobalWorkerOptions.workerSrc)
       * tesseract.js (tesseract.min.js)
     - Requires certain element IDs in DOM. See comments below for those IDs.
*/

/* ========== CONFIG ========== */
const CONFIG = {
  DEMO_LICENSE: "FULLACCESS123", // change to your real "full access" key if needed
  DEMO_MODE_VISIBLE: true,       // show DEMO label
  OCR_LANG_DEFAULT: "eng",       // tesseract default language
  OCR_LANGS_AVAILABLE: ["eng","hin","mar","guj"], // languages we anticipate
  MAX_DEMO_UPLOAD_MB: 50,        // UI hint; not enforced by code
  FULL_MODE_MAX_MB: 500,         // for info only
  STORAGE_KEY: "ssc_state_v1",
};

/* ========== STATE ========== */
const state = {
  name: "Guest",
  voiceEnabled: false,
  voiceSettings: { voiceURI: null, rate: 1.0, pitch: 1.0, lang: "en-US" },
  license: "",
  fullAccess: false,
  library: [],       // [{ id, name, type, addedAt, text, meta }]
  badges: {},        // { badgeName: timestamp }
  target: 20,
  ocrLang: CONFIG.OCR_LANG_DEFAULT,
  ttsSamples: {},    // user-uploaded TTS samples { sampleId: blobUrl }
};

/* ========== UTILS ========== */
// $ shorthand (if you use jQuery remove it — I use vanilla below)
const $ = id => document.getElementById(id);

// simple uid
function uid(prefix="id") {
  return prefix + "_" + Math.random().toString(36).slice(2,9);
}

// simple notification helper (replace with your toast)
function notify(msg, type="info", timeout=2500) {
  console.log("NOTIFY:", type, msg);
  // create basic floating toast if not present
  let t = document.createElement("div");
  t.className = "ssc-toast ssc-toast-" + type;
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", right: "12px", bottom: "12px",
    background: "#222", color: "#fff", padding: "8px 12px",
    borderRadius: "8px", zIndex: 99999, opacity: 0.95
  });
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), timeout);
}

/* ========== PERSISTENCE ========== */
function saveState() {
  try {
    const payload = {
      name: state.name,
      voiceEnabled: state.voiceEnabled,
      voiceSettings: state.voiceSettings,
      license: state.license,
      fullAccess: state.fullAccess,
      library: state.library,
      badges: state.badges,
      target: state.target,
      ocrLang: state.ocrLang,
      ttsSamples: Object.keys(state.ttsSamples) // sample IDs only; blobs not persisted
    };
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(payload));
    console.log("Saved state.");
  } catch (e) {
    console.error("saveState failed", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if(!raw) return;
    const p = JSON.parse(raw);
    Object.assign(state, {
      name: p.name || state.name,
      voiceEnabled: !!p.voiceEnabled,
      voiceSettings: p.voiceSettings || state.voiceSettings,
      license: p.license || "",
      fullAccess: !!p.fullAccess,
      library: p.library || [],
      badges: p.badges || {},
      target: p.target || state.target,
      ocrLang: p.ocrLang || state.ocrLang
    });
    console.log("Loaded state.");
  } catch (e) {
    console.error("loadState failed", e);
  }
}

/* ========== LICENSE CHECK ========== */
function checkLicense() {
  state.fullAccess = (state.license === CONFIG.DEMO_LICENSE);
  // Update UI label if available
  const badge = $("licenseStatus");
  if (badge) badge.textContent = state.fullAccess ? "Status: Full access" : "Status: Demo";
  saveState();
  notify(state.fullAccess ? "Full access enabled" : "Demo mode active", state.fullAccess ? "success" : "info");
}

/* ========== VOICE / TTS ========== */
let availableVoices = [];

/* initVoices: populate voiceSelect dropdown with available voices.
   Expects a <select id="voiceSelect"></select> in the DOM.
*/
function initVoices() {
  function populate() {
    availableVoices = speechSynthesis.getVoices();
    const sel = $("voiceSelect");
    if (!sel) return;
    sel.innerHTML = "";
    // prefer Indian/IN voices first if present
    const preferred = ["en-IN", "hi-IN", "mr-IN"];
    const order = (v) => {
      const lang = v.lang || "";
      const idx = preferred.indexOf(lang);
      return idx === -1 ? 99 : idx;
    };
    availableVoices.sort((a,b)=> order(a)-order(b));
    availableVoices.forEach(v=>{
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang || "unknown"})`;
      sel.appendChild(opt);
    });
    // pick a default Indian voice if present
    const prefer = availableVoices.find(v => (v.lang && v.lang.startsWith("en-IN")) || (v.lang && v.lang.startsWith("hi")));
    if (prefer) {
      sel.value = prefer.voiceURI;
      state.voiceSettings.voiceURI = prefer.voiceURI;
      state.voiceSettings.lang = prefer.lang;
    } else if (availableVoices[0]) {
      sel.value = availableVoices[0].voiceURI;
      state.voiceSettings.voiceURI = availableVoices[0].voiceURI;
      state.voiceSettings.lang = availableVoices[0].lang;
    }
  }

  populate();
  // On some browsers voices load async
  speechSynthesis.onvoiceschanged = populate;
}

// ttsSpeak: speak a given text using current settings
function ttsSpeak(text, { rate, pitch, voiceURI } = {}) {
  if (!("speechSynthesis" in window)) {
    notify("TTS not supported in this browser", "error");
    return;
  }
  if (!text || text.trim().length === 0) return;
  const ut = new SpeechSynthesisUtterance(text);
  ut.rate = rate || state.voiceSettings.rate || 1.0;
  ut.pitch = pitch || state.voiceSettings.pitch || 1.0;
  try {
    if (voiceURI) {
      const v = availableVoices.find(x => x.voiceURI === voiceURI);
      if (v) ut.voice = v;
    } else if (state.voiceSettings.voiceURI) {
      const v = availableVoices.find(x => x.voiceURI === state.voiceSettings.voiceURI);
      if (v) ut.voice = v;
    }
    ut.lang = state.voiceSettings.lang || "en-US";
    speechSynthesis.cancel(); // stop previous
    speechSynthesis.speak(ut);
  } catch (e) {
    console.error("ttsSpeak error", e);
  }
}

/* ========== FILE HANDLING & EXTRACTION ========== */
/*
 Expected DOM elements:
   - input[type=file] with id="fileInput"
   - button id="processBtn"
   - button id="deleteAll"
   - container id="libraryList"
   - textarea id="outputText" (where summaries/quizzes appear)
*/

// helper: read file as ArrayBuffer
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = (e) => reject(e);
    fr.readAsArrayBuffer(file);
  });
}

// helper: read file as text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = (e) => reject(e);
    fr.readAsText(file);
  });
}

/* extractTextFromPDF: tries pdf.js text extraction first; falls back to OCR using Tesseract.
   Returns { text, ocrUsed: bool }
   Requires pdfjsLib (pdf.js) and Tesseract (Tesseract.js) loaded globally.
*/
async function extractTextFromPDF(arrayBuffer, docName="document.pdf") {
  try {
    // Setup pdf.js worker if needed (assuming pdfjsLib exists globally)
    if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // the index.html should set correct worker path; if not, we'll set to CDN fallback:
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js";
    }
    // load PDF
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = "";
    let extractedByText = false;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = content.items.map(i => i.str).join(" ");
      if (pageText && pageText.trim().length > 10) {
        fullText += pageText + "\n\n";
        extractedByText = true;
      } else {
        // page has no selectable text — may be image-based
        // stop early and do OCR fallback
        extractedByText = extractedByText || false;
      }
    }
    if (fullText.trim().length > 20) {
      return { text: fullText.trim(), ocrUsed: false };
    }
  } catch (e) {
    console.warn("PDF text extraction error:", e);
  }

  // Fallback: Use Tesseract OCR on PDF images — we render each page to canvas and OCR.
  try {
    if (!window.Tesseract) {
      throw new Error("Tesseract.js not present");
    }
    // Render each page to canvas images using pdf.js then OCR each.
    const loadingTask2 = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf2 = await loadingTask2.promise;
    let aggregatedText = "";
    for (let p = 1; p <= pdf2.numPages; p++) {
      const page = await pdf2.getPage(p);
      // viewport scaled for better OCR
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      // run Tesseract on the canvas
      notify(`Running OCR on page ${p}...`, "info", 1200);
      const res = await Tesseract.recognize(canvas, state.ocrLang || CONFIG.OCR_LANG_DEFAULT, {
        logger: m => { /* optional progress logger */ }
      });
      if (res && res.data && res.data.text) {
        aggregatedText += res.data.text + "\n\n";
      }
      // free canvas memory
      canvas.remove();
    }
    if (aggregatedText.trim().length > 10) {
      return { text: aggregatedText.trim(), ocrUsed: true };
    } else {
      return { text: "", ocrUsed: true };
    }
  } catch (ocrErr) {
    console.error("OCR fallback failed:", ocrErr);
    return { text: "", ocrUsed: true };
  }
}

/* processFiles: main processing invoked on "Process" click.
   Accepts FileList or Array of Files
*/
async function processFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    notify("No files selected", "warning");
    return;
  }
  notify("Processing files...", "info");
  for (const f of fileList) {
    try {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
        const arr = await readFileAsArrayBuffer(f);
        const { text, ocrUsed } = await extractTextFromPDF(arr, f.name);
        const doc = {
          id: uid("doc"),
          name: f.name,
          type: "pdf",
          addedAt: new Date().toISOString(),
          text: text || "",
          meta: { ocrUsed, size: f.size }
        };
        state.library.push(doc);
        notify(`${f.name} processed (${ocrUsed ? "OCR" : "text"})`, "success", 1800);
      } else if (f.type.startsWith("image/") || /\.(jpg|jpeg|png)$/i.test(f.name)) {
        // image file — run OCR only
        const arr = await readFileAsArrayBuffer(f);
        // create image from blob
        const blob = new Blob([arr], { type: f.type });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await new Promise((res)=> { img.onload = res; img.onerror = res; });
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img,0,0);
        const res = await Tesseract.recognize(canvas, state.ocrLang || CONFIG.OCR_LANG_DEFAULT);
        const doc = {
          id: uid("img"),
          name: f.name,
          type: "image",
          addedAt: new Date().toISOString(),
          text: (res && res.data && res.data.text) ? res.data.text : "",
          meta: { ocrUsed: true, size: f.size }
        };
        state.library.push(doc);
        URL.revokeObjectURL(url);
        canvas.remove();
        notify(`${f.name} OCR done`, "success", 1200);
      } else if (f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt")) {
        const txt = await readFileAsText(f);
        const doc = {
          id: uid("txt"),
          name: f.name,
          type: "text",
          addedAt: new Date().toISOString(),
          text: txt,
          meta: { size: f.size }
        };
        state.library.push(doc);
        notify(`${f.name} added`, "success", 1200);
      } else if (f.name.toLowerCase().endsWith(".zip")) {
        // Zip handling: if your index.html includes a library (JSZip) you can unpack here.
        // We'll add a stub and let developer include JSZip integration later.
        notify("ZIP detected — unpacking not implemented client-side in this build", "warning", 3000);
        // Optional: use JSZip to read and call processFiles on contained files.
      } else {
        notify(`Unsupported file type: ${f.name}`, "warning", 1800);
      }
    } catch (e) {
      console.error("processFiles error:", e);
      notify(`Failed processing ${f.name}`, "error", 2000);
    }
  }
  saveState();
  renderLibrary();
}

/* ========== LIBRARY UI ========== */
function renderLibrary() {
  const list = $("libraryList");
  if (!list) return;
  list.innerHTML = "";
  if (state.library.length === 0) {
    list.innerHTML = "<div class='card note'>(no documents)</div>";
    return;
  }
  state.library.forEach(doc => {
    const card = document.createElement("div");
    card.className = "card doc-card";
    card.innerHTML = `
      <div class="doc-title">${escapeHtml(doc.name)}</div>
      <div class="doc-meta">Added: ${new Date(doc.addedAt).toLocaleString()}</div>
      <div class="doc-actions">
        <button class="btn small" data-docid="${doc.id}" data-action="view">View</button>
        <button class="btn small danger" data-docid="${doc.id}" data-action="delete">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });
  // attach handlers
  list.querySelectorAll("button").forEach(btn=>{
    btn.onclick = (e)=>{
      const id = btn.getAttribute("data-docid");
      const act = btn.getAttribute("data-action");
      if (act === "view") {
        const d = state.library.find(x=>x.id===id);
        if (!d) return notify("Document not found");
        displayDocument(d);
      } else if (act === "delete") {
        // confirm
        if (confirm("Delete this document?")) {
          state.library = state.library.filter(x=>x.id!==id);
          saveState();
          renderLibrary();
          notify("Deleted");
        }
      }
    };
  });
}

function clearAllDocs() {
  if (!confirm("Delete all documents?")) return;
  state.library = [];
  saveState();
  renderLibrary();
  notify("All documents deleted", "info");
}

/* displayDocument: show document text or PDF viewer
   Expects an element #outputText (textarea/div) to show text
*/
function displayDocument(doc) {
  const out = $("outputText");
  if (!out) {
    alert("No outputText element found to display document");
    return;
  }
  if (doc.type === "pdf" || doc.type === "text" || doc.type === "image") {
    if (doc.text && doc.text.trim().length > 0) {
      out.value = doc.text;
    } else {
      out.value = `(no text extracted)`;
    }
  } else {
    out.value = `(unsupported doc type)`;
  }
  // Optionally open a modal viewer — skipped for mobile simplicity.
}

/* ========== BADGES & TARGETS ========== */
function updateBadges() {
  // basic logic: award badges for counts
  const docs = state.library.length;
  if (docs >= 1 && !state.badges["first_upload"]) state.badges["first_upload"] = new Date().toISOString();
  if (docs >= 10 && !state.badges["ten_uploads"]) state.badges["ten_uploads"] = new Date().toISOString();
  // save
  saveState();
  renderBadges();
}
function renderBadges() {
  const container = $("badgesList");
  if (!container) return;
  container.innerHTML = "";
  const keys = Object.keys(state.badges || {});
  if (keys.length === 0) container.textContent = "(no badges yet)";
  else {
    keys.forEach(k=>{
      const el = document.createElement("div");
      el.className = "badge";
      el.textContent = `${k} • ${new Date(state.badges[k]).toLocaleDateString()}`;
      container.appendChild(el);
    });
  }
}

/* ========== QUIZ GENERATION (stub) ========== */
/*
 This generator is a client-only heuristic: it picks sentences & makes a trivial MCQ by removing a word.
 Later we will plug in a real question generator (LLM or rule-based).
*/
function generateMCQs(num=10, choices=4) {
  // gather all text
  const allText = state.library.map(d => d.text || "").join("\n");
  if (!allText || allText.trim().length < 100) {
    notify("Not enough material to generate MCQs.", "warning");
    return [];
  }
  // split to sentences
  const sentences = allText.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
  const questions = [];
  for (let i=0;i<Math.min(num,sentences.length);i++) {
    const s = sentences[i];
    const words = s.split(/\s+/).filter(w=>w.length>3);
    if (words.length === 0) continue;
    const answer = words[Math.floor(Math.random()*words.length)];
    const questionText = s.replace(answer, "_____");
    // generate fake choices
    const wrongs = [];
    while (wrongs.length < choices-1) {
      const w = words[Math.floor(Math.random()*words.length)];
      if (w !== answer && !wrongs.includes(w)) wrongs.push(w);
      if (wrongs.length > 20) break;
    }
    const opts = [answer, ...wrongs].sort(()=>Math.random()-0.5);
    questions.push({ q: questionText, options: opts, answer });
  }
  return questions;
}

function renderMCQs(questions) {
  const out = $("outputText");
  if (!out) return;
  if (!questions || questions.length === 0) {
    out.value = "(no MCQs)";
    return;
  }
  let text = "";
  questions.forEach((qq, idx) => {
    text += `${idx+1}. ${qq.q}\n`;
    qq.options.forEach((o,j)=> text += `   ${String.fromCharCode(65+j)}. ${o}\n`);
    text += `Answer: ${qq.answer}\n\n`;
  });
  out.value = text;
}

/* ========== SAMPLE VOICE UPLOAD (preview) ========== */
/*
  Supports user uploading a small audio clip and saving it as a sample.
  Expects <input type="file" id="voiceSampleInput">
*/
function handleVoiceSampleUpload(file) {
  if (!file) return notify("No sample selected");
  const id = uid("sample");
  const url = URL.createObjectURL(file);
  state.ttsSamples[id] = url;
  saveState(); // note: actual blob not stored, only id
  notify("Voice sample uploaded. Use 'preview sample' to hear it.");
  // show sample in UI if necessary
}

/* ========== UI HOOKUP ========== */
function wireUI() {
  // Basic bindings — ensure the following IDs exist in index.html
  const saveBtn = $("saveName");
  if (saveBtn) saveBtn.onclick = () => {
    const nameEl = $("name");
    if (nameEl) state.name = nameEl.value || "Guest";
    saveState();
    showWelcome();
    notify("Name saved", "success");
  };

  const enableVoiceBtn = $("enableVoice");
  if (enableVoiceBtn) enableVoiceBtn.onclick = () => {
    state.voiceEnabled = !state.voiceEnabled;
    enableVoiceBtn.textContent = state.voiceEnabled ? "Disable voice" : "Enable voice";
    saveState();
    notify(state.voiceEnabled ? "Voice enabled" : "Voice disabled");
  };

  const voiceSelect = $("voiceSelect");
  if (voiceSelect) voiceSelect.onchange = (e) => {
    const sel = voiceSelect.value;
    state.voiceSettings.voiceURI = sel;
    const v = availableVoices.find(x=>x.voiceURI===sel);
    if (v) state.voiceSettings.lang = v.lang;
    saveState();
  };

  const applyLicense = $("applyLicense");
  if (applyLicense) applyLicense.onclick = () => {
    const lic = ($("license") && $("license").value) || "";
    state.license = lic;
    checkLicense();
  };

  const fileInput = $("fileInput");
  if (fileInput) fileInput.onchange = (e) => {
    const files = e.target.files;
    // quick UI display of chosen file name
    const chosen = $("chosenFileName");
    if (chosen) chosen.textContent = files && files.length ? files[0].name : "(no file chosen)";
  };

  const processBtn = $("processBtn");
  if (processBtn) processBtn.onclick = async () => {
    const fileInputEl = $("fileInput");
    if (!fileInputEl || !fileInputEl.files || fileInputEl.files.length === 0) {
      notify("Choose files first", "warning");
      return;
    }
    await processFiles(fileInputEl.files);
    updateBadges();
  };

  const deleteAllBtn = $("deleteAll");
  if (deleteAllBtn) deleteAllBtn.onclick = clearAllDocs;

  const createMCQsBtn = $("createMCQs");
  if (createMCQsBtn) createMCQsBtn.onclick = () => {
    const qs = generateMCQs(10, 4);
    renderMCQs(qs);
  };

  const readBtn = $("readBtn");
  if (readBtn) readBtn.onclick = () => {
    const out = $("outputText");
    if (!out) return;
    ttsSpeak(out.value || "No text to read");
  };

  // OCR language selector
  const ocrSelect = $("ocrLang");
  if (ocrSelect) {
    ocrSelect.onchange = () => {
      state.ocrLang = ocrSelect.value;
      saveState();
      notify("OCR language set to " + state.ocrLang);
    };
    // populate options
    ocrSelect.innerHTML = "";
    CONFIG.OCR_LANGS_AVAILABLE.forEach(l=>{
      const o = document.createElement("option");
      o.value = l; o.textContent = l;
      if (l === state.ocrLang) o.selected = true;
      ocrSelect.appendChild(o);
    });
  }
}

/* ========== WELCOME & UI INIT ========== */
function showWelcome() {
  const welcomeEl = $("welcomeNote");
  if (welcomeEl) {
    let text = `Hi ${state.name}!`;
    if (state.voiceEnabled) text += " (voice active)";
    welcomeEl.textContent = text;
  }
  if (state.voiceEnabled) {
    ttsSpeak(`Welcome ${state.name}. Smart Study Companion ready.`);
  }
}

/* ========== BOOTSTRAP ========== */
document.addEventListener("DOMContentLoaded", async () => {
  // Load saved state
  loadState();

  // initialize voices & UI
  if ("speechSynthesis" in window) initVoices();

  // wire UI handlers
  wireUI();

  // render initial parts
  renderLibrary();
  renderBadges();
  checkLicense();
  showWelcome();

  // if demo label area exists
  const demoLabel = $("demoLabel");
  if (demoLabel && CONFIG.DEMO_MODE_VISIBLE) {
    demoLabel.textContent = state.fullAccess ? "FULL ACCESS" : "DEMO VERSION";
    demoLabel.className = state.fullAccess ? "demo-label full" : "demo-label demo";
  }

  // debug: indicate loaded
  console.log("App ready. State:", state);
});

/* ========== EXPORTS for testing (optional global hooks) ========== */
window.ssc = {
  state,
  saveState,
  loadState,
  processFiles,
  extractTextFromPDF,
  ttsSpeak,
  generateMCQs,
  checkLicense
};

/* === END OF FILE: app.js === */
/* Approximate lines in this expanded file: ~420 lines (depends on formatting) */