const FormData = require('form-data');
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { type = 'image', imageBase64, sourceAge, targetAge, duration = 5, fps = 24 } = JSON.parse(event.body);
    
    if (!imageBase64 || sourceAge === undefined || targetAge === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing imageBase64, sourceAge, or targetAge' })
      };
    }

    console.log('[age] Connecting to HF Gradio Space...');
    
    // Convert base64 to buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    const form = new FormData();
    form.append('files', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

    // Upload image
    const uploadRes = await fetch(
      'https://robys01-face-aging.hf.space/gradio_api/upload',
      {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      }
    );
    const uploadData = await uploadRes.json();
    console.log('[age] Upload response:', uploadData);
    
    if (uploadRes.status !== 200 || !Array.isArray(uploadData) || uploadData.length === 0) {
      console.error('[age] Upload failed:', uploadData);
      throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
    }
    const filePath = uploadData[0];

    // Call predict endpoint
    let predictRes;
    if (type === 'video') {
      console.log(`[age] Generating video: ${sourceAge} → ${targetAge}`);
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
      console.log(`[age] Generating image: ${sourceAge} → ${targetAge}`);
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

    if (!predictRes.ok) {
      throw new Error(`Predict request failed with status ${predictRes.status}`);
    }

    const predictData = await predictRes.json();
    console.log('[age] Predict response status:', predictRes.status);

    if (predictData.error) {
      console.error('[age] Prediction error:', predictData.error);
      throw new Error(predictData.error);
    }
    if (!predictData.data || predictData.data.length === 0) {
      console.error('[age] No data in response');
      throw new Error('No data returned from prediction');
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

    console.log('[age] Success:', type, '→', outputUrl);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ output: outputUrl })
    };

  } catch (error) {
    console.error('[age] Failed:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal error' })
    };
  }
};
