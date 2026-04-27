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

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1thsiQXBS2oSIoJGsqfP9O5UGkIZ4q6hJSL2D_PHArxnAAJeABZOz_yOM_OF6dORp/exec';
const LIFF_URL = 'https://liff.line.me/2009848785-XeUcZFkH';
const COMMANDS_LIFF_URL = 'https://liff.line.me/2009848785-nazfHeFe';
const ORDERS_LIFF_URL = 'https://liff.line.me/2009848785-RYVn3Fbp';

const pendingMerge = {};
const pendingWaiting = {};

async function callScript(action, params = {}) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    redirect: 'follow',
  });
  return response.json();
}

function parsePrice(str) {
  return Number(String(str).replace(/\$|,/g, '').trim()) || 0;
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
      messages: [{ type: 'text', text: '大家好！我是貝拉 👋\n\n傳「指令總覽」查看所有功能！' }],
    });
    return;
  }

  const sourceId = event.source.groupId || event.source.roomId || event.source.userId;
  const isGroup = event.source.type === 'group' || event.source.type === 'room';

  // 處理圖片訊息
  if (event.type === 'message' && event.message.type === 'image') {
    const imageId = event.message.id;
    pendingWaiting[sourceId] = { imageId, timestamp: Date.now() };
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '📷 收到圖片！\n請輸入待訂資訊：\n\n格式：顧客/商品/$金額/$成本/備註/付款狀態\n範例：王小美/韓國外套/$2180/$1500/等補貨/已付款' }],
    });
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userMessage = event.message.text.trim();

  try {

    // 收到圖片後輸入待訂資訊
    if (pendingWaiting[sourceId]) {
      const pending = pendingWaiting[sourceId];
      if (Date.now() - pending.timestamp < 5 * 60 * 1000) {
        const parts = userMessage.split('/').map(s => s.trim());
        if (parts.length >= 3) {
          const paymentStatus = parts[5] === '已付款' ? '已付款' : '未付款';
          const result = await callScript('addWaiting', {
            customer: parts[0],
            product: parts[1],
            price: parsePrice(parts[2]),
            cost: parsePrice(parts[3] || '0'),
            note: parts[4] || '',
            link: '',
            imageUrl: `https://api-data.line.me/v2/bot/message/${pending.imageId}/content`,
            paymentStatus,
          });
          delete pendingWaiting[sourceId];
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: `📝 待訂已記錄！\n━━━━━━━━━━━━━━\n🆔 待訂編號：${result.waitId}\n👤 顧客：${parts[0]}\n📦 商品：${parts[1]}\n💰 金額：${parsePrice(parts[2])} 元\n💵 成本：${parsePrice(parts[3] || '0')} 元\n📋 備註：${parts[4] || '無'}\n💳 付款：${paymentStatus}\n🖼️ 圖片：已儲存\n━━━━━━━━━━━━━━\n可下單後傳「待訂轉訂單：${result.waitId}」` }],
          });
          return;
        }
      } else {
        delete pendingWaiting[sourceId];
      }
    }

    // 合併訂單確認
    const mergeMatch = userMessage.match(/^合併\s*[：:]?\s*(\S+)/);
    if (mergeMatch && pendingMerge[sourceId]) {
      const pending = pendingMerge[sourceId];
      const result = await callScript('mergeOrder', {
        orderId: mergeMatch[1],
        newProduct: pending.newProduct,
        newPrice: pending.newPrice,
      });
      delete pendingMerge[sourceId];
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 訂單已合併！\n━━━━━━━━━━━━━━\n📋 訂單編號：${result.orderId}\n📦 商品：${result.mergedProduct}\n💰 合計：${result.mergedPrice} 元` }],
        });
      }
      return;
    }

    // 不合併另開新單
    if (userMessage === '不合併' && pendingMerge[sourceId]) {
      const pending = pendingMerge[sourceId];
      delete pendingMerge[sourceId];
      const result = await callScript('addOrder', {
        customer: pending.customer,
        product: pending.newProduct,
        price: pending.newPrice,
        forceNew: true,
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已另開新訂單！\n━━━━━━━━━━━━━━\n📋 訂單編號：${result.orderId}\n👤 顧客：${pending.customer}\n📦 商品：${pending.newProduct}\n💰 金額：${pending.newPrice} 元\n⏳ 狀態：待付款` }],
      });
      return;
    }

    // 新增商品
    const addProductMatch = userMessage.match(/^新增商品\s*[：:]\s*(.+)/);
    if (addProductMatch) {
      const parts = addProductMatch[1].split('/').map(s => s.trim());
      if (parts.length < 2) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 格式錯誤！\n正確格式：新增商品：名稱/$售價/$成本/庫存\n範例：新增商品：韓國波點外套/$2180/$1500/10' }],
        });
        return;
      }
      const result = await callScript('addProduct', {
        name: parts[0],
        price: parsePrice(parts[1]),
        cost: parsePrice(parts[2] || '0'),
        stock: Number(parts[3]) || 0,
        status: '現貨',
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 商品已新增！\n🆔 編號：${result.id}\n📦 商品：${parts[0]}\n💰 售價：${parsePrice(parts[1])} 元\n💵 成本：${parsePrice(parts[2] || '0')} 元\n📦 庫存：${Number(parts[3]) || 0} 件` }],
      });
      return;
    }

    // 賣出
    const saleMatch = userMessage.match(/^賣出\s*[：:]\s*(.+)/);
    if (saleMatch) {
      const parts = saleMatch[1].split('/').map(s => s.trim());
      const result = await callScript('addSale', {
        name: parts[0], id: parts[0], qty: Number(parts[1]) || 1,
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

    // 新增訂單（支援成本和貨到付款）
    // 格式：新增訂單：顧客/商品/$金額/$成本/貨到付款
    const addOrderMatch = userMessage.match(/^新增訂單\s*[：:]\s*(.+)/);
    if (addOrderMatch) {
      const parts = addOrderMatch[1].split('/').map(s => s.trim());
      if (parts.length < 3) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 格式錯誤！\n正確格式：新增訂單：顧客/商品/$金額/$成本\n貨到付款：新增訂單：顧客/商品/$金額/$成本/貨到付款\n\n成本可不填：新增訂單：顧客/商品/$金額' }],
        });
        return;
      }

      // 判斷是否有成本和貨到付款
      let cost = 0;
      let isCOD = false;
      if (parts[3]) {
        if (parts[3] === '貨到付款') {
          isCOD = true;
        } else {
          cost = parsePrice(parts[3]);
        }
      }
      if (parts[4] === '貨到付款') isCOD = true;

      const result = await callScript('addOrder', {
        customer: parts[0],
        product: parts[1],
        price: parsePrice(parts[2]),
        cost: cost,
        paymentType: isCOD ? '貨到付款' : '',
      });
      if (result.needMerge) {
        pendingMerge[sourceId] = {
          customer: parts[0],
          newProduct: parts[1],
          newPrice: parsePrice(parts[2]),
        };
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `⚠️ 偵測到同買家訂單！\n━━━━━━━━━━━━━━\n👤 顧客：${parts[0]}\n📋 現有訂單：${result.existingOrderId}\n📦 現有商品：${result.existingProduct}\n💰 現有金額：${result.existingPrice} 元\n━━━━━━━━━━━━━━\n🆕 新增商品：${parts[1]}\n💰 新增金額：${parsePrice(parts[2])} 元\n━━━━━━━━━━━━━━\n要合併到現有訂單嗎？\n✅ 回覆「合併：${result.existingOrderId}」\n❌ 回覆「不合併」另開新單` }],
        });
        return;
      }
      const statusText = isCOD ? '💵 貨到付款' : '⏳ 待付款';
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 訂單已建立！\n━━━━━━━━━━━━━━\n📋 訂單編號：${result.orderId}\n👤 顧客：${parts[0]}\n📦 商品：${parts[1]}\n💰 金額：${parsePrice(parts[2])} 元\n💵 成本：${cost || '未填'} 元\n${statusText}\n━━━━━━━━━━━━━━\n請將賣貨便連結傳給顧客 😊` }],
      });
      return;
    }

    // 付款確認
    const payMatch = userMessage.match(/^付款確認\s*[：:]\s*(.+)/);
    if (payMatch) {
      const parts = payMatch[1].split('/').map(s => s.trim());
      const result = await callScript('updateOrder', {
        orderId: parts[0], status: '已付款', note: parts[1] || '',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 付款已確認！\n━━━━━━━━━━━━━━\n📋 訂單：${parts[0]}\n💳 狀態：已付款\n📝 備註：${parts[1] || '無'}\n━━━━━━━━━━━━━━\n記得去跟韓國廠商下單！\n使用：分批下單：${parts[0]}/商品/$成本` }],
        });
      }
      return;
    }

    // 分批下單
    const batchPurchaseMatch = userMessage.match(/^分批下單\s*[：:]\s*(.+)/);
    if (batchPurchaseMatch) {
      const parts = batchPurchaseMatch[1].split('/').map(s => s.trim());
      if (parts.length < 2) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 格式錯誤！\n正確格式：分批下單：訂單編號/商品/$成本\n範例：分批下單：ORD001/韓國外套/$1500' }],
        });
        return;
      }
      const result = await callScript('addPurchase', {
        orderId: parts[0], product: parts[1], cost: parsePrice(parts[2] || '0'),
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 廠商下單完成！\n━━━━━━━━━━━━━━\n🛒 採購單號：${result.purchaseId}\n📋 關聯訂單：${result.orderId}\n📦 商品：${result.product}\n━━━━━━━━━━━━━━\n出貨時傳：部分出貨：${result.orderId}/${result.purchaseId}` }],
        });
      }
      return;
    }

    // 填入成本
    const updateCostMatch = userMessage.match(/^填入成本\s*[：:]\s*(.+)/);
    if (updateCostMatch) {
      const parts = updateCostMatch[1].split('/').map(s => s.trim());
      const result = await callScript('updateCost', {
        purchaseId: parts[0], cost: parsePrice(parts[1]),
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 成本已更新！\n🛒 採購單：${parts[0]}\n💵 成本：${parsePrice(parts[1])} 元` }],
        });
      }
      return;
    }

    // 部分出貨
    const partialShipMatch = userMessage.match(/^部分出貨\s*[：:]\s*(.+)/);
    if (partialShipMatch) {
      const parts = partialShipMatch[1].split('/').map(s => s.trim());
      const result = await callScript('partialShip', {
        orderId: parts[0], purchaseId: parts[1],
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        const allShippedMsg = result.allShipped
          ? '\n🎉 所有商品已全部出貨！\n可以傳「已完成：' + parts[0] + '」完成訂單'
          : '\n⏳ 還有其他商品待出貨';
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 部分出貨完成！\n━━━━━━━━━━━━━━\n📋 訂單：${parts[0]}\n🛒 採購單：${parts[1]}\n📦 狀態：已出貨${allShippedMsg}` }],
        });
      }
      return;
    }

    // 已出貨
    const shipMatch = userMessage.match(/^已出貨\s*[：:]\s*(\S+)/);
    if (shipMatch) {
      const result = await callScript('updateOrder', {
        orderId: shipMatch[1], status: '已出貨',
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
    const doneMatch = userMessage.match(/^已完成\s*[：:]\s*(\S+)/);
    if (doneMatch) {
      const result = await callScript('updateOrder', {
        orderId: doneMatch[1], status: '已完成',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        let stockMsg = '';
        if (result.stockUpdated && result.stockUpdated.length > 0) {
          stockMsg = '\n📦 庫存更新：\n' + result.stockUpdated.map(s =>
            `• ${s.name}：剩餘 ${s.newStock} 件${s.newStock === 0 ? '（已售完）' : ''}`
          ).join('\n');
        }
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `🎉 訂單完成！\n━━━━━━━━━━━━━━\n📋 訂單：${doneMatch[1]}\n✅ 狀態：已完成\n📈 獲利：${result.profit} 元${stockMsg}\n━━━━━━━━━━━━━━\n已自動寫入銷售紀錄！` }],
        });
      }
      return;
    }

    // 取消訂單
    const cancelMatch = userMessage.match(/^取消訂單\s*[：:]\s*(.+)/);
    if (cancelMatch) {
      const parts = cancelMatch[1].split('/').map(s => s.trim());
      const result = await callScript('updateOrder', {
        orderId: parts[0], status: '已取消', note: parts[1] || '',
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        let refundMsg = '';
        if (result.needRefund) {
          refundMsg = '\n⚠️ 此訂單先前狀態為「' + result.previousStatus + '」\n請記得處理退款事宜！';
        }
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `🚫 訂單已取消！\n━━━━━━━━━━━━━━\n📋 訂單：${parts[0]}\n❌ 狀態：已取消\n📝 原因：${parts[1] || '無'}${refundMsg}` }],
        });
      }
      return;
    }

    // 修改訂單
    const editMatch = userMessage.match(/^修改訂單\s*[：:]\s*(.+)/);
    if (editMatch) {
      const parts = editMatch[1].split('/').map(s => s.trim());
      if (parts.length < 3) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 格式錯誤！\n正確格式：修改訂單：訂單編號/欄位/新內容\n\n可修改欄位：商品、金額、顧客、備註、成本\n\n範例：\n修改訂單：ORD001/商品/韓國牛仔外套\n修改訂單：ORD001/金額/$2500\n修改訂單：ORD001/成本/$1500' }],
        });
        return;
      }
      const result = await callScript('editOrder', {
        orderId: parts[0], field: parts[1], value: parts[2],
      });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 訂單已修改！\n━━━━━━━━━━━━━━\n📋 訂單：${parts[0]}\n✏️ ${parts[1]}：${parts[2]}` }],
        });
      }
      return;
    }

    // 新增待訂（含成本和付款狀態）
    // 格式：新增待訂：顧客/商品/$金額/$成本/備註/付款狀態/連結
    const addWaitMatch = userMessage.match(/^新增待訂\s*[：:]\s*(.+)/);
    if (addWaitMatch) {
      const parts = addWaitMatch[1].split('/').map(s => s.trim());
      if (parts.length < 3) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 格式錯誤！\n正確格式：新增待訂：顧客/商品/$金額/$成本/備註/付款狀態\n\n範例：新增待訂：王小美/韓國外套/$2180/$1500/等補貨/已付款\n\n付款狀態可填：已付款 或 未付款（預設未付款）' }],
        });
        return;
      }
      const paymentStatus = parts[5] === '已付款' ? '已付款' : '未付款';
      const link = parts[6] && parts[6].startsWith('http') ? parts[6] : '';
      const result = await callScript('addWaiting', {
        customer: parts[0],
        product: parts[1],
        price: parsePrice(parts[2]),
        cost: parsePrice(parts[3] || '0'),
        note: parts[4] || '',
        link,
        imageUrl: '',
        paymentStatus,
      });
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `📝 待訂已記錄！\n━━━━━━━━━━━━━━\n🆔 待訂編號：${result.waitId}\n👤 顧客：${parts[0]}\n📦 商品：${parts[1]}\n💰 金額：${parsePrice(parts[2])} 元\n💵 成本：${parsePrice(parts[3] || '0')} 元\n📋 備註：${parts[4] || '無'}\n💳 付款：${paymentStatus}\n🔗 連結：${link || '無'}\n━━━━━━━━━━━━━━\n可下單後傳「待訂轉訂單：${result.waitId}」` }],
      });
      return;
    }

    // 查詢待訂清單
    if (userMessage === '待訂清單') {
      const result = await callScript('getWaiting', {});
      if (!result.list || result.list.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有待訂記錄 😊' }],
        });
        return;
      }
      const text = `📝 待訂清單（${result.list.length} 筆）\n━━━━━━━━━━━━━━\n` +
        result.list.map(w =>
          `🆔 ${w.id}\n👤 ${w.customer}\n📦 ${w.product}\n💰 ${w.price} 元｜💵 成本：${w.cost || '未填'} 元\n${w.paymentStatus === '已付款' ? '💳 已付款' : '⏳ 未付款'}\n📋 ${w.note || '無備註'}${w.link ? '\n🔗 ' + w.link : ''}${w.imageUrl ? '\n🖼️ 有圖片' : ''}\n📅 ${w.date}`
        ).join('\n━━━━━━━━━━━━━━\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 待訂轉正式訂單（自動帶入付款狀態和成本）
    const convertMatch = userMessage.match(/^待訂轉訂單\s*[：:]\s*(\S+)/);
    if (convertMatch) {
      const result = await callScript('convertWaiting', { waitId: convertMatch[1] });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        const paymentMsg = result.paymentStatus === '已付款' ? '💳 已付款' : '⏳ 待付款';
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 待訂已轉為正式訂單！\n━━━━━━━━━━━━━━\n📋 訂單編號：${result.orderId}\n👤 顧客：${result.customer}\n📦 商品：${result.product}\n💰 金額：${result.price} 元\n💵 成本：${result.cost || '未填'} 元\n${paymentMsg}\n━━━━━━━━━━━━━━\n${result.paymentStatus === '已付款' ? '已自動標記為已付款，記得去跟廠商下單！' : '請將賣貨便連結傳給顧客 😊'}` }],
        });
      }
      return;
    }

    // 刪除待訂
    const deleteWaitMatch = userMessage.match(/^刪除待訂\s*[：:]\s*(\S+)/);
    if (deleteWaitMatch) {
      const result = await callScript('deleteWaiting', { waitId: deleteWaitMatch[1] });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `🗑️ 待訂 ${deleteWaitMatch[1]} 已刪除！` }],
        });
      }
      return;
    }
    // 訂單管理系統
if (userMessage === '訂單管理' || userMessage === '開單系統' || userMessage === '訂單系統') {
  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'template',
      altText: '貝拉訂單管理系統',
      template: {
        type: 'buttons',
        title: '📋 訂單管理系統',
        text: '點下方按鈕開啟視覺化訂單管理',
        actions: [{ type: 'uri', label: '開啟訂單系統', uri: ORDERS_LIFF_URL }],
      },
    }],
  });
  return;
}

    // 指令總覽
    if (userMessage === '指令總覽' || userMessage === '查詢功能' || userMessage === '功能列表') {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '貝拉指令總覽',
          template: {
            type: 'buttons',
            title: '🤖 貝拉指令總覽',
            text: '點下方按鈕開啟完整指令選單',
            actions: [{ type: 'uri', label: '開啟指令總覽', uri: COMMANDS_LIFF_URL }],
          },
        }],
      });
      return;
    }

    // 核對收貨
    if (userMessage === '核對收貨' || userMessage === '開始核對' || userMessage === '叫出訂購單') {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'template',
          altText: '核對收貨系統',
          template: {
            type: 'buttons',
            title: '🛍️ 核對收貨系統',
            text: '點下方按鈕開啟核對介面',
            actions: [{ type: 'uri', label: '開啟核對介面', uri: LIFF_URL }],
          },
        }],
      });
      return;
    }

    // 查顧客訂單
    const customerMatch = userMessage.match(/^查顧客\s*[：:]\s*(.+)/);
    if (customerMatch) {
      const result = await callScript('searchByCustomer', { customer: customerMatch[1].trim() });
      if (!result.orders || result.orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `找不到「${customerMatch[1]}」的訂單 😕` }],
        });
        return;
      }
      const statusEmoji = { '待付款': '⏳', '貨到付款': '💵', '已付款': '💳', '已向廠商下單': '🛒', '已出貨': '📦', '已完成': '✅', '已取消': '🚫' };
      const text = `👤 ${customerMatch[1]} 的訂單（${result.orders.length} 筆）\n━━━━━━━━━━━━━━\n` +
        result.orders.map(o =>
          `📋 ${o.id}\n📦 ${o.product}\n💰 ${o.price} 元\n${statusEmoji[o.status] || '📌'} ${o.status}\n📅 ${o.date}`
        ).join('\n━━━━━━━━━━━━━━\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 查商品
    const productMatch = userMessage.match(/^查商品\s*[：:]\s*(.+)/);
    if (productMatch) {
      const result = await callScript('searchByProduct', { product: productMatch[1].trim() });
      if (!result.orders || result.orders.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `找不到「${productMatch[1]}」的相關訂單 😕` }],
        });
        return;
      }
      const statusEmoji = { '待付款': '⏳', '貨到付款': '💵', '已付款': '💳', '已向廠商下單': '🛒', '已出貨': '📦', '已完成': '✅', '已取消': '🚫' };
      let text = `📦 「${productMatch[1]}」查詢結果\n━━━━━━━━━━━━━━\n`;
      text += `📊 累計數據\n🛍️ 已售數量：${result.totalQty} 件\n💰 累計營收：${result.totalRevenue} 元\n📈 累計獲利：${result.totalProfit} 元\n`;
      text += `━━━━━━━━━━━━━━\n📋 相關訂單（${result.orders.length} 筆）\n`;
      text += result.orders.map(o =>
        `${o.id} | 👤 ${o.customer}\n${statusEmoji[o.status] || '📌'} ${o.status} | 💰 ${o.price} 元`
      ).join('\n━━━━━━━━━━━━━━\n');
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 查單筆訂單
    const orderIdMatch = userMessage.match(/^查訂單\s*[：:]\s*(\S+)/);
    if (orderIdMatch) {
      const result = await callScript('searchByOrderId', { orderId: orderIdMatch[1] });
      if (result.error) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `❌ ${result.error}` }],
        });
        return;
      }
      const o = result.order;
      const statusEmoji = { '待付款': '⏳', '貨到付款': '💵', '已付款': '💳', '已向廠商下單': '🛒', '已出貨': '📦', '已完成': '✅', '已取消': '🚫' };
      let text = `📋 訂單詳細資料\n━━━━━━━━━━━━━━\n🆔 ${o.id}\n📅 ${o.date}\n👤 ${o.customer}\n📦 ${o.product}\n💰 ${o.price} 元\n💵 成本：${o.cost || '未填'} 元\n🚚 運費：${o.shipping} 元\n${statusEmoji[o.status] || '📌'} ${o.status}\n📝 ${o.note || '無備註'}`;
      if (o.purchases && o.purchases.length > 0) {
        text += `\n━━━━━━━━━━━━━━\n🛒 採購明細（${o.purchases.length} 筆）\n`;
        text += o.purchases.map(p =>
          `${p.id} | ${p.product}\n💵 ${p.cost || '未填'} 元 | ${p.status}`
        ).join('\n');
      }
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
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
      const active = result.orders.filter(o => o.status !== '已完成' && o.status !== '已取消');
      if (active.length === 0) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '目前沒有進行中的訂單 🎉' }],
        });
        return;
      }
      const groups = {
        '待付款': active.filter(o => o.status === '待付款'),
        '貨到付款': active.filter(o => o.status === '貨到付款'),
        '待採購': active.filter(o => o.status === '已付款'),
        '待出貨': active.filter(o => o.status === '已向廠商下單'),
        '已出貨': active.filter(o => o.status === '已出貨'),
      };
      let text = `📋 訂單總覽（${active.length} 筆）\n━━━━━━━━━━━━━━\n`;
      if (groups['待付款'].length > 0) {
        text += `⏳ 待付款（${groups['待付款'].length} 筆）\n`;
        text += groups['待付款'].map(o => `${o.id} ${o.customer}｜${o.product}｜${o.price}元`).join('\n');
        text += '\n━━━━━━━━━━━━━━\n';
      }
      if (groups['貨到付款'].length > 0) {
        text += `💵 貨到付款（${groups['貨到付款'].length} 筆）\n`;
        text += groups['貨到付款'].map(o => `${o.id} ${o.customer}｜${o.product}｜${o.price}元`).join('\n');
        text += '\n━━━━━━━━━━━━━━\n';
      }
      if (groups['待採購'].length > 0) {
        text += `💳 待採購（${groups['待採購'].length} 筆）\n`;
        text += groups['待採購'].map(o => `${o.id} ${o.customer}｜${o.product}｜${o.price}元`).join('\n');
        text += '\n━━━━━━━━━━━━━━\n';
      }
      if (groups['待出貨'].length > 0) {
        text += `🛒 待出貨（${groups['待出貨'].length} 筆）\n`;
        text += groups['待出貨'].map(o => `${o.id} ${o.customer}｜${o.product}｜${o.price}元`).join('\n');
        text += '\n━━━━━━━━━━━━━━\n';
      }
      if (groups['已出貨'].length > 0) {
        text += `📦 已出貨（${groups['已出貨'].length} 筆）\n`;
        text += groups['已出貨'].map(o => `${o.id} ${o.customer}｜${o.product}｜${o.price}元`).join('\n');
      }
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text }],
      });
      return;
    }

    // 快速查詢各狀態
    const statusMap = { '待付款': '待付款', '待採購': '已付款', '待出貨': '已向廠商下單', '貨到付款': '貨到付款' };
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
【待訂管理】記錄尚未能下單的顧客需求
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
