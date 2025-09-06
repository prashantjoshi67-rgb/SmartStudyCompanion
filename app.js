/* app.js — Smart Study Companion (full expanded version)
   Features included:
   - PDF extraction (pdf.js), ZIP unpack (JSZip), OCR fallback (Tesseract.js)
   - Summaries (quick/detailed), MCQ + short answer generator
   - Voice output (Web Speech Synthesis) with preference for Indian voices
   - KBC/Normal/Silent modes + simple KBC experience toggle
   - Timers for quiz questions, scoring, immediate feedback (voice + visual)
   - Daily targets, streaks, badges, progress persistence (localStorage)
   - Backup/Restore, export/import library
   - Demo gating vs Full license gating (configurable)
   - Syllabus sync placeholder (auto-detect or load syllabus JSON)
   - Detailed logging and status messages
   - Very defensive: will create missing DOM elements to avoid runtime exceptions
*/

/* ==================== CONFIG ==================== */
const CONFIG = {
  DEV_EMAIL: "your-email@example.com",
  DEMO_LICENSE_KEY: "FULLACCESS123",
  DEMO_FEATURES: {
    ocr: false,   // OCR disabled in demo
    maxUploadMB: 50,
    voice: true,
    kbcMode: true
  },
  TESSERACT_CORE_CDN: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.1.0/tesseract-core.wasm.js',
  TESSERACT_JS_CDN: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js',
  PDFJS_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.js',
  PDFJS_WORKER_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js',
  JSZIP_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  MAX_SINGLE_UPLOAD_MB: 500
};

/* ==================== STATE ==================== */
// persisted in localStorage key 'ssc_v2'
const STATE = {
  library: [], // items: {id, name, subject, chapter, text, addedAt}
  user: {
    name: '',
    voiceName: '',
    dailyTarget: 20,
    todayCount: 0,
    streak: 0,
    badges: []
  },
  license: {
    key: '',
    valid: false
  },
  settings: {
    ocrLang: 'eng',
    mode: 'normal' // normal | kbc | silent
  },
  syllabus: null // optional structured syllabus JSON if synced
};

/* ==================== UTIL / STORAGE ==================== */
const $ = sel => document.getElementById(sel);
const q = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
function saveState(){ try{ localStorage.setItem('ssc_v2', JSON.stringify(STATE)); } catch(e){ console.warn('saveState failed', e); } }
function loadState(){ try{ const s=localStorage.getItem('ssc_v2'); if(s) Object.assign(STATE, JSON.parse(s)); } catch(e){ console.warn('loadState error', e); } }
function nowStr(){ return new Date().toLocaleString(); }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

/* status / toast */
function setStatus(msg, isError=false){
  let el = $('ssc_status');
  if(!el){
    el = document.createElement('div'); el.id='ssc_status';
    el.style.position='fixed'; el.style.right='12px'; el.style.bottom='12px';
    el.style.background='rgba(0,0,0,0.6)'; el.style.color='#fff'; el.style.padding='10px 14px';
    el.style.borderRadius='10px'; el.style.zIndex = 99999; document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = isError ? 'rgba(160,30,30,0.9)' : 'rgba(6,24,32,0.9)';
}

/* ==================== DYNAMIC LIBRARY UI CREATION (defensive) ==================== */
function ensureUI(){
  // create minimal required elements if not present so code won't crash when tested without index.html
  const ids = [
    'fileInput','processFiles','libraryList','summaryOutput','quizOutput','voiceSelect','enableVoice',
    'modeSelect','ocrLang','dailyTarget','setTarget','backupBtn','restoreFile','restoreBtn',
    'feedbackText','sendFeedback','licenseKey','applyLicense','licenseStatus','todayTarget','todayCount','streak','badgesArea'
  ];
  ids.forEach(id=>{
    if(!$(id)){
      const dummy = document.createElement('div');
      dummy.id = id;
      dummy.style.display = 'none';
      document.body.appendChild(dummy);
    }
  });
}

/* ==================== LIBRARY RENDERING ==================== */
function renderLibrary(){
  const root = $('libraryList');
  if(!root){ console.warn('No libraryList element'); return; }
  root.innerHTML = '';
  if(STATE.library.length === 0){
    root.innerHTML = '<div class="muted">No material. Upload PDFs / ZIP / TXT to begin.</div>';
    return;
  }
  STATE.library.forEach(item=>{
    const row = document.createElement('div'); row.className='row item';
    row.innerHTML = `
      <div style="flex:1">
        <strong>${escapeHtml(item.name)}</strong>
        <div class="muted">${escapeHtml(item.subject||'General')} — ${escapeHtml(item.chapter||'')}</div>
        <div class="muted small">Added: ${new Date(item.addedAt).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" data-id="${item.id}" onclick="viewItem('${item.id}')">View</button>
        <button class="btn small" data-id="${item.id}" onclick="deleteItem('${item.id}')">Delete</button>
      </div>`;
    root.appendChild(row);
  });
}

/* ==================== VIEW / DELETE ITEM ==================== */
window.viewItem = function(id){
  const it = STATE.library.find(x => x.id === id);
  if(!it){ alert('Item not found'); return; }
  // open in new window for readability
  const win = window.open('', '_blank');
  win.document.title = it.name;
  win.document.body.style.background = '#071018';
  win.document.body.style.color = '#e6eef6';
  const pre = win.document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily = 'Arial, sans-serif';
  pre.style.padding = '18px';
  pre.textContent = it.text || '(no text)';
  win.document.body.appendChild(pre);
};

window.deleteItem = function(id){
  if(!confirm('Delete this item?')) return;
  STATE.library = STATE.library.filter(x => x.id !== id);
  saveState(); renderLibrary(); setStatus('Item deleted');
};

/* ==================== PDF.js & JSZip LOADERS ==================== */
async function ensureLibraries(){
  // pdf.js
  if(!window.pdfjsLib){
    await loadScript(CONFIG.PDFJS_CDN);
    // worker
    if(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.PDFJS_WORKER_CDN;
    }
  }
  // JSZip
  if(!window.JSZip){
    await loadScript(CONFIG.JSZIP_CDN);
  }
  // Tesseract lazily loaded later when OCR is needed
}

function loadScript(src){
  return new Promise((res,rej)=>{
    if(document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = ()=>res(); s.onerror = (e)=>rej(e);
    document.head.appendChild(s);
  });
}

/* ==================== FILE HANDLING PIPELINE ==================== */
async function handleFilesSelected(files){
  setStatus('Processing files...');
  await ensureLibraries();
  const maxMB = STATE.license.valid ? CONFIG.MAX_SINGLE_UPLOAD_MB : CONFIG.DEMO_FEATURES.maxUploadMB;
  for(const f of files){
    if(f.size/1024/1024 > maxMB){ setStatus(`File ${f.name} too large for current mode`, true); continue; }
    try{
      if(f.name.toLowerCase().endsWith('.zip')){
        await handleZipFile(f);
      } else if(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')){
        await handlePDFFile(f);
      } else if(f.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(f.name)){
        await handleImageFile(f);
      } else if(f.type.startsWith('text/') || /\.(txt|html|htm)$/i.test(f.name)){
        await handleTextFile(f);
      } else {
        // unknown file type - try text
        await handleTextFile(f);
      }
    } catch(err){
      console.error('Error processing file', f.name, err);
      STATE.library.push({ id: uid(), name: f.name, subject:'General', chapter:'', text: '(processing error)' , addedAt: Date.now()});
    }
  }
  saveState(); renderLibrary(); setStatus('Processing complete');
}

async function handleZipFile(file){
  // unzip using JSZip
  if(!window.JSZip) await loadScript(CONFIG.JSZIP_CDN);
  const ab = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(ab);
  const promises = [];
  zip.forEach((relPath, zipEntry) => {
    if(zipEntry.dir) return;
    const ext = relPath.split('.').pop().toLowerCase();
    if(['pdf','txt','html','htm','jpg','jpeg','png'].includes(ext)){
      promises.push(zipEntry.async('blob').then(blob => {
        const f = new File([blob], relPath, {type: blob.type || 'application/octet-stream'});
        // process according to ext
        if(ext === 'pdf') return handlePDFFile(f);
        if(['jpg','jpeg','png'].includes(ext)) return handleImageFile(f);
        return handleTextFile(f);
      }));
    }
  });
  await Promise.all(promises);
}

async function handleTextFile(file){
  const txt = await file.text();
  STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: txt, addedAt: Date.now()});
}

async function handleImageFile(file){
  if(!STATE.license.valid && !CONFIG.DEMO_FEATURES.ocr){ STATE.library.push({id: uid(), name: file.name, text: '(OCR locked in demo)', addedAt: Date.now()}); return; }
  // For images, run OCR
  const text = await runOCR(file);
  STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: text || '(OCR failed)', addedAt: Date.now()});
}

async function handlePDFFile(file){
  await ensureLibraries();
  // try PDF.js text extraction
  try{
    const arr = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({data: arr}).promise;
    let combined = '';
    for(let p=1; p<=doc.numPages; p++){
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(i=>i.str).join(' ');
      combined += pageText + '\n';
    }
    if(combined.trim().length > 30){
      STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: combined, addedAt: Date.now()});
      return;
    }
    // else maybe image-based; fallback to per-page OCR
  } catch(err){
    console.warn('pdf.js extract failed:', err);
    // fallthrough to OCR if allowed
  }

  if(!STATE.license.valid && !CONFIG.DEMO_FEATURES.ocr){
    STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: '(image-based PDF — OCR locked in demo)', addedAt: Date.now()});
    return;
  }

  // OCR fallback - render pages to canvas first (if pdf.js available) or send to worker directly if single-image PDF
  try{
    // convert each page to image using pdf.js render
    const arr = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({data: arr}).promise;
    let bigText = '';
    // create a tesseract worker outside loop for efficiency
    const worker = await createTesseractWorker(STATE.settings.ocrLang);
    for(let p=1; p<=doc.numPages; p++){
      const page = await doc.getPage(p);
      const viewport = page.getViewport({scale:1.2});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({canvasContext: ctx, viewport}).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const { data: { text } } = await worker.recognize(blob);
      bigText += '\n' + text;
      // free canvas
      canvas.width = canvas.height = 0;
    }
    await worker.terminate();
    STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: bigText || '(OCR failed)', addedAt: Date.now()});
  } catch(err){
    console.error('PDF OCR fallback failed', err);
    STATE.library.push({id: uid(), name: file.name, subject:'General', chapter:'', text: '(PDF OCR failed)', addedAt: Date.now()});
  }
}

/* ==================== TESSERACT WORKER CREATION ==================== */
async function ensureTesseract(){
  if(window.Tesseract) return;
  await loadScript(CONFIG.TESSERACT_JS_CDN);
}
async function createTesseractWorker(lang = 'eng'){
  await ensureTesseract();
  const opts = {
    logger: m => { if(m && m.status){ setStatus(`OCR: ${m.status} ${m.progress ? Math.round(m.progress*100)+'%' : ''}`); } }
  };
  // use corePath for wasm; this improves performance
  opts.corePath = CONFIG.TESSERACT_CORE_CDN;
  // langPath left default; user can host traineddata if needed
  const worker = Tesseract.createWorker(opts);
  await worker.load();
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  return worker;
}

async function runOCR(file){
  try{
    const worker = await createTesseractWorker(STATE.settings.ocrLang);
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    return text;
  } catch(err){
    console.error('runOCR error', err);
    return null;
  }
}

/* ==================== SUMMARY GENERATOR ==================== */
function summarizeText(text, mode = 'quick'){
  if(!text || text.trim().length < 40) return '(no material)';
  // simple extractive: split into sentences, score by word frequency
  const sents = text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/).filter(Boolean);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/gi,' ').split(/\s+/).filter(Boolean);
  const stop = new Set(['the','is','and','to','in','of','a','that','it','for','with','as','are','on','this','by','an','be','or']);
  const freq = {};
  for(const w of words) if(!stop.has(w)) freq[w] = (freq[w]||0) + 1;
  const score = sents.map(s => {
    const ws = s.toLowerCase().replace(/[^a-z0-9\s]/gi,' ').split(/\s+/).filter(Boolean);
    let sc = 0;
    for(const w of ws) if(freq[w]) sc += freq[w];
    return { s, sc: sc / Math.max(1, ws.length) };
  });
  score.sort((a,b) => b.sc - a.sc);
  const n = mode === 'detailed' ? Math.min(8, score.length) : Math.min(4, score.length);
  return score.slice(0,n).map(x => x.s.trim()).join('\n\n');
}

/* ==================== MCQ / Quiz GENERATORS ==================== */
function generateMCQs(text, count = 5){
  // Very naive: pick sentences, choose a long word as answer, create distractors
  if(!text || text.length < 100) return [];
  const sents = text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/).filter(s => s.length > 40);
  const items = [];
  for(let i=0; i<Math.min(count, sents.length); i++){
    const s = sents[i];
    const words = s.replace(/[^a-zA-Z0-9\s]/g,'').split(/\s+/).filter(Boolean);
    let candidate = words.reduce((a,b)=> b.length > a.length ? b : a, '');
    if(!candidate || candidate.length <= 3) candidate = words[Math.floor(words.length/2)];
    // create simple distractors
    const options = [candidate];
    while(options.length < 4){
      const d = mutateWord(candidate);
      if(!options.includes(d)) options.push(d);
    }
    // shuffle
    for(let j=options.length-1;j>0;j--){
      const k = Math.floor(Math.random()*(j+1));
      [options[j], options[k]] = [options[k], options[j]];
    }
    items.push({ question: s.replace(candidate, '_____'), options, answer: candidate });
  }
  return items;
}
function mutateWord(w){
  if(!w) return 'None';
  // simple mutators
  const r = Math.random();
  if(r < 0.33) return w.split('').reverse().join('');
  if(r < 0.66) return w.slice(0, Math.max(1, Math.floor(w.length/2)));
  return w + (Math.floor(Math.random()*9)+1);
}

/* ==================== QUIZ FLOW + TIMERS + SCORING ==================== */
let CURRENT_QUIZ = { items: [], index: 0, score: 0, timerId: null, remaining: 0 };

function startQuiz(items, timeLimitSeconds = 0, voiceQuestion = false){
  CURRENT_QUIZ = { items, index: 0, score: 0, timerId: null, remaining: timeLimitSeconds };
  renderQuizQuestion();
  if(timeLimitSeconds > 0) startQuizTimer(timeLimitSeconds);
}
function renderQuizQuestion(){
  const out = $('quizOutput');
  if(!out) return;
  const item = CURRENT_QUIZ.items[CURRENT_QUIZ.index];
  if(!item){ out.innerHTML = `<div>No more questions. Score: ${CURRENT_QUIZ.score}/${CURRENT_QUIZ.items.length}</div>`; awardAfterQuiz(); return; }
  let html = `<div class="card"><div><b>Q${CURRENT_QUIZ.index+1}:</b> ${escapeHtml(item.question)}</div><div style="margin-top:8px">`;
  item.options.forEach((opt, idx) => {
    html += `<button class="btn small mcq-choice" data-choice="${escapeHtml(opt)}">${escapeHtml(opt)}</button> `;
  });
  html += `</div><div id="quizTimerDisplay" class="muted small" style="margin-top:8px"></div></div>`;
  out.innerHTML = html;
  // wire buttons
  out.querySelectorAll('.mcq-choice').forEach(btn=>{
    btn.onclick = (e) => {
      const choice = btn.getAttribute('data-choice');
      if(choice === item.answer){
        CURRENT_QUIZ.score++;
        btn.style.background = '#2ecc71';
        speakShort('Right answer');
      } else {
        btn.style.background = '#e74c3c';
        speakShort('Wrong answer. Correct: '+item.answer);
      }
      // next after short delay
      setTimeout(()=> {
        CURRENT_QUIZ.index++;
        renderQuizQuestion();
      }, 700);
    };
  });
}
function startQuizTimer(seconds){
  CURRENT_QUIZ.remaining = seconds;
  updateTimerDisplay();
  CURRENT_QUIZ.timerId = setInterval(()=> {
    CURRENT_QUIZ.remaining--;
    if(CURRENT_QUIZ.remaining <= 0){
      clearInterval(CURRENT_QUIZ.timerId);
      // time up for current question => move on
      CURRENT_QUIZ.index++;
      renderQuizQuestion();
    } else {
      updateTimerDisplay();
    }
  }, 1000);
}
function updateTimerDisplay(){
  const el = $('quizTimerDisplay');
  if(el) el.textContent = `Time left: ${CURRENT_QUIZ.remaining}s`;
}
function awardAfterQuiz(){
  // give one point per correct (already in score)
  // increment progress/store badge if target reached
  incrementProgress(CURRENT_QUIZ.score);
}

/* ==================== PROGRESS / BADGES / TARGETS ==================== */
function incrementProgress(n=1){
  STATE.user.todayCount = (STATE.user.todayCount || 0) + n;
  const target = STATE.user.dailyTarget || 20;
  if(STATE.user.todayCount >= target && !STATE.user.badges.includes('Daily Target')){
    STATE.user.badges.push('Daily Target');
    STATE.user.streak = (STATE.user.streak || 0) + 1;
    setStatus('Daily target achieved — badge awarded!');
  }
  saveState(); updateProgressUI();
}
function updateProgressUI(){
  const t = $('todayCount'); const tg = $('todayTarget'); const st = $('streak'); const bad = $('badgesArea');
  if(t) t.innerText = STATE.user.todayCount || 0;
  if(tg) tg.innerText = STATE.user.dailyTarget || 20;
  if(st) st.innerText = STATE.user.streak || 0;
  if(bad){
    bad.innerHTML = '';
    (STATE.user.badges || []).forEach(b=>{
      const el = document.createElement('span'); el.className = 'badge'; el.innerText = b; bad.appendChild(el);
    });
  }
}

/* ==================== VOICE (TTS) HELPERS ==================== */
function populateVoicesOptions(){
  const sel = $('voiceSelect');
  if(!sel) return;
  const voices = window.speechSynthesis.getVoices();
  sel.innerHTML = '';
  // prefer Indian voices early
  const pref = voices.filter(v => /India|IN|en-IN|hi-IN/i.test((v.lang||'') + ' ' + (v.name||'')));
  const rest = voices.filter(v => !pref.includes(v));
  [...pref,...rest].forEach(v=>{
    const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  // choose default if available
  if(pref.length) sel.value = pref[0].name;
}
function speakText(text, lang='en-IN', rate=1.0){
  if(!('speechSynthesis' in window)) return;
  if(!STATE.license.valid && !CONFIG.DEMO_FEATURES.voice) { /* locked in demo */ return; }
  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const pick = voices.find(v => v.name === STATE.user.voiceName) || voices.find(v => /en-?in|hi-?in|india/i.test(v.lang + ' ' + v.name)) || voices[0];
  if(pick) utter.voice = pick;
  utter.lang = lang;
  utter.rate = rate;
  speechSynthesis.cancel(); speechSynthesis.speak(utter);
}
function speakShort(text){
  if(STATE.settings.mode === 'silent') return;
  speakText(text, STATE.user.voiceName ? undefined : 'en-IN', 1.0);
}

/* ==================== TTS INIT (user gesture friendly) ==================== */
function ensureVoicesLoaded(){
  return new Promise((resolve) => {
    let voices = window.speechSynthesis.getVoices();
    if(voices.length) { populateVoicesOptions(); resolve(); }
    else {
      window.speechSynthesis.onvoiceschanged = () => { populateVoicesOptions(); resolve(); };
      // try silent utterance to trigger voices on some browsers
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  });
}

/* ==================== LICENSE (simple demo) ==================== */
function applyLicenseKey(){
  const key = ($('licenseKey') && $('licenseKey').value.trim()) || '';
  if(!key) return alert('Enter license key');
  if(key === CONFIG.DEMO_LICENSE_KEY){
    STATE.license.key = key; STATE.license.valid = true; saveState();
    setStatus('License accepted — Full access unlocked');
    renderAllControls();
  } else {
    alert('Invalid license (demo key is: ' + CONFIG.DEMO_LICENSE_KEY + ')');
  }
}

/* ==================== BACKUP / RESTORE ==================== */
function exportBackup(){
  const blob = new Blob([JSON.stringify(STATE)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ssc_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
function importBackup(file){
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const obj = JSON.parse(fr.result);
      Object.assign(STATE, obj);
      saveState(); renderAllControls(); renderLibrary();
      alert('Backup restored');
    } catch(e){
      alert('Invalid backup file');
    }
  };
  fr.readAsText(file);
}

/* ==================== SYLLABUS SYNC PLACEHOLDER ==================== */
function importSyllabusJson(file){
  // the syllabus JSON should map subject -> chapters array, etc.
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const j = JSON.parse(fr.result);
      STATE.syllabus = j;
      saveState(); setStatus('Syllabus imported');
    } catch(e){
      setStatus('Syllabus import failed', true);
    }
  };
  fr.readAsText(file);
}
async function autoDetectSyllabus(){
  // placeholder: in real app we could attempt to match files to known syllabus via heuristics or fetch NCERT mapping
  setStatus('Auto-detecting syllabus (not implemented)', true);
}

/* ==================== UI RENDER / HOOKS ==================== */
function renderAllControls(){
  updateProgressUI();
  renderLibrary();
  // license status
  if($('licenseStatus')) $('licenseStatus').innerText = STATE.license.valid ? 'Full access' : 'Demo mode';
  if($('ocrLang')) $('ocrLang').value = STATE.settings.ocrLang || 'eng';
  if($('modeSelect')) $('modeSelect').value = STATE.settings.mode || 'normal';
  // badges
  const ba = $('badgesArea'); if(ba) { ba.innerHTML=''; (STATE.user.badges||[]).forEach(b=>{ const sp = document.createElement('span'); sp.className='badge'; sp.innerText=b; ba.appendChild(sp); }); }
}

/* wire UI elements that exist */
function wireUI(){
  ensureUI();
  // hook file input and process button
  const fileInput = $('fileInput');
  const processBtn = $('processFiles');
  if(processBtn && fileInput){
    processBtn.onclick = async () => {
      const files = Array.from(fileInput.files || []);
      if(files.length === 0) return alert('Choose files first');
      await handleFilesSelected(files);
    };
  }
  // summary buttons
  const quick = $('quickSummary'), det = $('detailedSummary'), read = $('readSummary');
  if(quick) quick.onclick = ()=> { const txt = STATE.library.map(i=>i.text||'').join('\n'); $('summaryOutput').innerText = summarizeText(txt, 'quick'); incrementProgress(1); };
  if(det) det.onclick = ()=> { const txt = STATE.library.map(i=>i.text||'').join('\n'); $('summaryOutput').innerText = summarizeText(txt, 'detailed'); incrementProgress(1); };
  if(read) read.onclick = ()=> speakText($('summaryOutput').innerText || '', 'en-IN', 1.0);

  // quiz generation button (simple)
  const gen = $('generateQuiz');
  if(gen) gen.onclick = ()=> {
    const txt = STATE.library.map(i=>i.text||'').join('\n');
    const items = generateMCQs(txt, 5);
    CURRENT_QUIZ.items = items;
    CURRENT_QUIZ.index = 0; CURRENT_QUIZ.score = 0;
    startQuiz(items, 0, true);
  };

  // TTS enable
  const enableVoiceBtn = $('enableVoice');
  if(enableVoiceBtn){
    enableVoiceBtn.onclick = async ()=> {
      await ensureVoicesLoaded();
      populateVoicesOptions();
      STATE.user.voiceName = $('voiceSelect').value;
      saveState();
      alert('Voice preference saved');
    };
  }

  // mode select
  const modeSel = $('modeSelect');
  if(modeSel){
    modeSel.onchange = ()=> { STATE.settings.mode = modeSel.value; saveState(); setStatus('Mode: ' + modeSel.value); };
  }

  // OCR loader
  const loadOcrBtn = $('loadOCR');
  if(loadOcrBtn) loadOcrBtn.onclick = async ()=> {
    if(!STATE.license.valid && !CONFIG.DEMO_FEATURES.ocr) return alert('OCR is a paid feature in demo. Enter license to enable.');
    await ensureTesseract(); setStatus('OCR ready');
  };

  // license apply
  const apply = $('applyLicense');
  if(apply) apply.onclick = applyLicenseKeyHandler;

  // backup / restore
  if($('backupBtn')) $('backupBtn').onclick = exportBackup;
  if($('restoreBtn')) $('restoreBtn').onclick = ()=>{
    const f = $('restoreFile').files[0];
    if(!f) return alert('Choose backup file');
    importBackup(f);
  };

  // restore syllabus
  const syIn = $('syllabusFile');
  if(syIn) syIn.onchange = ()=> importSyllabusJson(syIn.files[0]);

  // feedback
  const fbBtn = $('sendFeedback');
  if(fbBtn) fbBtn.onclick = ()=> {
    const txt = $('feedbackText') ? $('feedbackText').value.trim() : '';
    if(!txt) return alert('Write feedback first');
    const subject = encodeURIComponent('SmartStudy Companion feedback');
    const body = encodeURIComponent(`User: ${STATE.user.name}\n\n${txt}`);
    location.href = `mailto:${CONFIG.DEV_EMAIL}?subject=${subject}&body=${body}`;
  };
}

/* apply license handler (connected to UI) */
function applyLicenseKeyHandler(){
  const key = $('licenseKey') ? $('licenseKey').value.trim() : '';
  if(!key) return alert('Enter license key');
  if(key === CONFIG.DEMO_LICENSE_KEY){
    STATE.license.key = key; STATE.license.valid = true; saveState(); renderAllControls();
    alert('License accepted — full access unlocked');
  } else {
    alert('Invalid license key (demo: FULLACCESS123)');
  }
}

/* ==================== BOOTSTRAP ==================== */
loadState();
ensureUI();
wireUI();
renderAllControls();
renderLibrary();
updateProgressUI();

// Populate browser voices after user gesture
window.addEventListener('click', () => {
  // populate voices once user clicks somewhere (gesture)
  try{ populateVoicesOptions(); } catch(e){ /* ignore */ }
}, { once:true });

/* ==================== EXPORTS for debugging in console ==================== */
window._SSC = {
  STATE,
  saveState,
  loadState,
  runOCR,
  summarizeText,
  generateMCQs,
  handleFilesSelected,
  exportBackup,
  importBackup
};

/* ==================== END OF FILE ==================== */