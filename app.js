/* ---------- SmartStudy Companion : app.js ---------- */
(function(){
  const S = {
    libs: {
      pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs",
      fflate: "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.min.js"
    },
    subjects: [
      "english","hindi","marathi","sanskrit","math","maths","mathematics","science",
      "physics","chemistry","biology","social","sst","history","geography","civics",
      "economics","computer","it","ai","cs"
    ],
    storeKey: "ssc.libraries.v1",
    maxZipMB: 500
  };

  /* ---------- helpers ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const once = (el, type, fn) => el.addEventListener(type, fn, {once:true});
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const human = n => new Intl.NumberFormat().format(n|0);
  const byText = (tag, txt) =>
    [...document.getElementsByTagName(tag)]
      .find(x => x.textContent.trim().toLowerCase().includes(txt));

  function toast(msg){
    let t = $("#__toast");
    if(!t){
      t = document.createElement("div"); t.id="__toast"; t.className="toast";
      document.body.appendChild(t);
    }
    t.textContent = msg; t.classList.add("show");
    setTimeout(()=>t.classList.remove("show"), 2800);
  }

  async function loadScript(src, type="text/javascript"){
    if (document.querySelector(`script[data-src="${src}"]`)) return;
    return new Promise((res, rej)=>{
      const s = document.createElement("script");
      s.dataset.src = src;
      if (type === "module") { s.type = "module"; s.src = src; }
      else { s.src = src; }
      s.onload = res; s.onerror = () => rej(new Error("Failed to load "+src));
      document.head.appendChild(s);
    });
  }

  /* ---------- storage (libraries) ---------- */
  function readStore(){
    try{
      return JSON.parse(localStorage.getItem(S.storeKey)) || { current:"Default", data:{Default:{files:[], meta:{}}}};
    }catch{ return { current:"Default", data:{Default:{files:[], meta:{}}}}}
  }
  function writeStore(obj){ localStorage.setItem(S.storeKey, JSON.stringify(obj)); }
  function currentLib(){ const o = readStore(); return o.data[o.current]; }
  function setCurrentLib(name){
    const o = readStore(); o.current = name;
    if(!o.data[name]) o.data[name] = {files:[], meta:{}};
    writeStore(o); updateLibraryBadge();
  }
  function addFilesToLib(files){
    const o = readStore();
    const lib = o.data[o.current];
    lib.files.push(...files);
    writeStore(o);
  }
  function clearLib(name){
    const o = readStore();
    if(o.data[name]) o.data[name] = {files:[], meta:{}};
    writeStore(o);
  }

  /* ---------- subject/chapter detection ---------- */
  function detectSubject(str){
    const s = str.toLowerCase();
    const hit = S.subjects.find(sub => s.includes(sub));
    if(hit==="maths") return "Mathematics";
    if(hit==="sst"||hit==="social") return "Social Science";
    return hit ? hit.charAt(0).toUpperCase()+hit.slice(1) : "General";
  }
  function detectChapter(str){
    // ex: "Chapter 4", "Ch-03", "Lesson 2", "पाठ ७"
    const s = str.toLowerCase();
    const m = s.match(/(?:chapter|ch|lesson|पाठ|abharas|adhyaya)[\s\-:_]*([0-9]{1,2})/i);
    if(m) return "Chapter " + (+m[1]);
    // Secondary: number before dash
    const m2 = s.match(/\b([0-9]{1,2})[\s\-\._]/);
    if(m2) return "Chapter " + (+m2[1]);
    return "Misc";
  }

  /* ---------- small welcome tone ---------- */
  function playWelcome(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type="sine"; o.frequency.value=660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+.02);
      o.start();
      setTimeout(()=>{ o.frequency.value=880; }, 160);
      setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+.05); o.stop(ctx.currentTime+.08); }, 340);
    }catch{}
  }

  /* ---------- PDF text ---------- */
  async function extractPDFText(file){
    await loadScript(S.libs.pdfjs, "module"); // pdf.js mjs builds expose global pdfjsLib via module script
    const array = await file.arrayBuffer();
    // some builds expose window["pdfjs-dist/build/pdf"]
    const pdfjs = window.pdfjsLib || window["pdfjs-dist/build/pdf"] || window.pdfjsDistBuildPdf;
    if(!pdfjs) return "";
    const doc = await pdfjs.getDocument({data:array}).promise;
    let text = "";
    for(let p=1;p<=doc.numPages;p++){
      const page = await doc.getPage(p);
      const c = await page.getTextContent();
      text += c.items.map(i=>i.str).join(" ") + "\n";
    }
    try{ doc.destroy && doc.destroy(); }catch{}
    return text;
  }

  /* ---------- ZIP unpack ---------- */
  async function unpackZip(file){
    const sizeMB = file.size/1024/1024;
    if(sizeMB > S.maxZipMB) throw new Error(`ZIP too large (${sizeMB.toFixed(1)} MB). Limit ${S.maxZipMB} MB.`);
    await loadScript(S.libs.fflate);
    const buf = new Uint8Array(await file.arrayBuffer());
    return new Promise((resolve,reject)=>{
      fflate.unzip(buf, (err, data)=>{
        if(err) return reject(err);
        const out = [];
        Object.entries(data).forEach(([name, u8])=>{
          if(name.endsWith("/")) return; // folder
          const parts = name.split("/");
          const fname = parts[parts.length-1];
          const blob = new Blob([u8.buffer], {type:guessMime(fname)});
          out.push(new File([blob], fname, {type:blob.type}));
        });
        resolve(out);
      });
    });
  }
  function guessMime(name){
    const s = name.toLowerCase();
    if(s.endsWith(".pdf")) return "application/pdf";
    if(s.endsWith(".txt")) return "text/plain";
    if(s.endsWith(".html")||s.endsWith(".htm")) return "text/html";
    if(s.endsWith(".md")) return "text/markdown";
    if(s.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if(s.endsWith(".epub")) return "application/epub+zip";
    if(/\.(png|jpg|jpeg|gif|webp)$/i.test(s)) return "image/*";
    return "application/octet-stream";
  }

  /* ---------- light summarizer + quiz (offline heuristic) ---------- */
  function splitSentences(t){
    return t.replace(/\s+/g," ").split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  }
  function summarize(text, max=6){
    const sents = splitSentences(text).slice(0, 800); // cap
    const score = sents.map(s=>{
      const len = s.length;
      const keyHits = (s.match(/\b(therefore|because|thus|important|means|called|includes|consists|definition|example)\b/gi)||[]).length;
      return {s, w: keyHits*3 + Math.min(2, Math.floor(len/120))};
    });
    return score.sort((a,b)=>b.w-a.w).slice(0,max).map(x=>x.s);
  }
  function makeMCQs(text, count=8){
    const sents = splitSentences(text).filter(s=>s.split(" ").length>6).slice(0,400);
    const qs = [];
    for(let i=0; i<Math.min(count, sents.length); i++){
      const s = sents[i];
      // pick a noun-ish word to blank (very naive)
      const words = s.split(" ");
      const idx = words.findIndex(w=>/^[A-Za-z][a-zA-Z]{3,}$/.test(w));
      if(idx<0) continue;
      const answer = words[idx].replace(/[^\w]$/,"");
      words[idx] = "_____";
      const stem = words.join(" ");
      const options = new Set([answer]);
      while(options.size<4){
        const alt = (sents[(i+2)%sents.length]||"").split(" ").find(w=>/^[A-Za-z][a-zA-Z]{3,}$/.test(w)) || answer+"s";
        options.add(alt.replace(/[^\w]$/,""));
      }
      qs.push({q:stem, options:[...options].sort(()=>Math.random()-0.5), answer});
    }
    return qs;
  }

  /* ---------- UI bindings ---------- */
  function findUI(){
    // try id first
    const ui = {
      name: $("#studentName") || $('input[type="text"]'),
      saveName: $("#saveNameBtn") || byText("button","save"),
      file: $("#fileInput") || $('input[type="file"]'),
      createSummaries: $("#createSummariesBtn") || byText("button","create"),
      startQuiz: $("#startQuizBtn") || byText("button","start quiz"),
      subjectsBox: $("#subjectsList") || byText("div","Subjects detected")?.parentElement?.querySelector(".list"),
      chaptersBox: $("#chaptersList") || byText("div","Chapters")?.parentElement?.querySelector(".list"),
      progress: $("#progressBar") || document.querySelector(".progress > span"),
      dailyTarget: $("#targetCount") || $('input[type="number"]'),
      setTarget: $("#setTargetBtn") || byText("button","set"),
      libBadge: $("#libraryBadge")
    };
    return ui;
  }

  function updateLibraryBadge(){
    const ui = findUI();
    const o = readStore();
    const text = `Library: ${o.current} • Files: ${human(o.data[o.current]?.files.length||0)}`;
    if(ui.libBadge){ ui.libBadge.textContent = text; }
    else{
      let badge = $("#__libbadge");
      if(!badge){
        badge = document.createElement("div"); badge.id="__libbadge"; badge.className="badge";
        const hd = document.querySelector(".header") || document.body;
        hd.appendChild(badge);
      }
      badge.textContent = text;
    }
  }

  async function handleFiles(fileList){
    const ui = findUI();
    const arr = [...fileList];
    const out = [];
    let done=0;

    if(ui.progress){ ui.progress.style.width="0%"; }

    for(const f of arr){
      let files = [f];
      if(/\.(zip|cbz)$/i.test(f.name)){
        toast("Unpacking ZIP…");
        try{ files = await unpackZip(f); }
        catch(e){ toast("ZIP error: "+e.message); continue; }
      }

      for(const file of files){
        const meta = {
          name:file.name, type:file.type||guessMime(file.name),
          subject:detectSubject(file.name), chapter:detectChapter(file.name),
          bytes:file.size
        };

        // If PDF -> extract a small text sample (for summaries/quiz)
        if(meta.type.includes("pdf")){
          try{
            const txt = await extractPDFText(file);
            meta.preview = txt.slice(0, 5000);
          }catch(e){
            meta.preview = "";
          }
        }else if(meta.type.startsWith("text/")){
          const txt = await file.text(); meta.preview = txt.slice(0,5000);
        }else{
          meta.preview = "";
        }

        out.push(meta);
        done++; if(ui.progress){ ui.progress.style.width = `${Math.round(done*100/arr.length)}%`; }
      }
    }

    addFilesToLib(out);
    renderSubjectsAndChapters();
    updateLibraryBadge();
    toast(`Added ${out.length} files.`);
  }

  function renderSubjectsAndChapters(){
    const ui = findUI();
    const lib = currentLib();
    const subs = new Map(), chs = new Map();
    lib.files.forEach(f=>{
      subs.set(f.subject, (subs.get(f.subject)||0)+1);
      const k = f.subject+" • "+f.chapter;
      chs.set(k, (chs.get(k)||0)+1);
    });
    if(ui.subjectsBox){
      ui.subjectsBox.innerHTML = "";
      [...subs.entries()].sort().forEach(([s,n])=>{
        const t = document.createElement("span"); t.className="tag"; t.textContent = `${s} · ${n}`;
        ui.subjectsBox.appendChild(t);
      });
    }
    if(ui.chaptersBox){
      ui.chaptersBox.innerHTML = "";
      [...chs.keys()].sort().forEach(k=>{
        const t = document.createElement("span"); t.className="tag"; t.textContent = k;
        ui.chaptersBox.appendChild(t);
      });
    }
  }

  function bind(){
    const ui = findUI();

    // name
    if(ui.name){
      const stored = localStorage.getItem("ssc.name");
      if(stored) ui.name.value = stored;
      if(ui.saveName){
        ui.saveName.onclick = ()=>{
          localStorage.setItem("ssc.name", ui.name.value.trim());
          toast(`Hi ${ui.name.value.trim() || "there"}!`);
          playWelcome();
        };
      }
    }

    // file input
    if(ui.file){
      ui.file.multiple = true;
      ui.file.accept = ".pdf,.txt,.html,.md,.epub,.docx,.zip,.cbz,.png,.jpg,.jpeg,.webp";
      ui.file.onchange = (e)=> handleFiles(e.target.files);
    }

    // daily target badge
    if(ui.setTarget && ui.dailyTarget){
      const saved = +(localStorage.getItem("ssc.target")||20);
      ui.dailyTarget.value = saved;
      ui.setTarget.onclick = ()=>{
        const v = Math.max(1, +(ui.dailyTarget.value||20));
        localStorage.setItem("ssc.target", v);
        toast(`Daily target set to ${v} Qs`);
      };
    }

    // Create summaries
    if(ui.createSummaries){
      ui.createSummaries.onclick = ()=>{
        const lib = currentLib();
        const allText = lib.files.map(f=>f.preview||"").join("\n").slice(0,120000);
        if(!allText){ toast("No text found yet (PDFs may still be loading)."); return; }
        const pts = summarize(allText, 8);
        showModal("Summaries", `<ol>${pts.map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ol>`);
      };
    }

    // Start quiz
    if(ui.startQuiz){
      ui.startQuiz.onclick = ()=>{
        const lib = currentLib();
        const text = lib.files.map(f=>f.preview||"").join("\n").slice(0,120000);
        if(!text){ toast("Add PDFs/text to make a quiz."); return; }
        const qs = makeMCQs(text, 8);
        showQuiz(qs);
      };
    }

    updateLibraryBadge();
    renderSubjectsAndChapters();
  }

  /* ---------- modal / quiz render ---------- */
  function showModal(title, html){
    let m = $("#__modal");
    if(!m){
      m = document.createElement("div"); m.id="__modal";
      m.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99">
        <div style="width:min(820px,92vw);max-height:85vh;overflow:auto;background:#0f1622;border:1px solid #293548;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.5)">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #293548">
            <b id="__mtitle"></b>
            <button id="__mclose" class="btn ghost">✕</button>
          </div>
          <div id="__mbody" style="padding:14px 16px"></div>
        </div>
      </div>`;
      document.body.appendChild(m);
      $("#__mclose").onclick = ()=> m.remove();
      once(m, "click", (e)=>{ if(e.target===m.firstElementChild) m.remove(); });
    }
    $("#__mtitle").textContent = title;
    $("#__mbody").innerHTML = html;
  }

  function showQuiz(qs){
    let idx=0, correct=0;
    const render = ()=>{
      if(idx>=qs.length){
        showModal("Quiz Result", `<p>You got <b>${correct}/${qs.length}</b> correct.</p>`);
        return;
      }
      const q = qs[idx];
      const opts = q.options.map(o=>`<button class="btn" data-a="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join(" ");
      showModal(`Question ${idx+1}/${qs.length}`, `<p style="line-height:1.6">${escapeHtml(q.q)}</p><div class="list" style="margin-top:10px">${opts}</div>`);
      $$("#__mbody .btn").forEach(b=>{
        b.onclick = ()=>{
          if(b.dataset.a===q.answer){ correct++; toast("✓ Correct"); } else { toast("✗ "+q.answer); }
          idx++; render();
        };
      });
    };
    render();
  }

  function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  /* ---------- init ---------- */
  document.addEventListener("DOMContentLoaded", ()=>{
    // insert badge placeholder if missing
    if(!document.querySelector(".header")){
      const w = document.createElement("div");
      w.className = "header wrapper";
      w.innerHTML = `<h2 style="margin:0">SmartStudy Companion</h2><span id="libraryBadge" class="badge"></span>`;
      document.body.prepend(w);
    }
    // progress bar placeholder (optional)
    if(!document.querySelector(".progress")){
      const p = document.createElement("div");
      p.className = "wrapper"; p.innerHTML = `<div class="progress"><span id="progressBar"></span></div>`;
      document.body.insertBefore(p, document.body.children[1]||null);
    }
    bind();
  });

})();
