// Smart Study Companion - app.js
// Local-first app: summaries, quizzes, OCR, voice, targets, badges, license gating, feedback, backup/restore

// === CONFIG ===
const DEV_EMAIL = "your-email@example.com"; // change for feedback
const DEMO_FEATURES = {
  ocr: false,              // disable OCR in demo
  maxUploadMB: 50,         // demo upload limit
  voice: true,
  kbcMode: true
};
const DEMO_LICENSE_KEY = "FULLACCESS123";

// === STATE ===
const STATE = {
  lib: [], // {id, name, subject, chapter, text}
  user: { name:"", voice:"", license:"", dailyTarget:20, todayCount:0, streak:0, badges:[] },
  licenseValid: false
};

// === HELPERS ===
const $ = id => document.getElementById(id);
const uid = ()=> Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const saveState = ()=> localStorage.setItem("ssc_state_v1", JSON.stringify(STATE));
const loadState = ()=> { const s=localStorage.getItem("ssc_state_v1"); if(s) Object.assign(STATE, JSON.parse(s)); };
function escapeHtml(s){ return (s||"").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// === INIT ===
window.addEventListener("DOMContentLoaded", ()=>{
  loadState(); hookUI(); renderAll(); populateVoices();
  if(STATE.user.voice) $("voiceSelect").value = STATE.user.voice;
});

// === UI WIRING ===
function hookUI(){
  $("saveName").onclick = ()=>{ STATE.user.name = $("userName").value.trim()||"Student"; saveState(); renderAll(); };
  $("processFiles").onclick = handleFiles;
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick=()=>{ document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
      btn.classList.add("active"); document.querySelectorAll(".panel").forEach(p=>p.classList.add("hidden"));
      $(btn.dataset.tab).classList.remove("hidden"); };
  });
  $("quickSummary").onclick = ()=> makeSummary("quick");
  $("detailedSummary").onclick = ()=> makeSummary("detailed");
  $("readSummary").onclick = ()=> readText($("summaryOutput").innerText);
  $("generateQuiz").onclick = ()=> generateQuiz();
  $("readQuiz").onclick = ()=> readText($("quizOutput").innerText);
  $("applyLicense").onclick = applyLicense;
  $("backupBtn").onclick = backupData;
  $("restoreBtn").onclick = restoreData;
  $("clearAll").onclick = ()=>{ if(confirm("Clear all?")){ STATE.lib=[]; STATE.user.todayCount=0; STATE.user.streak=0; STATE.user.badges=[]; saveState(); renderAll(); }};
  $("setTarget").onclick = ()=>{ STATE.user.dailyTarget=parseInt($("dailyTarget").value)||20; saveState(); renderAll(); };
  $("sendFeedback").onclick = ()=>{ const txt=$("feedbackText").value.trim(); if(!txt) return alert("Type feedback first");
    const subject=encodeURIComponent("SSC feedback"); const body=encodeURIComponent(txt+"\nUser:"+STATE.user.name);
    location.href=`mailto:${DEV_EMAIL}?subject=${subject}&body=${body}`; };
  $("enableVoice").onclick = ()=>{ STATE.user.voice=$("voiceSelect").value; saveState(); alert("Voice set."); };
}

// === RENDER ===
function renderAll(){
  $("userName").value = STATE.user.name||"";
  $("todayTarget").innerText = STATE.user.dailyTarget||20;
  $("todayCount").innerText = STATE.user.todayCount||0;
  $("streak").innerText = STATE.user.streak||0;
  renderLibrary(); renderCollections(); renderBadges();
  $("licenseStatus").innerText = STATE.licenseValid?"Full access":"Demo mode";
}
function renderLibrary(){
  const box=$("libraryList"); box.innerHTML=""; if(!STATE.lib.length){box.innerHTML="<div class='muted'>(empty)</div>";return;}
  STATE.lib.forEach(it=>{
    const d=document.createElement("div"); d.className="row item";
    d.innerHTML=`<div style="flex:1"><b>${it.name}</b><div class="muted">${it.subject||"General"} — ${it.chapter||""}</div></div>
    <div><button onclick="viewItem('${it.id}')" class="btn small">View</button>
    <button onclick="archiveItem('${it.id}')" class="btn small">Delete</button></div>`;
    box.appendChild(d);
  });
}
function renderCollections(){
  const box=$("collectionsList"); box.innerHTML=""; const coll={}; STATE.lib.forEach(i=>coll[i.subject||"General"]=(coll[i.subject||"General"]||0)+1);
  for(const k in coll){ const d=document.createElement("div"); d.className="row item"; d.innerHTML=`<div style="flex:1"><b>${k}</b> — ${coll[k]} items</div>`; box.appendChild(d);}
}
function renderBadges(){ const a=$("badgesArea"); a.innerHTML=""; (STATE.user.badges||[]).forEach(b=>{const s=document.createElement("span"); s.className="badge"; s.innerText=b; a.appendChild(s);}); }

// === FILE HANDLING ===
async function handleFiles(){
  const files=Array.from($("fileInput").files||[]); if(!files.length) return alert("Choose files");
  const maxMB=STATE.licenseValid?500:DEMO_FEATURES.maxUploadMB;
  if(files.some(f=>(f.size/1024/1024)>maxMB)) return alert("File too big for current mode");
  for(const f of files){ if(f.name.endsWith(".zip")) await processZIP(f); else if(f.type==="application/pdf") await processPDF(f);
    else if(f.type.startsWith("image/")) await processImage(f); else await processTextFile(f); }
  saveState(); renderAll();
}
async function processZIP(file){ const ab=await file.arrayBuffer(); const zip=await JSZip.loadAsync(ab);
  for(const n of Object.keys(zip.files)){ const zf=zip.files[n]; if(zf.dir) continue; const ext=n.split(".").pop().toLowerCase();
    const blob=await zf.async("blob"); const fake=new File([blob],n,{type:blob.type});
    if(ext==="pdf") await processPDF(fake); else if(["jpg","jpeg","png"].includes(ext)) await processImage(fake); else await processTextFile(fake); } }
async function processPDF(file){
  try{ const ab=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:ab}).promise; let text="";
    for(let p=1;p<=pdf.numPages;p++){ const pg=await pdf.getPage(p); const ct=await pg.getTextContent(); text+=ct.items.map(i=>i.str).join(" ")+" "; }
    if(text.trim().length<20){ if(!STATE.licenseValid&&!DEMO_FEATURES.ocr) text="(OCR locked in demo)";
      else text=await runOCR(file)||"(OCR failed)"; }
    STATE.lib.push({id:uid(),name:file.name,subject:"General",chapter:"Overview",text}); }
  catch(e){ STATE.lib.push({id:uid(),name:file.name,text:"(PDF error)"}); } }
async function processImage(file){ let t=""; if(!STATE.licenseValid&&!DEMO_FEATURES.ocr) t="(OCR locked)"; else t=await runOCR(file)||"(OCR failed)";
  STATE.lib.push({id:uid(),name:file.name,text:t}); }
async function processTextFile(file){ const txt=await file.text(); STATE.lib.push({id:uid(),name:file.name,text:txt}); }

// === OCR (Tesseract) ===
async function runOCR(file){
  const worker=await Tesseract.createWorker({ logger:m=>console.log("ocr",m) });
  await worker.load(); const lang=$("ocrLang").value||"eng";
  await worker.loadLanguage(lang); await worker.initialize(lang);
  const {data:{text}}=await worker.recognize(file); await worker.terminate(); return text;
}

// === SUMMARIES & QUIZ ===
function makeSummary(type){ if(!STATE.lib.length){$("summaryOutput").innerText="(empty)";return;}
  const txt=STATE.lib.map(i=>i.text).join(" "); const sents=txt.split(/(?<=[.?!])\s+/); const n=type==="quick"?5:15;
  $("summaryOutput").innerText=sents.slice(0,n).join(" "); incrementProgress(); }
function generateQuiz(){ const txt=STATE.lib.map(i=>i.text).join(" "); if(txt.length<200){$("quizOutput").innerText="Not enough";return;}
  const q=txt.split(".")[0]; $("quizOutput").innerHTML=`<div><b>Q:</b>${q.replace(/\b([A-Z][a-z]+)/,"_____")}</div><ol><li>A</li><li>B</li><li>C</li><li>D</li></ol>`; incrementProgress(); }

// === VOICE ===
function populateVoices(){ const sel=$("voiceSelect"); function set(){ const v=speechSynthesis.getVoices(); sel.innerHTML="";
    v.forEach(x=>{const o=document.createElement("option");o.value=x.name;o.innerText=x.name+" ("+x.lang+")"; sel.appendChild(o);});
    const pref=v.find(x=>/India|en-IN|hi-IN/i.test(x.lang+x.name)); if(pref) sel.value=pref.name; }
  set(); speechSynthesis.onvoiceschanged=set; }
function readText(t){ if(!t) return; if(!STATE.licenseValid&&!DEMO_FEATURES.voice) return alert("Voice locked in demo");
  const u=new SpeechSynthesisUtterance(t); const v=speechSynthesis.getVoices().find(x=>x.name===$("voiceSelect").value); if(v) u.voice=v;
  speechSynthesis.cancel(); speechSynthesis.speak(u); }

// === LICENSE & DATA ===
function applyLicense(){ const k=$("licenseKey").value.trim(); if(k===DEMO_LICENSE_KEY){ STATE.licenseValid=true; saveState(); renderAll(); alert("Full access!"); } else alert("Invalid key"); }
function backupData(){ const blob=new Blob([JSON.stringify(STATE)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ssc_backup.json"; a.click();}
function restoreData(){ const f=$("restoreFile").files[0]; if(!f) return alert("Choose file"); const r=new FileReader(); r.onload=()=>{try{Object.assign(STATE,JSON.parse(r.result));saveState();renderAll();alert("Restored");}catch(e){alert("Bad file");}}; r.readAsText(f); }

// === PROGRESS ===
function incrementProgress(){ STATE.user.todayCount=(STATE.user.todayCount||0)+1;
  if(STATE.user.todayCount>=STATE.user.dailyTarget){ if(!STATE.user.badges.includes("Target")) STATE.user.badges.push("Target");
    STATE.user.streak=(STATE.user.streak||0)+1; }
  saveState(); renderAll(); }

// === LIBRARY ITEM OPS ===
window.viewItem=id=>{const it=STATE.lib.find(x=>x.id===id); if(!it) return; const w=open(""); w.document.write("<pre>"+escapeHtml(it.text)+"</pre>");};
window.archiveItem=id=>{STATE.lib=STATE.lib.filter(x=>x.id!==id); saveState(); renderAll();};