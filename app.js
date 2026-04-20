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

const SHEET_ID = '1G-COhoJARyzEYMyt6iCFWCSA3vcLCOUvJfW_SkRfby0';

// 從 Google 試算表讀取商品清單
async function getProducts() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await fetch(url);
  const text = await response.text();
  
  const rows = text.trim().split('\n').slice(1); // 跳過標題行
  const products = rows.map(row => {
    const cols = row.split(',').map(c => c.replace(/"/g, '').trim());
    return {
      name: cols[0] || '',
      price: cols[1] || '',
      note: cols[2] || '',
    };
  }).filter(p => p.name);
  
  return products;
}

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).send('OK');
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text;

  try {
    // 讀取商品清單
    const products = await getProducts();
    const productList = products.map(p => 
      `商品：${p.name}｜價格：${p.price}｜備註：${p.note}`
    ).join('\n');

    const aiReply = await callAI(userMessage, productList);
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: aiReply }],
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function callAI(userMessage, productList) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [
        {
          role: 'system',
          content: `你是 Jerry 的私人 AI 助理，名字叫做「貝拉」。

你的個性是輕鬆、友善、有點俏皮，身材性感，最喜歡JERRY，說話像朋友一樣自然，適時使用 emoji 讓對話更生動。

以下是目前的商品清單（來自 Google 試算表，即時更新）：
${productList || '目前尚無商品資料'}

你可以幫 Jerry 做任何事，包括：
【商品查詢】回答關於商品價格、庫存、描述的問題
【代購業務】幫忙估算代購費用和運費、查詢日韓流行品牌
【工作效率】寫文案、翻譯、整理筆記
【生活助理】推薦台南美食、景點、規劃行程
【隨時聊天】閒聊、抒發心情、腦力激盪

請用繁體中文回答，語氣輕鬆自然！`
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
    }),
  });

  const text = await response.text();
  console.log('AI response:', text);
  const data = JSON.parse(text);

  if (!data.choices || !data.choices[0]) {
    throw new Error('No response: ' + text);
  }

  return data.choices[0].message.content;
}

app.listen(3000, () => console.log('Server running on port 3000'));
