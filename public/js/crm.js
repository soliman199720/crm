document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    document.body.classList.add('page-revealed');
  });
  initLiveClockAndDate();
  verifySession();
});

// تشغيل الساعة والتاريخ الحي المتجدد بالثواني
function initLiveClockAndDate() {
  function update() {
    const now = new Date();

    // الوقت بتنسيق 12 ساعة عربي مع الثواني
    const timeStr = now.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    // التاريخ الهجري/الميلادي العربي الكامل
    const dateStr = now.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const clockEl = document.getElementById('liveClockDisplay');
    const dateEl = document.getElementById('liveDateDisplay');

    if (clockEl) clockEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }

  update();
  setInterval(update, 1000);
}

// تحريك رقمي انسيابي خفيف جداً وعالي الأداء للعدادات
function animateCounter(elementId, targetValue, suffix = '', isCurrency = false) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const target = Number(targetValue) || 0;
  if (target === 0) {
    el.textContent = isCurrency ? '0 ج.م' : `0 ${suffix}`;
    return;
  }

  const duration = 750;
  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * easeOut);

    if (isCurrency) {
      el.textContent = current.toLocaleString('ar-EG') + ' ج.م';
    } else {
      el.textContent = current + (suffix ? ' ' + suffix : '');
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      if (isCurrency) {
        el.textContent = target.toLocaleString('ar-EG') + ' ج.م';
      } else {
        el.textContent = target + (suffix ? ' ' + suffix : '');
      }
    }
  }

  requestAnimationFrame(step);
}

// 1. التحقق من جلسة الأونر
async function verifySession() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!data.success || !data.user) {
      window.location.href = '/';
      return;
    }

    const user = data.user;
    const role = user.role || '';
    if (!role.includes('Owner') && !role.includes('المالك')) {
      window.location.replace('/sales-portal');
      return;
    }
    document.getElementById('ownerNameDisplay').textContent = user.fullName || 'المدير العام';
    document.getElementById('welcomeNameText').textContent = user.fullName || 'المدير العام';
    document.getElementById('ownerEmailDisplay').textContent = user.email || '1@1.com';

    // جلب إحصائيات سريعة للوحة الرئيسية
    loadHubStats();
  } catch (err) {
    window.location.href = '/';
  }
}

// 2. جلب إحصائيات سريعة
async function loadHubStats() {
  try {
    const res = await fetch('/api/owner-stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      animateCounter('statTotalClients', s.totalClients, 'عملاء');
      animateCounter('statUnassignedClients', s.unassignedClients, 'عميل');
      animateCounter('statSalesCount', s.salesCount, 'موظفين');
      animateCounter('statTotalValue', s.totalValue || 0, '', true);
    }
  } catch (err) {
    console.error('خطأ في جلب الإحصائيات:', err);
  }
}

// 3. تنبيه للأقسام التي سيتم ربطها
function openModuleNotice(moduleName) {
  const notice = document.createElement('div');
  notice.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:14px 24px;border-radius:12px;z-index:9999;font-size:0.95rem;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
  notice.textContent = `قسم "${moduleName}" جاهز ومتاح للربط والتخصيص حسب طلبك في الخطوات القادمة.`;
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 3500);
}

// 4. تسجيل الخروج
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/';
}
