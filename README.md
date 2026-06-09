# AgeWarp

Gesture-controlled face aging simulator powered by AI. Move your palm left/right to select a target age, then hold a fist for 800ms to generate an age-transformed photo using the Replicate SAM model.

---

## Stack

- **Frontend:** React 18 + Vite 5
- **Gesture Tracking:** MediaPipe Hands (CDN)
- **API Proxy:** Vercel Serverless Function (`/api/age.js`)
- **AI Model:** Hugging Face Space — `Robys01/Face-Aging` (free & public)
- **Styling:** Vanilla CSS, dark theme, glassmorphism

---

## Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npx vite
```

Open [http://localhost:5173](http://localhost:5173) in Chrome (camera required).

> **Note:** The `/api/age` endpoint works out-of-the-box locally with `npx vite` using a custom Vite API proxy plugin that connects directly to the Hugging Face Space. No API keys are required as the Space is public and free! Note that the first call may take 30-60 seconds if the Space is sleeping.

---

## Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Set your API token as an environment variable
vercel env add REPLICATE_API_TOKEN

# 3. Deploy
vercel --prod
```

The `vercel.json` config is already set up — just push and deploy.

---

## Gesture Controls

| Gesture | Action |
|---------|--------|
| **Open palm, move left/right** | Select target age (0–80) |
| **Hold fist for 800ms** | Capture snapshot → send to AI for aging |
| **Fast palm swipe left** | Scroll timeline strip right |
| **Fast palm swipe right** | Scroll timeline strip left |
| **Click timeline card** | View fullscreen |
| **ESC / click backdrop** | Close fullscreen view |

---

## Age Bucket Mode

When `BUCKET_MODE = true` (default) in `GestureEngine.jsx`, palm position snaps to 6 zones:

| Palm Zone | Target Age | Label |
|-----------|-----------|-------|
| 0–16% | 5 | Child |
| 17–33% | 15 | Teen |
| 34–50% | 28 | Young Adult |
| 51–66% | 43 | Middle Age |
| 67–83% | 58 | Senior |
| 84–100% | 73 | Elderly |

Set `BUCKET_MODE = false` for continuous 0–80 mapping.

---

## File Structure

```
age-warp/
├── api/
│   └── age.js              # Vercel serverless proxy → Replicate API
├── src/
│   ├── components/
│   │   ├── AgeSlider.jsx    # Right-side age display
│   │   ├── GestureEngine.jsx # MediaPipe hand tracking + gestures
│   │   ├── TimestampStrip.jsx # Bottom timeline gallery
│   │   └── WebcamFeed.jsx   # Mirrored webcam + overlays
│   ├── App.jsx              # Main application orchestrator
│   ├── index.css            # Global design system
│   └── main.jsx             # Vite entry point
├── .env                     # REPLICATE_API_TOKEN (never commit)
├── .gitignore
├── index.html               # MediaPipe CDN + Vite mount
├── package.json
├── README.md
└── vercel.json              # Vercel deployment config
```

---

## License

MIT
