/* === START OF FILE: app.js === */

// Smart Study Companion - Main Application Logic
// Author: Prashant & Tanaya
// Mode: Offline-first with optional OCR
// License: FULLACCESS

(() => {
  // ==============================
  // Global State
  // ==============================
  let state = {
    name: "",
    license: "DEMO",
    mode: "NORMAL",
    voice: null,
    voiceEnabled: false,
    ocrLang: "eng",
    library: [],
    targets: { daily: 20 },
    badges: [],
    settings: { welcome: true },
  };

  const STORAGE_KEY = "ssc_state_v2";

  // ==============================
  // Persistence
  // ==============================
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) state = { ...state, ...saved };
    } catch {}
  }
  loadState();

  // ==============================
  // UI Helpers
  // ==============================
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $("status");
    if (el) el.innerText = msg;
  }

  // ==============================
  // Voice
  // ==============================
  function initVoices() {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const voices = synth.getVoices();
    let indian = voices.find(v => v.lang === "en-IN" || v.name.includes("India"));
    if (!indian) indian = voices.find(v => v.lang.startsWith("en"));
    state.voice = indian || voices[0];
  }
  function speak(text) {
    if (!state.voiceEnabled || !state.voice) return;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = state.voice;
    speechSynthesis.speak(u);
  }

  // ==============================
  // Welcome
  // ==============================
  function showWelcome() {
    if (state.settings.welcome) {
      const msg = `Hi ${state.name || "Student"}, welcome to Smart Study Companion!`;
      $("welcomeNote").innerText = msg;
      speak(msg);
    }
  }

  // ==============================
  // License
  // ==============================
  function checkLicense() {
    if (state.license.startsWith("FULLACCESS")) {
      setStatus("Full access");
      return true;
    } else {
      setStatus("Demo mode: upload limit 50MB");
      return false;
    }
  }

  // ==============================
  // File Processing
  // ==============================
  async function handleFiles(files) {
    for (const file of files) {
      const entry = { name: file.name, type: file.type, added: new Date().toISOString(), text: "" };
      if (file.type === "application/pdf") {
        try {
          entry.text = await extractPdf(file);
        } catch (e) {
          entry.text = await runOcr(file);
        }
      } else if (file.type.startsWith("text/")) {
        entry.text = await file.text();
      }
      state.library.push(entry);
    }
    saveState();
    renderLibrary();
  }

  // PDF.js
  async function extractPdf(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async function () {
        try {
          const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(it => it.str).join(" ") + "\n";
          }
          resolve(text);
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // OCR
  async function runOcr(file) {
    setStatus("Running OCR...");
    const { createWorker } = Tesseract;
    const worker = await createWorker(state.ocrLang);
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    return text;
  }

  // ==============================
  // Library
  // ==============================
  function renderLibrary() {
    const div = $("libraryList");
    div.innerHTML = "";
    state.library.forEach((doc, i) => {
      const row = document.createElement("div");
      row.innerHTML = `
        <b>${doc.name}</b> (${doc.type}) 
        <button data-i="${i}" class="viewBtn">View</button>
        <button data-i="${i}" class="deleteBtn">Delete</button>`;
      div.appendChild(row);
    });
    div.querySelectorAll(".deleteBtn").forEach(btn => {
      btn.onclick = () => { state.library.splice(btn.dataset.i,1); saveState(); renderLibrary(); };
    });
  }

  // ==============================
  // Summaries
  // ==============================
  function makeSummary(text, mode="quick") {
    if (mode === "quick") return text.split(/\.\s/).slice(0,3).join(". ") + "...";
    if (mode === "detailed") return text.split(/\s+/).slice(0,100).join(" ");
    return text;
  }

  // ==============================
  // Quiz
  // ==============================
  function makeQuiz(text, style="NORMAL") {
    const sentences = text.split(".");
    const questions = [];
    for (let i=0;i<Math.min(5, sentences.length);i++) {
      const q = sentences[i].trim();
      if (q.length < 10) continue;
      questions.push({
        q,
        choices: ["Option A", "Option B", "Option C", "Option D"],
        answer: "Option A"
      });
    }
    if (style==="KBC") {
      return questions.map((q,i)=>({...q, q:`For ₹${1000*(i+1)}: ${q.q}`}));
    }
    return questions;
  }

  // ==============================
  // Badges
  // ==============================
  function updateBadges() {
    const total = state.library.reduce((a,b)=>a+(b.text.split(/\s+/).length),0);
    if (total > 500 && !state.badges.includes("Starter")) state.badges.push("Starter");
    if (total > 5000 && !state.badges.includes("Scholar")) state.badges.push("Scholar");
    $("badges").innerText = "Badges: " + state.badges.join(", ");
  }

  // ==============================
  // Events
  // ==============================
  document.addEventListener("DOMContentLoaded", ()=>{
    $("saveName").onclick = () => { state.name=$("name").value; saveState(); showWelcome(); };
    $("enableVoice").onclick = () => { state.voiceEnabled=!state.voiceEnabled; saveState(); };
    $("applyLicense").onclick = () => { state.license=$("license").value; saveState(); checkLicense(); };
    $("fileInput").onchange = e => handleFiles(e.target.files);
    $("deleteAll").onclick = ()=>{ state.library=[]; saveState(); renderLibrary(); };
    initVoices();
    showWelcome();
    renderLibrary();
    updateBadges();
    checkLicense();
  });

})();

/* === END OF FILE: app.js === */