<!-- === START OF FILE: README.md === -->

# Smart Study Companion

An interactive study and revision web app for CBSE and general learning.  
Built to process study materials (PDF, TXT, images, ZIP), generate summaries, quizzes, and gamified practice.

## Features

- **Demo vs Full Access**
  - DEMO mode (default): limited file size (~50 MB), basic features visible but some locked.
  - Enter `FULL-ACCESS` in the License field to unlock full mode (all features active).

- **File Handling**
  - Accepts **PDF**, **TXT**, **HTML**, **images (JPG/PNG)**.
  - **ZIP files** supported if [JSZip](https://stuk.github.io/jszip/) is included.
  - PDFs: text extracted via **pdf.js**, fallback to OCR with **Tesseract.js** if PDF is image-based.

- **Summaries**
  - Quick summary: extracts key sentences.
  - Detailed summary: larger excerpt of text.
  - Read-aloud: summaries read using browser TTS.

- **Quizzes**
  - Multiple-choice questions generated from study material.
  - Simple “fill-the-blank” style MCQs (demo logic).
  - KBC-style and GK quizzes (planned extension).

- **Voice / TTS**
  - Enable/disable text-to-speech.
  - Choose from available browser/system voices (Indian voices preferred where supported).
  - Reads summaries, quiz questions aloud.

- **Badges & Targets**
  - Daily progress target (e.g., number of questions).
  - Earn badges like “First Upload”, “Daily Target Achieved”.

- **Backup & Restore**
  - Export current library and settings to JSON.
  - Import JSON later to restore progress.

- **Themes**
  - Dark, Vibrant, Light themes.

- **Offline use**
  - Works offline after first load (uses browser localStorage).

## Setup

1. Fork or clone this repository.
2. Ensure `index.html`, `style.css`, and `app.js` are in the **root** of the repo.
3. Commit and push to the `main` branch.

## Deployment via GitHub Pages

1. Go to repo **Settings → Pages**.
2. Under **Source**, choose:
   - Branch: `main`
   - Folder: `/root`
3. Save. After a minute or two, your app will be live at: https://.github.io//
## Usage

1. Open the app in your browser.
2. Enter your name and (optionally) license key.
- Default: Demo
- Use `FULL-ACCESS` to unlock full mode.
3. Choose voice (if TTS available) and enable.
4. Upload files:
- PDF → text extracted (or OCR fallback).
- TXT → direct import.
- Image → OCR.
- ZIP → unpack if JSZip included.
5. Click **Process**.
6. Use tabs to navigate:
- Library: view documents.
- Summaries: generate quick/detailed summaries.
- Quiz: create practice MCQs.
- Manage: targets, backup/restore.
- Settings: OCR language, theme.

## Limitations

- OCR (Tesseract) is CPU-intensive on mobile; large PDFs may be slow.
- Voice output depends on your browser/system voices.
- Current quiz/summary logic is demo-level; better NLP/LLM can be integrated later.

## Roadmap / Planned

- Improved quiz generation using LLM API.
- KBC-style game mode with audio cues.
- Multi-user progress tracking.
- Cloud backup option.
- Integration of more Indian languages (OCR + TTS).

## License

This project is for educational and personal use. You may adapt it for your own studies or extend it further.

---

<!-- === END OF FILE: README.md === -->

