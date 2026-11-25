/**
 * build.js
 * سكربت بناء وتجهيز حزمة الإنتاج الجاهزة للرفع والنشر (Production Dist Build)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('========================================================');
console.log('       جاري بناء الموقع وتجهيز مجلد dist للرفع');
console.log('========================================================\n');

const distDir = path.join(__dirname, 'dist');
const zipFile = path.join(__dirname, 'dist.zip');

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 1. تنظيف وتجهيز مجلد dist
console.log('🧹 [1/4] تنظيف وتجهيز مجلد dist...');
if (fs.existsSync(distDir)) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
  } catch (e) {}
}
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 2. نسخ الملفات الأساسية
console.log('📂 [2/4] نسخ ملفات الخادم وقاعدة البيانات والإعدادات...');
const filesToCopy = [
  'server.js',
  'db.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'schema.sql',
  'start.sh',
  'README.md'
];

for (const file of filesToCopy) {
  const src = path.join(__dirname, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`   ✓ تم نسخ: ${file}`);
  }
}

// 3. نسخ مجلد public بالكامل
console.log('🌐 [3/4] نسخ واجهات المستخدم وصفحات النظام (public)...');
const srcPublic = path.join(__dirname, 'public');
const destPublic = path.join(distDir, 'public');
copyRecursiveSync(srcPublic, destPublic);
console.log('   ✓ تم نسخ جميع صفحات الـ HTML والتنسيقات CSS والسكريبتات JS');

// 4. ضغط مجلد dist إلى ملف dist.zip جاهز للرفع
console.log('📦 [4/4] إنشاء ملف الأرشيف dist.zip الجاهز للرفع مباشرة...');
try {
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }
  // دعم إنشاء الأرشيف عبر PowerShell على ويندوز وعبر zip على Linux/VPS
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipFile}' -Force"`, { stdio: 'ignore' });
  } else {
    execSync(`cd "${distDir}" && zip -r "${zipFile}" .`, { stdio: 'ignore' });
  }
  console.log('   ✓ تم إنشاء ملف: dist.zip');
} catch (err) {
  console.warn('   ! تنبيه: تعذر ضغط الملف تلقائياً، ولكن مجلد dist جاهز بالكامل للرفع.');
}

console.log('\n========================================================');
console.log('✅ اكتمل بناء الموقع بنجاح!');
console.log('📁 مجلد الإنتاج الجاهز للرفع: ' + distDir);
console.log('📦 الملف المضغوط الجاهز للرفع: ' + zipFile);
console.log('========================================================\n');
