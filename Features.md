<!-- === START OF FILE: Features.md === -->

# ✨ Smart Study Companion — Features Overview

Version: 1.0  
Date: 2025-09-07  

---

## 1. General Overview

Smart Study Companion is a **browser-based learning app** that turns study material into an interactive revision and practice tool.  
It works fully client-side (no server needed) and is ideal for CBSE Class 10 and beyond, but can be used with any educational content.

---

## 2. Access Modes

### Demo Mode
- Active by default.
- File size limit ~50 MB.
- Some advanced features are **visible** but **locked**.
- Great for trial runs and light use.

### Full Access
- Unlocked by entering license key: **`FULL-ACCESS`**.
- File size up to ~500 MB.
- All features fully enabled.
- Demo-only restrictions removed.

---

## 3. File Handling

- **Accepted file types**:  
  - PDF  
  - TXT  
  - HTML  
  - Images (JPG, PNG)  
  - ZIP (auto-unpacks with JSZip)  

- **PDFs**:  
  - Text extraction via **pdf.js**.  
  - OCR fallback via **Tesseract.js** for scanned/image-only PDFs.  

- **Images**:  
  - Converted to text via OCR.  

- **ZIPs**:  
  - Optional unpacking and batch processing if JSZip included.  

---

## 4. Library Management

- **Library tab** shows all uploaded files.  
- Each entry:  
  - File name  
  - Date added  
  - Source type (PDF, text, OCR, etc.)  
- **Actions** per file:  
  - View text  
  - Generate summary  
  - Delete  
- **Delete all** option clears the library.  
- Library is **saved in localStorage** (persists across browser sessions).  

---

## 5. Summaries

- **Quick Summary**: Short highlights (first key sentences).  
- **Detailed Summary**: Larger excerpts (several paragraphs).  
- **Read**: Uses browser TTS to read summary aloud.  
- **Create MCQs**: Generates demo multiple-choice questions from text.  

---

## 6. Quizzes

- **Quiz tab** lets you:  
  - Choose quiz type (MCQ, Short Answer).  
  - Set optional timer (10s, 30s, 60s).  
- Score tracked for correct answers.  
- Timer expiry = skip (no score).  
- Plans for:  
  - **KBC-style game mode** with audio cues.  
  - **General Knowledge mode** pulling questions from internet sources.  

---

## 7. Voice / TTS (Text to Speech)

- Toggle **Enable/Disable voice**.  
- Choose from **system/browser voices** (prefers Indian accents like `en-IN`, `hi-IN`).  
- Configurable: rate, pitch.  
- Reads:  
  - Summaries  
  - Quiz questions/answers  
- Voice preview available in Settings.  

---

## 8. Targets & Badges

- Set **daily study targets** (e.g., number of questions or minutes).  
- Earn **badges** for milestones:  
  - First upload  
  - Hitting daily targets  
  - Upload milestones (10+ docs, etc.)  
- Gamified approach keeps study engaging.  

---

## 9. Backup & Restore

- **Export**: Save library + settings as JSON.  
- **Import**: Restore JSON backup anytime.  
- Ensures data safety if browser storage is cleared.  

---

## 10. Themes

- Switch themes in **Settings tab**:  
  - Dark (default)  
  - Vibrant (colorful)  
  - Light (clean, bright)  

---

## 11. Help & Manuals

- **Help tab** provides quick troubleshooting.  
- Link to full **User Manual** (HTML version).  
- Developer and Features documentation included in repo.  

---

## 12. Technical Notes

- **Runs client-side** in browser — no server needed.  
- **Libraries used**:  
  - pdf.js for PDF parsing  
  - Tesseract.js for OCR  
  - JSZip for ZIP unpacking  
- **Storage**: Browser `localStorage`  
- **Deployment**: GitHub Pages (static hosting)  

---

## 13. Limitations

- OCR is slow on low-end mobile devices.  
- Large PDFs (>100 MB) may cause performance issues.  
- Voice depends on browser/system availability of voices.  
- Quiz generation logic is basic (demo) — better NLP integration planned.  

---

## 14. Roadmap (Planned Features)

- KBC-style interactive quiz with Amitabh Bachchan–style audio cues.  
- General Knowledge quiz pulling questions dynamically.  
- LLM-powered summarization and quiz generation.  
- Multi-user support with cloud sync.  
- Mobile app wrappers for offline use.  

---

## 15. Document Control

- Maintainer: Prashant  
- Last Updated: 2025-09-07  

---

<!-- === END OF FILE: Features.md === -->