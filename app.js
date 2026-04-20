const express = require('express');
const line = require('@line/bot-sdk');

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).send('OK');
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text;

  try {
    const aiReply = await callGemini(userMessage);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: aiReply }],
    });
  } catch (err) {
    console.error('Error:', JSON.stringify(err.message));
  }
}

async function callGemini(userMessage) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: '你是一個親切的客服助理，請用繁體中文回答用戶的問題。' }]
        },
        contents: [{ parts: [{ text: userMessage }] }],
      }),
    }
  );

  const data = await response.json();
  console.log('Gemini response:', JSON.stringify(data));

  if (!data.candidates || !data.candidates[0]) {
    throw new Error('No candidates in response: ' + JSON.stringify(data));
  }

  return data.candidates[0].content.parts[0].text;
}

app.listen(3000, () => console.log('Server running on port 3000'));
