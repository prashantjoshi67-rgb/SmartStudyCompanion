/* app.js - Smart Study Companion (lightweight, offline-capable) */
/* Required CDNs are loaded from index.html (pdf.js, JSZip, Tesseract) */

const FULL_LICENSE_KEY = "FULL-ACCESS"; // set to requested master key

// Simple state held in memory + localStorage
const STATE = {
  name: localStorage.getItem('ssc_name') || '',
  collection: localStorage.getItem('ssc_collection') || 'Default',
  voice: localStorage.getItem('ssc_voice') || 'en-IN',
  files: [], // {name, text, rawFile}
  syllabusMap: null
};

// helpers
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function info(msg){ showToast(msg); console.log('[INFO]',msg); }
function error(msg){ showToast(msg, true); console.error('[ERR]',msg); }

function showToast(msg, isError=false){
  const el = qs('.notice');
  if(!el) return;
  el.textContent = msg;
  el.style.border = isError ? '1px solid rgba(212,85,85,0.12)' : '1px solid rgba(255,255,255,0.02)';
}

// save/load
function saveProfile(){
  STATE.name = $('nameInput').value.trim();
  localStorage.setItem('ssc_name', STATE.name);
  showToast(`Saved name: ${STATE.name||'anonymous'}`);
}
function saveCollection(){
  STATE.collection = $('collectionInput').value.trim()||'Default';
  localStorage.setItem('ssc_collection', STATE.collection);
  showToast(`Collection set: ${STATE.collection}`);
}
function saveVoice(){
  STATE.voice = $('voiceSelect').value;
  localStorage.setItem('ssc_voice', STATE.voice);
  showToast(`Voice: ${STATE.voice}`);
}

// UI updates
function renderLibrary(){
  const container = $('fileList');
  container.innerHTML = '';
  if(STATE.files.length===0){
    container.innerHTML = `<div class="notice">Add files (PDF/TXT/HTML or ZIP) and press Process.</div>`;
    return;
  }
  for(const f of STATE.files){
    const row = document.createElement('div'); row.className='row-item';
    const left = document.createElement('div'); left.innerHTML = `<div style="font-weight:600">${escapeHtml(f.name)}</div><div class="meta">${escapeHtml(f.subject||'General')} — ${escapeHtml(f.chapter||'Overview')}</div>`;
    const right = document.createElement('div'); right.innerHTML = `<button class="btn" onclick="viewText('${f.id}')">Open</button>`;
    row.appendChild(left); row.appendChild(right); container.appendChild(row);
  }
}

function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

// View text
window.viewText = function(id){
  const f = STATE.files.find(x=>x.id===id);
  if(!f) return error('File not found');
  $('output').value = f.text || '(no text)';
  $('tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  $('tab-summaries').classList.add('active');
}

// File processing pipeline
async function processSelectedFiles(fileInput){
  const files = fileInput.files;
  if(!files || files.length===0) return error('No files selected');
  showToast('Processing files — this can take time for big uploads...');
  // reset
  STATE.files = [];
  renderLibrary();

  for(const file of files){
    const name = file.name;
    if(name.toLowerCase().endsWith('.zip')){
      await handleZip(file);
    } else {
      await handleSingleFile(file);
    }
  }
  renderLibrary();
  showToast('Processing complete. Open a file to create summaries or quizzes.');
}

async function handleZip(zipFile){
  try{
    const arrayBuffer = await zipFile.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const tasks = [];
    zip.forEach((relativePath, zipEntry)=>{
      if(zipEntry.dir) return;
      // only handle PDF, txt, html, jpg, png inside zip
      const ext = relativePath.split('.').pop().toLowerCase();
      if(['pdf','txt','html','htm','jpg','jpeg','png'].includes(ext)){
        tasks.push(zipEntry.async('blob').then(b => {
          const f = new File([b], relativePath, {type: b.type});
          return handleSingleFile(f);
        }));
      }
    });
    await Promise.all(tasks);
  } catch(err){
    console.error(err);
    error('ZIP processing failed: '+err.message);
  }
}

async function handleSingleFile(file){
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  const id = Math.random().toString(36).slice(2,10);
  const meta = { id, name: file.name, rawFile: null, text: '', subject:'General', chapter:'' };

  if(ext==='txt'){
    const txt = await file.text();
    meta.text = txt;
    meta.rawFile = file;
    STATE.files.push(meta);
    return;
  }
  if(['html','htm'].includes(ext)){
    const txt = await file.text();
    meta.text = stripTags(txt);
    meta.rawFile = file;
    STATE.files.push(meta);
    return;
  }
  if(['jpg','jpeg','png'].includes(ext)){
    // run OCR on image
    const txt = await runOCR(file);
    meta.text = txt;
    meta.rawFile = file;
    STATE.files.push(meta);
    return;
  }
  if(ext==='pdf'){
    // try PDF.js text extraction first
    try{
      const txt = await extractTextFromPDF(file);
      if(txt && txt.trim().length>20){
        meta.text = txt;
        meta.rawFile = file;
        STATE.files.push(meta);
        return;
      } else {
        // fallback: use OCR on pages (slower)
        const txt2 = await ocrPdfFallback(file);
        meta.text = txt2 || '(no text extracted)';
        meta.rawFile = file;
        STATE.files.push(meta);
        return;
      }
    } catch(err){
      console.error(err);
      const txt2 = await ocrPdfFallback(file);
      meta.text = txt2 || '(no text extracted)';
      meta.rawFile = file;
      STATE.files.push(meta);
      return;
    }
  }
  // unknown
  meta.text = '(unsupported file type)';
  STATE.files.push(meta);
}

// PDF extraction using PDF.js (fast if text-based)
async function extractTextFromPDF(file){
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const loadingTask = pdfjsLib.getDocument({data:uint8});
  const pdf = await loadingTask.promise;
  let fullText = '';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(i=>i.str).join(' ');
    fullText += '\n\n' + strings;
  }
  return fullText.trim();
}

// If PDF extraction fails (image-based), run OCR per page (heavy)
async function ocrPdfFallback(file){
  showToast('PDF extraction failed: using OCR fallback (slow).');
  // convert PDF pages to images via PDF.js canvas render, then OCR
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({data:new Uint8Array(arrayBuffer)});
  const pdf = await loadingTask.promise;
  const worker = await Tesseract.createWorker({
    logger: m => console.log(m),
  });
  // default languages: english (can be expanded by user)
  const lang = $('ocrLang') ? $('ocrLang').value : 'eng';
  await worker.load(); await worker.loadLanguage(lang); await worker.initialize(lang);
  let txt = '';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({scale:1.5});
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({canvasContext:ctx,viewport}).promise;
    const blob = await new Promise(res=>canvas.toBlob(res,'image/png'));
    const {data:{text}} = await worker.recognize(blob);
    txt += '\n\n' + text;
    // free canvas
    canvas.width = canvas.height = 0;
  }
  await worker.terminate();
  return txt.trim();
}

async function runOCR(file){
  const worker = await Tesseract.createWorker({ logger: m => console.log(m) });
  const lang = $('ocrLang') ? $('ocrLang').value : 'eng';
  await worker.load(); await worker.loadLanguage(lang); await worker.initialize(lang);
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return text;
}

function stripTags(html){ return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<\/?[^>]+(>|$)/g,""); }

// SUMMARY (extractive - top sentences by word frequency)
function generateSummary(text, maxSentences=4){
  if(!text || text.trim().length<40) return '(no material)';
  // split into sentences
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || text.split('\n').filter(Boolean);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/gi,' ').split(/\s+/).filter(Boolean);
  const stop = new Set(['the','is','and','to','in','of','a','that','it','for','with','as','are','on','this','by','an','be','or','we','will','can']);
  const freq = {};
  for(const w of words) if(!stop.has(w)) freq[w] = (freq[w]||0)+1;
  const scoreSentence = s => {
    const ws = s.toLowerCase().replace(/[^a-z0-9\s]/gi,' ').split(/\s+/).filter(Boolean);
    let sc = 0;
    for(const w of ws) if(freq[w]) sc += freq[w];
    return sc / Math.max(1, ws.length);
  };
  const scored = sentences.map(s=>({s,sc:scoreSentence(s)}));
  scored.sort((a,b)=>b.sc - a.sc);
  const top = scored.slice(0, Math.min(maxSentences, scored.length)).map(x=>x.s.trim());
  return top.join(' ');
}

// QUIZ (naive MCQ generator: pick a sentence with a noun and blank a keyword)
function generateMCQsFromText(text, count=5){
  if(!text || text.trim().length<80) return [];
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || text.split('\n').filter(Boolean);
  const picks = [];
  for(const s of sentences){
    if(s.split(' ').length<6) continue;
    // naive keyword: longest word >5 chars
    const words = s.replace(/[^a-zA-Z0-9\s]/g,'').split(/\s+/).filter(Boolean);
    const candidate = words.sort((a,b)=>b.length-a.length)[0];
    if(candidate && candidate.length>5){
      const question = s.replace(candidate, '_____');
      const options = [candidate, candidate.split('').reverse().join(''), candidate.slice(0,Math.max(3,Math.floor(candidate.length/2))), 'None of these'];
      // shuffle
      for(let i=options.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1)); [options[i],options[j]]=[options[j],options[i]];
      }
      picks.push({q:question.trim(), options, answer: candidate});
    }
    if(picks.length>=count) break;
  }
  return picks;
}

// Read aloud using WebSpeechSynthesis
function speakText(text){
  if(!text) return;
  const voiceTag = STATE.voice || 'en-IN';
  const utter = new SpeechSynthesisUtterance(text);
  // choose a matching voice if available
  const voices = speechSynthesis.getVoices() || [];
  let v = voices.find(x=>x.lang && x.lang.toLowerCase().includes(voiceTag.toLowerCase()));
  if(!v) v = voices.find(x=>x.name && x.name.toLowerCase().includes('india')) || voices[0];
  if(v) utter.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

// UI handlers for summary/quiz
$('generateSummaryBtn')?.addEventListener('click', ()=>{
  const out = $('output');
  const text = out.value || '';
  const sum = generateSummary(text, 4);
  out.value = sum;
});
$('generateQuizBtn')?.addEventListener('click', ()=>{
  const out = $('output');
  const text = out.value || '';
  const mcqs = generateMCQsFromText(text, 5);
  if(mcqs.length===0){ out.value = 'Not enough content to generate MCQs.'; return; }
  let s='';
  mcqs.forEach((m,i)=>{
    s += `${i+1}. ${m.q}\n`;
    m.options.forEach((o,j)=> s+= `   ${String.fromCharCode(65+j)}. ${o}\n`);
    s += `Answer: ${m.answer}\n\n`;
  });
  out.value = s;
});
$('readBtn')?.addEventListener('click', ()=>{
  const text = $('output').value;
  speakText(text);
});

// hookup UI file input buttons (index.html has these IDs)
window.initApp = function(){
  // restore profile
  $('nameInput').value = STATE.name;
  $('collectionInput').value = STATE.collection;
  $('voiceSelect').value = STATE.voice;
  renderLibrary();
  // file chooser
  $('chooseFilesBtn').addEventListener('change', async (e)=>{
    await processSelectedFiles(e.target);
  });
  $('processBtn').addEventListener('click', ()=>{
    // If user selected files via input, processing was auto; this button can be used to re-process
    const inp = $('chooseFilesBtn');
    if(inp.files.length===0) return error('Choose files first');
    processSelectedFiles(inp);
  });

  // save buttons
  $('saveNameBtn').addEventListener('click', saveProfile);
  $('setCollectionBtn').addEventListener('click', saveCollection);
  $('voiceSaveBtn').addEventListener('click', saveVoice);

  // quick voice init (populate voices)
  setTimeout(()=>{ speechSynthesis.getVoices(); }, 500);
};

// simple file ID helper when saving from handleSingleFile
function addFileToState(meta){
  STATE.files.push(meta);
  renderLibrary();
}

// small helper to create elements for each file
// but we used renderLibrary earlier

// expose some functions for debugging
window._STATE = STATE;
window.generateSummary = generateSummary;
window.generateMCQsFromText = generateMCQsFromText;