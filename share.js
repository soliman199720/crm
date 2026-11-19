const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

console.log('========================================================');
console.log('       جاري تشغيل ومشاركة مشروع CRM عبر الإنترنت');
console.log('========================================================\n');

function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getPublicIP() {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve('افتح https://loca.lt/mytunnelpassword'));
  });
}

async function main() {
  const isRunning = await checkServerRunning();
  if (!isRunning) {
    console.log('[1/3] جاري تشغيل سيرفر الـ CRM محلياً...');
    spawn('node', ['server.js'], { stdio: 'inherit', detached: false });
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    console.log('[1/3] سيرفر الـ CRM يعمل بالفعل على المنفذ 3000.');
  }

  console.log('[2/3] جاري جلب رقم الـ IP الخاص بك (كلمة المرور)...');
  const ip = await getPublicIP();

  console.log('\n========================================================');
  console.log('  كلمة المرور للطرف الثاني (Tunnel Password): ' + ip);
  console.log('========================================================\n');

  console.log('[3/3] جاري إنشاء الرابط الخارجي عبر localtunnel...');
  
  const localtunnel = require('localtunnel');
  try {
    const tunnel = await localtunnel({ port: 3000 });
    console.log('\n========================================================');
    console.log(' الرابط الخارجي جاهز الآن:');
    console.log('👉 ' + tunnel.url);
    console.log('========================================================');
    console.log('\nابعث الرابط وكلمة المرور للشخص الآخر.');
    console.log('ملاحظة: اترك هذه النافذة مفتوحة طوال فترة الاستخدام.\n');

    tunnel.on('close', () => {
      console.log('تم إغلاق الرابط الخارجي.');
    });
    tunnel.on('error', (err) => {
      console.error('تنبيه في الرابط:', err.message);
    });
  } catch (err) {
    console.error('تعذر إنشاء الرابط:', err.message);
    console.log('\nيمكنك تجربة الأمر المباشر:');
    console.log('npx localtunnel --port 3000');
  }
}

main();

