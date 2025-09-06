/* === START OF FILE: app.js ===
   Smart Study Companion - Main application logic (FULL)
   Features included:
   - state persistence (localStorage)
   - voice (speechSynthesis) with option to prefer Indian voices
   - PDF extraction using pdf.js (text-based PDFs)
   - OCR integration hook using Tesseract.js (for image-based PDFs)
   - ZIP unpack (reads files inside ZIP via JSZip)
   - Summaries (quick/detailed)
   - Quiz generation (NORMAL + KBC "game" style)
   - Badges & daily targets
   - License check (FULLACCESS prefix)
   - UI bindings for common controls: file input, save name, license, voice enable, mode, delete all
   - Helpful status messages and simple error handling
   - Clear comment blocks for future extension
*/

// Immediately-invoked function to isolate scope
(() => {
  'use strict';

  /* ---------------------
     Config & Constants
     --------------------- */
  const STORAGE_KEY = 'ssc_v3_state';
  const DEFAULT_TARGET = 20;
  const OCR_SUPPORTED_LANGS = [
    { code: 'eng', label: 'English' },
    { code: 'hin', label: 'Hindi' },
    { code: 'mar', label: 'Marathi' },
    { code: 'guj', label: 'Gujarati' }
  ];

  /* ---------------------
     App State
     --------------------- */
  let state = {
    name: '',
    license: 'DEMO',
    mode: 'NORMAL',            // NORMAL | KBC
    voiceEnabled: false,
    preferredVoiceLang: 'en-IN',
    voice: null,               // SpeechSynthesisVoice
    ocrLang: 'eng',
    library: [],               // [{name,type,added,text}]
    targets: { daily: DEFAULT_TARGET },
    badges: [],
    settings: { welcome: true, welcomeSound: true },
    lastProcessedAt: null
  };

  /* ---------------------
     Utility helpers
     --------------------- */
  const $ = id => document.getElementById(id);
  const elText = (id, txt='') => { const e = $(id); if(e) e.textContent = txt; };
  const setStatus = (msg) => elText('status', msg || '');

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('saveState error', e);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = JSON.parse(raw);
        state = {...state, ...loaded};
      }
    } catch (e) {
      console.warn('loadState failed', e);
    }
  }

  /* ---------------------
     Voice (speechSynthesis)
     --------------------- */
  function populateVoiceList() {
    const synth = window.speechSynthesis;
    if (!synth) return [];
    return synth.getVoices();
  }

  function pickPreferredVoice() {
    const voices = populateVoiceList();
    if (!voices || voices.length === 0) return null;

    // Prefer exact match en-IN, then any that include "India", then any that start with preferred language, then fallback.
    let v = voices.find(x => x.lang === state.preferredVoiceLang);
    if (!v) v = voices.find(x => /India/i.test(x.name));
    if (!v) v = voices.find(x => x.lang && x.lang.startsWith('en'));
    if (!v) v = voices[0];
    return v;
  }

  function enableVoicePlayback(enabled) {
    state.voiceEnabled = !!enabled;
    saveState();
  }

  function speak(text) {
    if (!state.voiceEnabled) return;
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = state.voice || pickPreferredVoice();
    window.speechSynthesis.cancel(); // stop prior
    window.speechSynthesis.speak(u);
  }

  /* ---------------------
     License handling
     --------------------- */
  function checkLicense() {
    if (typeof state.license === 'string' && state.license.startsWith('FULLACCESS')) {
      elText('licenseStatus', 'Status: Full access');
      return true;
    }
    elText('licenseStatus', 'Status: Demo (50MB)');
    return false;
  }

  /* ---------------------
     PDF extraction using PDF.js
     - Expects pdfjsLib global available (script included in index.html)
     --------------------- */
  async function extractTextFromPdfArrayBuffer(ab) {
    if (!window['pdfjsLib']) throw new Error('pdfjsLib not loaded');
    const loadingTask = pdfjsLib.getDocument({data: ab});
    const pdf = await loadingTask.promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      text += pageText + '\n';
    }
    return text.trim();
  }

  /* ---------------------
     OCR via Tesseract.js hook
     - We include it as optional; user can use OCR languages as needed
     - This function expects Tesseract to be available (Tesseract.createWorker etc.)
     --------------------- */
  async function performOcrOnFile(file, lang = 'eng') {
    if (!window['Tesseract']) {
      throw new Error('Tesseract not available');
    }
    setStatus('OCR: starting (this may be slow on mobile)');
    const { createWorker } = Tesseract;
    const worker = createWorker({
      logger: m => {
        // optional: show progress
        if (m.status && m.progress) {
          setStatus(`OCR: ${m.status} ${(m.progress*100).toFixed(0)}%`);
        }
      }
    });
    await worker.load();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const result = await worker.recognize(file);
    await worker.terminate();
    setStatus('OCR: done');
    return result.data && result.data.text ? result.data.text : '';
  }

  /* ---------------------
     ZIP handling using JSZip
     - expects JSZip availability
     --------------------- */
  async function extractFilesFromZip(fileBlob) {
    if (!window['JSZip']) throw new Error('JSZip not available');
    const zip = await JSZip.loadAsync(fileBlob);
    const files = [];
    const entries = Object.keys(zip.files);
    for (const entryName of entries) {
      const entry = zip.files[entryName];
      if (entry.dir) continue;
      const mime = entryName.split('.').pop().toLowerCase();
      const blob = await entry.async('blob');
      files.push({ name: entryName, blob });
    }
    return files;
  }

  /* ---------------------
     File processing workflow
     --------------------- */
  async function processSingleFile(file) {
    // Supported: PDF, TXT, HTML, JPG/PNG (OCR), ZIP
    const entry = { name: file.name || 'unknown', type: file.type || '', added: (new Date()).toISOString(), text: '' };
    try {
      if (entry.name.toLowerCase().endsWith('.zip')) {
        // unzip then process files inside
        if (!window['JSZip']) throw new Error('JSZip not loaded; cannot unpack ZIP');
        const innerFiles = await extractFilesFromZip(file);
        for (const f of innerFiles) {
          // for each inner file, attempt to process as if top-level
          try {
            const innerEntry = await processBlobAsDocument(f.blob, f.name);
            state.library.push(innerEntry);
          } catch (err) {
            // continue
            state.library.push({name: f.name, type:'unknown', added: new Date().toISOString(), text: ''});
          }
        }
        return null; // already pushed inner entries
      } else {
        const res = await processBlobAsDocument(file, file.name);
        state.library.push(res);
        return res;
      }
    } catch (e) {
      console.error('processSingleFile error', e);
      state.library.push(entry);
      return entry;
    }
  }

  async function processBlobAsDocument(blobOrFile, nameHint='file') {
    const mime = (blobOrFile.type || '').toLowerCase();
    const entry = { name: nameHint, type: mime || 'unknown', added: new Date().toISOString(), text: '' };

    // PDF
    if (nameHint.toLowerCase().endsWith('.pdf') || mime === 'application/pdf') {
      try {
        const arrayBuffer = await blobOrFile.arrayBuffer();
        const text = await extractTextFromPdfArrayBuffer(arrayBuffer);
        if (text && text.trim().length > 20) {
          entry.text = text;
          return entry;
        } else {
          // maybe image-based PDF -> OCR
          const ocrText = await performOcrOnFile(blobOrFile, state.ocrLang);
          entry.text = ocrText || '';
          return entry;
        }
      } catch (err) {
        // fallback to OCR if PDF.js fails
        try {
          const ocrText = await performOcrOnFile(blobOrFile, state.ocrLang);
          entry.text = ocrText || '';
          return entry;
        } catch (ocrErr) {
          console.error('pdf processing/OCR both failed', err, ocrErr);
          entry.text = '';
          return entry;
        }
      }
    }

    // Images -> OCR
    if (mime.startsWith('image/')) {
      try {
        const ocrText = await performOcrOnFile(blobOrFile, state.ocrLang);
        entry.text = ocrText || '';
        return entry;
      } catch (err) {
        console.error('image OCR failed', err);
        entry.text = '';
        return entry;
      }
    }

    // plain text / html
    if (mime.startsWith('text/') || nameHint.toLowerCase().endsWith('.txt') || nameHint.toLowerCase().endsWith('.html')) {
      try {
        const txt = await blobOrFile.text();
        entry.text = txt;
        return entry;
      } catch (err) {
        entry.text = '';
        return entry;
      }
    }

    // unknown - try text
    try {
      const txt = await blobOrFile.text();
      entry.text = txt;
      return entry;
    } catch (err) {
      return entry;
    }
  }

  async function handleFileInput(files) {
    setStatus('Processing files...');
    for (let i=0; i<files.length; i++) {
      const f = files[i];
      await processSingleFile(f);
      setStatus(`Processed ${i+1} of ${files.length}`);
    }
    state.lastProcessedAt = new Date().toISOString();
    saveState();
    renderLibrary();
    updateBadgesAndTargets();
    setStatus('Processing complete');
  }

  /* ---------------------
     Render library UI
     --------------------- */
  function renderLibrary() {
    const list = $('libraryList');
    if (!list) return;
    list.innerHTML = '';

    if (!state.library || state.library.length === 0) {
      list.innerHTML = '<div class="empty">No files added</div>';
      return;
    }

    state.library.forEach((doc, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'docRow';
      const html = `
        <div class="docTitle">${escapeHtml(doc.name)}</div>
        <div class="docMeta">${escapeHtml(doc.type || '—')} • added ${new Date(doc.added).toLocaleString()}</div>
        <div class="docActions">
          <button class="btn viewBtn" data-i="${idx}">View</button>
          <button class="btn deleteBtn" data-i="${idx}">Delete</button>
        </div>
      `;
      wrap.innerHTML = html;
      list.appendChild(wrap);
    });

    // attach events
    list.querySelectorAll('.viewBtn').forEach(b => b.onclick = (e) => {
      const i = +e.target.dataset.i;
      viewDocument(i);
    });
    list.querySelectorAll('.deleteBtn').forEach(b => b.onclick = (e) => {
      const i = +e.target.dataset.i;
      if (confirm('Delete this document?')) {
        state.library.splice(i,1);
        saveState();
        renderLibrary();
      }
    });
  }

  function viewDocument(i) {
    const doc = state.library[i];
    if (!doc) { setStatus('Document missing'); return; }
    // open in blank window (safer) with simple text rendering
    const w = window.open('', '_blank');
    const html = `
      <html><head><title>${escapeHtml(doc.name)}</title>
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <style>body{background:#0f1720;color:#e6eef6;padding:16px;font-family:Inter,Arial,Helvetica,sans-serif}</style></head>
      <body><h2>${escapeHtml(doc.name)}</h2><pre>${escapeHtml(doc.text || '(no text extracted)')}</pre></body></html>
    `;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /* ---------------------
     Summaries & Quiz generation
     --------------------- */
  function generateCombinedText() {
    return state.library.map(d => d.text || '').join('\n\n');
  }

  function createSummary(mode='quick') {
    const allText = generateCombinedText();
    if (!allText || allText.trim().length < 20) return '(no material)';
    if (mode === 'quick') {
      // first 4 sentences
      const sents = allText.match(/[^\.!\?]+[\.!\?]+/g) || [allText];
      return sents.slice(0,4).join(' ').trim();
    } else {
      // detailed: first 500 words
      const words = allText.split(/\s+/).slice(0,500);
      return words.join(' ');
    }
  }

  function createQuiz(style='NORMAL', count=10) {
    const text = generateCombinedText();
    if (!text || text.trim().length < 100) return { error: 'Not enough material to make MCQs.' };

    // naive approach: split into sentences, pick ones with facts and generate simple question by blanking a noun
    const sentences = text.split(/[\r\n]+|[\.!?]+/).map(s => s.trim()).filter(s => s.length > 40);
    if (sentences.length === 0) return { error: 'Not enough material to make MCQs.' };

    const qCount = Math.min(count, sentences.length);
    const questions = [];
    for (let i=0;i<qCount;i++) {
      const s = sentences[i];
      // simple question: "Which of the following is true?" + correct answer = whole sentence
      const choices = generateDummyChoices(s);
      const q = {
        q: (style === 'KBC') ? `₹${(i+1)*1000} - ${truncate(s, 120)}` : truncate(s, 120),
        choices,
        answer: choices[0]
      };
      questions.push(q);
    }

    return { questions };
  }

  function generateDummyChoices(correct) {
    // very simple: correct + 3 shuffles of words
    const a = [correct];
    for (let i=0;i<3;i++) {
      a.push(truncate(shuffleWords(correct), 80));
    }
    // shuffle array so correct isn't always first
    return shuffleArray(a);
  }

  /* ---------------------
     Badges & Targets
     --------------------- */
  function updateBadgesAndTargets() {
    const totalWords = state.library.reduce((acc, d) => {
      return acc + ((d.text || '').split(/\s+/).filter(Boolean).length);
    }, 0);
    const badges = [];
    if (totalWords > 1000) badges.push('Starter');
    if (totalWords > 5000) badges.push('Scholar');
    if (totalWords > 20000) badges.push('Master');
    state.badges = badges;
    elText('badges', badges.length ? badges.join(', ') : 'No badges yet');
    saveState();
  }

  /* ---------------------
     Small helpers
     --------------------- */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  function truncate(s, len=120) {
    if (!s) return '';
    return s.length > len ? s.slice(0,len-1) + '…' : s;
  }

  function shuffleWords(s) {
    const words = s.split(/\s+/).filter(Boolean);
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words.join(' ');
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------------
     Bind UI elements & events
     - IDs expected in index.html:
       name, saveName, license, applyLicense, voiceSelect, enableVoice,
       fileInput, processBtn, deleteAll, libraryList, summaryQuick, summaryDetailed,
       createQuizBtn, quizOutput, badges, status, licenseStatus, ocrLangSelect
     --------------------- */
  function bindUI() {
    // Save name
    const saveNameBtn = $('saveName');
    if (saveNameBtn) saveNameBtn.onclick = () => {
      const nameVal = $('name') ? $('name').value.trim() : '';
      state.name = nameVal;
      saveState();
      showWelcomeText();
    };

    // License
    const applyLicenseBtn = $('applyLicense');
    if (applyLicenseBtn) {
      applyLicenseBtn.onclick = () => {
        const lic = $('license') ? $('license').value.trim() : '';
        state.license = lic || 'DEMO';
        saveState();
        checkLicense();
      };
    }

    // Voice enable
    const enableVoiceBtn = $('enableVoice');
    if (enableVoiceBtn) enableVoiceBtn.onclick = () => {
      state.voiceEnabled = !state.voiceEnabled;
      saveState();
      setStatus(`Voice ${state.voiceEnabled ? 'enabled' : 'disabled'}`);
    };

    // OCR language select (populate)
    const ocrSelect = $('ocrLangSelect');
    if (ocrSelect) {
      OCR_SUPPORTED_LANGS.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang.code;
        opt.text = lang.label;
        ocrSelect.appendChild(opt);
      });
      ocrSelect.value = state.ocrLang;
      ocrSelect.onchange = () => {
        state.ocrLang = ocrSelect.value;
        saveState();
      };
    }

    // File input
    const fileInput = $('fileInput');
    const processBtn = $('processBtn');
    if (fileInput) {
      fileInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        // store selected names in UI if desired
        if (files.length) elText('selectedFiles', files.map(f=>f.name).join(', '));
      };
    }
    if (processBtn) processBtn.onclick = async () => {
      const files = (fileInput && fileInput.files) ? Array.from(fileInput.files) : [];
      if (!files.length) { setStatus('Choose files first'); return; }
      await handleFileInput(files);
    };

    // delete all
    const deleteAllBtn = $('deleteAll');
    if (deleteAllBtn) deleteAllBtn.onclick = () => {
      if (confirm('Delete ALL documents from library?')) {
        state.library = [];
        saveState();
        renderLibrary();
        setStatus('Library cleared');
      }
    };

    // summary quick/detailed
    const summaryQuick = $('summaryQuick');
    if (summaryQuick) summaryQuick.onclick = () => {
      const s = createSummary('quick');
      if ($('summaryOutput')) $('summaryOutput').textContent = s;
    }
    const summaryDetailed = $('summaryDetailed');
    if (summaryDetailed) summaryDetailed.onclick = () => {
      const s = createSummary('detailed');
      if ($('summaryOutput')) $('summaryOutput').textContent = s;
    }

    // create quiz
    const createQuizBtn = $('createQuizBtn');
    if (createQuizBtn) createQuizBtn.onclick = () => {
      const modeSelect = $('modeSelect');
      const style = (modeSelect && modeSelect.value === 'KBC') ? 'KBC' : 'NORMAL';
      const r = createQuiz(style, 10);
      if (r.error) {
        elText('quizOutput', r.error);
      } else {
        // render simple
        const out = r.questions.map((q, idx) => {
          return `${idx+1}. ${q.q}\n${q.choices.map((c,i)=>String.fromCharCode(65+i)+') '+c).join('\n')}\n`;
        }).join('\n');
        elText('quizOutput', out);
      }
    };

    // read summary aloud
    const readSummaryBtn = $('readSummary');
    if (readSummaryBtn) readSummaryBtn.onclick = () => {
      const s = $('summaryOutput') ? $('summaryOutput').textContent : '';
      if (!s) { setStatus('Summary empty'); return; }
      speak(s);
    };

    // When DOM content loaded we also pre-select speech voices and set stored values
  }

  function showWelcomeText() {
    const welcomeEl = $('welcomeNote');
    if (!welcomeEl) return;
    if (!state.settings.welcome) {
      welcomeEl.textContent = '';
      return;
    }
    const msg = state.name ? `Hi ${state.name}! Welcome back to Smart Study Companion.` : 'Welcome to Smart Study Companion.';
    welcomeEl.textContent = msg;
    if (state.settings.welcomeSound && state.voiceEnabled) {
      speak(msg);
    }
  }

  /* ---------------------
     Init app
     --------------------- */
  function init() {
    loadState();
    // try to pick voice
    try {
      // populate voice list asynchronously
      window.speechSynthesis.onvoiceschanged = () => {
        state.voice = pickPreferredVoice();
      };
      state.voice = pickPreferredVoice();
    } catch (e) {
      console.warn('voice init issue', e);
    }

    // bind UI
    bindUI();

    // initial render
    renderLibrary();
    updateBadgesAndTargets();
    checkLicense();
    showWelcomeText();

    // fill some UI elements if present
    if ($('name')) $('name').value = state.name || '';
    if ($('license')) $('license').value = state.license || '';
    if ($('ocrLangSelect')) $('ocrLangSelect').value = state.ocrLang || 'eng';
    if ($('modeSelect')) $('modeSelect').value = state.mode || 'NORMAL';
  }

  // Wait for DOM ready
  document.addEventListener('DOMContentLoaded', init);

  /* ---------------------
     Expose small debug API on window for console testing
     --------------------- */
  window.ssc = {
    state,
    saveState,
    loadState,
    speak,
    createSummary,
    createQuiz,
    processSingleFile,
    performOcrOnFile
  };

  /* =====================
     Helper small functions
     ===================== */
  function log() { console.log.apply(console, arguments); }

  /* === END OF FILE: app.js === */