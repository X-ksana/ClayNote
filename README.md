# ClayNote — Interactive Ocarina Studio

A mobile-first ("handphone-ready") interactive ocarina web application built with React, TypeScript, Vite, Tailwind CSS, and pure Web Audio APIs. Designed for **100% free static deployment on Vercel** with zero backend costs.

## Features

1. **Ocarina Academy (Learn & Tutorials)**
   - 5 structured lessons covering posture, breath pressure control, reading hole diagrams, first 5 notes (`C–D–E–F–G`), high notes/subholes ("acute bend"), and tonguing/vibrato.
   - Interactive quiz and live microphone breath-pressure check.

2. **Multi-Model & Multi-Scale Support**
   - **Models:** 12-Hole Transverse (Sweet Potato), 6-Hole Pendant (English cross-fingering), and 4-Hole Beginner (John Taylor system).
   - **Keys/Tunings:** Alto C (AC), Soprano C (SC), Bass C (BC), Alto G (AG), and Alto F (AF).
   - **Musical Scales:** Major, Natural Minor, Major Pentatonic, Minor Pentatonic, Dorian Mode, Blues, and Chromatic.
   - **Playable Virtual Ocarina:** Mobile touch note pads, desktop keyboard shortcuts (`A–X`), and direct hole-tap experimentation with warm breathy Web Audio synthesis.

3. **Dual Music Scroll & Real-Time Voice/Ocarina Tutor**
   - Toggle anytime between **Classic Horizontal Tab Scroll** (with SVG hole diagrams) and **Rhythm-Game Note Highway** (animated timeline + strike zone).
   - **3 Tutor Modes:** *Listen*, *Wait-for-Note* (pauses until you hit the note cleanly), and *Live Graded* (real-time YIN microphone pitch detection, cents accuracy, combo grading, and End-of-Session Accuracy Report).
   - Includes **Metronome**, **Tempo Multiplier** (`0.5x`–`1.25x`), **Auto-Fit Transpose**, and **Demo Pitch Simulator** for testing without a mic.

4. **MP3-to-Ocarina Music Scroll Studio**
   - Upload any `.mp3`, `.wav`, `.m4a`, or `.ogg` file (or test with the 1-click **Sample Melody Audio** generator).
   - Runs client-side YIN melody extraction, median pitch smoothing, onset segmentation, **Smart Auto-Transpose** to fit your ocarina's range, optional **Octave-Folding**, and saves directly to your Song Library.

5. **Chromatic Ocarina Tuner & Breath Coach**
   - Real-time cents meter (`-50¢` to `+50¢`), breath-pressure guidance (*Flat/Soft* vs *Sweet Spot* vs *Sharp/Hard*), rolling breath-stability trace, and automatic fingering lookup.

## Free Deployment to Vercel (via GitHub)

Because all audio synthesis, microphone pitch detection, and MP3 analysis run directly in the user's browser, **no paid server or API keys are needed**.

1. **Push this project to a GitHub repository:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: ClayNote Ocarina Studio"
   git branch -M main
   git remote add origin https://github.com/<your-username>/claynote-ocarina.git
   git push -u origin main
   ```
2. **Deploy on Vercel (Free Hobby Plan):**
   - Go to [vercel.com](https://vercel.com) and sign in with GitHub.
   - Click **Add New → Project** and import your `claynote-ocarina` repository.
   - Vercel automatically detects Vite (`Build Command: npm run build`, `Output Directory: dist`).
   - Click **Deploy**. Your app will be live on HTTPS (required for mobile microphone access!).
3. **Install on Handphone (PWA):**
   - Open your Vercel URL in Chrome (Android) or Safari (iOS) and tap **Add to Home Screen**.

## Local Development

```bash
npm install
npm run dev
```
