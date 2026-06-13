# AgeWarp

Gesture-controlled AI face aging simulator. Hold a fist in your camera to capture and generate photorealistic aged versions of your face at any age (0–80).

## Features

- **Gesture Control**: Fist to capture, index up/down to adjust age, peace to cancel
- **Real-time Generation**: Single capture generates 17 ages (0–80, 5-year intervals)
- **Live Gallery**: Download/retry/delete individual aged images
- **Video Timeline**: AI-generated aging timelapse with Dlib face morphing
- **No Setup**: Browser-based, no API keys, MediaPipe hand detection runs locally

## AI Model

**Conditional UNet + PatchGAN** trained on FFHQ (70k faces)

### Architecture

```
Input: 5-channel tensor [RGB + source_age_map + target_age_map]
       ↓
Encoder: 512→256→128→64→32 (BlurPool antialiasing)
       ↓
Decode: 32→64→128→256→512 (skip connections)
       ↓
Output: 512×512 aged RGB face
```

### Key Details

- **UNet**: Encoder-decoder with spatial skip connections preserves facial identity
- **BlurPool**: Antialiasing replaces strided convolutions to prevent artifact compression during age transformation
- **PatchGAN Discriminator**: Patch-level realism evaluation — more sensitive to local texture (wrinkles, skin tone) than full-image discriminators
- **Age Encoding**: Continuous spatial channels (not discrete classes) — supports any source→target age, including de-aging
- **Training Data**: FFHQ 70,000 faces, age labels via face analysis

### Inference

- Face detection & preprocessing: Dlib 68-point landmarks
- Age transformation: PyTorch UNet forward pass (~500ms)
- Video generation: 17-frame morphing interpolation → MP4

## Tech Stack

**Frontend**
- React 18, Vite 5
- MediaPipe Hands (gesture detection, local browser)
- Canvas API (face capture)

**Backend**
- Python inference: PyTorch UNet + PatchGAN
- Dlib: Face detection, 68-point landmarks
- FFmpeg: Video encoding

**Deployment**
- Netlify serverless functions (`/api/age`)
- Hugging Face Gradio Space (inference backend)

## Run Locally

```bash
npm install
npm run dev
# http://localhost:5173 (Chrome required, camera required)
```

## API

**POST** `/api/age`

```json
{
  "type": "image",
  "imageBase64": "...",
  "sourceAge": 25,
  "targetAge": 60
}
```

Response:
```json
{
  "output": "https://..."
}
```

Video generation: set `type: "video"`, include `duration` and `fps`.

## Project Structure

```
├── src/
│   ├── App.jsx                ← Main app, state management
│   └── components/
│       ├── WebcamFeed.jsx     ← Camera feed, countdown overlay
│       ├── GestureEngine.jsx  ← MediaPipe gesture detection
│       ├── AgeSlider.jsx      ← Age control
│       └── TimestampStrip.jsx ← Gallery + video tab
├── netlify/functions/
│   └── age.js                 ← Serverless proxy to HF Space
├── backend/
│   ├── models.py              ← UNet + PatchGAN architecture
│   ├── app.py                 ← Inference server
│   └── requirements.txt
└── netlify.toml               ← Netlify build config
```

## License

MIT
