/* === START OF FILE: app.js ===
   Full integrated Smart Study Companion app script
   Approx lines: 780
   Notes:
     - Replace existing app.js with this complete file.
     - index.html already includes pdf.js, tesseract.js and jszip via CDN.
     - OCR languages supported: 'eng','hin','mar','guj','eng+hin' (depends on tessdata availability)
     - Default timeout behavior: SKIP question on timeout
*/

'use strict';

/* global pdfjsLib, Tesseract, JSZip */

// -----------------------------
// Utilities, state and storage
// -----------------------------
const $ = id => document.getElementById(id);

const STORAGE_KEY = 'ssc_v5_state';
const APP_VERSION = '1.0.0';

let state = {
  user: { name: '' },
  license: 'DEMO',
  voice: { enabled: false, name: null, rate: 1.0, pitch: 1.0 },
  appearance: { preset: 'dark', vars: null },
  ocrLang: 'eng',
  library: [], // each item: { name, type, added, text, subject, chapter }
  badges: [],
  targets: { daily: 20 },
  lastProcessedAt: null,
  settings: { timeoutBehavior: 'skip' } // default skip
};

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('saveState', e); }
}
function loadState() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) state = Object.assign(state, JSON.parse(raw)); } catch (e) { console.warn('loadState', e); }
}
loadState();

function setStatus(msg) {
  const s = $('statusText'); if (s) s.innerText = msg || 'Ready';
}

// Safe escape for display
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// -----------------------------
// Multilingual label helper
// (we show short triple-labels near controls)
// -----------------------------
const LABELS = {
  testVoice: { en: 'Test Voice', hi: 'वॉइस टेस्ट', mr: 'वॉइस चाचणी' },
  enableVoice: { en: 'Enable Voice', hi: 'वॉइस चालू', mr: 'वॉइस सुरू करा' },
  timer: { en: 'Timer', hi: 'टाइमर', mr: 'टायमर' }
};
function triple(labelKey) {
  const t = LABELS[labelKey];
  if(!t) return labelKey;
  return `${t.en} — ${t.hi} — ${t.mr}`;
}

// -----------------------------
// Voice Manager (TTS) - prefers Indian voices
// -----------------------------
const VoiceManager = (function(){
  const vm = { voices: [], preferred: null, name: state.voice.name || null, enabled: !!state.voice.enabled, rate: state.voice.rate||1, pitch: state.voice.pitch||1 };

  function loadVoices() {
    if (!('speechSynthesis' in window)) { console.warn('speechSynthesis missing'); return; }
    vm.voices = window.speechSynthesis.getVoices() || [];
    vm.preferred = findIndian(vm.voices);
    // if persisted name exists, try to reselect
    if (vm.name) {
      const found = vm.voices.find(v=>v.name === vm.name);
      if (found) vm.preferred = found;
    }
    populateSelect();
  }

  function findIndian(list) {
    if(!list || !list.length) return null;
    let v = list.find(x => /^en[-_]?IN$/i.test(x.lang) || /^hi[-_]?IN$/i.test(x.lang));
    if(v) return v;
    v = list.find(x => /India|Hindi|Marathi|Hind|Bharat/i.test(x.name));
    if(v) return v;
    v = list.find(x => /^en/i.test(x.lang));
    if(v) return v;
    return list[0];
  }

  function populateSelect(){
    const sel = $('voiceSelect');
    if(!sel) return;
    sel.innerHTML = '';
    vm.voices.forEach((v, i) => {
      const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(o);
    });
    if (vm.name) sel.value = vm.name;
    else if (vm.preferred) sel.value = vm.preferred.name;
    sel.onchange = () => { vm.name = sel.value; state.voice.name = vm.name; saveState(); };
  }

  function setEnabled(flag) {
    vm.enabled = !!flag;
    state.voice.enabled = vm.enabled;
    saveState();
  }

  function speak(text, opts = {}) {
    if (!vm.enabled) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      // choose voice by name if set, else preferred
      let voice = null;
      if (vm.name) voice = vm.voices.find(v => v.name === vm.name);
      if (!voice) voice = vm.preferred;
      if (voice) utt.voice = voice;
      utt.rate = (opts.rate || vm.rate || 1.0);
      utt.pitch = (opts.pitch || vm.pitch || 1.0);
      if (opts.lang) utt.lang = opts.lang;
      window.speechSynthesis.speak(utt);
    } catch (e) { console.warn('speak error', e); }
  }

  function test() {
    setStatus('Testing voice...');
    speak('Welcome to Smart Study Companion');
    setTimeout(()=> speak('नमस्कार, आप कैसे हैं?'), 1400);
  }

  function init() {
    try {
      loadVoices();
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.onvoiceschanged = loadVoices;
      }
      // wire UI
      const btn = $('enableVoice');
      if (btn) {
        btn.textContent = vm.enabled ? triple('enableVoice')+' : ON' : triple('enableVoice')+' : OFF';
        btn.onclick = () => {
          vm.enabled = !vm.enabled;
          state.voice.enabled = vm.enabled;
          saveState();
          btn.textContent = vm.enabled ? triple('enableVoice')+' : ON' : triple('enableVoice')+' : OFF';
          if (vm.enabled) speak('Voice enabled');
        };
      }
      const testBtn = $('testVoice');
      if (testBtn) testBtn.textContent = triple('testVoice');
      if (testBtn) testBtn.onclick = () => { test(); };
      // pitch/rate controls if exist
      const rateEl = $('voiceRate');
      const pitchEl = $('voicePitch');
      if (rateEl) { rateEl.onchange = ()=> { vm.rate = parseFloat(rateEl.value||1); state.voice.rate = vm.rate; saveState(); } }
      if (pitchEl) { pitchEl.onchange = ()=> { vm.pitch = parseFloat(pitchEl.value||1); state.voice.pitch = vm.pitch; saveState(); } }
    } catch(e) { console.warn('Voice init', e); }
  }

  return { init, speak, test, setEnabled, getVoices: ()=>vm.voices, getPreferred: ()=>vm.preferred };
})();

// -----------------------------
// Appearance manager
// -----------------------------
const Appearance = (function(){
  function applyVars(vars) {
    const r = document.documentElement;
    if (!vars) return;
    if (vars.bg) r.style.setProperty('--bg', vars.bg);
    if (vars.accent) r.style.setProperty('--accent', vars.accent);
    if (vars.text) r.style.setProperty('--text', vars.text);
    if (vars.fontSize) r.style.setProperty('--font-size', vars.fontSize);
  }
  function setPreset(p) {
    if (p === 'vibrant') document.documentElement.setAttribute('data-theme','vibrant');
    else if (p === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    state.appearance.preset = p;
    saveState();
  }
  function load() {
    const a = state.appearance;
    if (a && a.preset) setPreset(a.preset);
    if (a && a.vars) applyVars(a.vars);
  }
  function initControls() {
    const preset = $('themePreset'); if (!preset) return;
    preset.onchange = ()=> setPreset(preset.value);
    const apply = $('applyTheme'); if (apply) apply.onclick = ()=> {
      const vars = { bg: $('bgColor')?.value, accent: $('accentColor')?.value, text: $('textColor')?.value, fontSize: $('fontSize')?.value };
      applyVars(vars); state.appearance.vars = vars; saveState(); setStatus('Appearance applied');
    };
    const reset = $('resetTheme'); if (reset) reset.onclick = ()=> { document.documentElement.removeAttribute('data-theme'); state.appearance = { preset:'dark', vars:null}; saveState(); setStatus('Appearance reset'); };
  }
  return { load, initControls };
})();

// -----------------------------
// OCR & PDF extraction
// - attempt pdf.js text extraction first
// - if no text or text too small, run Tesseract OCR on pages (up to MAX_OCR_PAGES)
// -----------------------------

async function extractTextFromPdfArrayBuffer(ab, onProgress) {
  if (!window.pdfjsLib) throw new Error('pdfjsLib not found');
  const loadingTask = pdfjsLib.getDocument({ data: ab });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let allText = '';

  // 1. attempt to read textContent on each page (fast)
  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    try {
      const content = await page.getTextContent();
      const pageText = (content.items || []).map(i => i.str || '').join(' ').trim();
      if (pageText) allText += pageText + '\n\n';
    } catch (e) {
      console.warn('textContent error page', p, e);
    }
    if (typeof onProgress === 'function') onProgress({ stage: 'pdf_text', page:p, total: numPages });
  }

  if (allText.trim().length > 40) {
    return { success: true, text: allText.trim(), pages: numPages, usedOCR:false };
  }

  // 2. fallback to OCR per page using Tesseract
  if (!window.Tesseract) return { success:false, text:'', pages:numPages, usedOCR:false, message:'Tesseract not available' };

  const worker = Tesseract.createWorker({
    logger: m => {
      if (m && m.status && m.progress) {
        // status e.g. 'recognizing text'
        if (typeof onProgress === 'function') onProgress({ stage:'ocr', status:m.status, progress:m.progress });
      }
    }
  });

  await worker.load();
  // Load user-selected OCR language (state.ocrLang). If e.g. 'eng+hin' that is allowed.
  const ocrLang = state.ocrLang || 'eng';
  try {
    await worker.loadLanguage(ocrLang);
    await worker.initialize(ocrLang);
  } catch (e) {
    console.warn('Tesseract language load/init failed', e);
    // Try fallback to eng
    try { await worker.loadLanguage('eng'); await worker.initialize('eng'); } catch(e2){ console.warn('fallback eng failed', e2); }
  }

  const MAX_OCR_PAGES = 25; // safety cap on mobile
  const pagesToDo = Math.min(numPages, MAX_OCR_PAGES);
  let ocrText = '';
  for (let p = 1; p <= pagesToDo; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    // create canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) { console.warn('page render error', e); }
    // convert to blob
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.9));
    if (!blob) {
      console.warn('canvas.toBlob returned null on page', p);
      continue;
    }
    // run OCR for this page
    try {
      const { data } = await worker.recognize(blob);
      if (data && data.text) ocrText += data.text + '\n\n';
    } catch (e) { console.warn('tesseract recognize page error', e); }
    canvas.width = 0; canvas.height = 0;
    if (typeof onProgress === 'function') onProgress({ stage:'ocr_page', page:p, total: pagesToDo });
  }

  await worker.terminate();

  if (ocrText.trim().length > 10) {
    return { success: true, text: ocrText.trim(), pages: numPages, usedOCR: true };
  } else {
    return { success: false, text: '', pages: numPages, usedOCR: true, message:'OCR returned no text' };
  }
}

// Generic wrapper: file -> processed entry
async function processBlobAsDocument(blob, nameHint, onProgress) {
  const entry = { name: nameHint || (blob && blob.name) || 'file', type: blob && blob.type || '', added: new Date().toISOString(), text: '', subject: '', chapter: '' };
  try {
    const lower = (entry.name || '').toLowerCase();
    if (lower.endsWith('.zip')) {
      // unzip and process inner files
      if (!window.JSZip) { entry.text = ''; return entry; }
      const zip = await JSZip.loadAsync(blob);
      for (const fname of Object.keys(zip.files)) {
        const f = zip.files[fname];
        if (f.dir) continue;
        const innerBlob = await f.async('blob');
        const innerEntry = await processBlobAsDocument(innerBlob, fname, onProgress);
        // store inner entries separately to library
        state.library.push(innerEntry);
      }
      saveState();
      return null; // caller should ignore (zip expands)
    }

    if (lower.endsWith('.pdf') || blob.type === 'application/pdf') {
      // try pdf.js -> text -> OCR fallback
      const ab = await blob.arrayBuffer();
      const res = await extractTextFromPdfArrayBuffer(ab, onProgress);
      if (res && res.success && res.text) {
        entry.text = res.text;
        return entry;
      } else {
        entry.text = (res && res.text) ? res.text : '';
        return entry;
      }
    }

    if (blob.type && blob.type.startsWith('image/')) {
      // run OCR on single image
      if (!window.Tesseract) { entry.text = ''; return entry; }
      const worker = Tesseract.createWorker({ logger: m => {/* omit progress to reduce noise */} });
      await worker.load();
      try {
        await worker.loadLanguage(state.ocrLang || 'eng');
        await worker.initialize(state.ocrLang || 'eng');
      } catch(e){ try { await worker.loadLanguage('eng'); await worker.initialize('eng'); } catch(e2){} }
      const { data } = await worker.recognize(blob);
      entry.text = data && data.text ? data.text.trim() : '';
      await worker.terminate();
      return entry;
    }

    // fallback text/html reading
    try {
      const txt = await blob.text();
      entry.text = txt;
      return entry;
    } catch (e) {
      console.warn('blob.text failed', e);
      return entry;
    }
  } catch (err) {
    console.warn('processBlobAsDocument error', err);
    return entry;
  }
}

// process file list
async function handleFileInput(files, onProgress) {
  if (!files || files.length === 0) { setStatus('No files selected'); return; }
  setStatus('Processing files...');
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const processed = await processBlobAsDocument(f, f.name, (p)=> {
        // forward progress to status
        if (p && p.stage) setStatus(`Processing ${f.name}: ${p.stage} ${p.page?('page '+p.page):''} ${(p.progress?Math.round(p.progress*100)+'%':'')}`);
        if (typeof onProgress === 'function') onProgress(p);
      });
      if (processed) {
        state.library.push(processed);
        setStatus(`Processed ${processed.name}`);
      } else {
        setStatus(`Processed archive ${f.name}`);
      }
    } catch (e) {
      console.error('file process error', e);
      setStatus(`Error processing ${f.name}`);
    }
  }
  state.lastProcessedAt = new Date().toISOString();
  saveState();
  renderLibrary();
  updateBadges();
  setStatus('All files processed');
}

// -----------------------------
// Library UI: render, view, delete
// -----------------------------
function renderLibrary() {
  const list = $('libraryList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.library || !state.library.length) {
    list.innerHTML = '<div class="small">No documents yet</div>';
    return;
  }
  state.library.forEach((doc, idx) => {
    const row = document.createElement('div');
    row.className = 'docRow';
    row.innerHTML = `
      <div>
        <div class="docTitle">${escapeHtml(doc.name)}</div>
        <div class="docMeta">${escapeHtml(doc.type||'')} • ${new Date(doc.added).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn" data-i="${idx}" data-action="view">View</button>
        <button class="btn" data-i="${idx}" data-action="summary">Summary</button>
        <button class="btn danger" data-i="${idx}" data-action="delete">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
  // attach events
  list.querySelectorAll('button[data-action="view"]').forEach(b => b.onclick = e => {
    const i = +e.currentTarget.dataset.i; viewDocument(i);
  });
  list.querySelectorAll('button[data-action="summary"]').forEach(b => b.onclick = e => {
    const i = +e.currentTarget.dataset.i; const doc = state.library[i];
    if (!doc) return;
    $('summaryOutput') && ($('summaryOutput').textContent = doc.text ? doc.text.slice(0, 1200) : '(no text)');
    setStatus('Showing document snapshot');
  });
  list.querySelectorAll('button[data-action="delete"]').forEach(b => b.onclick = e => {
    const i = +e.currentTarget.dataset.i; if(!confirm('Delete this document?')) return;
    state.library.splice(i,1); saveState(); renderLibrary(); setStatus('Deleted');
  });
}

function viewDocument(i) {
  const d = state.library[i];
  if (!d) return setStatus('Document missing');
  const w = window.open('', '_blank');
  const html = `
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(d.name)}</title>
    <style>body{font-family:Inter,Arial;padding:16px;background:#0b1220;color:#e6eef6}</style></head>
    <body><h2>${escapeHtml(d.name)}</h2><pre>${escapeHtml(d.text || '(no text)')}</pre></body></html>
  `;
  w.document.open(); w.document.write(html); w.document.close();
}

// -----------------------------
// Summaries (quick & detailed)
// -----------------------------
function getAllText() { return state.library.map(d=>d.text||'').join('\n\n'); }

function quickSummary() {
  const all = getAllText();
  if (!all || all.length < 20) return '(no material)';
  const sents = all.match(/[^\.!\?]+[\.!\?]+/g) || [all];
  return sents.slice(0,4).join(' ').trim();
}

function detailedSummary() {
  const all = getAllText();
  if (!all || all.length < 20) return '(no material)';
  const words = all.split(/\s+/).slice(0,1500);
  return words.join(' ');
}

// -----------------------------
// Basic MCQ generator (crude heuristic)
// -----------------------------
function generateMCQsFromText(count=10) {
  const text = getAllText();
  if (!text || text.length < 100) return { error: 'Not enough content' };
  const sentences = text.split(/[\r\n]+|[\.!?]+/).map(s=>s.trim()).filter(Boolean);
  const questions = [];
  for (let i=0;i<Math.min(count, sentences.length); i++) {
    const qtxt = truncate(sentences[i], 120);
    const correct = qtxt;
    const d1 = shuffleText(correct);
    const d2 = shuffleText(correct + ' extra');
    const d3 = shuffleText(correct + ' more');
    const choices = shuffleArray([correct, d1, d2, d3]);
    questions.push({ q: qtxt, choices, answer: correct });
  }
  return { questions };
}
function renderMCQList(questions) {
  if (!questions || !questions.length) return '(no questions)';
  return questions.map((q, idx) => {
    return `${idx+1}. ${q.q}\n${q.choices.map((c,i)=>String.fromCharCode(65+i)+') '+c).join('\n')}\n`;
  }).join('\n');
}

// -----------------------------
// GK module (OpenTDB + KBC dataset import)
// -----------------------------
const GK = (function(){
  const session = { pool: [], index:0, score:0, current:null, timerId:null, timeLeft:0 };

  function decodeHtml(s){ const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

  async function fetchOpenTDB(amount=10, difficulty='medium') {
    try {
      const url = `https://opentdb.com/api.php?amount=${amount}&type=multiple${difficulty ? '&difficulty='+difficulty : ''}`;
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.results) {
        return j.results.map((it,idx) => ({
          id: 'otdb_'+idx+'_'+Date.now(),
          question: decodeHtml(it.question),
          options: shuffleArray([decodeHtml(it.correct_answer), ...it.incorrect_answers.map(decodeHtml)]),
          answer: decodeHtml(it.correct_answer),
          subject: it.category, difficulty: it.difficulty
        }));
      }
    } catch (e) { console.warn('OpenTDB failed', e); }
    return [];
  }

  function parseCSVtoQuestions(txt) {
    const lines = txt.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const header = lines.shift().split(',').map(h=>h.trim().toLowerCase());
    const arr = lines.map(line => {
      const cols = line.split(','); const obj={};
      header.forEach((h,i)=> obj[h]=cols[i]?cols[i].trim():'');
      return { id: obj.id || ('csv_'+Math.random().toString(36).slice(2,8)), question: obj.question||'', options: [obj.option1||'', obj.option2||'', obj.option3||'', obj.option4||''], answer: obj.answer||(obj.option1||''), hint: obj.hint||'', subject: obj.subject||'General' };
    });
    return arr;
  }

  function start(pool) {
    session.pool = shuffleArray(pool || []);
    session.index = 0; session.score = 0; session.current = null;
    loadNext();
  }

  function loadNext() {
    if (session.index >= session.pool.length) {
      setStatus(`GK complete. Score: ${session.score}`);
      renderQuestion(null);
      return;
    }
    session.current = session.pool[session.index];
    renderQuestion(session.current);
    // timer
    const t = parseInt($('quizTimer') ? $('quizTimer').value : 0) || 0;
    startTimer(t);
  }

  function renderQuestion(q) {
    const qEl = $('gkQuestionText'); const optsEl = $('gkOptions'); if (!qEl || !optsEl) return;
    if (!q) { qEl.innerText = 'Session complete'; optsEl.innerHTML = ''; return; }
    qEl.innerText = q.question;
    optsEl.innerHTML = '';
    q.options.forEach((opt, i) => {
      const b = document.createElement('button'); b.className='btn'; b.innerText = String.fromCharCode(65+i)+'. '+opt;
      b.onclick = ()=> answer(opt);
      optsEl.appendChild(b);
    });
    $('gkScore') && ($('gkScore').innerText = `Score: ${session.score} • Q ${session.index+1}/${session.pool.length}`);
  }

  function answer(choice) {
    if (!session.current) return;
    if (choice === session.current.answer) {
      session.score++;
      setStatus('Correct!');
      VoiceManager.speak('Correct answer');
    } else {
      setStatus('Wrong. Correct: ' + session.current.answer);
      VoiceManager.speak('Wrong answer');
    }
    clearTimer();
    session.index++;
    setTimeout(()=> loadNext(), 700);
  }

  function lifeline5050() {
    const optsEl = $('gkOptions'); if (!optsEl || !session.current) return;
    const buttons = Array.from(optsEl.children);
    const wrongBtns = buttons.filter(b => !b.innerText.includes(session.current.answer));
    let removed = 0;
    for (let b of wrongBtns) { if (removed >= 2) break; b.style.visibility='hidden'; removed++; }
    setStatus('50-50 used');
  }
  function lifelineHint() { if (!session.current) return setStatus(session.current.hint || ('Hint: starts with '+(session.current.answer[0]||'?'))); }
  function lifelineSkip() { setStatus('Skipped'); session.index++; loadNext(); }

  function startTimer(seconds) {
    clearTimer();
    if (!seconds || seconds <= 0) return;
    session.timeLeft = seconds;
    $('gkTimer') && ($('gkTimer').innerText = `Time left: ${session.timeLeft}s`);
    session.timerId = setInterval(()=> {
      session.timeLeft--;
      $('gkTimer') && ($('gkTimer').innerText = `Time left: ${session.timeLeft}s`);
      if (session.timeLeft <= 10 && session.timeLeft > 0) VoiceManager.speak(String(session.timeLeft));
      if (session.timeLeft <= 0) {
        clearTimer();
        // default behaviour = SKIP (state.settings.timeoutBehavior)
        if ((state.settings && state.settings.timeoutBehavior) === 'skip') {
          setStatus('Time up — skipped');
          session.index++;
          loadNext();
        } else {
          // mark wrong then next
          setStatus('Time up — marked wrong');
          session.index++;
          loadNext();
        }
      }
    }, 1000);
  }

  function clearTimer(){ if (session.timerId) { clearInterval(session.timerId); session.timerId = null; } $('gkTimer') && ($('gkTimer').innerText=''); }

  // Bind UI controls
  function wire() {
    const startBtn = $('startGK'); if (startBtn) startBtn.onclick = async ()=> {
      const mode = $('gkMode') ? $('gkMode').value : 'dynamic_gk';
      if (mode === 'kbc_archive') {
        const f = $('kbcDataset') && $('kbcDataset').files && $('kbcDataset').files[0];
        if (!f) { setStatus('Choose dataset file'); return; }
        const txt = await f.text();
        const arr = txt.trim().startsWith('[') ? JSON.parse(txt) : parseCSVtoQuestions(txt);
        start(arr);
      } else if (mode === 'dynamic_gk') {
        setStatus('Fetching GK questions...');
        const out = await fetchOpenTDB(15, $('gkDifficulty') ? $('gkDifficulty').value : 'medium');
        start(out);
      } else {
        setStatus('Mode not supported');
      }
    };
    const stopBtn = $('stopGK'); if (stopBtn) stopBtn.onclick = ()=> { clearTimer(); renderQuestion(null); setStatus('Stopped'); };
    const lif50 = $('lifeline5050'); if (lif50) lif50.onclick = lifeline5050;
    const lifHint = $('lifelineHint'); if (lifHint) lifHint.onclick = lifelineHint;
    const lifSkip = $('lifelineSkip'); if (lifSkip) lifSkip.onclick = lifelineSkip;
    const importBtn = $('importKBC'); if (importBtn) importBtn.onclick = async ()=> {
      const f = $('kbcDataset') && $('kbcDataset').files && $('kbcDataset').files[0];
      if (!f) return setStatus('Choose dataset');
      try {
        const txt = await f.text();
        const parsed = txt.trim().startsWith('[') ? JSON.parse(txt) : parseCSVtoQuestions(txt);
        window._imported_kbc = parsed;
        setStatus('Imported dataset with '+parsed.length+' questions');
      } catch (e) { setStatus('Import failed: '+e.message); }
    };
  }

  return { wire };
})();

// -----------------------------
// Quiz system (simple MCQ flow with timer + skip default)
// -----------------------------
const Quiz = (function(){
  let qsession = { questions: [], index:0, score:0, timerId:null, timeLeft:0 };

  function startFromQuestions(questions) {
    qsession.questions = shuffleArray(questions || []);
    qsession.index = 0; qsession.score = 0;
    loadQuestion();
  }

  function loadQuestion() {
    if (qsession.index >= qsession.questions.length) {
      setStatus('Quiz finished. Score: '+qsession.score);
      $('quizOutput') && ($('quizOutput').textContent = `Completed. Score: ${qsession.score}/${qsession.questions.length}`);
      return;
    }
    const cur = qsession.questions[qsession.index];
    render(cur);
    // timer
    const t = parseInt($('quizTimer') ? $('quizTimer').value : 0) || 0;
    startTimer(t);
  }

  function render(q) {
    const out = $('quizOutput'); if (!out) return;
    out.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${escapeHtml(q.q)}</div>`;
    q.choices.forEach((c, idx) => {
      const btn = document.createElement('button'); btn.className='btn'; btn.textContent = String.fromCharCode(65+idx)+'. '+c;
      btn.onclick = ()=> check(c);
      out.appendChild(btn);
    });
    out.appendChild(document.createElement('div'));
    $('quizOutput').appendChild(document.createElement('div'));
  }

  function check(choice) {
    const cur = qsession.questions[qsession.index];
    if (!cur) return;
    if (choice === cur.answer) { qsession.score++; setStatus('Correct'); VoiceManager.speak('Correct answer'); }
    else { setStatus('Wrong — correct: '+cur.answer); VoiceManager.speak('Wrong answer'); }
    clearTimer();
    qsession.index++;
    setTimeout(()=> loadQuestion(), 600);
  }

  function startTimer(seconds) {
    clearTimer();
    if (!seconds || seconds <= 0) return;
    qsession.timeLeft = seconds;
    const info = document.createElement('div'); info.id = 'quizTimerDisplay';
    info.style.marginTop = '10px';
    const out = $('quizOutput');
    if (out) out.appendChild(info);
    qsession.timerId = setInterval(()=> {
      qsession.timeLeft--;
      const el = $('quizTimerDisplay'); if (el) el.innerText = `Time left: ${qsession.timeLeft}s`;
      if (qsession.timeLeft <= 10 && qsession.timeLeft > 0) VoiceManager.speak(String(qsession.timeLeft));
      if (qsession.timeLeft <= 0) {
        clearTimer();
        if ((state.settings && state.settings.timeoutBehavior) === 'skip') {
          setStatus('Time up — skipped');
          qsession.index++;
          loadQuestion();
        } else {
          setStatus('Time up — marked wrong');
          qsession.index++;
          loadQuestion();
        }
      }
    }, 1000);
  }

  function clearTimer() { if (qsession.timerId) { clearInterval(qsession.timerId); qsession.timerId = null; } const el = $('quizTimerDisplay'); if (el) el.remove(); }

  return { startFromQuestions };
})();

// -----------------------------
// Badges & targets
// -----------------------------
function updateBadges() {
  const totalWords = state.library.reduce((acc, d) => acc + ((d.text||'').split(/\s+/).filter(Boolean).length), 0);
  const badges = [];
  if (totalWords > 500) badges.push('Reader');
  if (totalWords > 3000) badges.push('Scholar');
  if (totalWords > 15000) badges.push('Master');
  state.badges = badges; saveState();
  const el = $('badges'); if (el) el.innerText = badges.length ? badges.join(', ') : 'No badges yet';
}

// -----------------------------
// Core UI binding
// -----------------------------
function bindCoreUI() {
  // Save name
  const saveNameBtn = $('saveName'); if (saveNameBtn) saveNameBtn.onclick = ()=> {
    const v = $('name') ? $('name').value.trim() : '';
    state.user.name = v; saveState(); setStatus('Name saved'); VoiceManager.speak('Welcome ' + (v||'student'));
  };

  // License
  const applyLic = $('applyLicense'); if (applyLic) applyLic.onclick = ()=> {
    const v = $('license') ? $('license').value.trim() : '';
    state.license = v || 'DEMO'; saveState(); setStatus('License applied: '+state.license);
  };

  // File process
  const fileInput = $('fileInput'); const processBtn = $('processBtn');
  if (processBtn && fileInput) processBtn.onclick = ()=> {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return setStatus('Select files first');
    handleFileInput(files, p => { /* progress already shows via setStatus */ }).catch(e => setStatus('Processing failed'));
  };

  // Delete all
  const deleteAllBtn = $('deleteAll'); if (deleteAllBtn) deleteAllBtn.onclick = ()=> { if (!confirm('Delete all documents?')) return; state.library = []; saveState(); renderLibrary(); setStatus('Library cleared'); };

  // Summaries
  const quickBtn = $('quickSummary'); if (quickBtn) quickBtn.onclick = ()=> { const s = quickSummary(); $('summaryOutput') && ($('summaryOutput').textContent = s); };
  const detBtn = $('detailedSummary'); if (detBtn) detBtn.onclick = ()=> { const s = detailedSummary(); $('summaryOutput') && ($('summaryOutput').textContent = s); };
  const readBtn = $('readSummary'); if (readBtn) readBtn.onclick = ()=> { const s = $('summaryOutput') ? $('summaryOutput').textContent : ''; if (s) VoiceManager.speak(s); };

  // MCQ create
  const createMCQsBtn = $('createMCQs'); if (createMCQsBtn) createMCQsBtn.onclick = ()=> { const r = generateMCQsFromText(10); if (r.error) setStatus(r.error); else $('quizOutput') && ($('quizOutput').textContent = renderMCQList(r.questions)); };

  // Quiz generate
  const genQuizBtn = $('generateQuiz'); if (genQuizBtn) genQuizBtn.onclick = ()=> {
    const type = $('quizType') ? $('quizType').value : 'mcq4';
    if (type === 'mcq4') {
      const r = generateMCQsFromText(10);
      if (r.error) setStatus(r.error);
      else Quiz.startFromQuestions(r.questions);
    } else setStatus('Only MCQ currently supported in demo');
  };

  // GK wire
  GK.wire();

  // Export/Import backup
  const exportBackup = $('exportBackup'); if (exportBackup) exportBackup.onclick = ()=> {
    const data = JSON.stringify(state);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ssc_backup.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const importBackup = $('importBackup'); if (importBackup) importBackup.onclick = ()=> {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept='.json'; inp.onchange = async ()=> {
      const f = inp.files[0]; if (!f) return; const txt = await f.text();
      try { const j = JSON.parse(txt); state = j; saveState(); renderLibrary(); updateBadges(); setStatus('Backup imported'); } catch(e) { setStatus('Invalid backup'); }
    }; inp.click();
  };

  // Feedback
  const sendFeedback = $('sendFeedback'); if (sendFeedback) sendFeedback.onclick = ()=> {
    const t = $('feedbackText') ? $('feedbackText').value.trim() : '';
    if (!t) return setStatus('Feedback empty');
    try {
      const key = 'ssc_feedback'; const arr = JSON.parse(localStorage.getItem(key) || '[]'); arr.push({ text: t, when: new Date().toISOString() }); localStorage.setItem(key, JSON.stringify(arr));
      $('feedbackText') && ($('feedbackText').value = ''); setStatus('Feedback saved'); 
    } catch (e) { setStatus('Feedback save failed'); }
  };

  // Settings/OCR language
  const ocrSelect = $('ocrLang'); if (ocrSelect) { ocrSelect.onchange = ()=> { state.ocrLang = ocrSelect.value; saveState(); setStatus('OCR language set: '+state.ocrLang); } }
  const themePreset = $('themePreset'); if (themePreset) themePreset.value = state.appearance.preset || 'dark';
  Appearance.initControls();

  // voice preview controls (basic)
  const vRate = $('voiceRate'); const vPitch = $('voicePitch');
  if (vRate) vRate.value = state.voice.rate || 1;
  if (vPitch) vPitch.value = state.voice.pitch || 1;
}

// -----------------------------
// Helpers: shuffle, truncate
// -----------------------------
function shuffleArray(arr){ const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function shuffleText(s){ const w = s.split(/\s+/).filter(Boolean); for (let i=w.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [w[i],w[j]]=[w[j],w[i]]; } return w.join(' '); }
function truncate(s,n=120){ return s && s.length>n? s.slice(0,n-1)+'…': s; }

// -----------------------------
// On DOM ready: init wiring
// -----------------------------
document.addEventListener('DOMContentLoaded', ()=> {
  try {
    VoiceManager.init();
    Appearance.load();
    bindCoreUI();
    renderLibrary();
    updateBadges();
    setStatus('Ready');
    // set TTS control labels to multilingual triple
    const tv = $('testVoice'); if (tv) tv.textContent = triple('testVoice');
    const ev = $('enableVoice'); if (ev) ev.textContent = triple('enableVoice') + (state.voice.enabled ? ' : ON' : ' : OFF');
    // wire GK and other panels done inside bindCoreUI
  } catch (e) { console.error('init error', e); setStatus('Init error'); }
});

// -----------------------------
// Expose some helpers for debugging
// -----------------------------
window.ssc = { state, saveState, loadState, speak: (t)=> VoiceManager.speak(t), processSingleFile: processBlobAsDocument };

// -----------------------------
// Utility: small functions used in console debug
// -----------------------------
function log(...args){ console.log('[SSC]', ...args); }
function humanDate(){ return new Date().toLocaleString(); }

// === END OF FILE: app.js ===