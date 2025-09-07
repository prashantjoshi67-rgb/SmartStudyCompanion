/* app.js
   Smart Study Companion - improved single-file app logic
   - Demo / Full access license
   - PDF extraction using pdf.js with Tesseract.js OCR fallback
   - Voice: browser TTS + playback of user-uploaded audio samples
   - KBC mode + general quiz (OpenTDB) integration
   - Targets & badges
   NOTE: This is client-side only. Large OCR jobs are CPU & memory heavy on mobile.
*/

/* ===========================
   Configuration & constants
   =========================== */
const STORAGE_KEY = 'ssc_state_v2';
const DEMO_LICENSE = 'DEMO';
const FULL_LICENSE_KEY = 'FULL-ACCESS'; // user types this to unlock
const TESS_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'; // public tessdata CDN
const OPENTDB_API = 'https://opentdb.com/api.php'; // public trivia API

/* ===========================
   App state
   =========================== */
let state = {
  name: '',
  license: DEMO_LICENSE,
  isPremium: false,
  voiceEnabled: false,
  voiceSampleURL: null, // user-uploaded voice audio (playback only)
  library: [], // {id,name,text,added,sourceFileName}
  badges: {}, // { badgeId: {title,awardedAt} }
  dailyTarget: 20,
  dailyProgress: 0,
  ocrLang: 'eng', // default Tesseract language
  lastProcessedAt: null
};

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadState() {
  const s = localStorage.getItem(STORAGE_KEY);
  if (s) {
    try { Object.assign(state, JSON.parse(s)); }
    catch(e){ console.warn('failed to parse state', e); }
  }
}

/* ===========================
   Utility
   =========================== */
const $ = id => document.getElementById(id);
const formatDate = ts => new Date(ts).toLocaleString();
function uid(prefix='id'){ return prefix + Math.random().toString(36).slice(2,9); }
function setStatus(msg){ const s=$('statusLine'); if(s) s.textContent = msg; console.log('STATUS:', msg); }

/* ===========================
   License / demo / premium
   =========================== */
function renderLicenseUI(){
  const badge = $('licenseBadge');
  if(!badge) return;
  if(state.isPremium){
    badge.className = 'badge premium';
    badge.textContent = 'FULL ACCESS';
  } else {
    badge.className = 'badge demo';
    badge.textContent = 'DEMO VERSION';
  }
  $('license').value = state.license || '';
}
function applyLicense(key){
  const val = String(key || '').trim().toUpperCase();
  if(val === FULL_LICENSE_KEY){
    state.license = val;
    state.isPremium = true;
    saveState();
    renderLicenseUI();
    setStatus('Full access enabled');
    speak('Full access enabled');
    awardBadge('power-user','Full Access');
  } else {
    state.license = val || DEMO_LICENSE;
    state.isPremium = false;
    saveState();
    renderLicenseUI();
    setStatus('Demo / invalid license applied');
  }
}

/* ===========================
   Voice / TTS / user sample
   =========================== */
const Voice = {
  synth: window.speechSynthesis,
  voices: [],
  init(){
    this.refresh();
    if(this.synth) this.synth.onvoiceschanged = ()=>this.refresh();
  },
  refresh(){
    this.voices = this.synth ? this.synth.getVoices() : [];
    const sel = $('voiceSelect');
    if(!sel) return;
    sel.innerHTML = '';
    this.voices.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = v.name + '||' + v.lang;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });
    // try select a likely Indian voice
    for(let i=0;i<sel.options.length;i++){
      if(/(India|IN|en-IN|hi-IN)/i.test(sel.options[i].text)){ sel.selectedIndex = i; break; }
    }
  },
  speak(text, opts={}){
    if(!state.voiceEnabled) return;
    if(!this.synth) return console.warn('No speechSynthesis');
    const ut = new SpeechSynthesisUtterance(text);
    const sel = $('voiceSelect').value;
    if(sel){
      const vname = sel.split('||')[0];
      const voice = this.voices.find(v=>v.name===vname);
      if(voice) ut.voice = voice;
    }
    ut.rate = opts.rate || 1.0;
    ut.pitch = opts.pitch || 1.0;
    this.synth.cancel();
    this.synth.speak(ut);
  },
  playUserSample(){
    if(!state.voiceSampleURL) { setStatus('No voice sample uploaded'); return; }
    const a = new Audio(state.voiceSampleURL);
    a.play();
  }
};

/* ===========================
   Badges & Targets
   =========================== */
function awardBadge(id, title){
  if(state.badges[id]) return; // already awarded
  state.badges[id] = { title, awardedAt: Date.now() };
  saveState();
  setStatus('Badge awarded: ' + title);
}
function updateProgress(n){
  state.dailyProgress = (state.dailyProgress || 0) + (n || 1);
  saveState();
  if(state.dailyProgress >= (state.dailyTarget||20)) awardBadge('streak', 'Daily Target Achieved');
}

/* ===========================
   PDF extraction + OCR via Tesseract
   =========================== */

async function loadTesseractWorker(lang='eng', onProgress=null){
  // create worker with explicit langPath for traineddata
  const worker = Tesseract.createWorker({
    logger: m => { if(onProgress) onProgress(m); }
  });
  await worker.load();
  // set langPath so that worker can fetch traineddata from public tessdata project
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  return worker;
}

async function extractTextFromPDFBuffer(arrayBuffer, ocrLang='eng', progressCb=null){
  // Uses pdf.js (fast) then if no text, renders page to canvas and runs Tesseract OCR per page.
  const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if(!pdfjsLib) throw new Error('pdf.js is not loaded');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  const numPages = doc.numPages;
  let fullText = '';
  let needOCR = false;

  // first pass: try to extract text from pages quickly
  for(let p=1;p<=numPages;p++){
    const page = await doc.getPage(p);
    try{
      const content = await page.getTextContent();
      const pageText = content.items.map(i=>i.str).join(' ').trim();
      if(pageText && pageText.length>20){
        fullText += pageText + '\n\n';
      } else {
        needOCR = true;
        // we still continue to collect non-empty texts from other pages
      }
    } catch(ex){
      needOCR = true;
    }
  }

  // if we got significant text, return it
  if(fullText.trim().length > 50 && !needOCR){
    return {text: fullText, ocrUsed:false};
  }

  // OCR: create a worker (may be heavy). We'll OCR pages that had no text.
  setStatus('OCR fallback: starting Tesseract (this can be slow on mobile)');
  const worker = await loadTesseractWorker(ocrLang, progressCb);
  try{
    for(let p=1;p<=numPages;p++){
      const page = await doc.getPage(p);
      const viewport = page.getViewport({scale: 1.8});
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({canvasContext: ctx, viewport}).promise;
      if(progressCb) progressCb({status:'render', progress: (p-1)/numPages});
      // run OCR on canvas
      const { data } = await worker.recognize(canvas);
      fullText += (data && data.text ? data.text : '') + '\n\n';
      if(progressCb) progressCb({status:'ocr', page:p, progress: p/numPages});
    }
  } finally {
    await worker.terminate();
  }
  return {text: fullText.trim(), ocrUsed:true};
}

/* ===========================
   File handling: process uploaded files
   =========================== */

async function processFiles(fileList){
  const files = Array.from(fileList);
  if(!files.length) { setStatus('No files'); return; }
  for(const f of files){
    setStatus('Processing: ' + f.name);
    try{
      if(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)){
        const ab = await f.arrayBuffer();
        // Attempt faster pdf.js text extraction; OCR fallback inside extractTextFromPDFBuffer
        const result = await extractTextFromPDFBuffer(ab, $('ocrLang').value || state.ocrLang, m => {
          // progress logging - update UI
          if(m.status === 'recognizing text' || m.status === 'ocr') {
            setStatus(`OCR progress: ${Math.round((m.progress||0)*100)}%`);
          } else if(m.status === 'render' || m.status === 'ocr') {
            setStatus(`Processing page: ${m.page || ''}`);
          }
        });
        const txt = result.text || '';
        state.library.unshift({id: uid('doc'), name: f.name, text: txt, added: Date.now(), sourceFileName: f.name});
        setStatus(`Done: ${f.name} (OCR used: ${result.ocrUsed ? 'yes' : 'no'})`);
      } else if(f.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(f.name)){
        // simple image OCR
        const imgBlob = f;
        const imgURL = URL.createObjectURL(imgBlob);
        const img = new Image(); img.src = imgURL;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
        const worker = await loadTesseractWorker($('ocrLang').value || state.ocrLang, m => setStatus(`OCR image: ${Math.round((m.progress||0)*100)}%`));
        const { data } = await worker.recognize(canvas);
        await worker.terminate();
        state.library.unshift({id: uid('img'), name: f.name, text: data.text || '', added: Date.now(), sourceFileName: f.name});
        URL.revokeObjectURL(imgURL);
        setStatus('Image OCR done: ' + f.name);
      } else if(f.type === 'text/plain' || /\.txt$/i.test(f.name)){
        const txt = await f.text();
        state.library.unshift({id: uid('txt'), name: f.name, text: txt, added: Date.now(), sourceFileName: f.name});
        setStatus('Text file added: ' + f.name);
      } else {
        setStatus('Unsupported file type: ' + f.name);
      }
    } catch(err){
      console.error('file process error', err);
      state.library.unshift({id: uid('err'), name: f.name, text: '', added: Date.now(), sourceFileName: f.name});
      setStatus('Processing failed for: ' + f.name);
    }
    saveState();
    renderLibrary();
  }
}

/* ===========================
   Render library UI
   =========================== */
function renderLibrary(){
  const list = $('libraryList');
  if(!list) return;
  if(!state.library.length){ list.innerHTML = '<div class="note">No documents</div>'; return; }
  list.innerHTML = '';
  state.library.forEach((doc, idx)=>{
    const div = document.createElement('div'); div.className='doc';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${doc.name}</strong><div class="muted">Added: ${formatDate(doc.added)}</div>`;
    const right = document.createElement('div');
    const viewBtn = document.createElement('button'); viewBtn.className='btn'; viewBtn.textContent='View';
    viewBtn.onclick = ()=> openViewer(doc);
    const summaryBtn = document.createElement('button'); summaryBtn.className='btn'; summaryBtn.textContent='Summary';
    summaryBtn.onclick = ()=> quickSummary(doc);
    const delBtn = document.createElement('button'); delBtn.className='btn btn-danger'; delBtn.textContent='Delete';
    delBtn.onclick = ()=> { if(confirm('Delete this document?')){ state.library.splice(idx,1); saveState(); renderLibrary(); } };
    right.appendChild(viewBtn); right.appendChild(summaryBtn); right.appendChild(delBtn);
    div.appendChild(left); div.appendChild(right);
    list.appendChild(div);
  });
}

/* ===========================
   Viewer, Summaries & MCQ generation (demo stubs + simple heuristics)
   =========================== */
function openViewer(doc){
  const w = window.open('about:blank','viewer');
  if(!w){ setStatus('Popup blocked: allow popups to view document'); return; }
  const content = doc.text ? escapeHtml(doc.text).replace(/\n/g,'<br/>') : '(no text)';
  w.document.write(`<html><body style="background:#071014;color:#e6eef6;font-family:Arial;padding:12px"><h3>${doc.name}</h3><div style="white-space:pre-wrap">${content}</div></body></html>`);
  w.document.close();
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function quickSummary(doc){
  // Very simple heuristic 'summary' - extract top sentences containing keywords (demo)
  if(!doc || !doc.text) { $('summaryBox').textContent = '(no material)'; return; }
  const text = doc.text.replace(/\n/g,' ').replace(/\s+/g,' ');
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const keywords = ['important','summary','conclusion','chapter','definition','means','is','are','cause','effect'];
  const picks = [];
  for(const s of sentences){
    for(const k of keywords){ if(s.toLowerCase().includes(k) && picks.length<5){ picks.push(s.trim()); break; } }
  }
  if(!picks.length) picks.push(sentences.slice(0,3).join(' '));
  $('summaryBox').textContent = picks.join('\n\n');
  setStatus('Quick summary (demo) ready');
  // Offer to speak
  if(state.voiceEnabled) Voice.speak(picks.join('. '));
}

async function generateMCQsFromDoc(doc, count=5){
  // Very naive MCQ generator: find sentences with 'is/are' and craft a question (demo only)
  const text = doc.text || '';
  const sentences = text.split(/(?<=[.?!])\s+/).filter(s=>s.length>20);
  const candidates = sentences.filter(s => /\b(is|are|was|were|refers to|means)\b/i);
  const qlist = [];
  for(let s of candidates.slice(0,count)){
    // attempt simple split by 'is' or 'are'
    const m = s.match(/(.+?)\s+(is|are|was|were|means|refers to)\s+(.+)/i);
    if(!m) continue;
    const subject = m[1].replace(/["'()]/g,'').trim();
    const answer = m[3].replace(/[.?!]$/,'').split(/[,;:]/)[0].trim();
    if(!subject || !answer) continue;
    // build 3 simple wrong options by scrambling words (demo)
    const wrong1 = scrambleWords(answer);
    const wrong2 = scrambleWords(answer + ' extra');
    const wrong3 = scrambleWords(answer + ' something');
    qlist.push({
      question: `What does "${subject}" refer to?`,
      correct: answer,
      choices: shuffleArray([answer, wrong1, wrong2, wrong3])
    });
  }
  return qlist;
}
function scrambleWords(s){
  const parts = s.split(/\s+/);
  parts.sort(()=>Math.random()-0.5);
  return parts.join(' ').slice(0, Math.max(8, Math.min(30, s.length)));
}
function shuffleArray(a){ return a.slice().sort(()=>Math.random()-0.5); }

/* ===========================
   General Knowledge quiz (OpenTDB)
   =========================== */
async function fetchGKQuestions(amount=10, category=null, difficulty='medium'){
  try{
    let url = `${OPENTDB_API}?amount=${amount}&type=multiple`;
    if(category) url += `&category=${category}`;
    if(difficulty) url += `&difficulty=${difficulty}`;
    setStatus('Fetching GK questions...');
    const res = await fetch(url);
    const json = await res.json();
    if(json.response_code !== 0) { setStatus('Trivia API: no results'); return []; }
    return json.results.map(q=>({
      question: decodeHtmlEntities(q.question),
      correct: decodeHtmlEntities(q.correct_answer),
      choices: shuffleArray([q.correct_answer, ...q.incorrect_answers].map(decodeHtmlEntities))
    }));
  } catch(err){
    console.error('trivia fetch',err);
    setStatus('Trivia fetch failed (offline?)');
    return [];
  }
}
function decodeHtmlEntities(s){ const txt = document.createElement('textarea'); txt.innerHTML = s; return txt.value; }

/* ===========================
   KBC mode basics (demo)
   =========================== */
async function startKBCFromUploadedMaterial(){
  // Use uploaded library to create KBC-style practice questions
  if(!state.library.length){ setStatus('No library material to create KBC questions'); return; }
  // pick first doc with text
  const doc = state.library.find(d=>d.text && d.text.length>50);
  if(!doc){ setStatus('No readable document found'); return; }
  const mcqs = await generateMCQsFromDoc(doc, 10);
  if(!mcqs.length){ setStatus('Could not auto-generate KBC questions from material (demo)'); return; }
  // show first question
  showKBCQuestion(mcqs,0,0);
}
function showKBCQuestion(list, idx, score){
  if(idx >= list.length){ setStatus(`KBC practice complete. Score: ${score}/${list.length}`); awardBadge('kbc-player','KBC Practice Completed'); return; }
  const q = list[idx];
  // simple modal question UI using prompt (for demo)
  const answer = prompt(`Q${idx+1}: ${q.question}\nChoices:\n${q.choices.map((c,i)=>`${i+1}. ${c}`).join('\n')}\nEnter choice number:`);
  const sel = Number(answer) - 1;
  if(q.choices[sel] === q.correct){ score++; alert('Correct!'); updateProgress(1); }
  else alert(`Wrong. Correct answer: ${q.correct}`);
  showKBCQuestion(list, idx+1, score);
}

/* ===========================
   Helpers & UI wiring
   =========================== */
function wireUI(){
  // basic buttons & inputs
  $('saveName').onclick = ()=>{
    state.name = $('name').value.trim();
    saveState();
    setStatus('Name saved');
    Voice.speak(`Hi ${state.name || 'student'}`);
  };
  $('enableVoice').onclick = ()=>{
    state.voiceEnabled = !state.voiceEnabled;
    saveState();
    $('enableVoice').textContent = state.voiceEnabled ? 'Disable Voice' : 'Enable Voice';
    setStatus('Voice ' + (state.voiceEnabled ? 'enabled' : 'disabled'));
  };
  $('applyLicense').onclick = ()=> applyLicense($('license').value);
  $('fileInput').onchange = (e)=> {
    const files = e.target.files;
    if(!files || !files.length) { setStatus('No files selected'); return; }
    // store temporarily for process button
    window._pendingFiles = files;
    setStatus(files.length + ' file(s) selected');
  };
  $('process').onclick = async ()=> {
    const files = window._pendingFiles;
    if(!files || !files.length){ alert('Choose files first'); return; }
    setStatus('Processing files...');
    await processFiles(files);
    renderLibrary();
    setStatus('Processing complete');
    state.lastProcessedAt = Date.now(); saveState();
  };
  $('deleteAll').onclick = ()=> {
    if(confirm('Delete all documents?')) { state.library = []; saveState(); renderLibrary(); setStatus('All documents deleted'); }
  };
  $('quickSum').onclick = ()=> {
    if(!state.library.length) { $('summaryBox').textContent='(no material)'; return; }
    quickSummary(state.library[0]);
  };
  $('detailedSum').onclick = ()=> { $('summaryBox').textContent='(detailed summarization not implemented in demo)'; };
  $('readSum').onclick = ()=> { Voice.speak($('summaryBox').textContent || 'No summary'); };

  $('genMCQ').onclick = async ()=>{
    if(!state.library.length){ setStatus('No library'); return; }
    const mcqs = await generateMCQsFromDoc(state.library[0], 5);
    if(!mcqs.length) { $('summaryBox').textContent='(no MCQs generated)'; return; }
    $('summaryBox').textContent = mcqs.map((q,i)=>`${i+1}. ${q.question}\nA) ${q.choices[0]}\nB) ${q.choices[1]}\nC) ${q.choices[2]}\nD) ${q.choices[3]}\nAnswer: ${q.correct}\n`).join('\n\n');
    setStatus('MCQs generated (demo)');
  };

  $('generateQuiz').onclick = async ()=> {
    // try fetch GK from OpenTDB; fallback to local generation from docs
    const online = navigator.onLine;
    $('quizBox').textContent = 'Generating quiz...';
    let questions = [];
    if(online){
      questions = await fetchGKQuestions(10);
      if(!questions.length) setStatus('No GK questions from API; fallback to local');
    }
    if(!questions.length && state.library.length){
      // generate from first doc
      const mcqs = await generateMCQsFromDoc(state.library[0], 10);
      questions = mcqs.map(m=>({question:m.question, choices:m.choices, correct:m.correct}));
    }
    if(!questions.length){ $('quizBox').textContent = '(no questions available)'; return; }
    // render first few
    $('quizBox').textContent = questions.map((q,i)=>`${i+1}. ${q.question}\nChoices: ${q.choices.join(' | ')}\nAnswer: ${q.correct}\n`).join('\n\n');
    setStatus('Quiz ready');
  };

  // voice sample upload
  $('voiceSampleInput').onchange = (e)=> {
    const f = e.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    state.voiceSampleURL = url; saveState();
    setStatus('Voice sample uploaded');
  };
  $('playVoiceSample').onclick = ()=> Voice.playUserSample();

  // OCR language change
  $('ocrLang').onchange = ()=> { state.ocrLang = $('ocrLang').value; saveState(); setStatus('OCR language set to ' + state.ocrLang); };

  // badges & target UI
  $('targetSet').onclick = ()=> {
    const v = Number($('targetInput').value) || 0; state.dailyTarget = v; saveState(); setStatus('Daily target set: ' + v);
  };

  // KBC start
  $('startKBC').onclick = ()=> startKBCFromUploadedMaterial();
}

/* ===========================
   Small UI creation helper (if HTML lacks some elements)
   =========================== */
function safeEnsureUI(){
  // voice sample input & play button (if not present in index.html)
  if(!$('voiceSampleInput')){
    const container = document.createElement('div'); container.style.marginTop='8px';
    container.innerHTML = `<label>Upload voice sample (mp3/wav)</label>
      <input id="voiceSampleInput" type="file" accept="audio/*" />
      <button id="playVoiceSample" class="btn">Play sample</button>`;
    const manage = $('manage');
    if(manage) manage.appendChild(container);
  }
  // badges target UI
  if(!$('targetInput')){
    const c = document.createElement('div'); c.style.marginTop='12px';
    c.innerHTML = `<label>Daily target</label>
      <input id="targetInput" type="number" value="${state.dailyTarget || 20}" />
      <button id="targetSet" class="btn">Set</button>
      <div id="badgesList" style="margin-top:8px"></div>`;
    const manage = $('manage');
    if(manage) manage.appendChild(c);
  }
  // KBC start button (if not present)
  if(!$('startKBC')){
    const c = document.createElement('div'); c.style.marginTop='10px';
    c.innerHTML = `<button id="startKBC" class="btn btn-primary">Start KBC practice (from uploaded material)</button>`;
    const library = $('library');
    if(library) library.appendChild(c);
  }
}

/* ===========================
   Render badges list
   =========================== */
function renderBadges(){
  const box = $('badgesList');
  if(!box) return;
  box.innerHTML = Object.keys(state.badges).length ? Object.keys(state.badges).map(id=>{
    const b = state.badges[id];
    return `<div style="padding:6px;border-radius:8px;background:rgba(255,255,255,0.02);margin:6px 0">${b.title} — ${formatDate(b.awardedAt)}</div>`;
  }).join('') : '<div class="note">No badges yet</div>';
}

/* ===========================
   Initialization
   =========================== */
async function init(){
  loadState();
  // wire UI (elements assumed present in index.html)
  wireUI();
  safeEnsureUI();
  Voice.init();
  renderLicenseUI();
  renderLibrary();
  renderBadges();
  setStatus('Ready (demo). Tip: type FULL-ACCESS and click Apply to unlock premium.');
  // show saved name if any
  if($('name')) $('name').value = state.name || '';
  if($('ocrLang')) $('ocrLang').value = state.ocrLang || 'eng';
  if($('license')) $('license').value = state.license || DEMO_LICENSE;
  // set voice button label
  if($('enableVoice')) $('enableVoice').textContent = state.voiceEnabled ? 'Disable Voice' : 'Enable Voice';
  // daily progress badge demo
  if(state.dailyProgress >= (state.dailyTarget || 20)) awardBadge('streak','Daily Target Achieved');
}

/* ===========================
   Helpful UI helpers for developer & debug
   =========================== */
window.quickDebug = {
  dumpState: ()=> console.log(JSON.stringify(state,null,2)),
  clearAll: ()=> { if(confirm('Clear all local state?')){ localStorage.removeItem(STORAGE_KEY); location.reload(); } }
};

/* ===========================
   Start app
   =========================== */
document.addEventListener('DOMContentLoaded', ()=> init());

/* ===========================
   FINAL NOTES:
   - Tesseract traineddata files are large; the CDN used here is public (projectnaptha).
   - For best OCR reliability (Marathi or specialized fonts), host traineddata yourself or run server-side OCR.
   - For voice cloning: do NOT upload or clone famous actor's voice without legal permission. User-uploaded sample playback is allowed.
   - If you want server-side processing (reliable OCR & voice cloning) we can design an API end-point and server code next.
   =========================== */