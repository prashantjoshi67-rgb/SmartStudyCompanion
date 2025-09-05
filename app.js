/* app.js
   SmartStudy Companion - main client logic (updated)
   - OCR via tesseract.js (CDN + local tessdata fallback)
   - PDF text extraction via pdf.js (CDN)
   - Summary & MCQ generators (client-side heuristics)
   - Voice read-aloud with attempt to pick Indian voices
   - KBC / Normal / Silent hooks, Feedback capture
   - Lots of console logs + status for debugging on mobile/desktop
*/

/* ========= Configuration ========= */
const CONFIG = {
  // If you upload tessdata into repo, set TESSDATA_PATH to '/tessdata'
  // Otherwise leave null to use CDN raw GitHub path (may be slower)
  TESSDATA_PATH: '/tessdata', // set to null to use CDN raw
  TESSERACT_CORE_CDN: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.1.0/tesseract-core.wasm.js',
  TESSDATA_RAW_CDN: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata/main', // fallback
  PDFJS_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.js',
  PDFJS_WORKER_CDN: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js'
};

/* ========= Utility helpers ========= */
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function log(...args){ console.log('[App]', ...args); }
function setStatus(msg, isError=false){
  const el = $('#statusBox') || (()=>{
    const s = document.createElement('div');
    s.id='statusBox';
    s.style.position='fixed';
    s.style.right='12px';
    s.style.bottom='12px';
    s.style.zIndex=99999;
    s.style.padding='8px 12px';
    s.style.borderRadius='8px';
    s.style.background = isError? '#6b1d1d':'#123';
    s.style.color = '#fff';
    document.body.appendChild(s);
    return s;
  })();
  el.textContent = msg;
  el.style.background = isError? '#a33' : '#0b1720';
}

/* ========= Load PDF.js dynamically ========= */
async function ensurePdfJs(){
  if(window.pdfjsLib) return;
  // load PDF.js scripts
  await loadScript(CONFIG.PDFJS_CDN);
  await loadScript(CONFIG.PDFJS_WORKER_CDN);
  window.pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib || window.pdfjsLib;
  if(window.pdfjsLib) {
    if (window.pdfjsLib.GlobalWorkerOptions && window.pdfjsLib.GlobalWorkerOptions.workerSrc === undefined) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.PDFJS_WORKER_CDN;
    }
    log('pdf.js loaded');
  } else {
    log('pdf.js loading might have failed');
  }
}
function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = ()=>resolve();
    s.onerror = (e)=>reject(e);
    document.head.appendChild(s);
  });
}

/* ========= Tesseract worker helpers ========= */
async function createTessWorker(langCode='eng') {
  // lazy-load tesseract.js
  if(!window.Tesseract) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js');
  }
  // prepare options
  const opts = {
    logger: m => {
      // show progress numeric in console and status
      if(m && m.status) {
        const p = m.progress ? Math.round(m.progress*100) : '';
        log('tess:', m.status, p);
        setStatus(`OCR: ${m.status} ${p ? p+'%' : ''}`);
      } else {
        log('tess log', m);
      }
    }
  };
  // prefer local tessdata path if set by repo owner
  if(CONFIG.TESSDATA_PATH) {
    opts.langPath = CONFIG.TESSDATA_PATH;
  } else {
    opts.langPath = CONFIG.TESSDATA_RAW_CDN;
  }
  opts.corePath = CONFIG.TESSERACT_CORE_CDN;

  const worker = Tesseract.createWorker(opts);
  await worker.load();
  // allow combined languages
  const langs = (langCode || 'eng').split('+').map(x=>x.trim()).filter(Boolean);
  for(const l of langs) {
    try {
      await worker.loadLanguage(l);
    } catch(err){
      log('Failed to load tess language', l, err);
      // fallback: try raw CDN if local failed
      if(!CONFIG.TESSDATA_PATH) {
        // may already be using raw; continue
      }
    }
  }
  await worker.initialize(langs.join('+'));
  return worker;
}

/* ========= Text extraction from PDF (pdf.js) ========= */
async function extractTextFromPdf(file) {
  try {
    await ensurePdfJs();
    const arr = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({data: arr}).promise;
    let fullText = '';
    for(let p=1; p<=pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const texts = content.items.map(i => i.str).join(' ');
      fullText += texts + '\n\n';
    }
    return fullText.trim();
  } catch(err) {
    log('pdf text extraction error', err);
    return ''; // empty indicates fallback to OCR
  }
}

/* ========= OCR for image-based PDFs or images ========= */
async function ocrFile(file, lang='eng') {
  // For simple images, feed file directly to Tesseract.
  const worker = await createTessWorker(lang);
  try {
    setStatus('OCR: initializing');
    const { data: { text } } = await worker.recognize(file);
    setStatus('OCR: done');
    return text;
  } finally {
    await worker.terminate();
    setStatus('Ready');
  }
}

/* ========= High-level pipeline: file -> text ========= */
async function fileToText(file, ocrLang='eng') {
  // Try pdf.js text extraction first
  if(file.type === 'application/pdf') {
    const txt = await extractTextFromPdf(file);
    if(txt && txt.trim().length>20) {
      log('PDF had selectable text.');
      return txt;
    } else {
      log('PDF likely image-based; falling back to OCR.');
      // try OCR pages
      return await ocrFile(file, ocrLang);
    }
  } else if(file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png)$/i)) {
    // images => OCR
    return await ocrFile(file, ocrLang);
  } else if(file.type.startsWith('text/') || file.name.match(/\.(txt|html)$/i)) {
    // text file => read raw
    return await file.text();
  } else if(file.name.match(/\.(zip)$/i)) {
    // ZIP: we'll unpack in handleFileSelect elsewhere; here return empty
    log('ZIP handling should be done before calling fileToText');
    return '';
  } else {
    // unknown
    try { return await file.text(); } catch(e){ return ''; }
  }
}

/* ========= Simple summarizer & quiz generator (client-side heuristics) ========= */
function simpleSummarize(text, type='quick') {
  if(!text || text.trim().length < 50) return '(no material)';
  // naive approach: split into sentences, pick top N by length & uniqueness
  const sents = text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(Boolean);
  if(sents.length===0) return '(no material)';
  const N = (type==='detailed') ? Math.min(8, Math.ceil(sents.length/4)) : Math.min(4, Math.ceil(sents.length/6));
  // score sentences by length and keyword density
  const scores = sents.map(s=>{
    const len = s.length;
    const keywords = (s.match(/\b(is|are|the|and|because|in|of|for)\b/gi) || []).length;
    return {s, score: len - keywords*2};
  });
  scores.sort((a,b)=>b.score - a.score);
  const out = scores.slice(0,N).map(x=>`• ${x.s}`);
  return out.join('\n\n');
}

function generateSimpleMCQs(text, count=5) {
  // Very naive MCQ generator: pick sentences with an explicit fact, create distractors by shuffling keywords.
  if(!text || text.length < 100) return [];
  const sents = text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(Boolean);
  const candidates = sents.filter(s=> s.split(' ').length > 6);
  const selected = [];
  for(let i=0;i<Math.min(count, candidates.length); i++){
    const q = candidates[i];
    // pick a word to hide (longish noun)
    const words = q.split(/\s+/);
    let targetIdx = words.findIndex(w => w.length>6) ;
    if(targetIdx<0) targetIdx = Math.floor(words.length/2);
    const answer = words[targetIdx].replace(/[^a-zA-Z0-9]/g,'');
    const questionText = q.replace(words[targetIdx], '_____');
    // build distractors: pick other words or alter characters
    const distractors = new Set();
    while(distractors.size < 3) {
      const w = words[Math.max(0, Math.min(words.length-1, Math.floor(Math.random()*words.length)))].replace(/[^a-zA-Z0-9]/g,'');
      if(w && w.toLowerCase() !== answer.toLowerCase()) distractors.add(w);
      if(distractors.size>10) break;
    }
    const choices = [answer, ...Array.from(distractors).slice(0,3)];
    // shuffle
    for(let k=choices.length-1;k>0;k--){
      const r = Math.floor(Math.random()*(k+1));
      [choices[k], choices[r]] = [choices[r], choices[k]];
    }
    selected.push({q: questionText, choices, answer});
  }
  return selected;
}

/* ========= Voice helpers (SpeechSynthesis) ========= */
function getPreferredVoice(langPref='en-IN') {
  // try to find Indian voice first
  const voices = window.speechSynthesis.getVoices() || [];
  // Try exact match
  let v = voices.find(x => x.lang && x.lang.toLowerCase().startsWith(langPref.toLowerCase()));
  if(v) return v;
  // Fallback heuristics:
  v = voices.find(x=>/(India|Indian|en-?in|hi-?in)/i.test(x.name + ' ' + x.lang));
  if(v) return v;
  // else first english voice
  return voices.find(x => x.lang && x.lang.startsWith('en')) || voices[0] || null;
}
function speakText(text, lang='en-IN', rate=1.0) {
  if(!('speechSynthesis' in window)) {
    alert('Speech synthesis not supported in this browser.');
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const v = getPreferredVoice(lang);
  if(v) utter.voice = v;
  utter.lang = lang;
  utter.rate = rate;
  window.speechSynthesis.speak(utter);
}

/* ========= File handling & UI wiring ========= */
let APP = {
  library: [], // {name, text, subject?, chapter?}
  currentCollection: 'CBSE Class 10',
  ocrLang: 'eng', // default
  mode: 'normal', // normal | kbc | silent
  license: 'FULL-ACCESS'
};

function initApp() {
  log('initApp');
  // wire basic UI elements. If IDs differ in your index.html, change selectors accordingly.
  const choose = $('#fileInput') || document.querySelector('input[type=file]#fileInput') || (()=>{
    const el = document.createElement('input');
    el.type='file'; el.id='fileInput'; el.multiple=true;
    el.accept='.pdf,.zip,.txt,.html,.png,.jpg';
    el.style.display='none';
    document.body.appendChild(el);
    return el;
  })();

  // File chooser button
  const chooseBtn = $('#btnChooseFiles') || document.getElementById('chooseFilesBtn');
  if(chooseBtn) chooseBtn.addEventListener('click', ()=> choose.click());

  choose.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    if(files.length===0) return;
    await handleFilesSelected(files);
  });

  // process button
  const processBtn = $('#btnProcess') || document.getElementById('processBtn');
  if(processBtn) processBtn.addEventListener('click', async ()=>{
    const files = Array.from(choose.files || []);
    if(files.length===0) return alert('Choose files first');
    await handleFilesSelected(files);
  });

  // voice dropdown
  const voiceSel = $('#voiceSelect');
  if(voiceSel){
    voiceSel.addEventListener('change', ()=>{
      const v = voiceSel.value;
      APP.ocrLang = mapVoiceToOcrLang(v);
      setStatus(`Voice set to ${v}`);
    });
  }

  // summary buttons
  const btnQuick = $('#btnQuickSummary');
  if(btnQuick) btnQuick.addEventListener('click', ()=> {
    const area = $('#summaryOutput');
    area.value = simpleSummarize(fullCombinedText(),'quick');
  });
  const btnDetail = $('#btnDetailedSummary');
  if(btnDetail) btnDetail.addEventListener('click', ()=> {
    $('#summaryOutput').value = simpleSummarize(fullCombinedText(),'detailed');
  });

  const btnCreateMCQ = $('#btnCreateMCQ');
  if(btnCreateMCQ) btnCreateMCQ.addEventListener('click', ()=>{
    const m = generateSimpleMCQs(fullCombinedText(), 6);
    renderMCQs(m);
  });

  // Generate quiz button (older UI)
  const genQuiz = $('#btnGenerateQuiz');
  if(genQuiz) genQuiz.addEventListener('click', ()=>{
    const m = generateSimpleMCQs(fullCombinedText(), 6);
    renderMCQs(m);
  });

  // read aloud
  const readBtn = $('#btnReadSummary');
  if(readBtn) readBtn.addEventListener('click', ()=> {
    speakText($('#summaryOutput').value || 'Nothing to read', preferredTTSLang());
  });

  // KBC toggle
  const kbcToggle = $('#kbcToggle');
  if(kbcToggle) kbcToggle.addEventListener('change', (e)=>{
    APP.mode = e.target.checked ? 'kbc' : 'normal';
    setStatus('Mode: ' + APP.mode);
  });

  // Feedback
  const fbBtn = $('#btnSendFeedback');
  if(fbBtn) fbBtn.addEventListener('click', captureFeedback);

  // On startup, populate voices (some browsers need user gesture)
  if(window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = ()=> {
      populateVoices();
    };
    populateVoices();
  }

  // restore library from localStorage if exists
  const saved = localStorage.getItem('ssc_library_v1');
  if(saved) {
    try { APP.library = JSON.parse(saved); log('library restored'); } catch(e){}
  }

  setStatus('Ready');
}

function preferredTTSLang(){
  const sel = $('#voiceSelect');
  if(!sel) return 'en-IN';
  const v = sel.value || 'English (India)';
  if(/Hindi|हिन्दी|Hindi/i.test(v)) return 'hi-IN';
  if(/Marathi|मराठी/i.test(v)) return 'mr-IN';
  return 'en-IN';
}

function mapVoiceToOcrLang(voiceLabel){
  // map UI voice selection to OCR languages
  if(!voiceLabel) return 'eng';
  if(/Hindi|हिन्दी/i.test(voiceLabel)) return 'hin';
  if(/Marathi|मराठी/i.test(voiceLabel)) return 'mar';
  if(/Gujarati/i.test(voiceLabel)) return 'guj';
  return 'eng';
}

function populateVoices(){
  const sel = $('#voiceSelect');
  if(!sel) return;
  sel.innerHTML = '';
  const voices = window.speechSynthesis.getVoices() || [];
  const seen = new Set();
  // prefer Indian variations first
  const preferred = voices.filter(v => /IN|India|Indian|hi-|en-IN|hi-IN/i.test(v.lang + ' ' + v.name));
  const rest = voices.filter(v=>!preferred.includes(v));
  [...preferred, ...rest].forEach(v=>{
    const lab = `${v.name} (${v.lang})`;
    if(seen.has(lab)) return;
    const opt = document.createElement('option');
    opt.value = lab;
    opt.textContent = lab;
    sel.appendChild(opt);
    seen.add(lab);
  });
}

async function handleFilesSelected(files){
  setStatus('Processing files...');
  APP.lastFiles = files;
  // if zip found, try to unpack
  const zipFiles = files.filter(f => /\.zip$/i.test(f.name));
  const others = files.filter(f => !/\.zip$/i.test(f.name));
  let allFiles = [...others];
  if(zipFiles.length>0) {
    try {
      const unzipped = await unzipFiles(zipFiles[0]); // single zip for now
      allFiles = allFiles.concat(unzipped);
    } catch(e) {
      console.error('unzip failed', e);
      setStatus('ZIP unpack failed', true);
    }
  }

  // convert each file to text (pdf/text/image)
  for(const f of allFiles) {
    setStatus(`Reading ${f.name} ...`);
    try {
      const txt = await fileToText(f, APP.ocrLang);
      APP.library.push({name: f.name, text: txt, uploadedAt: Date.now()});
    } catch(err){
      console.error('file processing error', err);
      APP.library.push({name: f.name, text: '', uploadedAt: Date.now()});
    }
  }
  // persist
  localStorage.setItem('ssc_library_v1', JSON.stringify(APP.library));
  setStatus('Files processed. Ready.');
  renderLibrary();
}

/* ========= unzip helper (uses JSZip CDN) ========= */
async function unzipFiles(zipFile) {
  // load JSZip dynamically
  if(!window.JSZip) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  const jszip = window.JSZip;
  const content = await zipFile.arrayBuffer();
  const zip = await jszip.loadAsync(content);
  const files = [];
  const promises = [];
  zip.forEach((relPath, zipEntry) => {
    // only simple files
    if(zipEntry.dir) return;
    // accept pdf, txt, html, jpg, png
    if(/\.(pdf|txt|html|htm|jpg|jpeg|png)$/i.test(relPath)) {
      promises.push(zipEntry.async('blob').then(blob => {
        const f = new File([blob], relPath, {type: blob.type || 'application/octet-stream'});
        files.push(f);
      }));
    }
  });
  await Promise.all(promises);
  log('unzipped files', files.map(f=>f.name));
  return files;
}

/* ========= Render helpers ========= */
function renderLibrary(){
  const el = $('#libraryList');
  if(!el) return;
  el.innerHTML = '';
  APP.library.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = `<div class="lib-title">${item.name}</div>
                     <div class="lib-sub">${item.text && item.text.length>20 ? (item.text.slice(0,120)+'...') : '(no text)'}</div>`;
    row.addEventListener('click', ()=> {
      $('#summaryOutput').value = item.text || '(no material)';
      setStatus(`Selected ${item.name}`);
    });
    el.appendChild(row);
  });
}

/* ========= Full combined text convenience ========= */
function fullCombinedText(){
  return APP.library.map(x=>x.text || '').join('\n\n');
}

/* ========= MCQ render ========= */
function renderMCQs(list){
  const out = $('#quizOutput');
  if(!out) {
    // fallback to alert
    alert(JSON.stringify(list, null, 2));
    return;
  }
  if(!list || list.length===0) {
    out.textContent = 'Not enough material to make MCQs.';
    return;
  }
  out.innerHTML = '';
  list.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'mcq-card';
    const qEl = document.createElement('div');
    qEl.className='qtxt';
    qEl.textContent = `${i+1}. ${q.q}`;
    card.appendChild(qEl);
    const choices = document.createElement('div');
    choices.className='choices';
    q.choices.forEach((c, idx) => {
      const b = document.createElement('button');
      b.className='choice-btn';
      b.textContent = c;
      b.addEventListener('click', ()=>{
        if(c === q.answer) {
          b.style.background = '#2ecc71';
          setStatus('Correct!', false);
        } else {
          b.style.background = '#e74c3c';
          setStatus('Wrong — correct: ' + q.answer, true);
        }
      });
      choices.appendChild(b);
    });
    card.appendChild(choices);
    out.appendChild(card);
  });
}

/* ========= Feedback capture ========= */
function captureFeedback() {
  const fbText = $('#feedbackText') ? $('#feedbackText').value : prompt('Feedback:');
  if(!fbText) return;
  const arr = JSON.parse(localStorage.getItem('ssc_feedback_v1') || '[]');
  arr.push({text: fbText, at: Date.now()});
  localStorage.setItem('ssc_feedback_v1', JSON.stringify(arr));
  setStatus('Thanks for feedback — saved locally.');
}

/* ========= Small UI debug helper to create missing elements if index.html doesn't have them ========= */
function ensureUiPlaceholders(){
  if(!$('#summaryOutput')) {
    const out = document.createElement('textarea');
    out.id='summaryOutput';
    out.style.width='100%';
    out.style.height='220px';
    document.body.appendChild(out);
  }
  if(!$('#libraryList')) {
    const lib = document.createElement('div');
    lib.id='libraryList';
    lib.style.minHeight='120px';
    lib.style.border='1px dashed rgba(255,255,255,0.05)';
    document.body.appendChild(lib);
  }
  if(!$('#quizOutput')) {
    const q = document.createElement('div');
    q.id='quizOutput';
    q.style.minHeight='120px';
    document.body.appendChild(q);
  }
}

/* ========= Boot ========= */
document.addEventListener('DOMContentLoaded', ()=>{
  ensureUiPlaceholders();
  initApp();
  // Informational: if index.html lacks script includes for pdf.js or tesseract, they will be loaded lazily.
  log('App ready — DOMContentLoaded');
});

/* ========= Developer / Integration notes =========
- To enable fast offline OCR: upload tessdata/*.traineddata files to your repo root under /tessdata and set CONFIG.TESSDATA_PATH='/tessdata'.
- PDF.js is loaded lazily from CDN; if offline-first desired, bundle pdf.js and worker in /src and change CONFIG.PDFJS_* accordingly.
- The summarizer and MCQ generator are intentionally simple heuristics to be deterministic and local-only.
- For production paid gating: replace localStorage license checks with server-side license validation (fetch license from your server).
- UI expects certain ids: fileInput (input type=file), btnChooseFiles, btnProcess, voiceSelect,
  btnQuickSummary, btnDetailedSummary, btnCreateMCQ, btnGenerateQuiz, btnReadSummary, kbcToggle,
  btnSendFeedback, feedbackText, libraryList, summaryOutput, quizOutput.
  If your index.html uses different ids, either update the html or update the selectors above.
========================================= */