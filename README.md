# AgeWarp

Gesture-controlled face aging simulator powered by AI. Mirrored camera feed detects hands to select target age, capture snapshots, and animate transitions.

---

## Stack

- **Frontend:** React 18 + Vite 5
- **Gesture Tracking:** MediaPipe Hands (CDN)
- **API Proxy:** Vercel Serverless Function (`/api/age.js`) & Vite local API Proxy middleware
- **AI Model:** Hugging Face Space — `Robys01/Face-Aging` (free & public)
- **Styling:** Vanilla CSS, dark theme, flat aesthetics

---

## Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome (camera required).

> **Note:** The `/api/age` endpoint works out-of-the-box locally using the custom Vite API proxy plugin that connects directly to the Hugging Face Space. No API keys are required as the Space is public and free!

---

## Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy
vercel --prod
```

The `vercel.json` config is already set up — just push and deploy.

---

## Age Setup Modal

Upon page load, users are prompted with a secure, non-glowing age input modal:
- **Empty Default**: Starts completely empty with the placeholder `"25"`.
- **Validation**: Accepts numeric values between `0` and `80`. Entering values outside this range displays an inline red error message.
- **Form Controls**: The Confirm button stays disabled until a valid age is entered.

---

## Gesture Controls

The application maps active gestures detected within the **Gesture Zone** (left 30% of the camera frame):

| Gesture | Delay | Action |
|---------|-------|--------|
| **FIST (✊)** | 1.5s Hold | Captures photo → initiates AI generation for current target age |
| **INDEX UP (Index Finger ↑)** | 1.5s Hold | Increases target age |
| **INDEX DOWN (Index Finger ↓)** | 1.5s Hold | Decreases target age |
| **PEACE (✌️ / Index + Middle Extended)** | **Immediate** | Aborts all pending API calls and cancels active queue generations |

---

## Camera App Countdown

When a capture is triggered:
- **Corner Timer**: A thin transparent white countdown number (`3` -> `2` -> `1`) displays in the bottom-right corner of the camera feed.
- **Camera Shutter Flash**: At `0` (snapshot moment), a white overlay flashes (`0` → `0.4` → `0` opacity) over `150ms` across the webcam frame.

---

## Right Panel Layout (IMAGES & VIDEO Tabs)

The right panel features a `36px` high toggle tab bar to switch between gallery formats:

### 1. IMAGES Tab (Default Active)
- **Grid Layout**: Displays a 2-column grid of snapshots.
- **Card Actions**: Successful cards show download (`↓`) and delete (`✕`) controls only on hover.
- **Failure States**: Failed cards display a persistent `"✕ Failed"` overlay with a **Retry** button and a top-right circular close button (`✕`) that is always visible.
- **Status Bar**: A top status bar tracks bulk timeline generation progress (`GENERATING 8 / 17`) and shows `COMPLETE 17 / 17` for 3 seconds before hiding.

### 2. VIDEO Tab
- **Timelapses**: Displays the generated video timelapses showing aging transitions.
- **Baby-to-Senior Transition**: Automatically configures the source age to `0` and target age to `80` to render the transition from birth.
- **Player & Downloads**: Features a built-in player that spans the full panel width, complete with a clean download button (`DOWNLOAD VIDEO`).
- **Auto-Switching**: Triggering a video generation from the controls panel automatically switches focus to the Video tab upon completion.

---

## License

MIT
