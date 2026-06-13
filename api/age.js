export default async function handler(req, res) {
  try {
    const { type = 'image', imageBase64, sourceAge, targetAge, duration = 5, fps = 24 } = req.body;
    if (!imageBase64 || sourceAge === undefined || targetAge === undefined) {
      return res.status(400).json({ error: "Missing params" });
    }

    // Step 1: Upload image to HF Space using native FormData (Gradio expects multipart files key)
    const buffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('files', blob, 'image.jpg');
    
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

    // Step 2: Call predict endpoint
    let predictRes;
    if (type === 'video') {
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
    } else {
      const imageData = predictData.data[0];
      outputUrl = imageData.url || 
                  'https://robys01-face-aging.hf.space/gradio_api/file=' + 
                  imageData.path;
    }
    
    res.json({ output: outputUrl });

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: error.message });
  }
}
