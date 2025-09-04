/* app.js — Smart Study Companion (client-side)
   - Local processing only
   - Uses pdf.js for PDF text extraction and JSZip for zip unpacking
   - Simple summary and quiz generator
   - Voice via SpeechSynthesis with preference for Indian languages
*/

// ========== Utilities ==========
const $ = id => document.getElementById(id);
const humanNow = () => new Date().toLocaleString();

const log = (...args) => console.log('[SSC]', ...args);
const alertErr = msg => { alert(msg); console.error(msg); };

// ========== Local storage keys ==========
const STORAGE_LIB = 'ssc_library_v1';
const STORAGE_SETTINGS = 'ssc_settings_v1';
const STORAGE_FEEDBACK = 'ssc_feedback_v1';

// default syllabus (small placeholder) — you can expand or upload JSON
const DEFAULT_SYLLABUS = {
  "CBSE Class 10": {
    "Mathematics": ["Real Numbers","Polynomials","Pair of Linear Equations","Triangles","Coordinate Geometry","Trigonometry","Circles","Constructions","Areas","Probability","Statistics"],
    "Science": ["Chemical Reactions","Acids,Bases & Salts","Metals & Non-metals","Carbon & its compounds","Periodic Classification","Life processes","Heredity","Light","Electricity","Magnetism"],
    "Social Science": ["Nationalism in India","The Rise of Nationalism in Europe","Industrialization","Agrarian Change","The Making of a Global World","Resources and Development"]
  }
};

// minimal app state
const STATE = {
  library: {}, // {collectionName: {items: [ {id,filename,type,text,subject,chapter} ], meta: {}}}
  currentCollection: 'CBSE Class 10',
  voices: [],
  settings: {
    studentName: '',
    voiceLang: 'en-IN',
    ownerEmail: ''
  }
};

// ========== Init & DOM wiring ==========
window.addEventListener('DOMContentLoaded', initApp);

async function initApp(){
  // load settings & library
  loadSettings();
  loadLibrary();

  // voice setup
  await loadVoices();

  // DOM wiring
  $('saveNameBtn').addEventListener('click', saveName);
  $('setCollectionBtn').addEventListener('click', setCollection);
  $('fileInput').addEventListener('change', onFilesSelected);
  $('processBtn').addEventListener('click', processSelectedFiles);

  // tabs
  $('tabLibrary').addEventListener('click', ()=>showPanel('panelLibrary'));
  $('tabSummaries').addEventListener('click', ()=>showPanel('panelSummaries'));
  $('tabQuiz').addEventListener('click', ()=>showPanel('panelQuiz'));
  $('tabManage').addEventListener('click', ()=>showPanel('panelManage'));
  $('tabSyllabus').addEventListener('click', ()=>showPanel('panelSyllabus'));
  $('tabFeedback').addEventListener('click', ()=>showPanel('panelFeedback'));
  $('tabHelp').addEventListener('click', ()=>showPanel('panelHelp'));

  // summary / quiz / manage wiring
  $('quickSummaryBtn').addEventListener('click', ()=>createSummary('quick'));
  $('detailedSummaryBtn').addEventListener('click', ()=>createSummary('detailed'));
  $('readSummaryBtn').addEventListener('click', ()=>speakText($('summaryBox').value));
  $('copySummaryBtn').addEventListener('click', ()=>copyText($('summaryBox').value));

  $('generateQuizBtn').addEventListener('click', ()=>generateQuiz());
  $('readQuizBtn').addEventListener('click', ()=>speakText($('quizBox').innerText));
  $('copyQuizBtn').addEventListener('click', ()=>copyText($('quizBox').innerText));

  $('backupBtn').addEventListener('click', backupLibrary);
  $('restoreBtn').addEventListener('click', restoreLibraryFromFile);
  $('clearLibBtn').addEventListener('click', clearLibraryConfirmed);

  $('sendFeedbackBtn').addEventListener('click', saveFeedback);

  // voice selection
  $('toggleVoiceBtn').addEventListener('click', toggleVoiceEnabled);
  $('voiceSelect').value = STATE.settings.voiceLang;
  $('voiceSelect').addEventListener('change', ()=>{
    STATE.settings.voiceLang = $('voiceSelect').value;
    saveSettings();
  });

  // syllabus area
  $('syllabusBox').value = JSON.stringify(DEFAULT_SYLLABUS, null, 2);

  // UI initial
  $('currentCollectionLabel').innerText = STATE.currentCollection;
  $('studentName').value = STATE.settings.studentName || '';
  $('feedbackEmail').value = STATE.settings.ownerEmail || '';
  refreshLibraryUI();
  refreshFeedbackUI();
}

// ========== Settings / Storage ==========
function loadSettings(){
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if(raw) {
      STATE.settings = JSON.parse(raw);
      if(STATE.settings.currentCollection) STATE.currentCollection = STATE.settings.currentCollection;
    }
  } catch(e){ console.error('loadSettings', e); }
}

function saveSettings(){
  STATE.settings.currentCollection = STATE.currentCollection;
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(STATE.settings));
}

function loadLibrary(){
  try {
    const raw = localStorage.getItem(STORAGE_LIB);
    if(raw) {
      STATE.library = JSON.parse(raw);
      if(STATE.library && Object.keys(STATE.library).length > 0){
        // keep current collection if present
        if(!STATE.library[STATE.currentCollection]){
          const keys = Object.keys(STATE.library);
          STATE.currentCollection = keys[0];
        }
      }
    } else {
      // initialize
      STATE.library = {};
      STATE.library[STATE.currentCollection] = {items: [], meta:{}};
      saveLibrary();
    }
  } catch(e){
    console.error('loadLibrary', e);
    STATE.library = {};
    STATE.library[STATE.currentCollection] = {items: [], meta:{}};
    saveLibrary();
  }
}

function saveLibrary(){
  localStorage.setItem(STORAGE_LIB, JSON.stringify(STATE.library));
}

function backupLibrary(){
  const data = JSON.stringify(STATE.library, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ssc_backup_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function restoreLibraryFromFile(){
  const input = $('restoreFile');
  if(!input.files || input.files.length === 0) { alert('Choose a backup JSON file first'); return; }
  const f = input.files[0];
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      STATE.library = data;
      saveLibrary();
      loadLibrary();
      refreshLibraryUI();
      alert('Library restored locally.');
    } catch(err){
      alertErr('Invalid JSON file for restore');
    }
  };
  reader.readAsText(f);
}

function clearLibraryConfirmed(){
  if(confirm('Delete entire local library? This cannot be undone.')) {
    STATE.library = {};
    STATE.currentCollection = 'CBSE Class 10';
    STATE.library[STATE.currentCollection] = {items: [], meta:{}};
    saveLibrary();
    refreshLibraryUI();
    alert('Library cleared.');
  }
}

// ========== Voice setup ==========
async function loadVoices(){
  return new Promise(resolve=>{
    const synth = window.speechSynthesis;
    function setVoices(){
      const voices = synth.getVoices();
      STATE.voices = voices;
      populateVoiceSelect();
      resolve(voices);
    }
    setTimeout(()=>{ if(synth.getVoices().length) setVoices(); }, 50);
    synth.onvoiceschanged = setVoices;
  });
}

function populateVoiceSelect(){
  const sel = $('voiceSelect');
  // keep options same; but select matched actual voice if present
  const pref = STATE.settings.voiceLang || 'en-IN';
  const found = STATE.voices.find(v => v.lang && v.lang.toLowerCase().startsWith(pref.toLowerCase()));
  if(found) {
    // nothing to do in select; just remember
  }
}

function speakText(text, langHint){
  if(!text || text.trim().length===0) return;
  const synth = window.speechSynthesis;
  if(!synth) return alert('Speech not supported in this browser');

  const utter = new SpeechSynthesisUtterance();
  utter.text = text;
  const prefLang = STATE.settings.voiceLang || $('voiceSelect').value || 'en-IN';
  utter.lang = prefLang;

  // pick a voice that matches language
  let v = STATE.voices.find(x => x.lang && x.lang.toLowerCase().startsWith(prefLang.toLowerCase()));
  if(!v){
    // fallback: choose any english or the first
    v = STATE.voices.find(x => x.lang && x.lang.toLowerCase().startsWith('en')) || STATE.voices[0];
  }
  if(v) utter.voice = v;
  utter.rate = 0.95;
  utter.pitch = 1.0;
  synth.cancel(); // stop previous
  synth.speak(utter);
}

// toggle quick on/off (button text)
function toggleVoiceEnabled(){
  const btn = $('toggleVoiceBtn');
  if(btn.dataset.enabled === '1'){
    btn.dataset.enabled = '0'; btn.innerText = 'Enable';
    STATE.settings.voiceEnabled = false;
  } else {
    btn.dataset.enabled = '1'; btn.innerText = 'Disable';
    STATE.settings.voiceEnabled = true;
  }
  saveSettings();
}

// ========== Files selection & processing ==========
let SELECTED_FILES = []; // FileList -> Array

function onFilesSelected(e){
  SELECTED_FILES = Array.from(e.target.files || []);
  renderSelectedFiles();
}

function renderSelectedFiles(){
  const node = $('fileList');
  if(!SELECTED_FILES || SELECTED_FILES.length===0){ node.innerText = 'No files yet.'; return; }
  node.innerHTML = '';
  SELECTED_FILES.forEach(f=>{
    const div = document.createElement('div');
    div.className = 'file-row';
    const left = document.createElement('div'); left.innerText = f.name;
    const right = document.createElement('div'); right.innerHTML = `<span class="muted">${(f.size/1024|0)} KB</span>`;
    div.appendChild(left); div.appendChild(right);
    node.appendChild(div);
  });
}

// Process files button
async function processSelectedFiles(){
  if(!SELECTED_FILES || SELECTED_FILES.length===0) { alert('Choose files first'); return; }

  // size check
  let total = SELECTED_FILES.reduce((s,f)=>s+f.size, 0);
  if(total > 500 * 1024 * 1024) {
    if(!confirm(`Selected files total ${(total/1024/1024).toFixed(1)} MB — exceeds 500 MB. Continue?`)) return;
  }

  // ensure collection exists
  if(!STATE.library[STATE.currentCollection]) STATE.library[STATE.currentCollection] = {items:[],meta:{}};

  // iterate files (ZIP unpack if necessary)
  for(const f of SELECTED_FILES){
    const name = f.name.toLowerCase();
    if(name.endsWith('.zip')){
      await processZipFile(f);
    } else if(name.endsWith('.pdf')){
      await processPdfFile(f);
    } else if(name.endsWith('.txt') || name.endsWith('.md')){
      await processTextFile(f);
    } else if(name.endsWith('.html') || name.endsWith('.htm')){
      await processHtmlFile(f);
    } else if(/\.(jpg|jpeg|png)$/i.test(name)){
      // optional: image -> OCR not included (heavy). store as metadata only
      await storeFileItem({filename:f.name, type:'image', text:'[image file - OCR not performed]', rawFile: null});
    } else {
      await storeFileItem({filename:f.name, type:'other', text:'[unsupported filetype]', rawFile: null});
    }
  }

  saveLibrary();
  refreshLibraryUI();
  alert('Processing complete (local). Check Library.');
}

// ZIP processing
async function processZipFile(file){
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entries = Object.keys(zip.files);
    for(const entryName of entries){
      const entry = zip.files[entryName];
      if(entry.dir) continue;
      const lower = entryName.toLowerCase();
      if(lower.endsWith('.pdf')){
        const content = await entry.async('uint8array');
        // create blob to pass to pdf routine
        const blob = new Blob([content], {type:'application/pdf'});
        await processPdfBlob(blob, entryName);
      } else if(lower.endsWith('.txt') || lower.endsWith('.md')){
        const txt = await entry.async('string');
        await storeFileItem({filename:entryName, type:'text', text:txt, rawFile:null});
      } else if(lower.endsWith('.html') || lower.endsWith('.htm')){
        const txt = await entry.async('string');
        await storeFileItem({filename:entryName, type:'html', text:txt, rawFile:null});
      } else {
        // skip other inside zip or add placeholder
        await storeFileItem({filename:entryName, type:'other', text:'[in zip - unsupported]', rawFile:null});
      }
    }
  } catch(e){
    console.error('processZipFile', e);
    alertErr('Error unpacking ZIP: ' + e.message);
  }
}

// PDF processing (File object)
async function processPdfFile(file){
  const blob = new Blob([await file.arrayBuffer()], {type:'application/pdf'});
  await processPdfBlob(blob, file.name);
}

async function processPdfBlob(blob, filename){
  try {
    // Use pdf.js to extract text from all pages
    const arr = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data:arr}).promise;
    let fullText = '';
    for(let i=1;i<=pdf.numPages;i++){
      const page = await pdf.getPage(i);
      const txtContent = await page.getTextContent();
      const pageText = txtContent.items.map(it => it.str).join(' ');
      fullText += '\n' + pageText;
    }
    await storeFileItem({filename, type:'pdf', text: fullText, rawFile: null});
  } catch(err){
    console.error('processPdfBlob', err);
    await storeFileItem({filename, type:'pdf', text:'[PDF text extraction failed]', rawFile: null});
  }
}

async function processTextFile(file){
  const txt = await file.text();
  await storeFileItem({filename:file.name, type:'text', text: txt, rawFile: null});
}

async function processHtmlFile(file){
  const txt = await file.text();
  // crude: strip tags
  const stripped = txt.replace(/<[^>]*>/g, ' ');
  await storeFileItem({filename:file.name, type:'html', text: stripped, rawFile: null});
}

// store extracted item into library with auto-grouping
async function storeFileItem({filename, type='text', text='', rawFile=null}){
  // basic id
  const id = 'it_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  // determine subject/chapter heuristics
  const grouping = autoGroupByFilename(filename, text);
  const item = {id, filename, type, text, subject: grouping.subject, chapter: grouping.chapter, added: humanNow()};
  STATE.library[STATE.currentCollection].items.push(item);
  log('Stored', filename, '->', grouping);
}

// very simple auto-group heuristics: try to match syllabus titles in text or filename
function autoGroupByFilename(filename, text){
  const cls = STATE.currentCollection || 'CBSE Class 10';
  let subj='Unknown', chap='Unknown';
  try {
    const syllabus = JSON.parse($('syllabusBox').value || JSON.stringify(DEFAULT_SYLLABUS));
    const classMap = syllabus[cls] || {};
    const joined = (filename + ' ' + (text||'')).toLowerCase();

    // search subjects by keywords in joined text
    for(const s of Object.keys(classMap)){
      if(joined.indexOf(s.toLowerCase()) !== -1){
        subj = s;
        // try chapters within subject
        for(const ch of classMap[s]){
          if(joined.indexOf(ch.toLowerCase()) !== -1){
            chap = ch; break;
          }
        }
        if(chap === 'Unknown'){
          // fallback: first chapter
          chap = classMap[s][0] || 'Unknown';
        }
        break;
      }
    }

    // if no subject found, try matching chapter names across all subjects
    if(subj==='Unknown'){
      for(const s of Object.keys(classMap)){
        for(const ch of classMap[s]){
          if(joined.indexOf(ch.toLowerCase()) !== -1){
            subj = s; chap = ch; break;
          }
        }
        if(subj!=='Unknown') break;
      }
    }

    // if still unknown, use filename tokens (e.g., "Math", "Science", "Social")
    if(subj==='Unknown'){
      if(/math/i.test(filename)) subj='Mathematics';
      else if(/science/i.test(filename)) subj='Science';
      else if(/social/i.test(filename) || /history/i.test(filename) || /geo/i.test(filename)) subj='Social Science';
    }
  } catch(e){ console.error('autoGroup error', e); }

  return {subject: subj, chapter: chap};
}

// ========== UI: library rendering ==========
function refreshLibraryUI(){
  const node = $('libList');
  node.innerHTML = '';
  const col = STATE.library[STATE.currentCollection];
  if(!col || !col.items || col.items.length===0){ node.innerText = 'Add files to see them here.'; return; }

  // show table rows
  col.items.forEach(it=>{
    const div = document.createElement('div');
    div.className = 'file-row';
    div.innerHTML = `<div>
        <strong style="color:#cfe7ff">${it.filename}</strong><div class="muted">${it.subject} — ${it.chapter}</div>
      </div>
      <div class="muted">${it.added}</div>`;
    node.appendChild(div);
  });
}

// ========== Summaries ==========
function createSummary(mode='quick'){
  const col = STATE.library[STATE.currentCollection];
  if(!col || !col.items || col.items.length===0) return alert('No files in library');

  // merge text from all items in collection
  const allText = col.items.map(i=>i.text||'').join('\n\n');
  if(!allText || allText.trim().length===0) return alert('No text extracted from files yet');

  if(mode==='quick'){
    $('summaryBox').value = quickExtractiveSummary(allText, 6);
  } else {
    $('summaryBox').value = quickExtractiveSummary(allText, 14);
  }
}

// VERY simple extractive summary: pick top N sentences by length/keywords
function quickExtractiveSummary(text, numSentences=6){
  const sents = text.split(/(?<=[.?!])\s+/).filter(s=>s.trim().length>30);
  if(sents.length===0) return 'Could not extract meaningful sentences from uploaded files.';
  // score by length + presence of numbers/keywords
  const keywords = ['chapter','chapter','chapter','important','define','is','are','the','in','with','which'];
  const scored = sents.map(s=>{
    const l = s.length;
    let score = Math.log(1+l);
    for(const k of keywords) if(s.toLowerCase().includes(k)) score+=0.5;
    if(/\d/.test(s)) score+=0.6;
    return {s,score};
  });
  scored.sort((a,b)=>b.score - a.score);
  return scored.slice(0,numSentences).map(x=>x.s.trim()).join('\n\n');
}

// ========== Quiz generator ==========
function generateQuiz(){
  const col = STATE.library[STATE.currentCollection];
  if(!col || !col.items || col.items.length===0) return alert('No files in library');

  const allText = col.items.map(i=>i.text||'').join('\n\n');
  const type = $('quizType').value;

  if(type==='mcq'){
    const mcqs = generateMCQsFromText(allText, 5);
    renderMCQs(mcqs);
  } else if(type==='tf'){
    const tfs = generateTFsFromText(allText, 8);
    renderTFs(tfs);
  } else {
    const shorts = generateShortsFromText(allText, 6);
    renderShorts(shorts);
  }
}

function generateMCQsFromText(text, count=5){
  // pick sentences which contain facts (crude: sentences with colon or 'is' and length)
  const sents = text.split(/(?<=[.?!])\s+/).filter(s=>s.trim().length>40);
  const candidates = sents.filter(s=>/\bis\b|\bare\b|\bwas\b|\bconsist\b|\binclude\b/i.test(s));
  const out = [];
  for(let i=0;i<Math.min(count,candidates.length);i++){
    const q = candidates[i].trim();
    // create question by replacing verb phrase to make blank (naive)
    const parts = q.split(/\b(is|are|was|were|consists of|include|includes|includes)\b/i);
    let stem = q;
    let answer = '';
    if(parts.length>1){
      stem = parts[0] + ' ____ ' + (parts.slice(2).join(' '));
      answer = parts[2] ? parts[2].split(/[.,;] /)[0] : '';
    } else {
      // fallback
      stem = q.split('. ')[0] + '?';
      answer = q.split('.')[0];
    }
    // build 3 wrong options by grabbing other sentence fragments
    const wrong = [];
    for(let j=0;j<6 && wrong.length<3;j++){
      if(j===i) continue;
      const c = sents[j];
      if(!c) continue;
      const fragment = c.split(/[.,;]/)[0];
      if(fragment && fragment!==answer && !wrong.includes(fragment)) wrong.push(fragment);
    }
    // if not enough wrongs, use shuffled words
    while(wrong.length<3) wrong.push(answer.split(' ').slice(0,3).join(' '));
    const choices = [answer].concat(wrong).slice(0,4);
    // shuffle choices
    for (let k = choices.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [choices[k], choices[r]] = [choices[r], choices[k]];
    }
    out.push({stem,answer,choices});
  }
  return out;
}

function renderMCQs(mcqs){
  const box = $('quizBox');
  if(!mcqs || mcqs.length===0){ box.innerText = 'No MCQs could be generated.'; return; }
  box.innerHTML = '';
  mcqs.forEach((m, idx)=>{
    const div = document.createElement('div');
    div.style.marginBottom = '12px';
    div.innerHTML = `<div style="font-weight:600;color:#dbefff">Q${idx+1}. ${m.stem}</div>`;
    m.choices.forEach((c,ci)=>{
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.marginRight='6px';
      btn.innerText = c;
      btn.addEventListener('click', ()=> {
        if(c===m.answer) { btn.style.background = '#27ae60'; alert('Correct!'); }
        else { btn.style.background = '#e85a5a'; alert('Incorrect. Correct: ' + m.answer); }
      });
      div.appendChild(btn);
    });
    box.appendChild(div);
  });
}

function generateTFsFromText(text, n=8){
  const sents = text.split(/(?<=[.?!])\s+/).filter(s=>s.trim().length>40);
  const out = [];
  for(let i=0;i<Math.min(n,sents.length);i++){
    const st = sents[i].trim();
    const truth = Math.random()>0.3; // naive randomize
    const stmt = truth ? st : randomizeSentence(st);
    out.push({stmt,answer:truth});
  }
  return out;
}

function randomizeSentence(s){
  // naive: reorder subject/object by splitting at 'is'
  if(s.indexOf(' is ')!==-1){
    const parts = s.split(' is ');
    return parts[1].split(' ')[0] + ' is ' + parts[0];
  }
  return s.split(' ').reverse().join(' ');
}

function renderTFs(tfs){
  const box = $('quizBox');
  if(!tfs || tfs.length===0) { box.innerText='No TFs'; return; }
  box.innerHTML = '';
  tfs.forEach((q,idx)=>{
    const div = document.createElement('div'); div.style.marginBottom='8px';
    const p = document.createElement('div'); p.innerHTML = `<strong>Q${idx+1}.</strong> ${q.stmt}`;
    const bT = document.createElement('button'); bT.className='btn'; bT.innerText='True'; bT.addEventListener('click', ()=>{ alert(q.answer ? 'Correct' : 'Incorrect'); });
    const bF = document.createElement('button'); bF.className='btn'; bF.innerText='False'; bF.addEventListener('click', ()=>{ alert(!q.answer ? 'Correct' : 'Incorrect'); });
    div.appendChild(p); div.appendChild(bT); div.appendChild(bF);
    box.appendChild(div);
  });
}

function generateShortsFromText(text, n=6){
  const sents = text.split(/(?<=[.?!])\s+/).filter(s=>s.trim().length>50);
  return sents.slice(0,n).map(s=>({q: s.split(/[.?!]/)[0] + '?', a:s.split('.')[0]}));
}

function renderShorts(shorts){
  const box = $('quizBox');
  if(!shorts || shorts.length===0){ box.innerText='No short questions'; return; }
  box.innerHTML = '';
  shorts.forEach((s, idx)=>{
    const div = document.createElement('div'); div.innerHTML = `<div style="font-weight:600">Q${idx+1}. ${s.q}</div><div style="color:var(--muted)">Answer hidden — student types it out</div>`;
    box.appendChild(div);
  });
}

// ========== Feedback ==========
function saveFeedback(){
  const txt = $('feedbackText').value.trim();
  if(!txt) return alert('Write feedback first');
  const fb = JSON.parse(localStorage.getItem(STORAGE_FEEDBACK) || '[]');
  fb.push({text:txt,ts:humanNow()});
  localStorage.setItem(STORAGE_FEEDBACK, JSON.stringify(fb));
  $('feedbackText').value = '';
  refreshFeedbackUI();
  alert('Feedback saved locally.');
}

function refreshFeedbackUI(){
  const fb = JSON.parse(localStorage.getItem(STORAGE_FEEDBACK) || '[]');
  const node = $('feedbackList');
  node.innerHTML = '';
  if(fb.length===0){ node.innerText = 'No feedback yet.'; return; }
  fb.reverse().forEach(item=>{
    const d = document.createElement('div'); d.style.padding='6px 4px';
    d.innerHTML = `<div style="font-weight:600">${item.ts}</div><div class="muted">${item.text}</div>`;
    node.appendChild(d);
  });
}

// ========== Helpers ==========
function showPanel(id){
  const panels = ['panelLibrary','panelSummaries','panelQuiz','panelManage','panelSyllabus','panelFeedback','panelHelp'];
  panels.forEach(p=> $(p).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function copyText(txt){
  navigator.clipboard?.writeText(txt).then(()=> alert('Copied to clipboard'), ()=> alert('Copy failed'));
}

// ========== Name / collection ==========
function saveName(){
  const nm = $('studentName').value.trim();
  STATE.settings.studentName = nm;
  saveSettings();
  alert('Name saved');
}

function setCollection(){
  const coll = $('collectionName').value.trim() || 'CBSE Class 10';
  STATE.currentCollection = coll;
  if(!STATE.library[coll]) STATE.library[coll] = {items:[],meta:{}};
  $('currentCollectionLabel').innerText = coll;
  saveSettings();
  saveLibrary();
  refreshLibraryUI();
}

// ========== Init end ==========
log('App script loaded');