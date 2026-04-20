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

async function callScript(action, params = {}) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    redirect: 'follow',
  });
  return response.json();
}

async function getProductList() {
  const result = await callScript('getProducts');
  if (!result.products || result.products.length === 0) return '目前尚無商品資料';
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
  if (event.type === 'join') {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '大家好！我是貝拉 👋\n\n📋 訂單管理指令：\n新增訂單：顧客名稱 商品 金額\n付款確認：訂單編號\n廠商下單：訂單編號 成本\n已出貨：訂單編號\n已完成：訂單編號\n\n🔍 快速查詢：\n訂單總覽\n待付款\n待採購\n待出貨\n\n💬 其他問題：@貝拉 任何問題' }],
    });
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text.trim();
  const isGroup = event.source.type === 'group' || event.source.type === 'room';

  try {

    // 新增商品
    const addProductMatch = userMessage.match(/新增商品\s*[：:]\s*(.+?)\s+(\d+)\s*(\d*)\s*(\d*)/);
    if (addProductMatch) {
      const result = await callScript('addProduct', {
        name: addProductMatch[1],
        price: addProductMatch[2],
        cost: addProductMatch[3] || 0,
        stock: addProductMatch[4] || 0,
        status: '現貨',
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 商品已新增！\n🆔 編號：${result.id}\n📦 商品：${addProductMatch[1]}\n💰 售價：${addProductMatch[2]} 元` }],
      });
      return;
    }

    // 賣出
    const saleMatch = userMessage.match(/賣出\s*[：:]\s*(.+?)\s+(\d+)/);
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

    // 新增訂單
    const addOrderMatch = userMessage.match(/新增訂單\s*[：:]\s*(.+?)\s+(.+?)\s+(\d+)/);
    if (addOrderMatch) {
      const result = await callScript('addOrder', {
        customer: addOrderMatch[1],
        product: addOrderMatch[2],
        price: addOrderMatch[3],
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 訂單已建立！\n━━━━━━━━━━━━━━\n📋 訂單編號：${result.orderId}\n👤 顧客：${addOrderMatch[1]}\n📦 商品：${addOrderMatch[2]}\n💰 金額：${addOrderMatch[3]} 元\n⏳ 狀態：待付款\n━━━━━━━━━━━━━━\n請將賣貨便連結傳給顧客 😊` }],
      });
      return;
    }

    // 付款確認
    const payMatch = userMessage.match(/付款確認\s*[：:]\s*(\S+)\s*(.*)/);
    if (payMatch) {
      const result = await callScript('updateOrder', {
        orderId: payMatch[1],
        status: '已付款',
        note: payMatch[2] || '',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 付款已確認！\n━━━━━━━━━━━━━━\n📋 訂單：${payMatch[1]}\n💳 狀態：已付款\n🛒 採購單：${result.purchaseId} 已建立\n━━━━━━━━━━━━━━\n記得去跟韓國廠商下單！` }],
        });
      }
      return;
    }

    // 廠商下單
    const purchaseMatch = userMessage.match(/廠商下單\s*[：:]\s*(\S+)\s*(\d*)/);
    if (purchaseMatch) {
      const result = await callScript('updateOrder', {
        orderId: purchaseMatch[1],
        status: '已向廠商下單',
        cost: purchaseMatch[2] || 0,
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 廠商下單完成！\n━━━━━━━━━━━━━━\n📋 訂單：${purchaseMatch[1]}\n🛒 狀態：已向廠商下單\n⏳ 等待廠商出貨中...` }],
        });
      }
      return;
    }

    // 已出貨
    const shipMatch = userMessage.match(/已出貨\s*[：:]\s*(\S+)/);
    if (shipMatch) {
      const result = await callScript('updateOrder', {
        orderId: shipMatch[1],
        status: '已出貨',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 已出貨！\n━━━━━━━━━━━━━━\n📋 訂單：${shipMatch[1]}\n📦 狀態：已出貨\n🚚 等待顧客收貨中...` }],
        });
      }
      return;
    }

    // 已完成
    const doneMatch = userMessage.match(/已完成\s*[：:]\s*(\S+)/);
    if (doneMatch) {
      const result = await callScript('updateOrder', {
        orderId: doneMatch[1],
        status: '已完成',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `🎉 訂單完成！\n━━━━━━━━━━━━━━\n📋 訂單：${doneMatch[1]}\n✅ 狀態：已完成\n📈 獲利：${result.profit} 元\n━━━━━━━━━━━━━━\n已自動寫入銷售紀錄！` }],
        });
      }
      return;
    }

    // 訂單總覽
    if (userMessage === '訂單總覽') {
      const result = await callScript('getOrders', {});
      if (!result.orders || result.orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有任何訂單 😊' }],
        });
        return;
      }
      const active = result.orders.filter(o => o.status !== '已完成');
      if (active.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有進行中的訂單 🎉' }],
        });
        return;
      }
      const text = `📋 進行中訂單（${active.length} 筆）\n━━━━━━━━━━━━━━\n` +
        active.map(o =>
          `🆔 ${o.id}\n👤 ${o.customer}\n📦 ${o.product}\n💰 ${o.price} 元\n⏳ ${o.status}`
        ).join('\n━━━━━━━━━━━━━━\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 快速查詢各狀態訂單
    const statusMap = {
      '待付款': '待付款',
      '待採購': '已付款',
      '待出貨': '已向廠商下單',
    };
    if (statusMap[userMessage]) {
      const result = await callScript('getOrders', { status: statusMap[userMessage] });
      if (!result.orders || result.orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `目前沒有「${userMessage}」的訂單 😊` }],
        });
        return;
      }
      const text = `📋 ${userMessage}訂單（${result.orders.length} 筆）\n━━━━━━━━━━━━━━\n` +
        result.orders.map(o =>
          `🆔 ${o.id} | 👤 ${o.customer}\n📦 ${o.product} | 💰 ${o.price} 元`
        ).join('\n━━━━━━━━━━━━━━\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 群組中只回應 @貝拉
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
【訂單管理】查詢訂單狀態、待處理訂單、本月訂單數量
【商品查詢】回答關於商品價格、庫存、狀態的問題
【代購業務】估算代購費用和運費、查詢韓國流行品牌資訊
【工作效率】寫文案、翻譯韓文、整理筆記
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
