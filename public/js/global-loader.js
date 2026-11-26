/**
 * Global Page Loader Controller
 * Smart CRM Unified Experience
 */
(function() {
  function dismissGlobalLoader() {
    const loader = document.getElementById('globalCrmLoader');
    if (loader && !loader.classList.contains('fade-out')) {
      loader.style.pointerEvents = 'none';
      loader.classList.add('fade-out');
      document.body.classList.add('page-revealed');
      setTimeout(function() {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
      }, 480);
    }
  }

  // إتاحة الدالة عالمياً لأي صفحة تريد إخفاءه فور اكتمال الـ API
  window.dismissGlobalLoader = dismissGlobalLoader;

  // دالة موحدة لتأمين النصوص ومنع ثغرات XSS عبر كافة صفحات النظام
  window.escapeHtml = function(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // نافذة تأكيد موحدة للتنبيهات الهامة (مثل استعادة عميل من الأرشيف)
  window.showCrmConfirmDialog = function({ title = 'تنبيه وتأكيد', message = '', confirmText = 'تأكيد وإضافة', cancelText = 'إلغاء' } = {}) {
    return new Promise(function(resolve) {
      const existing = document.getElementById('crmDynamicConfirmOverlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'crmDynamicConfirmOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.62);backdrop-filter:blur(4px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;font-family:Cairo,sans-serif;';

      const card = document.createElement('div');
      card.style.cssText = 'background:#ffffff;border-radius:18px;max-width:480px;width:100%;padding:24px;box-shadow:0 24px 48px rgba(15,23,42,0.28);border:1px solid #e2e8f0;text-align:center;';

      const iconWrap = document.createElement('div');
      iconWrap.style.cssText = 'width:56px;height:56px;border-radius:50%;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin:0 auto 14px;';
      iconWrap.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';

      const heading = document.createElement('h3');
      heading.style.cssText = 'margin:0 0 10px;font-size:1.15rem;font-weight:800;color:#0f172a;';
      heading.textContent = title;

      const body = document.createElement('p');
      body.style.cssText = 'margin:0 0 20px;font-size:0.95rem;line-height:1.7;color:#334155;white-space:pre-line;';
      body.textContent = message;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = cancelText;
      cancelBtn.style.cssText = 'padding:10px 20px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#475569;font-weight:700;font-family:inherit;cursor:pointer;font-size:0.92rem;';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.textContent = confirmText;
      confirmBtn.style.cssText = 'padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#ffffff;font-weight:800;font-family:inherit;cursor:pointer;font-size:0.92rem;box-shadow:0 4px 12px rgba(217,119,6,0.3);';

      function cleanup(result) {
        overlay.remove();
        resolve(result);
      }

      cancelBtn.onclick = function() { cleanup(false); };
      confirmBtn.onclick = function() { cleanup(true); };
      overlay.onclick = function(e) { if (e.target === overlay) cleanup(false); };

      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      card.appendChild(iconWrap);
      card.appendChild(heading);
      card.appendChild(body);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  };

  // دالة للتحقق من أمان روابط الصور (تسمح بالرفع المحلي وروابط http/https و data:image فقط)
  window.isSafeImageUrl = function(url) {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    return trimmed.startsWith('/uploads/') ||
      /^https?:\/\//i.test(trimmed) ||
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(trimmed);
  };

  // ضبط شريط التنقل العلوي في صفحات المشروعات حسب صلاحية المستخدم (أونر أم سيلز)
  window.applyProjectsTopbarForRole = function(user) {
    const role = (user && user.role) ? user.role : '';
    const isOwner = role.includes('Owner') || role.includes('المالك');
    if (isOwner) {
      document.body.classList.add('role-owner');
      return;
    }

    document.querySelectorAll('.topbar-nav-pills a[href="/sales"], .topbar-nav-pills a[href="/users"], .topbar-nav-pills a[href="/logs"]').forEach(function(el) {
      el.remove();
    });

    document.querySelectorAll('a[href="/crm"]').forEach(function(link) {
      link.setAttribute('href', '/sales-portal');
      link.setAttribute('title', 'العودة لبوابة السيلز');
      const span = link.querySelector('span');
      if (span) span.textContent = 'العودة لبوابة السيلز';
    });

    document.querySelectorAll('.db-live-pill').forEach(function(el) {
      el.remove();
    });

    document.querySelectorAll('.brand-badge-pill').forEach(function(el) {
      if (el.textContent.trim() === 'البوابة الإدارية') {
        el.textContent = 'بوابة المبيعات';
      }
    });

    document.querySelectorAll('.owner-badge').forEach(function(badge) {
      const strong = badge.querySelector('.owner-text strong');
      const small = badge.querySelector('.owner-text small');
      const icon = badge.querySelector('.avatar-circle i');
      if (strong) strong.textContent = (user && (user.fullName || user.full_name)) || 'مسؤول المبيعات';
      if (small) small.textContent = role || 'سيلز (Sales)';
      if (icon) icon.className = 'fa-solid fa-headset';
    });
  };

  // إخفاء شاشة التحميل فور جاهزية الهيكل دون انتظار الموارد الخارجية (الخطوط/الأيقونات)
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(dismissGlobalLoader, 80);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(dismissGlobalLoader, 80);
    });
  }

  // إخفاء فوري عند العودة عبر أزرار المتصفح (bfcache)
  window.addEventListener('pageshow', function(event) {
    if (event.persisted) dismissGlobalLoader();
  });

  // صمام أمان زمني إضافي في حالة تأخر الـ API أو أي طلب شبكة
  setTimeout(dismissGlobalLoader, 600);
})();

