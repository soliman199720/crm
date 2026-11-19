#!/bin/bash
# تشغيل نظام إدارة العملاء CRM على بيئات Linux / VPS / Cloud
set -e

echo "========================================================"
echo "      منظومة إدارة العملاء والمبيعات CRM"
echo "      نسخة الإنتاج الجاهزة للتشغيل (Production)"
echo "========================================================"

if [ ! -d "node_modules" ]; then
  echo "جاري تثبيت المكتبات البرمجية..."
  npm install --omit=dev
fi

export NODE_ENV=production
echo "جاري تشغيل خادم السي آر إم على المنفذ ${PORT:-3000}..."
node server.js
