/* app.js - Smart Study Companion (basic) */

/* PDF.js worker setup */
if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  // CDN worker: already loaded by index.html pdf.worker.min.js
  // If required:
  // pdfjsLib.GlobalWorkerOptions.workerSrc = '...';
}

/* Simple app state */
const STATE_KEY = 'ssc_state_v1';
let STATE = {
  student: '',
  voice: 'en-IN',
  docs: [] // each: {id, name, text, sourceFileName}
};

/* Utilities */
const uid = (n=8)=>Math.random().toString(36).slice(2,2+n);
const $ = id => document.getElementById(id);

/* Save/restore state */
function saveState(){ localStorage.setItem(STATE_KEY, JSON.stringify(STATE)); }
function loadState(){
  try{
    const raw = localStorage.getItem(STATE_KEY);
    if(raw) STATE = JSON.parse(raw);
  }catch(e){ console.warn('loadState error', e) }
}

/* UI wiring */
function initUI(){
  loadState();
  $('studentName').value = STATE.student || '';
  $('voiceSelect').value = STATE.voice || 'en-IN';
  $('saveName').onclick = ()=>{
    STATE.student = $('studentName').value.trim();
    saveState();
    speak(`Hi ${STATE.student || 'there'}`, true);
    renderFileList();
  };
  $('enableVoice').onclick = ()=> {
    STATE.voice = $('voiceSelect').value;
    saveState();
    speak('Voice set to ' + STATE.voice, true);
  };
  $('processBtn').onclick = processFiles;
  $('fileInput').onchange = (e)=> {
    // no-op: process when Process clicked
  };

  // tabs
  document.querySelectorAll('.tab').forEach(b=>{
    b.onclick = ()=> {
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      b.classList.add('active');
      const tab = b.dataset.tab;
      $(tab).classList.add('active');
    };
  });

  $('quickSummary').onclick = ()=> makeSummary('quick');
  $('detailedSummary').onclick = ()=> makeSummary('detailed');
  $('readSummary').onclick = ()=> { const t = $('summaryBox').innerText||''; speak(t); };

  $('generateQuiz').onclick = ()=> generateQuiz();
  $('readQuiz').onclick = ()=> { const t = $('quizBox').innerText||''; speak(t); };

  $('backupBtn').onclick = ()=> {
    const dataStr = JSON.stringify(STATE);
    const blob = new Blob([dataStr], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ssc-backup.json'; a.click();
    URL.revokeObjectURL(url);
  };
  $('restoreBtn').onclick = ()=> $('restoreFile').click();
  $('restoreFile').onchange = (ev)=> {
    const f = ev.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = ()=> {
      try {
        STATE = JSON.parse(r.result);
        saveState();
        renderFileList();
        alert('Restored backup.');
      } catch(e){ alert('Invalid backup file'); }
    };
    r.readAsText(f);
  };

  renderFileList();
}

/* Render file list */
function renderFileList(){
  const list = $('fileList');
  list.innerHTML = '';
  if(!STATE.docs || STATE.docs.length===0){
    list.innerHTML = '<div class="note">No files yet.</div>'; return;
  }
  STATE.docs.forEach(d=>{
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<strong>${escapeHtml(d.name)}</strong><div class="note">${d.source || ''}</div>
      <div style="margin-top:8px;"><button class="btn" data-id="${d.id}" onclick="viewDoc('${d.id}')">View</button>
      <button class="btn" onclick="deleteDoc('${d.id}')">Delete</button></div>`;
    list.appendChild(div);
  });
}

/* Basic escape for display */
function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* View document */
window.viewDoc = function(id){
  const d = STATE.docs.find(x=>x.id===id);
  if(!d) return;
  // show in summaries tab
  document.querySelector('[data-tab="summaries"]').click();
  $('summaryBox').innerText = d.text || '(no text extracted)';
};

/* Delete doc */
window.deleteDoc = function(id){
  STATE.docs = STATE.docs.filter(x=>x.id!==id);
  saveState(); renderFileList();
};

/* Process files (upload input) */
async function processFiles(){
  const files = Array.from($('fileInput').files || []);
  if(files.length===0){ alert('Select files first'); return; }
  // process each file: if zip -> unpack, else handle based on extension
  for(const f of files){
    const name = f.name || 'file';
    const lower = name.toLowerCase();
    if(lower.endsWith('.zip')){
      await processZipFile(f);
    } else if(lower.endsWith('.pdf')){
      await processPdfFile(f);
    } else if(lower.endsWith('.txt') || lower.endsWith('.html') || lower.endsWith('.htm')){
      await processTextFile(f);
    } else {
      console.warn('unsupported', name);
    }
  }
  saveState();
  renderFileList();
  alert('Processing complete.');
}

/* ZIP unpack */
async function processZipFile(file){
  try{
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entries = Object.keys(zip.files);
    for(const en of entries){
      const zf = zip.files[en];
      if(zf.dir) continue;
      const lower = en.toLowerCase();
      if(lower.endsWith('.pdf')){
        const ab = await zf.async('arraybuffer');
        const blob = new Blob([ab], {type:'application/pdf'});
        await processPdfBlob(blob, en, file.name);
      } else if(lower.endsWith('.txt')){
        const txt = await zf.async('string');
        addDoc({name: en, text: txt, source: file.name});
      } else if(lower.match(/\.(html|htm)$/)){
        const txt = await zf.async('string');
        addDoc({name: en, text: stripHtml(txt), source: file.name});
      } else {
        // images etc - skip (OCR not implemented)
      }
    }
  }catch(e){ console.error('zip error', e); alert('ZIP processing error: '+e.message); }
}

/* Text file direct */
async function processTextFile(file){
  const txt = await file.text();
  addDoc({name:file.name, text: txt, source: 'local'});
}

/* PDF file direct */
async function processPdfFile(file){
  await processPdfBlob(file, file.name, file.name);
}

/* process pdf blob using pdf.js - extract text from each page */
async function processPdfBlob(blob, name, sourceName){
  try{
    const data = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({data});
    const pdf = await loadingTask.promise;
    let fullText = '';
    for(let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const texts = content.items.map(it => it.str).join(' ');
      fullText += texts + '\n\n';
    }
    addDoc({name, text: fullText, source: sourceName});
  }catch(e){
    console.error('pdf error', e);
    addDoc({name, text: '(pdf extraction failed: maybe image-based PDF; OCR not included)', source: sourceName});
  }
}

/* utility to strip html to text */
function stripHtml(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

/* add doc to state */
function addDoc({name, text, source}){
  const id = uid(8);
  STATE.docs.push({id, name, text, source});
}

/* summary: very simple heuristic */
function makeSummary(type='quick'){
  const allText = STATE.docs.map(d=>d.text||'').join('\n\n');
  if(!allText.trim()){ $('summaryBox').innerText = 'No material to summarize.'; return; }
  const sentences = splitToSentences(allText).filter(s=>s.length>20);
  if(sentences.length===0){ $('summaryBox').innerText = 'Not enough extractable text.'; return; }
  let out = '';
  if(type==='quick'){
    out = sentences.slice(0,6).join(' ');
  } else {
    // detailed: top 12 + short bullet points
    out = sentences.slice(0,12).join(' ');
  }
  $('summaryBox').innerText = out;
  speak(out, false);
}

/* simple sentence splitter */
function splitToSentences(text){
  return text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/);
}

/* quiz generation - naive: take sentences and make questions by selecting sentence and making choices from other sentences (NOT semantic) */
function generateQuiz(){
  const allText = STATE.docs.map(d=>d.text||'').join('\n\n');
  if(!allText.trim()){ $('quizBox').innerText = 'Not enough material to make MCQs.'; return; }
  const sents = splitToSentences(allText).filter(s=>s.length>30);
  if(sents.length < 4){ $('quizBox').innerText = 'Not enough material to make MCQs.'; return; }
  // pick one sentence as question text and create one correct option + 3 distractors
  const qIndex = 0; // simplest: use first long sentence
  const correct = sents[qIndex];
  const distractors = sents.slice(1,4);
  const choices = [correct, ...distractors].sort(()=>Math.random()-0.5);
  const html = `<div><b>Q:</b> ${escapeHtml(correct.slice(0,120))}...</div>
    <ol type="A">
      ${choices.map((c,i)=>`<li>${escapeHtml(c.slice(0,120))}...</li>`).join('')}
    </ol>`;
  $('quizBox').innerHTML = html;
}

/* Text-to-speech using browser SpeechSynthesis; try to pick an 'Indian' voice if available */
function speak(text, short=false){
  if(!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  // Try to choose a voice matching the desired language (STATE.voice)
  const langPref = STATE.voice || $('voiceSelect').value || 'en-IN';
  const voices = window.speechSynthesis.getVoices();
  // find voice with exact lang then fallback to contains country
  let v = voices.find(x=>x.lang && x.lang.toLowerCase() === langPref.toLowerCase());
  if(!v) v = voices.find(x=>x.lang && x.lang.toLowerCase().startsWith(langPref.split('-')[0]));
  if(!v) v = voices.find(x=>x.lang && x.lang.toLowerCase().includes('en'));
  if(v) utter.voice = v;
  utter.rate = short ? 1.05 : 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/* on load */
window.addEventListener('DOMContentLoaded', ()=> {
  initUI();
  // ensure voices loaded (some browsers load async)
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = ()=> {
      // optionally set default
    };
  }
});