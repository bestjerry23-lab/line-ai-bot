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
    const aiReply = await callAI(userMessage);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: aiReply }],
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function callAI(userMessage) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.2-3b-instruct:free',
      messages: [
        { role: 'system', content: '你是一個親切的客服助理，請用繁體中文回答用戶的問題。' },
        { role: 'user', content: userMessage }
      ],
    }),
  });

  const data = await response.json();
  console.log('AI response:', JSON.stringify(data));

  if (!data.choices || !data.choices[0]) {
    throw new Error('No response: ' + JSON.stringify(data));
  }

  return data.choices[0].message.content;
}

app.listen(3000, () => console.log('Server running on port 3000'));
