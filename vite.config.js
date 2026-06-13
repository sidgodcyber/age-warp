import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev plugin that mimics the Vercel /api/age serverless function using direct HTTP fetch
function apiProxyPlugin() {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/age', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Method not allowed' }));
        }

        // Read request body
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }

        const { type = 'image', imageBase64, sourceAge, targetAge, duration = 5, fps = 24 } = parsed;
        if (!imageBase64 || sourceAge === undefined || targetAge === undefined) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Missing imageBase64, sourceAge, or targetAge' }));
        }

        try {
          console.log(`[api/age] Connecting to HF Gradio Space Robys01/Face-Aging via fetch...`);
          
          // Convert base64 to buffer
          const buffer = Buffer.from(imageBase64, 'base64');
          const formData = new FormData();
          const blob = new Blob([buffer], { type: 'image/jpeg' });
          formData.append('files', blob, 'image.jpg');

          // Upload image
          const uploadRes = await fetch(
            'https://robys01-face-aging.hf.space/gradio_api/upload',
            {
              method: 'POST',
              body: formData
            }
          );
          const uploadData = await uploadRes.json();
          console.log('Upload response:', uploadData);
          
          if (uploadRes.status !== 200 || !Array.isArray(uploadData) || uploadData.length === 0) {
            throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
          }
          const filePath = uploadData[0];

          // Call predict endpoint
          let predictRes;
          if (type === 'video') {
            console.log(`[api/age] Running video predict_1: age ${sourceAge} -> ${targetAge}, duration ${duration}, fps ${fps}...`);
            predictRes = await fetch(
              'https://robys01-face-aging.hf.space/gradio_api/run/predict_1',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  data: [
                    { path: filePath },
                    0,
                    Number(targetAge),
                    Number(duration),
                    Number(fps)
                  ]
                })
              }
            );
          } else {
            console.log(`[api/age] Running image predict: age ${sourceAge} -> ${targetAge}...`);
            predictRes = await fetch(
              'https://robys01-face-aging.hf.space/gradio_api/run/predict',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  data: [
                    { path: filePath },
                    Number(sourceAge),
                    Number(targetAge)
                  ]
                })
              }
            );
          }

          const predictData = await predictRes.json();
          console.log('Predict response:', predictData);

          if (predictData.error) {
            throw new Error(predictData.error);
          }
          if (!predictData.data || predictData.data.length === 0) {
            throw new Error('Prediction failed: No data returned from Space');
          }

          let outputUrl;
          if (type === 'video') {
            const videoData = predictData.data[0];
            outputUrl = videoData?.video?.url || videoData?.url || videoData;
            if (typeof outputUrl === 'string' && !outputUrl.startsWith('http')) {
              outputUrl = 'https://robys01-face-aging.hf.space/gradio_api/file=' + outputUrl;
            }
            console.log(`[api/age] ✅ Video success! Output: ${outputUrl}`);
          } else {
            const imageData = predictData.data[0];
            outputUrl = imageData.url || 
                        'https://robys01-face-aging.hf.space/gradio_api/file=' + 
                        imageData.path;
            console.log(`[api/age] ✅ Image success! Output: ${outputUrl}`);
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ output: outputUrl }));

        } catch (err) {
          console.error('[api/age] Internal error:', err.message);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
});
