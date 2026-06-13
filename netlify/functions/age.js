export default async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { type = 'image', imageBase64, sourceAge, targetAge, duration = 5, fps = 24 } = JSON.parse(event.body);
    
    if (!imageBase64 || sourceAge === undefined || targetAge === undefined) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing imageBase64, sourceAge, or targetAge' })
      };
    }

    console.log('[age] Connecting to HF Gradio Space Robys01/Face-Aging via fetch...');
    
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
        body: formData,
        timeout: 30000
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
      console.log(`[age] Running video predict_1: age ${sourceAge} -> ${targetAge}, duration ${duration}, fps ${fps}...`);
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
          }),
          timeout: 60000
        }
      );
    } else {
      console.log(`[age] Running image predict: age ${sourceAge} -> ${targetAge}...`);
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
          }),
          timeout: 60000
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
      console.log(`[age] ✅ Video success! Output: ${outputUrl}`);
    } else {
      const imageData = predictData.data[0];
      outputUrl = imageData.url || 
                  'https://robys01-face-aging.hf.space/gradio_api/file=' + 
                  imageData.path;
      console.log(`[age] ✅ Image success! Output: ${outputUrl}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output: outputUrl })
    };

  } catch (error) {
    console.error('[age] Error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal error' })
    };
  }
}
