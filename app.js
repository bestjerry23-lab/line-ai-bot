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
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1thsiQXBS2oSIoJGsqfP9O5UGkIZ4q6hJSL2D_PHArxnAAJeABZOz_yOM_OF6dORp/exec';

// 呼叫 Apps Script
async function callScript(action, params = {}) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    redirect: 'follow',
  });
  return response.json();
}

// 讀取商品清單（給 AI 用）
async function getProductList() {
  const result = await callScript('getProducts');
  if (!result.products) return '目前尚無商品資料';
  return result.products.map(p =>
    `[${p.id}] ${p.name}｜售價：${p.price}元｜庫存：${p.stock}｜狀態：${p.status}`
  ).join('\n');
}

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).send('OK');
});

async function handleEvent(event) {
  // 自動接受群組邀請
  if (event.type === 'join') {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '大家好！我是貝拉 👋\n\n我可以幫你：\n📦 新增商品：新增商品：商品名稱 售價 成本 庫存\n💰 記錄賣出：賣出：商品編號或名稱 數量\n🔍 查詢商品：@貝拉 有沒有XXX？\n💬 其他問題：@貝拉 任何問題' }],
    });
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text.trim();
  const isGroup = event.source.type === 'group' || event.source.type === 'room';

  try {
    // 新增商品指令
    // 格式：新增商品：商品名稱 售價 成本 庫存
    const addMatch = userMessage.match(/新增商品[：:]\s*(.+?)\s+(\d+)\s*(\d*)\s*(\d*)/);
    if (addMatch) {
      const result = await callScript('addProduct', {
        name: addMatch[1],
        price: addMatch[2],
        cost: addMatch[3] || 0,
        stock: addMatch[4] || 0,
        status: '現貨',
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 商品已新增！\n🆔 編號：${result.id}\n📦 商品：${addMatch[1]}\n💰 售價：${addMatch[2]} 元\n📊 成本：${addMatch[3] || 0} 元\n🏷️ 庫存：${addMatch[4] || 0} 件` }],
      });
      return;
    }

    // 賣出指令
    // 格式：賣出：商品編號或名稱 數量
    const saleMatch = userMessage.match(/賣出[：:]\s*(.+?)\s+(\d+)/);
    if (saleMatch) {
      const result = await callScript('addSale', {
        name: saleMatch[1],
        id: saleMatch[1],
        qty: saleMatch[2],
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 銷售紀錄已新增！\n💰 銷售金額：${result.total} 元\n📈 獲利：${result.profit} 元\n📦 剩餘庫存：${result.newStock} 件` }],
        });
      }
      return;
    }

    // 群組中只回應 @貝拉 開頭
    if (isGroup && !userMessage.startsWith('@貝拉')) return;

    const question = userMessage.replace('@貝拉', '').trim();
    const productList = await getProductList();
    const aiReply = await callAI(question, productList);

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
你的個性是輕鬆、友善、有點俏皮，說話像朋友一樣自然，適時使用 emoji 讓對話更生動。

以下是目前的商品清單（即時更新）：
${productList}

你可以幫 Jerry 做任何事：
【商品查詢】回答關於商品價格、庫存、狀態的問題
【代購業務】估算代購費用和運費、查詢日韓流行品牌資訊
【工作效率】寫文案、翻譯、整理筆記
【生活助理】推薦台南美食、景點、規劃行程
【隨時聊天】閒聊、抒發心情、腦力激盪

請用繁體中文回答，語氣輕鬆自然！`
        },
        { role: 'user', content: userMessage }
      ],
    }),
  });

  const text = await response.text();
  const data = JSON.parse(text);
  if (!data.choices || !data.choices[0]) throw new Error('No response: ' + text);
  return data.choices[0].message.content;
}

app.listen(3000, () => console.log('Server running on port 3000'));
