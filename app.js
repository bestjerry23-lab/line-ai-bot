// app.js
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

// LINE Webhook
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).send('OK');
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text;

  // 呼叫 Claude AI
  const aiReply = await callClaude(userMessage);

  // 回覆 LINE 用戶
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: aiReply }],
  });
}

async function callClaude(userMessage) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: '你是一個親切的客服助理，請用繁體中文回答用戶的問題。', // 👈 在這裡設定機器人個性
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  return data.content[0].text;
}

app.listen(3000, () => console.log('Server running on port 3000'));