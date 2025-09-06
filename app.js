/* === START OF FILE: app.js ===
   Approx lines: 520
   Smart Study Companion - main application script
   Integrated modules:
    - Voice Manager (Indian TTS preference)
    - Appearance / Theme Manager
    - File processing (pdf.js, JSZip, Tesseract hooks)
    - Library management
    - Summaries & Quiz (including KBC-like flow)
    - GK module (OpenTDB + user dataset import)
    - Badges / Targets, Feedback
   Save as: app.js (root of repo)
*/

/* global pdfjsLib, Tesseract, JSZip */

(function () {
  'use strict';

  //////////////////////////////
  // Basic utilities & state
  //////////////////////////////
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'ssc_v4_state';
  const APP_VERSION = '1.0';

  let state = {
    name: '',
    license: 'DEMO',
    mode: 'normal', // normal | kbc | silent
    voiceEnabled: false,
    ocrLang: 'eng',
    library: [], // {name,type,added,text,subject,chapter}
    badges: [],
    targets: { daily: 20 },
    appearance: { preset: 'dark', vars: null },
    lastProcessedAt: null
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('saveState', e); }
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = Object.assign(state, JSON.parse(raw));
    } catch (e) { console.warn('loadState', e); }
  }
  loadState();

  function setStatus(msg) {
    const s = $('statusText');
    if (s) s.innerText = msg;
  }

  //////////////////////////////
  // Voice Manager
  //////////////////////////////
  const VoiceManager = (function () {
    const vm = {
      voices: [],
      preferredVoice: null,
      voiceName: null,
      enabled: !!state.voiceEnabled,
      rate: 1.0,
      pitch: 1.0
    };

    function loadVoices() {
      if (!('speechSynthesis' in window)) return;
      const v = window.speechSynthesis.getVoices();
      vm.voices = v || [];
      vm.preferredVoice = findIndianVoice(vm.voices);
      // restore persisted voiceName if any
      try {
        const vn = localStorage.getItem('ssc_voiceName');
        if (vn) vm.voiceName = vn;
      } catch (e) {}
    }

    function findIndianVoice(list) {
      if (!list || !list.length) return null;
      let res = list.find(x => /^en[-_]?IN$/i.test(x.lang) || /^hi[-_]?IN$/i.test(x.lang));
      if (res) return res;
      res = list.find(x => /India|Hindi|Indian/i.test(x.name));
      if (res) return res;
      res = list.find(x => /^en/i.test(x.lang));
      if (res) return res;
      return list[0];
    }

    function populateVoiceSelect() {
      const sel = $('voiceSelect');
      if (!sel) return;
      sel.innerHTML = '';
      vm.voices.forEach(v => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = `${v.name} — ${v.lang}`;
        sel.appendChild(o);
      });
      // set chosen
      if (vm.voiceName) sel.value = vm.voiceName;
      else if (vm.preferredVoice) sel.value = vm.preferredVoice.name;
      sel.onchange = () => {
        vm.voiceName = sel.value;
        try { localStorage.setItem('ssc_voiceName', vm.voiceName); } catch(e){}
      };
    }

    function setEnabled(v) {
      vm.enabled = !!v;
      state.voiceEnabled = vm.enabled;
      saveState();
      setStatus(vm.enabled ? 'Voice on' : 'Voice off');
    }

    function speak(text, opts = {}) {
      if (!vm.enabled) return;
      if (!('speechSynthesis' in window)) return;
      const utt = new SpeechSynthesisUtterance(text);
      // choose voice by name or preferredVoice
      let voice = null;
      if (vm.voiceName) voice = vm.voices.find(x => x.name === vm.voiceName);
      if (!voice) voice = vm.preferredVoice || vm.voices[0] || null;
      if (voice) utt.voice = voice;
      utt.rate = opts.rate || vm.rate;
      utt.pitch = opts.pitch || vm.pitch;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    }

    function test() {
      if (!vm.enabled) { alert('Enable voice first'); return; }
      speak('Welcome to Smart Study Companion. This is a quick test.');
      setTimeout(()=> speak('नमस्कार, आप कैसे हैं?'), 1400);
    }

    // Initialization
    function init() {
      try {
        loadVoices();
        if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
          speechSynthesis.onvoiceschanged = () => {
            loadVoices();
            populateVoiceSelect();
          };
        } else {
          // immediate populate
          populateVoiceSelect();
        }
        // restore enabled flag
        vm.enabled = !!state.voiceEnabled;
        const enBtn = $('enableVoice');
        if (enBtn) enBtn.textContent = vm.enabled ? 'Voice: ON' : 'Voice: OFF';

        // wire enable button
        if (enBtn) enBtn.onclick = () => {
          vm.enabled = !vm.enabled;
          setEnabled(vm.enabled);
          enBtn.textContent = vm.enabled ? 'Voice: ON' : 'Voice: OFF';
        };

        // wire test button if present
        const testBtn = $('testVoice');
        if (testBtn) testBtn.onclick = test;
      } catch (e) {
        console.warn('VoiceManager init error', e);
      }
    }

    return {
      init, speak, test, setEnabled,
      get voices() { return vm.voices; },
      get preferredVoice() { return vm.preferredVoice; },
      setVoiceByName: (n) => { vm.voiceName = n; try{ localStorage.setItem('ssc_voiceName', n);}catch(e){} },
      setRate: (r)=>{ vm.rate=r; },
      setPitch: (p)=>{ vm.pitch=p; }
    };
  })();

  //////////////////////////////
  // Appearance Manager
  //////////////////////////////
  const Appearance = (function(){
    function applyVars(vars) {
      const root = document.documentElement;
      if (!vars) return;
      if (vars.bg) root.style.setProperty('--bg', vars.bg);
      if (vars.accent) root.style.setProperty('--accent', vars.accent);
      if (vars.text) root.style.setProperty('--text', vars.text);
      if (vars.btn) root.style.setProperty('--btn', vars.btn);
      if (vars.fontSize) root.style.setProperty('--font-size', vars.fontSize);
    }
    function setPreset(preset) {
      if (preset === 'vibrant') document.documentElement.setAttribute('data-theme','vibrant');
      else if (preset === 'light') document.documentElement.setAttribute('data-theme','light');
      else document.documentElement.removeAttribute('data-theme');
      state.appearance.preset = preset;
      saveState();
    }
    function load() {
      const a = state.appearance;
      if (a && a.preset) setPreset(a.preset);
      if (a && a.vars) applyVars(a.vars);
    }
    function initControls() {
      const preset = $('themePreset');
      const bg = $('bgColor');
      const acc = $('accentColor');
      const txt = $('textColor');
      const font = $('fontSize');
      const apply = $('applyTheme');
      const reset = $('resetTheme');
      if (!preset) return;
      try {
        preset.onchange = () => setPreset(preset.value);
        if (apply) apply.onclick = () => {
          const vars = {
            bg: bg ? bg.value : null,
            accent: acc ? acc.value : null,
            text: txt ? txt.value : null,
            fontSize: font ? font.value : null
          };
          applyVars(vars);
          state.appearance.vars = vars;
          saveState();
          setStatus('Appearance applied');
        };
        if (reset) reset.onclick = () => {
          document.documentElement.removeAttribute('data-theme');
          state.appearance = { preset: 'dark', vars: null };
          saveState();
          setStatus('Appearance reset');
        };
      } catch (e) {}
    }
    return { load, initControls };
  })();

  //////////////////////////////
  // File processing (PDF, ZIP, OCR)
  //////////////////////////////

  async function extractTextFromPdfArrayBuffer(ab) {
    if (!window.pdfjsLib) throw new Error('pdfjsLib not loaded');
    const pdf = await pdfjsLib.getDocument({data: ab}).promise;
    let text = '';
    for (let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text.trim();
  }

  async function performOcrBlob(blob, lang='eng') {
    if (!window.Tesseract) throw new Error('Tesseract not loaded');
    setStatus('Starting OCR...');
    const { createWorker } = Tesseract;
    const worker = createWorker({
      logger: m => {
        if (m && m.status && m.progress) {
          setStatus(`OCR: ${m.status} ${(m.progress*100).toFixed(0)}%`);
        }
      }
    });
    await worker.load();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const { data: { text } } = await worker.recognize(blob);
    await worker.terminate();
    setStatus('OCR done');
    return text || '';
  }

  async function extractFilesFromZip(blob) {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    const zip = await JSZip.loadAsync(blob);
    const files = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir) continue;
      const innerBlob = await f.async('blob');
      files.push({ name, blob: innerBlob });
    }
    return files;
  }

  async function processBlobAsDocument(blob, nameHint) {
    const lower = (nameHint || '').toLowerCase();
    const entry = { name: nameHint || blob.name || 'file', type: blob.type || '', added: new Date().toISOString(), text: '' };
    try {
      if (lower.endsWith('.pdf') || blob.type === 'application/pdf') {
        // try PDF text extraction
        try {
          const ab = await blob.arrayBuffer();
          const t = await extractTextFromPdfArrayBuffer(ab);
          if (t && t.trim().length > 20) {
            entry.text = t;
            return entry;
          } else {
            // fallback OCR
            const ot = await performOcrBlob(blob, state.ocrLang);
            entry.text = ot;
            return entry;
          }
        } catch (e) {
          // fallback OCR
          try {
            const ot = await performOcrBlob(blob, state.ocrLang);
            entry.text = ot;
            return entry;
          } catch (err) {
            console.error('PDF/extract error', err);
            return entry;
          }
        }
      }

      if (blob.type && blob.type.startsWith('image/')) {
        const ot = await performOcrBlob(blob, state.ocrLang);
        entry.text = ot;
        return entry;
      }

      // text or html
      try {
        const txt = await blob.text();
        entry.text = txt;
        return entry;
      } catch (e) {
        return entry;
      }
    } catch (err) {
      console.error('processBlobAsDocument', err);
      return entry;
    }
  }

  async function processSingleFile(file) {
    // if zip -> unpack
    const name = file.name || 'file';
    if (name.toLowerCase().endsWith('.zip')) {
      if (!window.JSZip) throw new Error('JSZip not loaded');
      const inner = await extractFilesFromZip(file);
      for (const f of inner) {
        const processed = await processBlobAsDocument(f.blob, f.name);
        state.library.push(processed);
      }
      saveState();
      return;
    } else {
      const processed = await processBlobAsDocument(file, name);
      state.library.push(processed);
      saveState();
      return;
    }
  }

  async function handleFileInput(files) {
    if (!files || files.length===0) { setStatus('No files selected'); return; }
    setStatus('Processing files...');
    for (let i=0;i<files.length;i++){
      const f = files[i];
      try {
        await processSingleFile(f);
        setStatus(`Processed ${i+1}/${files.length}`);
      } catch (e) {
        console.error('file process error', e);
      }
    }
    state.lastProcessedAt = new Date().toISOString();
    saveState();
    renderLibrary();
    updateBadges();
    setStatus('All files processed');
  }

  //////////////////////////////
  // Library management & UI
  //////////////////////////////
  function renderLibrary() {
    const list = $('libraryList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.library || state.library.length===0) {
      list.innerHTML = '<div class="small">No documents yet</div>';
      return;
    }
    state.library.forEach((doc, idx) => {
      const row = document.createElement('div');
      row.className = 'docRow';
      row.innerHTML = `
        <div>
          <div class="docTitle">${escapeHtml(doc.name)}</div>
          <div class="docMeta">${escapeHtml(doc.type || '')} • added ${new Date(doc.added).toLocaleString()}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn" data-i="${idx}" data-action="view">View</button>
          <button class="btn danger" data-i="${idx}" data-action="delete">Delete</button>
        </div>
      `;
      list.appendChild(row);
    });
    // attach events
    list.querySelectorAll('button[data-action="view"]').forEach(b => b.onclick = (e)=> {
      const i = +e.currentTarget.dataset.i;
      viewDocument(i);
    });
    list.querySelectorAll('button[data-action="delete"]').forEach(b => b.onclick = (e) => {
      const i = +e.currentTarget.dataset.i;
      if (confirm('Delete this document?')) {
        state.library.splice(i,1);
        saveState();
        renderLibrary();
        setStatus('Document deleted');
      }
    });
  }

  function viewDocument(i) {
    const d = state.library[i];
    if (!d) { setStatus('Document missing'); return; }
    const w = window.open('', '_blank');
    const html = `
      <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${escapeHtml(d.name)}</title>
      <style>body{font-family:Inter,Arial;padding:16px;background:#0b1220;color:#e6eef6}</style></head>
      <body><h2>${escapeHtml(d.name)}</h2><pre>${escapeHtml(d.text || '(no text)')}</pre></body></html>
    `;
    w.document.open(); w.document.write(html); w.document.close();
  }

  //////////////////////////////
  // Summaries
  //////////////////////////////
  function getAllText() {
    return state.library.map(d => d.text || '').join('\n\n');
  }
  function quickSummary() {
    const all = getAllText();
    if (!all || all.length<20) return '(no material)';
    // simple heuristic: first 4 sentences
    const sents = all.match(/[^\.!\?]+[\.!\?]+/g) || [all];
    return sents.slice(0,4).join(' ').trim();
  }
  function detailedSummary() {
    const all = getAllText();
    if (!all || all.length<20) return '(no material)';
    const words = all.split(/\s+/).slice(0,600);
    return words.join(' ');
  }

  //////////////////////////////
  // Basic Quiz generator
  //////////////////////////////
  function generateMCQsFromText(count=10) {
    const text = getAllText();
    if (!text || text.length < 100) return { error: 'Not enough content to create MCQs' };
    const sentences = text.split(/[\r\n]+|[\.!?]+/).map(s=>s.trim()).filter(Boolean);
    const questions = [];
    for (let i=0;i<Math.min(count,sentences.length);i++){
      const s = sentences[i];
      const correct = truncate(s,80);
      // crude distractors: shuffle words
      const d1 = shuffleWords(correct);
      const d2 = shuffleWords(correct + ' extra');
      const d3 = shuffleWords(correct + ' more');
      const choices = shuffleArray([correct, d1, d2, d3]);
      questions.push({ q: correct, choices, answer: correct });
    }
    return { questions };
  }

  // helper: create quiz UI output (simple)
  function renderMCQList(questions) {
    if (!questions || !questions.length) return '(no questions)';
    return questions.map((q, idx) => {
      return `${idx+1}. ${q.q}\n${q.choices.map((c,i)=>String.fromCharCode(65+i)+') '+c).join('\n')}\n`;
    }).join('\n');
  }

  //////////////////////////////
  // GK Module (OpenTDB + KBC dataset import)
  //////////////////////////////
  const GK = (function(){
    const gk = { pool: [], index: 0, score: 0, timerId: null, timeLeft:0, current: null };

    function decodeHtml(s){ const t=document.createElement('textarea'); t.innerHTML=s; return t.value; }

    async function fetchOpenTDB(amount=10, difficulty='medium') {
      try {
        const url = `https://opentdb.com/api.php?amount=${amount}&type=multiple${difficulty ? '&difficulty='+difficulty : ''}`;
        const r = await fetch(url);
        const j = await r.json();
        if (j && j.results) {
          return j.results.map((it, idx) => ({
            id: 'otdb_'+idx+'_'+Date.now(),
            question: decodeHtml(it.question),
            options: shuffleArray([decodeHtml(it.correct_answer), ...it.incorrect_answers.map(decodeHtml)]),
            answer: decodeHtml(it.correct_answer),
            subject: it.category,
            difficulty: it.difficulty,
            source: 'opentdb'
          }));
        }
      } catch (e) {
        console.warn('OpenTDB fetch failed', e);
      }
      return [];
    }

    function parseCSVtoQuestions(txt) {
      const lines = txt.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return [];
      const header = lines.shift().split(',').map(h=>h.trim().toLowerCase());
      const arr = lines.map(line=>{
        const cols = line.split(',');
        const obj = {};
        header.forEach((h,i)=> obj[h]=cols[i] ? cols[i].trim() : '');
        return {
          id: obj.id || ('csv_'+Math.random().toString(36).slice(2,8)),
          question: obj.question || '',
          options: [obj.option1||'', obj.option2||'', obj.option3||'', obj.option4||''],
          answer: obj.answer || (obj.option1||''),
          hint: obj.hint || '',
          subject: obj.subject || 'General'
        };
      });
      return arr;
    }

    function startSessionFromPool(poolArr) {
      gk.pool = shuffleArray(poolArr || []);
      gk.index = 0; gk.score = 0; gk.current = null;
      loadNext();
    }

    function loadNext() {
      if (gk.index >= gk.pool.length) { setStatus('GK complete. Score: '+gk.score); renderGKQuestion(null); return; }
      gk.current = gk.pool[gk.index];
      renderGKQuestion(gk.current);
      const t = parseInt($('quizTimer') ? $('quizTimer').value : 0) || 0;
      startTimer(t);
    }

    function renderGKQuestion(q) {
      const textEl = $('gkQuestionText');
      const optsEl = $('gkOptions');
      if (!textEl || !optsEl) return;
      if (!q) { textEl.innerText = 'Session complete'; optsEl.innerHTML = ''; return; }
      textEl.innerText = q.question;
      optsEl.innerHTML = '';
      q.options.forEach((opt,i)=>{
        const b = document.createElement('button');
        b.className = 'btn';
        b.innerText = String.fromCharCode(65+i)+'. '+opt;
        b.onclick = ()=> handleAnswer(opt);
        optsEl.appendChild(b);
      });
      $('gkScore') && ($('gkScore').innerText = `Score: ${gk.score} • Q ${gk.index+1}/${gk.pool.length}`);
    }

    function handleAnswer(choice) {
      if (!gk.current) return;
      if (choice === gk.current.answer) {
        gk.score++;
        setStatus('Correct!');
        VoiceManager.speak('Correct answer');
      } else {
        setStatus('Wrong. Correct: ' + gk.current.answer);
        VoiceManager.speak('Wrong answer');
      }
      clearTimer();
      gk.index++;
      loadNext();
    }

    function lifeline5050() {
      const optsEl = $('gkOptions');
      if (!optsEl || !gk.current) return;
      const buttons = Array.from(optsEl.children);
      const wrongBtns = buttons.filter(b => !b.innerText.includes(gk.current.answer));
      let removed = 0;
      for (let b of wrongBtns) {
        if (removed >= 2) break;
        b.style.visibility = 'hidden';
        removed++;
      }
      setStatus('50-50 used');
    }

    function lifelineHint() {
      if (!gk.current) return;
      setStatus(gk.current.hint || ('Hint: starts with '+(gk.current.answer[0]||'?')));
    }

    function lifelineSkip() {
      setStatus('Skipped');
      gk.index++;
      loadNext();
    }

    function startTimer(seconds) {
      clearTimer();
      if (!seconds || seconds<=0) return;
      gk.timeLeft = seconds;
      $('gkTimer') && ($('gkTimer').innerText = `Time left: ${gk.timeLeft}s`);
      gk.timerId = setInterval(()=>{
        gk.timeLeft--;
        $('gkTimer') && ($('gkTimer').innerText = `Time left: ${gk.timeLeft}s`);
        if (gk.timeLeft <= 0) {
          clearTimer();
          setStatus('Time up');
          gk.index++;
          loadNext();
        }
      },1000);
    }

    function clearTimer(){ if (gk.timerId) { clearInterval(gk.timerId); gk.timerId = null; } $('gkTimer') && ($('gkTimer').innerText = ''); }

    function renderGKUIBindings() {
      const start = $('startGK'); if (start) start.onclick = async () => {
        const mode = $('gkMode') ? $('gkMode').value : 'dynamic_gk';
        const difficulty = $('gkDifficulty') ? $('gkDifficulty').value : 'medium';
        if (mode === 'kbc_archive') {
          const f = $('kbcDataset') && $('kbcDataset').files && $('kbcDataset').files[0];
          if (!f) { setStatus('Choose dataset file'); return; }
          const txt = await f.text();
          const arr = txt.trim().startsWith('[') ? JSON.parse(txt) : parseCSVtoQuestions(txt);
          startSessionFromPool(arr);
        } else if (mode === 'dynamic_gk') {
          setStatus('Fetching questions...');
          const fetched = await fetchOpenTDB(15, difficulty);
          startSessionFromPool(fetched);
        } else {
          setStatus('No local GK dataset found');
        }
      };
      const stop = $('stopGK'); if (stop) stop.onclick = ()=> { setStatus('Stopped'); clearTimer(); renderGKQuestion(null); };
      const lif50 = $('lifeline5050'); if (lif50) lif50.onclick = lifeline5050;
      const lifHint = $('lifelineHint'); if (lifHint) lifHint.onclick = lifelineHint;
      const lifSkip = $('lifelineSkip'); if (lifSkip) lifSkip.onclick = lifelineSkip;
      const importBtn = $('importKBC'); if (importBtn) importBtn.onclick = async ()=> {
        const f = $('kbcDataset') && $('kbcDataset').files && $('kbcDataset').files[0];
        if (!f) { setStatus('Choose dataset first'); return; }
        try {
          const txt = await f.text();
          const parsed = txt.trim().startsWith('[') ? JSON.parse(txt) : parseCSVtoQuestions(txt);
          window._imported_kbc = parsed;
          setStatus('Imported dataset with '+parsed.length+' questions');
        } catch (e) { setStatus('Import failed: '+e.message); }
      };
    }

    // expose some functions
    return { renderBindings: renderGKUIBindings, fetchOpenTDB, parseCSVtoQuestions };
  })();

  //////////////////////////////
  // UI bindings & init
  //////////////////////////////
  function escapeHtml(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function shuffleWords(s){ const w=s.split(/\s+/).filter(Boolean); for(let i=w.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[w[i],w[j]]=[w[j],w[i]];} return w.join(' '); }
  function shuffleArray(a){ const arr=a.slice(); for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]] } return arr; }
  function truncate(s,n=120){ return s && s.length>n? s.slice(0,n-1)+'…': s; }

  function updateBadges() {
    const totalWords = state.library.reduce((acc,d)=>acc + ((d.text||'').split(/\s+/).filter(Boolean).length),0);
    const b = [];
    if (totalWords > 1000) b.push('Reader');
    if (totalWords > 5000) b.push('Scholar');
    if (totalWords > 20000) b.push('Master');
    state.badges = b;
    const el = $('badges'); if (el) el.innerText = b.length ? b.join(', ') : 'No badges yet';
    saveState();
  }

  // Wire core UI buttons
  function bindCoreUI() {
    const saveNameBtn = $('saveName'); if (saveNameBtn) saveNameBtn.onclick = ()=> {
      const v = $('name') ? $('name').value.trim() : '';
      state.name = v; saveState();
      setStatus('Name saved');
      VoiceManager.speak('Welcome back ' + (v || 'student'));
    };

    const applyLic = $('applyLicense'); if (applyLic) applyLic.onclick = ()=> {
      const v = $('license') ? $('license').value.trim() : '';
      state.license = v || 'DEMO';
      saveState();
      setStatus('License applied: ' + state.license);
    };

    const fileInput = $('fileInput');
    const processBtn = $('processBtn');
    if (processBtn && fileInput) processBtn.onclick = ()=> {
      const files = Array.from(fileInput.files || []);
      if (!files.length) { setStatus('Select files first'); return; }
      handleFileInput(files).catch(e=> setStatus('Processing failed: '+(e.message||e)));
    };

    const deleteAllBtn = $('deleteAll'); if (deleteAllBtn) deleteAllBtn.onclick = ()=> {
      if (!confirm('Delete all files from library?')) return;
      state.library = []; saveState(); renderLibrary(); setStatus('Library cleared');
    };

    const quickBtn = $('quickSummary'); if (quickBtn) quickBtn.onclick = ()=> {
      const s = quickSummary();
      if ($('summaryOutput')) $('summaryOutput').textContent = s;
    };
    const detBtn = $('detailedSummary'); if (detBtn) detBtn.onclick = ()=> {
      const s = detailedSummary();
      if ($('summaryOutput')) $('summaryOutput').textContent = s;
    };
    const readBtn = $('readSummary'); if (readBtn) readBtn.onclick = ()=> {
      const s = $('summaryOutput') ? $('summaryOutput').textContent : '';
      if (!s) { setStatus('No summary'); return; }
      VoiceManager.speak(s);
    };

    const createMCQsBtn = $('createMCQs'); if (createMCQsBtn) createMCQsBtn.onclick = ()=> {
      const r = generateMCQsFromText(10);
      if (r.error) setStatus(r.error);
      else {
        if ($('summaryOutput')) $('summaryOutput').textContent = renderMCQList(r.questions);
      }
    };

    // Quiz panel bindings
    const genQuiz = $('generateQuiz'); if (genQuiz) genQuiz.onclick = ()=> {
      const type = $('quizType') ? $('quizType').value : 'mcq4';
      if (type === 'mcq4') {
        const r = generateMCQsFromText(10);
        if (r.error) setStatus(r.error);
        else { $('quizOutput') && ($('quizOutput').textContent = renderMCQList(r.questions)); }
      } else {
        setStatus('Other quiz types not yet implemented in this demo');
      }
    };
    const readQuizBtn = $('readQuiz'); if (readQuizBtn) readQuizBtn.onclick = ()=> {
      const q = $('quizOutput') ? $('quizOutput').textContent : '';
      if (q) VoiceManager.speak(q);
    };

    // feedback
    const sendFeedback = $('sendFeedback'); if (sendFeedback) sendFeedback.onclick = ()=> {
      const t = $('feedbackText') ? $('feedbackText').value : '';
      if (!t) { setStatus('Feedback empty'); return; }
      // store in local storage (push)
      try {
        const fbKey = 'ssc_feedback';
        const arr = JSON.parse(localStorage.getItem(fbKey) || '[]');
        arr.push({ text: t, when: new Date().toISOString() });
        localStorage.setItem(fbKey, JSON.stringify(arr));
        setStatus('Feedback saved locally');
        if ($('feedbackText')) $('feedbackText').value = '';
      } catch (e) { setStatus('Feedback save error'); }
    };
  }

  // init on DOM ready
  document.addEventListener('DOMContentLoaded', ()=> {
    try {
      VoiceManager.init();
      Appearance.load();
      Appearance.initControls && Appearance.initControls();
      bindCoreUI();
      GK.renderBindings && GK.renderBindings();
      renderLibrary();
      updateBadges();
      setStatus('Ready');
    } catch (e) {
      console.error('init error', e);
    }
  });

  //////////////////////////////
  // Small public helpers for debugging
  //////////////////////////////
  window.ssc = {
    state, saveState, loadState,
    speak: (t)=> VoiceManager.speak(t),
    processSingleFile, processBlobAsDocument
  };

  //////////////////////////////
  // Utility helper functions
  //////////////////////////////
  function shuffleWords(s) {
    const w = s.split(/\s+/).filter(Boolean);
    for (let i=w.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [w[i],w[j]]=[w[j],w[i]]; }
    return w.join(' ');
  }

})();
/* === END OF FILE: app.js === */