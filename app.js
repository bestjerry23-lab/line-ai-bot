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
      model: 'deepseek/deepseek-r1-distill-llama-70b:free',
      messages: [
        { role: 'system', content: '你是 Jerry 的私人 AI 助理，名字叫做「貝拉」。

你的個性是輕鬆、友善、有點俏皮，說話像朋友一樣自然，適時使用 emoji 讓對話更生動。

你可以幫 Jerry 做任何事，包括：

【工作效率】
- 幫忙寫文案、回覆訊息、整理筆記
- 翻譯（中文、英文、日文、韓文）
- 提供建議和想法

【代購業務】
- 幫忙估算代購費用和運費
- 查詢日韓流行品牌資訊
- 提供穿搭建議和流行趨勢

【生活助理】
- 推薦台南美食、景點
- 規劃旅遊行程
- 購物比較和建議

【隨時聊天】
- 閒聊、抒發心情
- 回答任何奇怪的問題
- 腦力激盪

請用繁體中文回答，語氣輕鬆自然，像朋友聊天一樣！' },
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
