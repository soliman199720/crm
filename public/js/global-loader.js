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

