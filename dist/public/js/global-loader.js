/**
 * Global Page Loader Controller
 * Smart CRM Unified Experience
 */
(function() {
  function dismissGlobalLoader() {
    const loader = document.getElementById('globalCrmLoader');
    if (loader && !loader.classList.contains('fade-out')) {
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

  // صمام أمان عند اكتمال تحميل عناصر الصفحة بالكامل window.load
  if (document.readyState === 'complete') {
    setTimeout(dismissGlobalLoader, 180);
  } else {
    window.addEventListener('load', function() {
      setTimeout(dismissGlobalLoader, 180);
    });
  }

  // صمام أمان زمني إضافي في حالة تأخر الـ API أو أي طلب شبكة
  setTimeout(dismissGlobalLoader, 1200);
})();

