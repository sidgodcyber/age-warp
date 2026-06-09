import { Client } from "@gradio/client";

export default async function handler(req, res) {
  try {
    const { type = 'image', imageBase64, sourceAge, targetAge, duration = 5, fps = 24 } = req.body;
    if (!imageBase64 || sourceAge === undefined || targetAge === undefined) {
      return res.status(400).json({ error: "Missing params" });
    }

    // Convert base64 to blob
    const buffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });

    // Connect to the free HF Space
    const client = await Client.connect("Robys01/Face-Aging");
    
    if (type === 'video') {
      console.log(`[api/age] Running video prediction: source: ${sourceAge}, target: ${targetAge}`);
      const result = await client.predict("/predict_1", {
        image_path: blob,
        source_age: Number(sourceAge),
        target_age: Number(targetAge),
        duration: Number(duration),
        fps: Number(fps),
      });

      // result.data[0] is typically { video: { url, path }, ... } or contains the URL directly
      const videoData = result.data[0];
      const agedVideoUrl = videoData?.video?.url || videoData?.url || videoData;
      res.json({ output: agedVideoUrl });
    } else {
      console.log(`[api/age] Running image prediction: source: ${sourceAge}, target: ${targetAge}`);
      const result = await client.predict("/predict", {
        image_path: blob,
        source_age: Number(sourceAge),
        target_age: Number(targetAge),
      });

      const agedImageUrl = result.data[0].url;
      res.json({ output: agedImageUrl });
    }

  } catch (error) {
    console.error('HF Space error:', error);
    res.status(500).json({ error: error.message });
  }
}
