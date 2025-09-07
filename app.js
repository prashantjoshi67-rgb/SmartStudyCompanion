/* === START OF FILE: app.js ===
   Smart Study Companion - App Logic (Client-Only)
   Includes license handling, PDF extraction + OCR fallback, TTS, library, badges, quiz, backup/restore
*/

/* ========== STATE ========== */
const STORAGE_KEY = "ssc_state_v1";
let STATE = {
  name: "Guest",
  license: "DEMO",
  fullAccess: false,
  voiceEnabled: false,
  voiceSettings: { voiceURI: null, lang: "en-US", rate: 1.0, pitch: 1.0 },
  library: [],  // {id, name, type, addedAt, text, meta}
  badges: {},
  target: 20,
  ocrLang: "eng"
};

/* ========== UTILITIES ========== */
const $ = id => document.getElementById(id);
const uid = p => p + "_" + Math.random().toString(36).slice(2,9);
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
function loadState(){ const raw=localStorage.getItem(STORAGE_KEY); if(raw){ try{STATE=Object.assign(STATE,JSON.parse(raw));}catch(e){console.error(e);} } }
function notify(msg){ console.log("INFO:", msg); const s=$("statusLabel"); if(s) s.textContent="Status: "+msg; }

/* ========== LICENSE ========== */
function applyLicenseKey(){
  const key = ($("licenseInput").value || "").trim().toUpperCase();
  if(key==="FULL-ACCESS"){ STATE.license="FULL-ACCESS"; STATE.fullAccess=true; notify("Full Access"); }
  else { STATE.license="DEMO"; STATE.fullAccess=false; notify("Demo"); }
  const badge=$("licenseStatus"); if(badge) badge.textContent=STATE.fullAccess?"Full":"Demo";
  saveState();
}

/* ========== VOICE / TTS ========== */
let voices=[];
function initVoices(){
  function populate(){
    voices=speechSynthesis.getVoices();
    const sel=$("voiceSelect"); if(!sel) return;
    sel.innerHTML=""; voices.forEach(v=>{
      const o=document.createElement("option"); o.value=v.voiceURI; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o);
    });
    if(STATE.voiceSettings.voiceURI){ sel.value=STATE.voiceSettings.voiceURI; }
  }
  populate(); speechSynthesis.onvoiceschanged=populate;
}
function ttsSpeak(text){
  if(!STATE.voiceEnabled) return;
  if(!("speechSynthesis" in window)) return;
  const ut=new SpeechSynthesisUtterance(text);
  const sel=$("voiceSelect").value;
  if(sel){ const v=voices.find(x=>x.voiceURI===sel); if(v) ut.voice=v; }
  ut.lang=STATE.voiceSettings.lang; ut.rate=STATE.voiceSettings.rate; ut.pitch=STATE.voiceSettings.pitch;
  speechSynthesis.cancel(); speechSynthesis.speak(ut);
}

/* ========== FILE HANDLING & PDF/OCR ========== */
async function extractTextFromPDF(buf){
  try{
    const task=pdfjsLib.getDocument({data:buf}); const pdf=await task.promise; let all="";
    for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const c=await pg.getTextContent();
      const t=c.items.map(it=>it.str).join(" ").trim(); if(t.length>0) all+="\n"+t; }
    if(all.trim().length>20) return {text:all.trim(),ocr:false};
  }catch(e){ console.warn("pdf.js failed",e); }
  // OCR fallback
  if(typeof Tesseract==="undefined") return {text:"",ocr:true};
  const task=pdfjsLib.getDocument({data:buf}); const pdf=await task.promise; let all="";
  for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const vp=pg.getViewport({scale:1.5});
    const cvs=document.createElement("canvas"); cvs.width=vp.width; cvs.height=vp.height;
    await pg.render({canvasContext:cvs.getContext("2d"),viewport:vp}).promise;
    const res=await Tesseract.recognize(cvs,STATE.ocrLang||"eng"); all+="\n"+res.data.text; cvs.remove(); }
  return {text:all.trim(),ocr:true};
}

async function processFiles(files){
  for(const f of files){
    if(f.type==="application/pdf"||f.name.endsWith(".pdf")){
      const buf=await f.arrayBuffer(); const {text,ocr}=await extractTextFromPDF(buf);
      STATE.library.push({id:uid("doc"),name:f.name,type:"pdf",addedAt:new Date().toISOString(),text,meta:{ocr}});
      notify(`Processed PDF (${ocr?"OCR":"text"})`);
    } else if(f.type.startsWith("image/")){
      const res=await Tesseract.recognize(f,STATE.ocrLang||"eng"); STATE.library.push({id:uid("img"),name:f.name,type:"image",addedAt:new Date().toISOString(),text:res.data.text,meta:{ocr:true}});
      notify("OCR image done");
    } else if(f.type==="text/plain"||f.name.endsWith(".txt")){
      const txt=await f.text(); STATE.library.push({id:uid("txt"),name:f.name,type:"text",addedAt:new Date().toISOString(),text:txt,meta:{}});
      notify("Text file added");
    } else { notify("Unsupported file: "+f.name); }
  }
  saveState(); renderLibrary();
}

/* ========== LIBRARY UI ========== */
function renderLibrary(){
  const list=$("libraryList"); if(!list) return; list.innerHTML="";
  if(STATE.library.length===0){ list.textContent="(no documents)"; return; }
  STATE.library.forEach(d=>{
    const div=document.createElement("div"); div.className="card";
    div.innerHTML=`<b>${d.name}</b> — ${new Date(d.addedAt).toLocaleString()}
      <button data-id="${d.id}" data-act="view">View</button>
      <button data-id="${d.id}" data-act="del">Delete</button>`;
    list.appendChild(div);
  });
  list.querySelectorAll("button").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.id; const act=b.dataset.act; const d=STATE.library.find(x=>x.id===id);
      if(act==="view"){ $("summaryOutput").textContent=d.text||"(no text)"; }
      else if(act==="del"){ STATE.library=STATE.library.filter(x=>x.id!==id); saveState(); renderLibrary(); }
    };
  });
}
function deleteAllDocs(){ if(confirm("Delete all?")){ STATE.library=[]; saveState(); renderLibrary(); } }

/* ========== SUMMARIES / QUIZ DEMO ========== */
function quickSummary(){ const txt=STATE.library.map(d=>d.text).join(" ").slice(0,500); $("summaryOutput").textContent=txt||"(no material)"; }
function detailedSummary(){ const txt=STATE.library.map(d=>d.text).join(" "); $("summaryOutput").textContent=txt||"(no material)"; }
function createMCQs(){
  const txt=STATE.library.map(d=>d.text).join(" "); if(!txt){ $("summaryOutput").textContent="(no material)"; return; }
  const words=txt.split(/\s+/).filter(w=>w.length>4); if(words.length<4){ $("summaryOutput").textContent="(not enough text)"; return; }
  const answer=words[0]; $("summaryOutput").textContent=`Q: _____ ?\nA) ${answer}\nB) X\nC) Y\nD) Z\nAnswer: ${answer}`;
}

/* ========== BADGES / TARGETS ========== */
function updateBadges(){ if(STATE.library.length>=1&&!STATE.badges["first"]){ STATE.badges["first"]=Date.now(); notify("Badge: First upload"); } saveState(); }

/* ========== BACKUP / RESTORE ========== */
function exportData(){ const data=JSON.stringify(STATE); const blob=new Blob([data],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="ssc_backup.json"; a.click(); }
function importData(f){ const r=new FileReader(); r.onload=()=>{ try{ const j=JSON.parse(r.result); STATE=Object.assign(STATE,j); saveState(); renderLibrary(); notify("Import OK"); }catch(e){notify("Import failed");} }; r.readAsText(f); }

/* ========== INIT UI BINDINGS ========== */
document.addEventListener("DOMContentLoaded",()=>{
  loadState(); renderLibrary(); initVoices();
  $("saveName").onclick=()=>{ STATE.name=$("name").value||"Guest"; saveState(); notify("Name saved"); };
  $("enableVoice").onclick=()=>{ STATE.voiceEnabled=!STATE.voiceEnabled; $("enableVoice").textContent=STATE.voiceEnabled?"Disable":"Enable"; saveState(); };
  $("applyLicense").onclick=applyLicenseKey;
  $("processBtn").onclick=()=>{ const f=$("fileInput").files; if(f.length) processFiles(f); };
  $("deleteAll").onclick=deleteAllDocs;
  $("quickSum").onclick=quickSummary; $("detailedSum").onclick=detailedSummary; $("createMCQ").onclick=createMCQs;
  $("readSum").onclick=()=> ttsSpeak($("summaryOutput").textContent||"");
  $("generateQuiz").onclick=createMCQs;
  $("exportData").onclick=exportData;
  $("importFile").onchange=e=>{ if(e.target.files.length) importData(e.target.files[0]); };
  // license display
  $("licenseStatus").textContent=STATE.fullAccess?"Full":"Demo";
  $("enableVoice").textContent=STATE.voiceEnabled?"Disable":"Enable";
  notify("Ready");
});
/* === END OF FILE: app.js === */