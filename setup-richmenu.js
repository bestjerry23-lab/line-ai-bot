const https = require('https');

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// 建立圖文選單
async function createRichMenu() {
  const richMenu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: '貝拉功能選單',
    chatBarText: '功能選單',
    areas: [
      // 上排左：訂單總覽
      {
        bounds: { x: 0, y: 0, width: 833, height: 421 },
        action: { type: 'message', text: '訂單總覽' }
      },
      // 上排中：待訂清單
      {
        bounds: { x: 833, y: 0, width: 834, height: 421 },
        action: { type: 'message', text: '待訂清單' }
      },
      // 上排右：查詢功能
      {
        bounds: { x: 1667, y: 0, width: 833, height: 421 },
        action: { type: 'message', text: '查詢功能' }
      },
      // 下排左：核對收貨
      {
        bounds: { x: 0, y: 421, width: 833, height: 422 },
        action: { type: 'message', text: '核對收貨' }
      },
      // 下排中：營收報表
      {
        bounds: { x: 833, y: 421, width: 834, height: 422 },
        action: { type: 'message', text: '營收報表' }
      },
      // 下排右：問貝拉
      {
        bounds: { x: 1667, y: 421, width: 833, height: 422 },
        action: { type: 'message', text: '@貝拉 ' }
      },
    ]
  };

  const body = JSON.stringify(richMenu);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/richmenu',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        console.log('✅ 圖文選單建立成功！richMenuId:', result.richMenuId);
        resolve(result.richMenuId);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 上傳選單圖片
async function uploadImage(richMenuId) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const imageData = fs.readFileSync('richmenu.png');

    const req = https.request({
      hostname: 'api-data.line.me',
      path: `/v2/bot/richmenu/${richMenuId}/content`,
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`,
        'Content-Length': imageData.length,
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('✅ 圖片上傳成功！');
        resolve();
      });
    });
    req.on('error', reject);
    req.write(imageData);
    req.end();
  });
}

// 設為預設選單
async function setDefault(richMenuId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: `/v2/bot/user/all/richmenu/${richMenuId}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`,
        'Content-Length': 0,
      }
    }, (res) => {
      console.log('✅ 已設為預設選單！所有用戶都能看到');
      resolve();
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('開始建立圖文選單...');
  const richMenuId = await createRichMenu();
  await uploadImage(richMenuId);
  await setDefault(richMenuId);
  console.log('🎉 完成！重新開啟 LINE 就能看到選單了');
}

main().catch(console.error);
