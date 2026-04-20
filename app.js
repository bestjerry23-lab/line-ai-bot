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
    console.error('Error:', err.message);
  }
}

async function callGemini(userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_
