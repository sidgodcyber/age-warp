import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev plugin that mimics the Vercel /api/age serverless function
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
          console.log(`[api/age] Connecting to HF Gradio Space Robys01/Face-Aging...`);
          
          // Convert base64 to blob
          const buffer = Buffer.from(imageBase64, 'base64');
          const blob = new Blob([buffer], { type: 'image/jpeg' });

          // Dynamic import of ESM-only package to prevent CommonJS bundle errors during Vite startup
          const { Client } = await import('@gradio/client');
          const client = await Client.connect("Robys01/Face-Aging");
          
          if (type === 'video') {
            console.log(`[api/age] Running predict_1 (video): age ${sourceAge} -> ${targetAge}, duration ${duration}, fps ${fps}...`);
            const result = await client.predict("/predict_1", {
              image_path: blob,
              source_age: Number(sourceAge),
              target_age: Number(targetAge),
              duration: Number(duration),
              fps: Number(fps),
            });
            const videoData = result.data[0];
            const agedVideoUrl = videoData?.video?.url || videoData?.url || videoData;
            console.log(`[api/age] ✅ Video success! Output: ${agedVideoUrl}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ output: agedVideoUrl }));
          } else {
            console.log(`[api/age] Running predict (image): age ${sourceAge} -> ${targetAge}...`);
            const result = await client.predict("/predict", {
              image_path: blob,
              source_age: Number(sourceAge),
              target_age: Number(targetAge),
            });

            const agedImageUrl = result.data[0].url;
            console.log(`[api/age] ✅ Image success! Output: ${agedImageUrl}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ output: agedImageUrl }));
          }
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
