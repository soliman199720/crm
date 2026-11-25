/**
 * sales-portal.js
 * بوابة ومتابعة العملاء الخاصة بفريق المبيعات (Sales Portal)
 */

let currentSalesUser = null;
let allClients = [];
let filteredClients = [];
let activeClientIdForNotes = null;
let activeClientIdForPostpone = null;
let remindersPollInterval = null;
let activeRemindersList = [];
let draggedClientId = null;

// إعدادات التمرير اللانهائي الذكي (12 عميلاً في البداية ثم 15 في كل دفعة تالية)
const INITIAL_DEALS_LIMIT = 12;
const CHUNK_DEALS_SIZE = 15;
let currentVisibleLimit = INITIAL_DEALS_LIMIT;
let isInfiniteLoading = false;
let infiniteObserver = null;

let currentPortalView = 'active'; // 'active' | 'archive'
let currentArchiveCategory = 'won'; // 'won' | 'lost' | 'all'
let currentArchivePeriod = 'all'; // 'all' | '1m' | '3m' | '6m' | '1y'

document.addEventListener('DOMContentLoaded', async () => {
  displayCurrentDate();
  initInfiniteScrollObserver();

  // إغلاق القائمة المنسدلة للتنبيهات عند النقر في أي مكان خارجها
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('remindersDropdown');
    const bellWrapper = document.querySelector('.reminder-bell-wrapper');
    if (dropdown && !dropdown.classList.contains('d-none')) {
      if (bellWrapper && !bellWrapper.contains(e.target)) {
        dropdown.classList.add('d-none');
      }
    }
  });

  await initSalesPortal();
});

// عرض التاريخ الحالي باللغة العربية
function displayCurrentDate() {
  const dateEl = document.getElementById('currentDateDisplay');
  if (!dateEl) return;
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  dateEl.textContent = `اليوم: ${now.toLocaleDateString('ar-EG', options)}`;
}

// تهيئة البوابة وفحص الجلسة وجلب البيانات
async function initSalesPortal() {
  try {
    // 1. جلب بيانات المستخدم الحالي
    const userRes = await fetch('/api/me');
    if (!userRes.ok) {
      window.location.href = '/';
      return;
    }
    const userData = await userRes.json();
    if (!userData.success || !userData.user) {
      window.location.href = '/';
      return;
    }

    currentSalesUser = userData.user;
    renderUserInfo(currentSalesUser);

    // 2. تحميل الإحصائيات وقائمة العملاء المسندين
    await loadPortalData();

    // 3. فحص التنبيهات وجدولة المتابعات المستحقة دورياً
    await checkDueReminders();
    if (remindersPollInterval) clearInterval(remindersPollInterval);
    remindersPollInterval = setInterval(checkDueReminders, 45000);
  } catch (err) {
    console.error('فشل تهيئة بوابة السيلز:', err);
    showToast('تعذر الاتصال بالخادم، يرجى إعادة المحاولة', 'error');
  } finally {
    // كشف الشاشة بعد انتهاء التحميل بلمسة خفيفة وسريعة
    setTimeout(dismissSplashLoader, 150);
  }
}

// إنهاء شاشة التحميل التمهيدية وتفعيل تأثير كشف الصفحة الاحترافي للـ CRM
function dismissSplashLoader() {
  if (typeof window.dismissGlobalLoader === 'function') {
    window.dismissGlobalLoader();
  }
  const loader = document.getElementById('portalSplashLoader');
  if (loader && !loader.classList.contains('fade-out')) {
    loader.classList.add('fade-out');
    document.body.classList.add('page-revealed');
    setTimeout(() => {
      loader.style.display = 'none';
    }, 450);
  }
}

// صمام أمان لإخفاء اللودر فوراً
setTimeout(dismissSplashLoader, 1600);

// استخراج الاسم الترحيبي الأول والودي للمستخدم (مثال: أحمد، محمد، إلخ)
function getFriendlyName(user) {
  if (!user) return 'زميلنا العزيز';

  // 1. فحص الاسم الكامل المكتوب في قاعدة البيانات
  const fullName = (user.full_name || user.fullName || '').trim();
  if (fullName) {
    // نأخذ الاسم الأول فقط (مثلاً: "أحمد محمود" -> "أحمد")
    const firstWord = fullName.split(/\s+/)[0];
    if (firstWord) return firstWord;
  }

  // 2. إذا لم يكن الاسم العربي مدخلاً، نفحص اسم البريد الإلكتروني
  const email = (user.email || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const prefix = email.split('@')[0];
    // قاموس للأسماء الأكثر شيوعاً لتحويلها إلى العربية
    const nameMap = {
      'ahmed': 'أحمد',
      'ahmad': 'أحمد',
      'mohamed': 'محمد',
      'mohammed': 'محمد',
      'mahmoud': 'محمود',
      'ali': 'علي',
      'omar': 'عمر',
      'amr': 'عمرو',
      'hassan': 'حسن',
      'hussein': 'حسين',
      'khaled': 'خالد',
      'tarek': 'طارق',
      'karim': 'كريم',
      'youssef': 'يوسف',
      'mostafa': 'مصطفى',
      'mustafa': 'مصطفى',
      'ibrahim': 'إبراهيم',
      'sayed': 'سيد',
      'hossam': 'حسام',
      'islam': 'إسلام',
      'sara': 'سارة',
      'sarah': 'سارة',
      'nour': 'نور',
      'salma': 'سلمى',
      'aya': 'آية',
      'mona': 'منى',
      'mai': 'مي'
    };

    // إزالة أي أرقام من بادئة الإيميل مثل ahmed123 -> ahmed
    const cleanPrefix = prefix.replace(/[0-9_.-]/g, '').toLowerCase();
    if (nameMap[cleanPrefix]) {
      return nameMap[cleanPrefix];
    }
    if (cleanPrefix.length >= 2) {
      return cleanPrefix.charAt(0).toUpperCase() + cleanPrefix.slice(1);
    }
    return prefix;
  }

  // 3. فحص اسم المستخدم (Username)
  if (user.username) {
    return user.username;
  }

  return 'مسؤول المبيعات';
}

// عرض بيانات مسؤول المبيعات في الهيدر واللافتة الترحيبية المخصصة
function renderUserInfo(user) {
  const nameDisplay = document.getElementById('salesNameDisplay');
  const emailDisplay = document.getElementById('salesEmailDisplay');
  const welcomeName = document.getElementById('welcomeSalesName');

  const friendlyName = getFriendlyName(user);
  const fullName = user.full_name || user.fullName || user.username || friendlyName;

  if (nameDisplay) nameDisplay.textContent = fullName;
  if (welcomeName) welcomeName.textContent = friendlyName;
  if (emailDisplay) emailDisplay.textContent = user.email || user.username || 'sales@crm.com';

  // تحديث عنوان نافذة المتصفح ليكون ترحيبياً أيضاً
  document.title = `مرحباً بك يا ${friendlyName} | بوابة المبيعات`;
}

// تحميل الإحصائيات وقائمة العملاء معاً
async function loadPortalData() {
  const loadingState = document.getElementById('loadingState');
  const emptyState = document.getElementById('emptyState');
  const container = document.getElementById('dealsContainer') || document.getElementById('kanbanContainer');

  if (loadingState) loadingState.classList.remove('d-none');
  if (emptyState) emptyState.classList.add('d-none');
  if (container) container.classList.add('d-none');

  try {
    // جلب الإحصائيات والعملاء بالتوازي
    const [statsRes, clientsRes] = await Promise.all([
      fetch('/api/sales-portal/stats'),
      fetch('/api/clients')
    ]);

    if (statsRes.ok) {
      const statsData = await statsRes.json();
      if (statsData.success) {
        renderStats(statsData.stats);
      }
    }

    if (clientsRes.ok) {
      const clientsData = await clientsRes.json();
      if (clientsData.success && Array.isArray(clientsData.clients)) {
        allClients = clientsData.clients;
        initSmartDefaultView();
        filterClients(true);
      }
    }
  } catch (err) {
    console.error('خطأ أثناء جلب البيانات:', err);
    showToast('خطأ أثناء تحميل البيانات', 'error');
  } finally {
    if (loadingState) loadingState.classList.add('d-none');
  }
}

// تحديث وعرض بطاقات الـ KPIs
function renderStats(stats) {
  const totalEl = document.getElementById('statTotalClients');
  const inProgressEl = document.getElementById('statInProgress');
  const contractedEl = document.getElementById('statContracted');
  const closedValEl = document.getElementById('statClosedValue');

  if (totalEl) totalEl.textContent = stats.totalClients || 0;
  if (inProgressEl) inProgressEl.textContent = stats.inProgress || 0;
  if (contractedEl) contractedEl.textContent = stats.contracted || 0;
  if (closedValEl) {
    const val = Number(stats.closedDealsValue || 0);
    closedValEl.textContent = `${val.toLocaleString('ar-EG')} ج.م`;
  }
}

// تهيئة العرض الافتراضي الذكي (Smart Default View)
function initSmartDefaultView() {
  const statusFilter = document.getElementById('statusFilter');
  if (!statusFilter) return;

  // فحص هل لدى السيلز عملاء جدد؟
  const hasNew = allClients.some(c => c.status === 'عميل جديد' || c.status === 'تم الإسناد');
  if (hasNew) {
    statusFilter.value = 'عميل جديد';
    return;
  }

  // فحص هل لديه قيد المتابعة؟
  const hasProgress = allClients.some(c => c.status === 'قيد المتابعة');
  if (hasProgress) {
    statusFilter.value = 'قيد المتابعة';
    return;
  }

  // فحص هل لديه مؤجل؟
  const hasDelayed = allClients.some(c => c.status === 'مؤجل');
  if (hasDelayed) {
    statusFilter.value = 'مؤجل';
    return;
  }

  statusFilter.value = 'عميل جديد';
}

// فلترة وترتيب العملاء
function filterClients(resetPage = false) {
  if (resetPage) {
    currentVisibleLimit = INITIAL_DEALS_LIMIT;
  }

  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const sortBy = document.getElementById('sortBy');
  const clearBtn = document.getElementById('clearSearchBtn');

  const term = (searchInput ? searchInput.value.trim().toLowerCase() : '');
  const status = (statusFilter ? statusFilter.value : 'عميل جديد');
  const sort = (sortBy ? sortBy.value : 'id_desc');

  if (clearBtn) {
    if (term.length > 0) {
      clearBtn.classList.add('active');
    } else {
      clearBtn.classList.remove('active');
    }
  }

  // تصفية
  filteredClients = allClients.filter(c => {
    // 1. فحص هل نحن في وضع الصفقات النشطة أم أرشيف الصفقات المنتهية
    if (currentPortalView === 'active') {
      // الصفقات المنتهية لا تظهر نهائياً في المسار اليومي النشط لمنع الزحام
      if (c.status === 'تم التعاقد' || c.status === 'ملغي') {
        return false;
      }

      if (status === 'عميل جديد') {
        if (c.status !== 'عميل جديد' && c.status !== 'تم الإسناد') return false;
      } else if (status !== 'all' && status !== 'all_active' && c.status !== status) {
        return false;
      }
    } else {
      // وضع الأرشيف المدمج في نفس الصفحة
      if (c.status !== 'تم التعاقد' && c.status !== 'ملغي') {
        return false;
      }

      if (currentArchiveCategory === 'won' && c.status !== 'تم التعاقد') {
        return false;
      }
      if (currentArchiveCategory === 'lost' && c.status !== 'ملغي') {
        return false;
      }
      if (!isClientMatchingArchivePeriod(c, currentArchivePeriod)) {
        return false;
      }
    }

    // 2. فحص نص البحث
    if (term) {
      const name = (c.name || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const company = (c.company || '').toLowerCase();
      const project = (c.project_interest || '').toLowerCase();
      return name.includes(term) || phone.includes(term) || company.includes(term) || project.includes(term);
    }
    return true;
  });

  // ترتيب
  filteredClients.sort((a, b) => {
    if (sort === 'id_desc') return (b.id || 0) - (a.id || 0);
    if (sort === 'id_asc') return (a.id || 0) - (b.id || 0);
    if (sort === 'name_asc') return (a.name || '').localeCompare(b.name || '', 'ar');
    if (sort === 'value_desc') return (Number(b.total_value) || 0) - (Number(a.total_value) || 0);
    return 0;
  });

  renderDealsPipeline();
  updateBatchArchiveToolbar();
}

function isClientMatchingArchivePeriod(client, period) {
  if (!period || period === 'all') return true;
  const dateVal = client.archived_at || client.created_at;
  if (!dateVal) return false;
  const archivedDate = new Date(dateVal);
  if (isNaN(archivedDate.getTime())) return false;

  const cutoff = new Date();
  if (period === '1m') cutoff.setMonth(cutoff.getMonth() - 1);
  else if (period === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
  else if (period === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
  else if (period === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);
  return archivedDate <= cutoff;
}

function updateBatchArchiveToolbar() {
  const toolbar = document.getElementById('archiveBatchToolbar');
  const countEl = document.getElementById('archiveBatchMatchCount');
  const btn = document.getElementById('btnBatchReactivateArchive');
  if (!toolbar) return;

  if (currentPortalView !== 'archive') {
    toolbar.classList.add('d-none');
    toolbar.style.display = 'none';
    return;
  }

  toolbar.classList.remove('d-none');
  toolbar.style.display = 'flex';
  const count = filteredClients.length;
  if (countEl) countEl.textContent = count;
  if (btn) {
    btn.disabled = count === 0;
    btn.style.opacity = count === 0 ? '0.55' : '1';
    btn.style.cursor = count === 0 ? 'not-allowed' : 'pointer';
  }
}

function onArchivePeriodChange(period) {
  currentArchivePeriod = period || 'all';
  filterClients(true);
}

async function handleBatchReactivateArchive() {
  const count = filteredClients.length;
  if (count === 0) {
    showToast('لا يوجد عملاء مؤرشفون مطابقون لهذه الفترة', 'info');
    return;
  }

  const periodLabels = {
    all: 'جميع الفترات',
    '1m': 'منذ شهر فأكثر',
    '3m': 'منذ 3 شهور فأكثر',
    '6m': 'منذ 6 شهور فأكثر',
    '1y': 'منذ سنة فأكثر'
  };
  const catLabels = {
    won: 'تم التعاقد',
    lost: 'ملغي / غير مهتم',
    all: 'جميع المؤرشفين'
  };

  const confirmed = await window.showCrmConfirmDialog({
    title: 'تأكيد إعادة تنشيط الدفعة',
    message:
      `سيتم إعادة تنشيط (${count}) عميل من أرشيف [${catLabels[currentArchiveCategory] || 'الكل'}]\n` +
      `الفترة: (${periodLabels[currentArchivePeriod] || 'الكل'})\n\n` +
      `سيتم تحويلهم إلى حالة (عميل جديد) وإرجاعهم مباشرة إلى صفحة الإدارة (/sales) لإعادة التوزيع.`,
    confirmText: `تأكيد إعادة تنشيط (${count}) عميل`,
    cancelText: 'إلغاء'
  });

  if (!confirmed) return;

  const btn = document.getElementById('btnBatchReactivateArchive');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إعادة التنشيط...';
  }

  try {
    const res = await fetch('/api/sales-portal/archive/reactivate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: currentArchivePeriod,
        category: currentArchiveCategory
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تمت إعادة التنشيط وإرسال العملاء للإدارة بنجاح', 'success');
      await loadPortalData();
    } else {
      showToast(data.message || 'تعذر إعادة تنشيط الدفعة', 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالخادم', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      updateBatchArchiveToolbar();
    }
  }
}

// مسح حقل البحث
function clearSearch() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    filterClients(true);
    searchInput.focus();
  }
}

// ========================================================
//   وظائف وعرض مسار الصفقات التفاعلي بنظام الخطوات السريعة
//   (One-Click Deals Pipeline)
// ========================================================

// مراحل مسار الصفقات الخمسة
const DEAL_STAGES = [
  {
    id: 'new',
    title: 'عميل جديد / إسناد',
    stageKey: 'stage-new',
    icon: 'fa-solid fa-user-plus',
    statuses: ['عميل جديد', 'تم الإسناد'],
    targetStatus: 'عميل جديد'
  },
  {
    id: 'progress',
    title: 'قيد المتابعة والتفاوض',
    stageKey: 'stage-progress',
    icon: 'fa-solid fa-clock-rotate-left',
    statuses: ['قيد المتابعة'],
    targetStatus: 'قيد المتابعة'
  },
  {
    id: 'delayed',
    title: 'مؤجل / اتصال لاحق',
    stageKey: 'stage-delayed',
    icon: 'fa-solid fa-pause',
    statuses: ['مؤجل'],
    targetStatus: 'مؤجل'
  },
  {
    id: 'contracted',
    title: 'تم التعاقد والنجاح 🏆',
    stageKey: 'stage-contracted',
    icon: 'fa-solid fa-circle-check',
    statuses: ['تم التعاقد'],
    targetStatus: 'تم التعاقد'
  },
  {
    id: 'cancelled',
    title: 'ملغي / غير مهتم',
    stageKey: 'stage-cancelled',
    icon: 'fa-solid fa-ban',
    statuses: ['ملغي'],
    targetStatus: 'ملغي'
  }
];

// للتوافقية
const PIPELINE_STAGES = DEAL_STAGES;
const KANBAN_COLUMNS = DEAL_STAGES;

// التبديل بين مسار الصفقات النشطة وأرشيف المنتهية داخل نفس الصفحة
function switchPortalView(view) {
  currentPortalView = view;
  const btnActive = document.getElementById('btnNavActive');
  const btnArchive = document.getElementById('btnNavArchive');
  const pipelineTabs = document.getElementById('pipelineTabsWrapper');
  const archiveTabs = document.getElementById('archiveTabsWrapper');
  const titleEl = document.getElementById('tableCardTitle');
  const hintEl = document.getElementById('viewModeHintText');
  const statusFilter = document.getElementById('statusFilter');

  if (view === 'active') {
    if (btnActive) btnActive.classList.add('active');
    if (btnArchive) btnArchive.classList.remove('active');
    if (pipelineTabs) pipelineTabs.classList.remove('d-none');
    if (archiveTabs) archiveTabs.classList.add('d-none');
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-arrows-split-up-and-left"></i> مسار الصفقات ومتابعة العملاء النشطة';
    if (hintEl) hintEl.textContent = 'انقر بنقرة واحدة على أي مرحلة في مسار العميل لنقل صفقته فوراً، والصفقات المنتهية تُنقل تلقائياً للأرشيف 📁';
    if (statusFilter) statusFilter.value = 'عميل جديد';
  } else {
    if (btnActive) btnActive.classList.remove('active');
    if (btnArchive) btnArchive.classList.add('active');
    if (pipelineTabs) pipelineTabs.classList.add('d-none');
    if (archiveTabs) archiveTabs.classList.remove('d-none');
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-box-archive"></i> أرشيف الصفقات المنتهية (التعاقدات الناجحة والملغية)';
    if (hintEl) hintEl.textContent = 'هنا صفقاتك السابقة المغلقة، يمكنك استعراض تفاصيل التعاقد، أو النقر على "إعادة تنشيط الصفقة" لأي عميل ملغي لإعادته للمتابعة النشطة فوراً ⚡';
    selectArchiveCategory(currentArchiveCategory || 'won', false);
  }

  filterClients(true);
}

// اختيار تصنيف الأرشيف داخل الصفحة (Won / Lost / All)
function selectArchiveCategory(category, shouldFilter = true) {
  currentArchiveCategory = category;

  document.querySelectorAll('.archive-filter-tab').forEach(tab => {
    const tabCat = tab.getAttribute('data-category');
    tab.className = 'archive-filter-tab';
    if (tabCat === category) {
      if (category === 'won') tab.classList.add('active-won');
      else if (category === 'lost') tab.classList.add('active-lost');
      else tab.classList.add('active-all');
    }
  });

  if (shouldFilter) {
    filterClients(true);
  }
}

// إعادة تنشيط صفقة ملغية ونقلها لمسار المتابعة النشطة بنقرة واحدة
async function reactivateDeal(clientId) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  const confirmMsg = `هل تريد بالتأكيد إعادة تنشيط صفقة العميل (${client.name || ''}) ونقلها لمرحلة "قيد المتابعة والتفاوض" في مسار الصفقات النشطة؟`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/clients/${clientId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'قيد المتابعة' })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'فشل تحديث الحالة في الخادم', 'error');
      return;
    }

    client.status = 'قيد المتابعة';
    filterClients(false);
    showToast(`تمت إعادة تنشيط صفقة (${client.name}) بنجاح ونقلها للمسار النشط! 🚀`, 'success');

    // تحديث إحصائيات السيرفر
    fetch('/api/sales-portal/stats')
      .then(r => r.json())
      .then(res => { if (res.success) renderStats(res.stats); });
  } catch (err) {
    console.error('خطأ أثناء إعادة تنشيط الصفقة:', err);
    showToast('تعذر إعادة تنشيط الصفقة، حدث خطأ في الاتصال', 'error');
  }
}

// اختيار تبويب الفلترة السريعة
function selectPipelineTab(status) {
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) {
    statusFilter.value = status;
  }
  filterClients(true);
}

// تحديث عدادات التبويبات العلوية وشريط التنقل الرئيسي
function updateTabCounts() {
  const countAll = allClients.length;
  const countNew = allClients.filter(c => c.status === 'عميل جديد' || c.status === 'تم الإسناد').length;
  const countProgress = allClients.filter(c => c.status === 'قيد المتابعة').length;
  const countDelayed = allClients.filter(c => c.status === 'مؤجل').length;
  const countWon = allClients.filter(c => c.status === 'تم التعاقد').length;
  const countLost = allClients.filter(c => c.status === 'ملغي').length;
  const countArchive = countWon + countLost;
  const countAllActive = allClients.filter(c => c.status !== 'تم التعاقد' && c.status !== 'ملغي').length;

  const elNew = document.getElementById('tabCountNew');
  const elProgress = document.getElementById('tabCountProgress');
  const elDelayed = document.getElementById('tabCountDelayed');
  const elArchive = document.getElementById('tabCountArchive');
  const elAllActive = document.getElementById('tabCountAllActive');
  const navActive = document.getElementById('navActiveBadge');
  const navArchive = document.getElementById('navArchiveBadge');

  if (elNew) elNew.textContent = countNew;
  if (elProgress) elProgress.textContent = countProgress;
  if (elDelayed) elDelayed.textContent = countDelayed;
  if (elArchive) elArchive.textContent = countArchive;
  if (elAllActive) elAllActive.textContent = countAllActive;
  if (navActive) navActive.textContent = countAllActive;
  if (navArchive) navArchive.textContent = countArchive;

  // عدادات تبويبات الأرشيف المدمجة
  const elWon = document.getElementById('tabCountWon');
  const elLost = document.getElementById('tabCountLost');
  const elArchivedAll = document.getElementById('tabCountArchivedAll');

  if (elWon) elWon.textContent = countWon;
  if (elLost) elLost.textContent = countLost;
  if (elArchivedAll) elArchivedAll.textContent = countArchive;

  // مزامنة الصنف النشط (Active Class) لتبويبات المسار النشط
  const currentStatus = document.getElementById('statusFilter') ? document.getElementById('statusFilter').value : 'عميل جديد';
  document.querySelectorAll('.pipeline-tab').forEach(tab => {
    const tabStatus = tab.getAttribute('data-status');
    if (tabStatus === currentStatus || (tabStatus === 'عميل جديد' && currentStatus === 'تم الإسناد')) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // مزامنة الصنف النشط لتبويبات الأرشيف المدمجة
  document.querySelectorAll('.archive-filter-tab').forEach(tab => {
    const tabCat = tab.getAttribute('data-category');
    tab.className = 'archive-filter-tab';
    if (tabCat === currentArchiveCategory) {
      if (tabCat === 'won') tab.classList.add('active-won');
      else if (tabCat === 'lost') tab.classList.add('active-lost');
      else tab.classList.add('active-all');
    }
  });
}

// تحديث مؤشرات حالة التمرير اللانهائي (Infinite Scroll UI)
function updateInfiniteScrollUI(totalCount) {
  const loader = document.getElementById('portalInfiniteScrollLoader');
  const endBox = document.getElementById('portalInfiniteScrollEnd');
  const statusEl = document.getElementById('portalInfiniteScrollStatus');
  const endText = document.getElementById('portalInfiniteScrollEndText');

  if (loader) loader.classList.add('d-none');

  if (totalCount === 0) {
    if (endBox) endBox.classList.add('d-none');
    if (statusEl) statusEl.textContent = '';
    return;
  }

  const showingCount = Math.min(currentVisibleLimit, totalCount);

  if (statusEl) {
    statusEl.innerHTML = `يتم عرض <strong>${showingCount}</strong> من إجمالي <strong>${totalCount}</strong> صفقة`;
  }

  if (showingCount >= totalCount) {
    if (endBox) {
      if (totalCount > INITIAL_DEALS_LIMIT) {
        endBox.classList.remove('d-none');
        if (endText) {
          endText.textContent = `تم استعراض كافة الصفقات المسجلة بالكامل (${totalCount} عميل)`;
        }
      } else {
        endBox.classList.add('d-none');
      }
    }
  } else {
    if (endBox) endBox.classList.add('d-none');
  }
}

// محرك جلب الدفعة التالية (15 عميلاً) أثناء التمرير لأسفل (Infinite Scroll)
function handleInfiniteScrollTrigger() {
  if (isInfiniteLoading || currentVisibleLimit >= filteredClients.length) {
    return;
  }

  isInfiniteLoading = true;
  const loader = document.getElementById('portalInfiniteScrollLoader');
  if (loader) loader.classList.remove('d-none');

  // تأخير بسيط لانسيابية ظهور الدفعة
  setTimeout(() => {
    const nextBatch = filteredClients.slice(currentVisibleLimit, currentVisibleLimit + CHUNK_DEALS_SIZE);
    currentVisibleLimit += nextBatch.length;

    const container = document.getElementById('dealsContainer');
    if (container && nextBatch.length > 0) {
      const isArchive = (currentPortalView === 'archive');
      const nextHtml = nextBatch.map(c => isArchive ? createArchiveDealCardHtml(c) : createActiveDealCardHtml(c)).join('');
      container.insertAdjacentHTML('beforeend', nextHtml);
    }

    if (loader) loader.classList.add('d-none');
    isInfiniteLoading = false;

    updateInfiniteScrollUI(filteredClients.length);
  }, 180);
}

// تفعيل مراقب التمرير التلقائي (IntersectionObserver)
function initInfiniteScrollObserver() {
  const container = document.getElementById('portalInfiniteScrollContainer');
  if (!container) return;

  if (infiniteObserver) {
    infiniteObserver.disconnect();
  }

  infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        handleInfiniteScrollTrigger();
      }
    });
  }, {
    root: null,
    rootMargin: '250px',
    threshold: 0.05
  });

  infiniteObserver.observe(container);

  container.onclick = () => {
    handleInfiniteScrollTrigger();
  };
}

// نقل حالة الصفقة بنقرة واحدة سريعة مع متابعة بصرية سلسة وانتقال ذكي للتبويب
async function advanceDealStage(clientId, newStatus) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  // إذا تم اختيار مرحلة "مؤجل"، نفتح فوراً نافذة جدولة موعد المتابعة الذكي
  if (newStatus === 'مؤجل') {
    openPostponeModal(clientId);
    return;
  }

  if (client.status === newStatus) return;

  const oldStatus = client.status;
  client.status = newStatus;
  if (newStatus !== 'مؤجل') {
    client.is_reminder_resolved = true;
  }

  const statusFilter = document.getElementById('statusFilter');
  const currentFilterVal = statusFilter ? statusFilter.value : 'عميل جديد';

  // 1. إذا تم نقل الصفقة للتعاقد أو الإلغاء، ننقل الواجهة فوراً للأرشيف
  if (newStatus === 'تم التعاقد' || newStatus === 'ملغي') {
    switchPortalView('archive');
    selectArchiveCategory(newStatus === 'تم التعاقد' ? 'won' : 'lost');
    showToast(`تم نقل الصفقة إلى [${newStatus}] ونقلها للأرشيف بنجاح! 📁`, 'success');
  } else {
    // 2. إذا كان السيلز في تبويب مخصص (مثل عميل جديد)، نحول التبويب تلقائياً لمرحلة العميل الجديدة
    if (currentFilterVal !== 'all' && currentFilterVal !== 'all_active') {
      selectPipelineTab(newStatus);
    } else {
      filterClients(false);
    }
    showToast(`تم نقل العميل (${client.name || ''}) إلى [${newStatus}] بنجاح! 🚀`, 'success');

    // تمرير ناعم وإضاءة كارت العميل في موقعه الجديد ليراه السيلز مباشرة دون اختفاء
    setTimeout(() => {
      const movedCard = document.getElementById(`deal-card-${clientId}`);
      if (movedCard) {
        movedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        movedCard.classList.add('just-moved');
        setTimeout(() => movedCard.classList.remove('just-moved'), 2000);
      }
    }, 120);
  }

  try {
    const res = await fetch(`/api/clients/${clientId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!data.success) {
      client.status = oldStatus;
      filterClients(false);
      showToast(data.message || 'فشل تحديث الحالة في الخادم', 'error');
    } else {
      // تحديث الإحصائيات العلوية والتنبيهات
      fetch('/api/sales-portal/stats')
        .then(r => r.json())
        .then(res => { if (res.success) renderStats(res.stats); });
      checkDueReminders();
    }
  } catch (err) {
    client.status = oldStatus;
    filterClients(false);
    showToast('تعذر تحديث الحالة، حدث خطأ في الاتصال', 'error');
  }
}

// دوال بناء HTML لكروت الصفقات (النشطة والأرشيف)
function createArchiveDealCardHtml(client) {
  const senderName = currentSalesUser ? (currentSalesUser.full_name || currentSalesUser.fullName || getFriendlyName(currentSalesUser)) : 'مسؤول المبيعات';
  const isWon = client.status === 'تم التعاقد';
  const cleanPhone = formatWhatsAppNumber(client.phone);
  const clientName = escapeHtml(client.name || 'عميل بدون اسم');
  const company = escapeHtml(client.company || 'عميل فردي');
  const project = escapeHtml(client.project_interest || 'مشروع عام');
  const valFormatted = Number(client.total_value || 0).toLocaleString('ar-EG');
  const hasNotes = client.notes && client.notes.trim() !== '';
  const notesSnippet = hasNotes ? escapeHtml(client.notes.trim()) : 'إضافة ملاحظة ومتابعة...';

  const defaultMsg = encodeURIComponent(`السلام عليكم أستاذ ${client.name || ''}، معك ${senderName} بخصوص (${client.project_interest || 'خدماتنا'}).`);
  const waLink = `https://wa.me/${cleanPhone}?text=${defaultMsg}`;

  return `
    <div class="deal-card archive-deal-card ${isWon ? 'deal-won' : 'deal-lost'}" id="deal-card-${client.id}">
      <!-- صف معلومات العميل والماليات -->
      <div class="deal-card-main-info">
        <div class="deal-client-box">
          <div class="client-avatar-monogram" style="background: ${getMonogramColor(client.name)};" title="${clientName}">
            ${getClientInitial(client.name)}
          </div>
          <div class="deal-names-meta">
            <div class="deal-name-with-id">
              <h4>${clientName}</h4>
              <span class="deal-id-badge" style="${isWon ? 'background: #dcfce7; color: #15803d; border-color: #86efac;' : 'background: #fee2e2; color: #b91c1c; border-color: #fca5a5;'}">#${client.id}</span>
            </div>
            <span class="deal-company-tag"><i class="fa-regular fa-building"></i> ${company}</span>
          </div>
        </div>

        <div class="deal-financial-meta">
          ${isWon 
            ? `<span class="archive-badge-won"><i class="fa-solid fa-trophy"></i> تم التعاقد والنجاح 🏆</span>`
            : `<span class="archive-badge-lost"><i class="fa-solid fa-ban"></i> ملغي / غير مهتم 🚫</span>`
          }
          <span class="deal-value-pill" style="${isWon ? 'background: #dcfce7; color: #15803d; border-color: #86efac;' : ''}">
            <i class="fa-solid fa-coins"></i> ${valFormatted} ج.م
          </span>
        </div>
      </div>

      <!-- صف التواصل السريع والملاحظات -->
      <div class="deal-card-contact-row">
        <div class="deal-phone-actions">
          <a href="tel:${escapeHtml(client.phone || '')}" class="deal-phone-link" title="اتصال مباشر">
            <i class="fa-solid fa-phone"></i>
            <span>${escapeHtml(client.phone || 'بدون هاتف')}</span>
          </a>
          ${cleanPhone ? `
            <button type="button" class="deal-btn-action deal-btn-whatsapp" onclick="openWhatsAppTemplatesModal(${client.id})" title="اختيار رسالة واتساب جاهزة وإرسالها">
              <i class="fa-brands fa-whatsapp"></i>
              <span>واتساب</span>
            </button>
          ` : ''}
          ${client.phone ? `
            <a href="tel:${escapeHtml(client.phone)}" class="deal-btn-action deal-btn-call" title="إجراء اتصال هاتفي">
              <i class="fa-solid fa-phone-volume"></i>
              <span>اتصال</span>
            </a>
          ` : ''}
        </div>

        <div style="display: flex; gap: 8px; width: 100%; align-items: stretch;">
          <button type="button" class="deal-notes-trigger ${hasNotes ? 'has-notes' : ''}" onclick="openNotesModal(${client.id})" title="عرض وتعديل الملاحظات" style="flex: 1;">
            <i class="fa-regular fa-comment-dots"></i>
            <span>${notesSnippet}</span>
          </button>
          <button type="button" class="deal-btn-action" onclick="openClientTimeline(${client.id})" title="سجل المتابعات التفاعلي الزمني" style="background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe; padding: 0 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; border-radius: 8px; cursor: pointer;">
            <i class="fa-solid fa-timeline"></i>
            <span>المتابعات</span>
          </button>
        </div>
      </div>

      <!-- زر إعادة تنشيط الصفقة (للملغي فقط) أو علامة التأكيد -->
      <div class="archive-card-footer" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px dashed #e2e8f0; flex-wrap: wrap;">
        <span class="deal-interest-pill" title="${project}">
          <i class="fa-solid fa-cubes"></i> ${project}
        </span>
        ${!isWon ? `
          <button type="button" class="btn-reactivate-deal" onclick="reactivateDeal(${client.id})" title="إعادة تنشيط الصفقة ونقلها لقيد المتابعة والتفاوض">
            <i class="fa-solid fa-arrow-rotate-left"></i>
            <span>إعادة تنشيط ومتابعة الصفقة ⚡</span>
          </button>
        ` : `
          <span class="win-rate-pill" title="صفقة مغلقة ومحققة بنجاح">
            <i class="fa-solid fa-circle-check"></i>
            <span>صفقة رابحة ومؤكدة</span>
          </span>
        `}
      </div>
    </div>
  `;
}

function createActiveDealCardHtml(client) {
  const senderName = currentSalesUser ? (currentSalesUser.full_name || currentSalesUser.fullName || getFriendlyName(currentSalesUser)) : 'مسؤول المبيعات';
  const cleanPhone = formatWhatsAppNumber(client.phone);
  const clientName = escapeHtml(client.name || 'عميل بدون اسم');
  const company = escapeHtml(client.company || 'غير محدد');
  const project = escapeHtml(client.project_interest || 'مشروع عام');
  const valFormatted = Number(client.total_value || 0).toLocaleString('ar-EG');
  const hasNotes = client.notes && client.notes.trim() !== '';
  const notesSnippet = hasNotes ? escapeHtml(client.notes) : 'إضافة ملاحظة ومتابعة جديدة...';

  // شارة وتفاصيل التأجيل والمتابعة
  let followupHtml = '';
  if (client.status === 'مؤجل') {
    if (client.postponed_until) {
      const pDate = new Date(client.postponed_until);
      const isDue = pDate <= new Date();
      const timeStr = formatReminderDate(pDate);
      followupHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; padding: 6px 12px; background: ${isDue ? '#fff1f2' : '#fefce8'}; border: 1px solid ${isDue ? '#fca5a5' : '#fde68a'}; border-radius: 12px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="followup-pill ${isDue ? 'due-now' : ''}" onclick="openPostponeModal(${client.id})" style="cursor: pointer;" title="انقر لإعادة جدولة الموعد">
              <i class="${isDue ? 'fa-solid fa-triangle-exclamation' : 'fa-regular fa-clock'}"></i>
              ${isDue ? `⚠️ موعد الاتصال مستحق الآن! (${timeStr})` : `موعد الاتصال المجدول: ${timeStr}`}
            </span>
            ${client.postpone_reason ? `
              <span class="followup-reason">
                <i class="fa-regular fa-comment-dots"></i> ${escapeHtml(client.postpone_reason)}
              </span>
            ` : ''}
          </div>
          <button type="button" class="btn-reminder-act done" onclick="resolveReminderDirectly(${client.id})" style="padding: 4px 10px; font-size: 11.5px;" title="تم التواصل بنجاح ونقل الصفقة إلى قيد المتابعة">
            <i class="fa-solid fa-check"></i> تم التواصل ✅
          </button>
        </div>
      `;
    } else {
      followupHtml = `
        <div style="margin-bottom: 10px;">
          <span class="followup-pill" onclick="openPostponeModal(${client.id})" style="cursor: pointer;" title="انقر لتحديد موعد وتنبيه">
            <i class="fa-regular fa-calendar-plus"></i> انقر لتحديد موعد وتنبيه المتابعة 🔔
          </span>
        </div>
      `;
    }
  }

  const defaultMsg = encodeURIComponent(`السلام عليكم أستاذ ${client.name || ''}، معك ${senderName} من إدارة المبيعات. بخصوص استفساركم عن (${client.project_interest || 'خدماتنا'}).`);
  const waLink = `https://wa.me/${cleanPhone}?text=${defaultMsg}`;

  // توليد خطوات المسار الخمسة بنقرة واحدة
  const stepperHtml = DEAL_STAGES.map(stage => {
    const isActive = stage.statuses.includes(client.status);
    const hint = isActive ? 'المرحلة الحالية للصفقة' : `انقر للنقل إلى: ${stage.title}`;

    return `
      <button 
        type="button" 
        class="stepper-step ${isActive ? 'is-active ' + stage.stageKey : ''}" 
        onclick="advanceDealStage(${client.id}, '${stage.targetStatus}')" 
        title="${hint}"
      >
        <div class="stepper-step-circle">
          <i class="${isActive ? 'fa-solid fa-check' : stage.icon}"></i>
        </div>
        <div class="stepper-step-title">
          <span class="step-main">${stage.title}</span>
          <span class="step-hint">${hint}</span>
        </div>
      </button>
    `;
  }).join('');

  return `
    <div class="deal-card" id="deal-card-${client.id}">
      <!-- صف معلومات العميل والماليات -->
      <div class="deal-card-main-info">
        <div class="deal-client-box">
          <div class="client-avatar-monogram" style="background: ${getMonogramColor(client.name)};" title="${clientName}">
            ${getClientInitial(client.name)}
          </div>
          <div class="deal-names-meta">
            <div class="deal-name-with-id">
              <h4>${clientName}</h4>
              <span class="deal-id-badge">#${client.id}</span>
            </div>
            <span class="deal-company-tag"><i class="fa-regular fa-building"></i> ${company}</span>
          </div>
        </div>

        <div class="deal-financial-meta">
          <span class="deal-interest-pill" title="${project}"><i class="fa-solid fa-layer-group"></i> ${project}</span>
          <span class="deal-value-pill"><i class="fa-solid fa-coins"></i> ${valFormatted} ج.م</span>
        </div>
      </div>

      ${followupHtml}

      <!-- صف التواصل السريع والملاحظات -->
      <div class="deal-card-contact-row">
        <div class="deal-phone-actions">
          <a href="tel:${escapeHtml(client.phone || '')}" class="deal-phone-link" title="اتصال مباشر">
            <i class="fa-solid fa-phone"></i>
            <span>${escapeHtml(client.phone || 'بدون هاتف')}</span>
          </a>
          ${cleanPhone ? `
            <button type="button" class="deal-btn-action deal-btn-whatsapp" onclick="openWhatsAppTemplatesModal(${client.id})" title="اختيار رسالة واتساب جاهزة وإرسالها">
              <i class="fa-brands fa-whatsapp"></i>
              <span>واتساب</span>
            </button>
          ` : ''}
          ${client.phone ? `
            <a href="tel:${escapeHtml(client.phone)}" class="deal-btn-action deal-btn-call" title="إجراء اتصال هاتفي">
              <i class="fa-solid fa-phone-volume"></i>
              <span>اتصال</span>
            </a>
          ` : ''}
        </div>

        <div style="display: flex; gap: 8px; width: 100%; align-items: stretch;">
          <button type="button" class="deal-notes-trigger ${hasNotes ? 'has-notes' : ''}" onclick="openNotesModal(${client.id})" title="عرض وتعديل الملاحظات" style="flex: 1;">
            <i class="fa-regular fa-comment-dots"></i>
            <span>${notesSnippet}</span>
          </button>
          <button type="button" class="deal-btn-action" onclick="openClientTimeline(${client.id})" title="سجل المتابعات التفاعلي الزمني" style="background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe; padding: 0 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; border-radius: 8px; cursor: pointer;">
            <i class="fa-solid fa-timeline"></i>
            <span>المتابعات</span>
          </button>
        </div>
      </div>

      <!-- شريط خطوات مسار الصفقة بنقرة زر واحدة -->
      <div class="deal-stepper-container">
        <div class="stepper-header-label">
          <span><i class="fa-solid fa-arrows-turn-to-dots"></i> مسار الصفقة (انقر على أي مرحلة للنقل الفوري):</span>
          <span class="status-pill ${getStatusClass(client.status)}" style="font-size: 0.75rem; padding: 3px 10px;">${escapeHtml(client.status)}</span>
        </div>
        <div class="stepper-track">
          ${stepperHtml}
        </div>
      </div>
    </div>
  `;
}

// بناء وعرض صفقات العملاء بنظام شريط الخطوات السريعة والتقسيم
function renderDealsPipeline() {
  const container = document.getElementById('dealsContainer') || document.getElementById('kanbanContainer');
  const countBadge = document.getElementById('clientsCountBadge');
  const emptyState = document.getElementById('emptyState');
  const paginationWrapper = document.getElementById('paginationWrapper');

  updateTabCounts();

  const totalDeals = filteredClients.length;
  if (countBadge) {
    countBadge.textContent = `${totalDeals} من إجمالي ${allClients.length} صفقة`;
  }

  // في حال عدم وجود نتائج
  if (totalDeals === 0) {
    if (container) container.classList.add('d-none');
    if (paginationWrapper) paginationWrapper.classList.add('d-none');
    if (emptyState) {
      emptyState.classList.remove('d-none');
      const title = document.getElementById('emptyStateTitle');
      const desc = document.getElementById('emptyStateDesc');
      const currentStatus = document.getElementById('statusFilter') ? document.getElementById('statusFilter').value : 'all';

      if (currentPortalView === 'archive') {
        if (currentArchiveCategory === 'won') {
          if (title) title.textContent = 'لا توجد صفقات متعاقد عليها حتى الآن 🏆';
          if (desc) desc.textContent = 'عند إتمام أي صفقة بالتعاقد الناجح في مسار الصفقات، ستظهر هنا فوراً.';
        } else if (currentArchiveCategory === 'lost') {
          if (title) title.textContent = 'سجل نظيف! لا توجد صفقات ملغية 🚫';
          if (desc) desc.textContent = 'ممتاز! ليس لديك أي صفقات ملغية حالياً.';
        } else {
          if (title) title.textContent = 'أرشيف الصفقات المنتهية فارغ حالياً 📁';
          if (desc) desc.textContent = 'عندما تنتهي صفقات بالتعاقد أو الإلغاء، ستُؤرشف بياناتها هنا تلقائياً للرجوع إليها عند الحاجة.';
        }
      } else if (currentStatus === 'عميل جديد') {
        if (title) title.textContent = 'رائع! لا يوجد عملاء جدد في الانتظار';
        if (desc) desc.textContent = 'تم التواصل مع جميع العملاء الجدد أو نقلهم لمرحلة المتابعة والتفاوض.';
      } else {
        if (title) title.textContent = 'لا توجد صفقات تطابق هذا الاختيار';
        if (desc) desc.textContent = 'جرّب البحث بكلمات أخرى أو اختر تبويباً مختلفاً من التبويبات العلوية.';
      }
    }
    if (container) container.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('d-none');
  if (container) container.classList.remove('d-none');
  if (paginationWrapper) paginationWrapper.classList.add('d-none');
  if (!container) return;

  // جلب أول 12 صفقة في البداية (أو الحد الحالي المتراكم للتمرير)
  const currentDeals = filteredClients.slice(0, currentVisibleLimit);
  const isArchive = (currentPortalView === 'archive');

  container.innerHTML = currentDeals.map(c => isArchive ? createArchiveDealCardHtml(c) : createActiveDealCardHtml(c)).join('');

  updateInfiniteScrollUI(totalDeals);
}

// التوافقية
const renderKanbanBoard = renderDealsPipeline;
const handleKanbanDrop = (event, targetStatus) => {};

// الحصول على صنف CSS المناسب للحالة
function getStatusClass(status) {
  switch (status) {
    case 'عميل جديد': return 'status-new';
    case 'تم الإسناد': return 'status-assigned';
    case 'قيد المتابعة': return 'status-progress';
    case 'تم التعاقد': return 'status-contracted';
    case 'مؤجل': return 'status-delayed';
    case 'ملغي': return 'status-cancelled';
    default: return 'status-progress';
  }
}

// تحديث حالة العميل عبر الـ API
async function updateClientStatus(clientId, newStatus, selectElement) {
  try {
    const res = await fetch(`/api/clients/${clientId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`تم تحديث حالة العميل إلى "${newStatus}" بنجاح!`, 'success');

      // تحديث الكائن محلياً
      const target = allClients.find(c => c.id === clientId);
      if (target) target.status = newStatus;

      // تحديث لون الـ select
      if (selectElement) {
        selectElement.className = `status-dropdown ${getStatusClass(newStatus)}`;
      }

      filterClients();

      // تحديث الإحصائيات في الخلفية
      fetch('/api/sales-portal/stats')
        .then(r => r.json())
        .then(res => { if (res.success) renderStats(res.stats); });
    } else {
      showToast(data.message || 'فشل تحديث الحالة', 'error');
    }
  } catch (err) {
    console.error('خطأ تحديث الحالة:', err);
    showToast('تعذر تحديث الحالة، حدث خطأ في الشبكة', 'error');
  }
}

// فتح نافذة الملاحظات
function openNotesModal(clientId) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  activeClientIdForNotes = clientId;

  const modal = document.getElementById('notesModal');
  const nameEl = document.getElementById('modalClientName');
  const compEl = document.getElementById('modalClientCompany');
  const phoneEl = document.getElementById('modalClientPhone');
  const projEl = document.getElementById('modalClientProject');
  const textarea = document.getElementById('clientNotesTextarea');

  if (nameEl) nameEl.textContent = `ملاحظات: ${client.name || 'العميل'}`;
  if (compEl) compEl.textContent = client.company || 'غير محدد';
  if (phoneEl) phoneEl.textContent = client.phone || 'بدون هاتف';
  if (projEl) projEl.textContent = client.project_interest || 'مشروع عام';
  if (textarea) {
    textarea.value = client.notes || '';
    setTimeout(() => textarea.focus(), 100);
  }

  if (modal) modal.classList.remove('d-none');
}

// إغلاق نافذة الملاحظات
function closeNotesModal() {
  const modal = document.getElementById('notesModal');
  if (modal) modal.classList.add('d-none');
  activeClientIdForNotes = null;
}

// حفظ الملاحظات عبر الـ API
async function saveClientNotes() {
  if (!activeClientIdForNotes) return;

  const textarea = document.getElementById('clientNotesTextarea');
  const notesText = textarea ? textarea.value.trim() : '';
  const saveBtn = document.getElementById('saveNotesBtn');

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
  }

  try {
    const res = await fetch(`/api/clients/${activeClientIdForNotes}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesText })
    });

    const data = await res.json();
    if (data.success) {
      showToast('تم حفظ ملاحظات العميل بنجاح!', 'success');

      // تحديث محلياً
      const client = allClients.find(c => c.id === activeClientIdForNotes);
      if (client) {
        client.notes = notesText;
      }

      // تحديث معاينة الملاحظات في الجدول
      const previewEl = document.getElementById(`notes-preview-${activeClientIdForNotes}`);
      if (previewEl) {
        previewEl.innerHTML = notesText ? escapeHtml(notesText) : '<span class="empty-notes-hint">لا توجد ملاحظات مسجلة</span>';
      }

      filterClients();

      closeNotesModal();
    } else {
      showToast(data.message || 'فشل حفظ الملاحظات', 'error');
    }
  } catch (err) {
    console.error('خطأ حفظ الملاحظات:', err);
    showToast('خطأ أثناء حفظ الملاحظات', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>حفظ الملاحظات</span>';
    }
  }
}

// تسجيل الخروج
async function handleLogout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.error('Logout error:', e);
  }
  window.location.href = '/';
}

// عرض رسائل التوست المنبثقة
let toastTimeout = null;
function showToast(message, type = 'success') {
  const toast = document.getElementById('toastNotification');
  const msgEl = document.getElementById('toastMessage');
  const iconEl = document.getElementById('toastIcon');

  if (!toast || !msgEl) return;

  clearTimeout(toastTimeout);

  msgEl.textContent = message;
  toast.className = `toast-notification ${type} show`;

  if (iconEl) {
    if (type === 'error') {
      iconEl.className = 'fa-solid fa-circle-xmark toast-icon';
    } else {
      iconEl.className = 'fa-solid fa-circle-check toast-icon';
    }
  }

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// دوال مساعدة لمنع ثغرات XSS (escapeHtml provided globally by global-loader.js)

// توليد لون تدرج لوني فخم وفريد لكل عميل بناءً على اسمه (Monogram Avatar Color)
function getMonogramColor(name) {
  const palettes = [
    'linear-gradient(135deg, #2563eb, #1d4ed8)', // Royal Blue
    'linear-gradient(135deg, #059669, #047857)', // Emerald Green
    'linear-gradient(135deg, #7c3aed, #5b21b6)', // Deep Violet
    'linear-gradient(135deg, #d97706, #b45309)', // Warm Amber
    'linear-gradient(135deg, #db2777, #9d174d)', // Rose Pink
    'linear-gradient(135deg, #0891b2, #0e7490)', // Teal / Cyan
    'linear-gradient(135deg, #ea580c, #c2410c)', // Sunset Orange
    'linear-gradient(135deg, #4f46e5, #3730a3)'  // Indigo
  ];
  if (!name) return palettes[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palettes.length;
  return palettes[index];
}

// استخراج الحرف الأول المميز من اسم العميل (Client Initial)
function getClientInitial(name) {
  if (!name) return 'ع';
  const clean = name.replace(/^(م\.|د\.|أ\.|مهندس|دكتور|أستاذ|شركة|مؤسسة)\s*/i, '').trim();
  return clean ? clean.charAt(0) : name.charAt(0);
}

// دالة ذكية لتنسيق رقم الواتساب ليعمل بسلاسة في مصر والأرقام الدولية
function formatWhatsAppNumber(phone) {
  let cleaned = (phone || '').replace(/[^0-9]/g, '');
  if (!cleaned) return '';
  // الأرقام المصرية تبدأ بـ 01 وطولها 11 رقماً
  if (cleaned.startsWith('01') && cleaned.length === 11) {
    return '2' + cleaned;
  }
  if (cleaned.startsWith('00')) {
    return cleaned.substring(2);
  }
  return cleaned;
}

/* ========================================================
   نظام جدولة وتأجيل الصفقات وتنبيهات المتابعة (Proposal 1)
   ======================================================== */

// فتح نافذة جدولة موعد المتابعة لصفقة محددة
function openPostponeModal(clientId) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;
  activeClientIdForPostpone = clientId;

  const modal = document.getElementById('postponeModal');
  if (!modal) return;

  const nameEl = document.getElementById('postponeClientName');
  const compEl = document.getElementById('postponeClientCompany');
  const phoneEl = document.getElementById('postponeClientPhone');
  const projEl = document.getElementById('postponeClientProject');
  const dateInput = document.getElementById('postponeDateInput');
  const timeInput = document.getElementById('postponeTimeInput');
  const reasonInput = document.getElementById('postponeReasonInput');

  if (nameEl) nameEl.textContent = `تأجيل متابعة: ${client.name || 'عميل بدون اسم'}`;
  if (compEl) compEl.textContent = client.company || 'غير محدد';
  if (phoneEl) phoneEl.textContent = client.phone || 'بدون هاتف';
  if (projEl) projEl.textContent = client.project_interest || 'مشروع عام';

  // ضبط الحد الأدنى لتاريخ المتابعة ليكون بدءاً من اليوم
  const todayStr = new Date().toISOString().split('T')[0];
  if (dateInput) dateInput.min = todayStr;

  // إعادة ضبط الأزرار السريعة
  document.querySelectorAll('.shortcut-btn').forEach(btn => btn.classList.remove('active'));

  if (client.postponed_until) {
    const d = new Date(client.postponed_until);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      if (dateInput) dateInput.value = `${year}-${month}-${day}`;
      if (timeInput) timeInput.value = `${hours}:${mins}`;
    }
  } else {
    // تعيين افتراضي مسبق: غداً الساعة 10:00 صباحاً مع تفعيل الزر بصرياً
    applyPostponeShortcut('tomorrow_morning');
  }

  if (reasonInput) {
    reasonInput.value = client.postpone_reason || '';
  }

  modal.classList.remove('d-none');
}

// إغلاق نافذة الجدولة
function closePostponeModal() {
  const modal = document.getElementById('postponeModal');
  if (modal) modal.classList.add('d-none');
  activeClientIdForPostpone = null;
}

// تطبيق الاختصارات الذكية لتاريخ ووقت المتابعة
function applyPostponeShortcut(preset) {
  const now = new Date();
  let targetDate = new Date();

  if (preset === '2hours') {
    targetDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  } else if (preset === 'tomorrow_morning') {
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(10, 0, 0, 0);
  } else if (preset === '2days') {
    targetDate.setDate(targetDate.getDate() + 2);
    targetDate.setHours(10, 0, 0, 0);
  } else if (preset === 'next_week') {
    targetDate.setDate(targetDate.getDate() + 7);
    targetDate.setHours(10, 0, 0, 0);
  }

  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const hours = String(targetDate.getHours()).padStart(2, '0');
  const mins = String(targetDate.getMinutes()).padStart(2, '0');

  const dateInput = document.getElementById('postponeDateInput');
  const timeInput = document.getElementById('postponeTimeInput');
  if (dateInput) dateInput.value = `${year}-${month}-${day}`;
  if (timeInput) timeInput.value = `${hours}:${mins}`;

  // تمييز الزر النشط بدقة عبر data-preset
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
  });
}

// حفظ تأجيل الصفقة وتفعيل المنبه الذكي
async function confirmPostponeDeal() {
  if (!activeClientIdForPostpone) return;
  const clientId = activeClientIdForPostpone;
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  const dateVal = document.getElementById('postponeDateInput').value;
  const timeVal = document.getElementById('postponeTimeInput').value || '10:00';
  const reason = (document.getElementById('postponeReasonInput').value || '').trim();

  if (!dateVal) {
    showToast('يرجى تحديد تاريخ المتابعة أولاً', 'error');
    return;
  }

  const selectedDateTime = new Date(`${dateVal}T${timeVal}`);
  if (isNaN(selectedDateTime.getTime())) {
    showToast('يرجى إدخال تاريخ ووقت صحيحين', 'error');
    return;
  }

  const postponedUntil = `${dateVal}T${timeVal}:00`;

  const confirmBtn = document.getElementById('confirmPostponeBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
  }

  try {
    const res = await fetch(`/api/clients/${clientId}/postpone`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postponed_until: postponedUntil,
        postpone_reason: reason
      })
    });

    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'فشل حفظ تأجيل المتابعة', 'error');
      return;
    }

    // تحديث بيانات العميل محلياً
    client.status = 'مؤجل';
    client.postponed_until = postponedUntil;
    client.postpone_reason = reason;
    client.is_reminder_resolved = false;

    closePostponeModal();

    // نقل السيلز مباشرة لتبويب "مؤجل" ليرى الصفقة في مكانها الجديد دون أن تختفي
    selectPipelineTab('مؤجل');
    showToast(`تم تأجيل الصفقة وتفعيل التنبيه بنجاح ليوم ${dateVal} الساعة ${timeVal} 🔔`, 'success');

    // تمرير ناعم ومؤثر إضاءة للصفقة
    setTimeout(() => {
      const movedCard = document.getElementById(`deal-card-${clientId}`);
      if (movedCard) {
        movedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        movedCard.classList.add('just-moved');
        setTimeout(() => movedCard.classList.remove('just-moved'), 2000);
      }
    }, 120);

    // تحديث التنبيهات والإحصائيات العلوية
    checkDueReminders();
    fetch('/api/sales-portal/stats')
      .then(r => r.json())
      .then(sRes => { if (sRes.success) renderStats(sRes.stats); });
  } catch (err) {
    console.error('Error postponing deal:', err);
    showToast('حدث خطأ في الاتصال أثناء تأجيل الصفقة', 'error');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-bell"></i> <span>حفظ الموعد وتفعيل التنبيه 🔔</span>';
    }
  }
}

// فتح / إغلاق القائمة المنسدلة للتنبيهات
function toggleRemindersDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('remindersDropdown');
  if (!dropdown) return;
  dropdown.classList.toggle('d-none');
}

// فحص وجلب المتابعات المستحقة وتحديث الجرس
async function checkDueReminders() {
  try {
    const res = await fetch('/api/sales-portal/reminders');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    const reminders = data.reminders || [];
    activeRemindersList = reminders;

    const bellBtn = document.getElementById('reminderBellBtn');
    const bellBadge = document.getElementById('reminderBellBadge');
    const dropdownBadge = document.getElementById('dropdownBadgeText');
    const remindersList = document.getElementById('remindersList');

    const dueCount = typeof data.due_count === 'number' ? data.due_count : reminders.filter(r => r.is_due).length;

    if (bellBadge) {
      if (dueCount > 0) {
        bellBadge.textContent = dueCount > 99 ? '99+' : dueCount;
        bellBadge.classList.remove('d-none');
      } else {
        bellBadge.classList.add('d-none');
      }
    }

    if (bellBtn) {
      if (dueCount > 0) {
        bellBtn.classList.add('has-due');
      } else {
        bellBtn.classList.remove('has-due');
      }
    }

    if (dropdownBadge) {
      dropdownBadge.textContent = `${dueCount} موعد مستحق`;
    }

    if (!remindersList) return;

    if (reminders.length === 0) {
      remindersList.innerHTML = `
        <div class="dropdown-empty-state">
          <i class="fa-solid fa-calendar-check"></i>
          <div style="font-weight: 700; font-size: 13.5px; color: #1e293b; margin-bottom: 4px;">لا توجد مواعيد مستحقة حالياً</div>
          <p style="font-size: 11.5px; margin: 0; color: #64748b;">جميع صفقاتك ومتابعاتك منتظمة وعلى المسار الصحيح!</p>
        </div>
      `;
      return;
    }

    const senderName = getFriendlyName(currentSalesUser);

    remindersList.innerHTML = reminders.map(r => {
      const cleanPhone = formatWhatsAppNumber(r.phone);
      const isDue = !!r.is_due;
      const d = new Date(r.postponed_until);
      const formattedTime = formatReminderDate(d);
      const clientName = escapeHtml(r.name || 'عميل بدون اسم');
      const defaultMsg = encodeURIComponent(`السلام عليكم أستاذ ${r.name || ''}، معك ${senderName} من إدارة المبيعات. بناءً على موعدنا المحدد بخصوص (${r.project_interest || 'استفساركم'}).`);
      const waLink = `https://wa.me/${cleanPhone}?text=${defaultMsg}`;

      return `
        <div class="reminder-item ${isDue ? 'is-due-alert' : ''}" id="reminder-item-${r.id}">
          <div class="reminder-item-header">
            <div>
              <div class="reminder-client-name">${clientName}</div>
              <div class="reminder-meta-text">
                <i class="fa-solid fa-building"></i> ${escapeHtml(r.company || 'غير محدد')}
              </div>
            </div>
            <span class="reminder-due-tag ${isDue ? 'due' : 'upcoming'}">
              ${isDue ? '⚠️ مستحق الآن' : 'قادم'}
            </span>
          </div>

          <div class="reminder-meta-text">
            <i class="fa-regular fa-clock"></i>
            <span>موعد الاتصال: <strong>${formattedTime}</strong></span>
          </div>

          ${r.postpone_reason ? `
            <div class="reminder-reason-box">
              <i class="fa-regular fa-comment-dots"></i> ${escapeHtml(r.postpone_reason)}
            </div>
          ` : ''}

          <div class="reminder-actions-row">
            ${cleanPhone ? `
              <button type="button" class="btn-reminder-act wa" onclick="openWhatsAppTemplatesModal(${r.id}, 'مؤجل')" title="اختيار رسالة واتساب جاهزة">
                <i class="fa-brands fa-whatsapp"></i> واتساب
              </button>
            ` : ''}
            ${r.phone ? `
              <a href="tel:${escapeHtml(r.phone)}" class="btn-reminder-act call" title="اتصال هاتفي">
                <i class="fa-solid fa-phone"></i> اتصال
              </a>
            ` : ''}
            <button type="button" class="btn-reminder-act done" onclick="resolveReminderDirectly(${r.id})" title="تم التواصل بنجاح ونقل الصفقة إلى قيد المتابعة">
              <i class="fa-solid fa-check"></i> تم التواصل ✅
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error checking reminders:', err);
  }
}

// وضع علامة "تم التواصل" بنقرة واحدة ونقل الصفقة فوراً لمرحلة قيد المتابعة
async function resolveReminderDirectly(clientId) {
  try {
    const res = await fetch(`/api/clients/${clientId}/resolve-reminder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'فشل تحديث التنبيه', 'error');
      return;
    }

    // تحديث بيانات العميل محلياً
    const client = allClients.find(c => c.id === clientId);
    if (client) {
      client.status = 'قيد المتابعة';
      client.is_reminder_resolved = true;
    }

    showToast('رائع! تم تسجيل التواصل ونقل الصفقة إلى "قيد المتابعة" بنجاح 🚀', 'success');
    
    // إذا كان السيلز في تبويب مخصص (مثل مؤجل)، نحوله لتبويب قيد المتابعة لمشاهدة الصفقة فوراً
    const statusFilter = document.getElementById('statusFilter');
    const currentFilterVal = statusFilter ? statusFilter.value : 'all_active';
    if (currentFilterVal !== 'all' && currentFilterVal !== 'all_active') {
      selectPipelineTab('قيد المتابعة');
    } else {
      filterClients(false);
    }

    setTimeout(() => {
      const movedCard = document.getElementById(`deal-card-${clientId}`);
      if (movedCard) {
        movedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        movedCard.classList.add('just-moved');
        setTimeout(() => movedCard.classList.remove('just-moved'), 2000);
      }
    }, 120);

    await checkDueReminders();

    // تحديث الإحصائيات
    fetch('/api/sales-portal/stats')
      .then(r => r.json())
      .then(sRes => { if (sRes.success) renderStats(sRes.stats); });
  } catch (err) {
    console.error('Error resolving reminder:', err);
    showToast('حدث خطأ أثناء تسجيل التواصل', 'error');
  }
}

// تنسيق التاريخ والوقت بأسلوب ودي وسهل القراءة
function formatReminderDate(dateObj) {
  if (isNaN(dateObj.getTime())) return '--';
  const now = new Date();
  const isToday = now.toDateString() === dateObj.toDateString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const isTomorrow = tomorrow.toDateString() === dateObj.toDateString();

  const timeStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `اليوم ${timeStr}`;
  if (isTomorrow) return `غداً ${timeStr}`;
  return `${dateObj.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })} ${timeStr}`;
}

/* ========================================================
   نظام سجل المتابعات التفاعلي الزمني للعميل (Lead Interaction Timeline)
   ======================================================== */
let activeTimelineClientId = null;
let currentSelectedActivityType = 'call';

function selectActivityType(type, btn) {
  currentSelectedActivityType = type;
  document.querySelectorAll('#timelineModal .type-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function openClientTimeline(clientId) {
  const client = allClients.find(c => c.id === clientId);
  if (!client) return;

  activeTimelineClientId = clientId;

  const modal = document.getElementById('timelineModal');
  const nameEl = document.getElementById('timelineClientName');
  const infoEl = document.getElementById('timelineClientInfo');
  const detailsInput = document.getElementById('activityDetailsText');
  const container = document.getElementById('timelineListContainer');

  if (nameEl) nameEl.textContent = client.name || 'عميل بدون اسم';
  if (infoEl) infoEl.textContent = `${client.company ? client.company + ' • ' : ''}${client.phone || ''} • (${client.status || 'عميل جديد'})`;
  if (detailsInput) detailsInput.value = '';

  currentSelectedActivityType = 'call';
  document.querySelectorAll('#timelineModal .type-pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-type') === 'call');
  });

  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 25px; color: #94a3b8;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 8px;"></i>
        <p style="margin: 0; font-size: 0.85rem;">جاري جلب سجل المتابعات الزمني...</p>
      </div>
    `;
  }

  if (modal) modal.classList.remove('d-none');

  await loadClientActivities(clientId);
}

function closeTimelineModal() {
  activeTimelineClientId = null;
  const modal = document.getElementById('timelineModal');
  if (modal) modal.classList.add('d-none');
}

async function loadClientActivities(clientId) {
  const container = document.getElementById('timelineListContainer');
  const countBadge = document.getElementById('timelineCountBadge');

  try {
    const res = await fetch(`/api/clients/${clientId}/activities`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      if (container) container.innerHTML = `<p style="color: #ef4444; text-align: center; font-size: 0.85rem;">تعذر تحميل السجل: ${data.message || ''}</p>`;
      return;
    }

    const activities = data.activities || [];
    if (countBadge) countBadge.textContent = `${activities.length} متابعة`;

    if (activities.length === 0) {
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 25px 15px; color: #94a3b8;">
            <i class="fa-solid fa-clock-rotate-left" style="font-size: 2rem; opacity: 0.4; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-size: 0.85rem;">لا توجد متابعات مسجلة لهذا العميل حتى الآن.<br>سجّل أول مكالمة أو تواصل من النموذج بالأعلى 👆</p>
          </div>
        `;
      }
      return;
    }

    const typeConfig = {
      call: { icon: 'fa-phone', label: 'مكالمة هاتفية', class: 'type-badge-call' },
      whatsapp: { icon: 'fa-whatsapp', brand: true, label: 'مراسلة واتساب', class: 'type-badge-whatsapp' },
      meeting: { icon: 'fa-handshake', label: 'اجتماع / زيارة', class: 'type-badge-meeting' },
      quotation: { icon: 'fa-file-invoice-dollar', label: 'عرض سعر', class: 'type-badge-quotation' },
      note: { icon: 'fa-note-sticky', label: 'ملاحظة', class: 'type-badge-note' }
    };

    let html = '';
    activities.forEach(act => {
      const cfg = typeConfig[act.activity_type] || typeConfig.note;
      const dateObj = new Date(act.created_at);
      const timeFormatted = dateObj.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

      html += `
        <div class="timeline-item">
          <div class="timeline-item-dot"></div>
          <div class="timeline-item-card">
            <div class="timeline-item-header">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="timeline-type-badge ${cfg.class}">
                  <i class="${cfg.brand ? 'fa-brands' : 'fa-solid'} ${cfg.icon}"></i> ${cfg.label}
                </span>
                ${act.outcome ? `<span class="timeline-outcome-badge">${escapeHtml(act.outcome)}</span>` : ''}
              </div>
              <span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">${timeFormatted}</span>
            </div>
            <p class="timeline-item-text">${escapeHtml(act.details)}</p>
            <div class="timeline-item-meta">
              <span><i class="fa-solid fa-user-check"></i> تم التسجيل بواسطة: <strong>${escapeHtml(act.user_name || 'مسؤول السيلز')}</strong></span>
            </div>
          </div>
        </div>
      `;
    });

    if (container) container.innerHTML = html;

  } catch (err) {
    if (container) container.innerHTML = `<p style="color: #ef4444; text-align: center; font-size: 0.85rem;">خطأ في الاتصال بالخادم: ${err.message}</p>`;
  }
}

async function submitClientActivity() {
  if (!activeTimelineClientId) return;

  const detailsInput = document.getElementById('activityDetailsText');
  const outcomeSelect = document.getElementById('activityOutcomeSelect');
  const statusChangeSelect = document.getElementById('activityStatusChangeSelect');
  const btn = document.getElementById('btnSubmitActivity');

  const details = detailsInput ? detailsInput.value.trim() : '';
  const outcome = outcomeSelect ? outcomeSelect.value : '';
  const updateStatus = statusChangeSelect ? statusChangeSelect.value : '';

  if (!details) {
    showToast('يرجى كتابة تفاصيل المتابعة أولاً', 'error');
    if (detailsInput) detailsInput.focus();
    return;
  }

  const origBtnText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
  }

  try {
    const res = await fetch(`/api/clients/${activeTimelineClientId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_type: currentSelectedActivityType,
        outcome,
        details,
        update_client_status: updateStatus || null
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast(data.message || 'تم تسجيل المتابعة بنجاح 👍', 'success');
      if (detailsInput) detailsInput.value = '';

      await loadClientActivities(activeTimelineClientId);

      if (data.updatedStatus) {
        const client = allClients.find(c => c.id === activeTimelineClientId);
        if (client) {
          client.status = data.updatedStatus;
          renderDealsPipeline();
          loadPortalStats();
        }
      }
    } else {
      showToast(data.message || 'فشل حفظ المتابعة', 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

// ==================== إضافة عميل جديد من بوابة السيلز وإرساله للأونر ====================
function openNewClientModal() {
  const modal = document.getElementById('newClientModal');
  if (modal) {
    modal.classList.remove('d-none');
    const nameInput = document.getElementById('portalClientName');
    if (nameInput) nameInput.focus();
  }
}

function closeNewClientModal() {
  const modal = document.getElementById('newClientModal');
  if (modal) modal.classList.add('d-none');
  const form = document.getElementById('newClientPortalForm');
  if (form) form.reset();
}

async function handlePortalCreateClient(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitPortalClient');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال...';
  }

  const name = document.getElementById('portalClientName').value.trim();
  const phone = document.getElementById('portalClientPhone').value.trim();
  const project_interest = document.getElementById('portalClientInterest').value.trim();
  const total_value = parseFloat(document.getElementById('portalClientValue').value) || 0;
  const notes = document.getElementById('portalClientNotes').value.trim();

  async function sendPortalCreate(confirmRestore = false) {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        company: '',
        email: '',
        project_interest,
        total_value,
        notes,
        confirm_restore: confirmRestore
      })
    });
    return res.json();
  }

  try {
    let data = await sendPortalCreate(false);

    if (data.requiresConfirmation) {
      const confirmed = await window.showCrmConfirmDialog({
        title: 'العميل موجود في الأرشيف',
        message: data.message,
        confirmText: 'تأكيد الإضافة والإزالة من الأرشيف',
        cancelText: 'إلغاء'
      });
      if (!confirmed) return;
      data = await sendPortalCreate(true);
    }

    if (data.success) {
      closeNewClientModal();
      showToast(data.message || 'تمت إضافة العميل وإسناده لحسابك بنجاح للبدء في متابعته!', 'success');
      await loadPortalData();
    } else {
      showToast(data.message || 'فشل إرسال العميل', 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالخادم', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}



// ========================================================
//   قوالب رسائل الواتساب بالمصرية حسب مرحلة العميل (5 رسائل لكل مرحلة)
// ========================================================
const WHATSAPP_STAGE_TEMPLATES = {
  new: {
    label: 'عميل جديد / تم الإسناد',
    messages: [
      'أهلاً بحضرتك يا أستاذ {name} 🌟 معاك {sales} من إدارة المبيعات. شوفت إن حضرتك مهتم بـ ({project})، حابب أتواصل معاك في الوقت المناسب ليك عشان أوضح لحضرتك كل التفاصيل والأسعار المتاحة.',
      'مساء الخير يا أستاذ {name} 👋 معاك {sales}. بخصوص استفسار حضرتك عن ({project})، عندنا حالياً وحدات مميزة جداً وأنظمة سداد مرنة. تحب نكلم حضرتك امتى النهارده؟',
      'السلام عليكم أستاذ {name} 🤝 معاك {sales} مستشارك العقاري. حبيت أرحب بحضرتك وأبعتلك تفاصيل ومميزات ({project}) على السريع، ولو حابب نحدد مكالمة قصيرة 5 دقايق تحت أمرك.',
      'أهلاً يا فندم أستاذ {name} ✨ معاك {sales}. وصلنا طلب حضرتك بخصوص ({project})، ممكن أعرف المساحة أو الميزانية اللي بتدور عليها عشان أرشح لحضرتك أنسب اختيارات عندنا؟',
      'تحياتي لحضرتك يا أستاذ {name} 📞 معاك {sales} من فريق المبيعات. حاولت أتواصل معاك بخصوص ({project})، أول ما تكون فاضي ابعتلي رسالة أو قولي الميعاد المناسب وأنا هكلمك فوراً.'
    ]
  },
  progress: {
    label: 'قيد المتابعة والتفاوض',
    messages: [
      'أهلاً بحضرتك تاني يا أستاذ {name} 👋 معاك {sales}. حبيت أطمن وصلت لإيه في العرض اللي اتكلمنا فيه بخصوص ({project})؟ ولو في أي نقطة حابب نوضحها أو نظبطها معاك أنا جاهز.',
      'مساء الخير يا أستاذ {name} ✨ معاك {sales}. في تحديث جديد ممتاز بخصوص ({project}) وعروض تقسيط هتناسب حضرتك جداً، تحب أبعتلك تفاصيلها ولا نتكلم فون؟',
      'السلام عليكم أستاذ {name} 🤝 معاك {sales}. إيه رأي حضرتك نحدد ميعاد معاينة على الطبيعة لـ ({project}) الأسبوع ده عشان تشوف الموقع والتشطيب بنفسك قبل ما تاخد قرارك؟',
      'أهلاً يا أستاذ {name} 📄 معاك {sales}. جهزت لحضرتك مقارنة بسيطة بين أفضل الوحدات المتاحة حالياً في ({project}) من حيث السعر والمساحة، تحب أبعتهالك دلوقتي؟',
      'تحياتي لحضرتك يا أستاذ {name} ⏳ معاك {sales}. حبيت أفكر حضرتك إن الوحدات المميزة في ({project}) الإقبال عليها عالي الفترة دي، فلو نويت نحجز ميعاد أو نكمل الخطوة الجاية قولي وأنا معاك.'
    ]
  },
  delayed: {
    label: 'مؤجل / اتصال لاحق',
    messages: [
      'أهلاً بحضرتك يا أستاذ {name} 😊 معاك {sales}. بناءً على الميعاد اللي اتفقنا عليه قبل كده، حبيت أسأل لو وقت حضرتك يسمح نكمل كلامنا بخصوص ({project})؟',
      'مساء الخير يا أستاذ {name} 🌟 معاك {sales}. عدّى وقت على آخر مكالمة لينا بخصوص ({project})، حبيت أطمن عليك وأعرف لو ظروفك دلوقتي مناسبة نرجع نرتب الاختيارات من جديد.',
      'السلام عليكم أستاذ {name} 👋 معاك {sales}. نزلت عندنا أسعار وعروض جديدة في ({project}) ممكن تكون أنسب ليك دلوقتي، حبيت أبلغك بيها أول بأول.',
      'أهلاً يا فندم أستاذ {name} 🤝 معاك {sales}. ميعاد المتابعة اللي حضرتك حددته جه، قولّي تحب أكلمك النهارده الساعة كام ولا نأجلها ليوم تاني يناسبك؟',
      'تحياتي لحضرتك أستاذ {name} ✨ معاك {sales}. مش حابب أزعجك، بس حبيت أسيبلك رسالة تذكير لطيفة إننا جاهزين في أي وقت لو حبيت تشوف الجديد في ({project}).'
    ]
  },
  contracted: {
    label: 'تم التعاقد والنجاح 🏆',
    messages: [
      'ألف مبروك يا أستاذ {name} 🎉 معاك {sales}. مبسوطين جداً بتعاقد حضرتك معانا في ({project})، ونتمنى لك كل التوفيق والبركة فيها، وأنا معاك لأي استفسار في أي وقت.',
      'مساء الخير يا أستاذ {name} 🏆 معاك {sales}. حبيت أطمن على حضرتك بعد إتمام التعاقد في ({project}) وأتأكد إن كل الإجراءات والأوراق ماشية معاك تمام وبكل سلاسة.',
      'تحياتي لحضرتك يا أستاذ {name} 🌟 معاك {sales}. شكراً على ثقتك الغالية فينا وفي ({project})، ولو في أي حد من معارفك بيدور على وحدة مميزة هنشرف جداً بخدمته زي حضرتك.',
      'أهلاً بحضرتك يا أستاذ {name} 🤝 معاك {sales}. حبيت أتابع معاك لو في أي استفسار بخصوص مواعيد الأقساط أو الاستلام في ({project})، تحت أمرك دايماً.',
      'السلام عليكم أستاذ {name} ✨ معاك {sales}. بنفكرك دايماً إن خدمة ما بعد البيع موجودة لراحتك في أي وقت بخصوص وحدتك في ({project})، نهارك سعيد!'
    ]
  },
  lost: {
    label: 'ملغي / غير مهتم',
    messages: [
      'أهلاً بحضرتك يا أستاذ {name} 😊 معاك {sales}. عارف إن العرض اللي فات في ({project}) مكنش أنسب حاجة وقتها، بس حبيت أبلغك إن عندنا حالياً بدائل بأسعار ومساحات مختلفة ممكن تعجبك.',
      'مساء الخير يا أستاذ {name} 👋 معاك {sales}. حبيت أسلم عليك وأعرف لو خططك اتغيرت الفترة دي وبقيت بتدور تاني على فرصة كويسة في ({project}) أو غيره.',
      'السلام عليكم أستاذ {name} ✨ معاك {sales}. نزل عندنا مؤخراً أنظمة سداد مريحة ومقدمات أقل بكتير من قبل كده، فقلت أشاركك المعلومة يمكن تناسبك المرة دي.',
      'تحياتي لحضرتك يا أستاذ {name} 🤝 معاك {sales}. رأيك يهمنا جداً، لو في حاجة معينة كانت سبب إننا مكملناش في ({project}) ياريت تقولي عشان نقدر نوفرلك اللي يناسبك مستقبلاً.',
      'أهلاً يا فندم أستاذ {name} 🌟 معاك {sales}. رقمي مع حضرتك في أي وقت لو احتجت أي استشارة عقارية أو حبيت تسأل عن أسعار السوق الحالية، بالتوفيق دايماً!'
    ]
  }
};

function getWhatsAppStageKey(status) {
  if (status === 'قيد المتابعة') return 'progress';
  if (status === 'مؤجل') return 'delayed';
  if (status === 'تم التعاقد') return 'contracted';
  if (status === 'ملغي') return 'lost';
  return 'new';
}

function formatWhatsAppTemplateText(template, client) {
  const senderName = currentSalesUser
    ? (currentSalesUser.full_name || currentSalesUser.fullName || getFriendlyName(currentSalesUser))
    : 'مسؤول المبيعات';
  const clientName = (client && client.name) ? client.name.trim() : 'فندم';
  const project = (client && client.project_interest) ? client.project_interest.trim() : 'مشروعاتنا';
  return template
    .replace(/\{name\}/g, clientName)
    .replace(/\{project\}/g, project)
    .replace(/\{sales\}/g, senderName);
}

function openWhatsAppTemplatesModal(clientId, overrideStatus) {
  let client = allClients.find(c => c.id === clientId);
  if (!client && Array.isArray(activeRemindersList)) {
    client = activeRemindersList.find(r => r.id === clientId);
  }
  if (!client) return;

  const cleanPhone = formatWhatsAppNumber(client.phone);
  if (!cleanPhone) {
    showToast('رقم هاتف العميل غير صالح لفتح واتساب', 'error');
    return;
  }

  const stageKey = getWhatsAppStageKey(overrideStatus || client.status);
  const stageConfig = WHATSAPP_STAGE_TEMPLATES[stageKey] || WHATSAPP_STAGE_TEMPLATES.new;
  const formattedMessages = stageConfig.messages.map(tpl => formatWhatsAppTemplateText(tpl, client));

  const existing = document.getElementById('whatsappTemplatesOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'whatsappTemplatesOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;font-family:Cairo,sans-serif;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#ffffff;border-radius:18px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;padding:22px;box-shadow:0 24px 48px rgba(15,23,42,0.3);border:1px solid #e2e8f0;';

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #f1f5f9;padding-bottom:12px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:42px;height:42px;border-radius:12px;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-size:1.35rem;">
          <i class="fa-brands fa-whatsapp"></i>
        </div>
        <div>
          <h3 style="margin:0;font-size:1.08rem;font-weight:800;color:#0f172a;">رسائل واتساب جاهزة — ${escapeHtml(client.name || 'العميل')}</h3>
          <small style="color:#64748b;">المرحلة: <strong style="color:#0f172a;">${escapeHtml(stageConfig.label)}</strong> &bull; ${escapeHtml(client.phone || '')}</small>
        </div>
      </div>
      <button type="button" id="closeWaTemplatesBtn" style="border:none;background:#f1f5f9;color:#475569;width:34px;height:34px;border-radius:10px;font-size:1.2rem;cursor:pointer;">&times;</button>
    </div>

    <div id="waTemplatesList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;"></div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;">
      <label style="display:block;font-size:0.85rem;font-weight:700;color:#334155;margin-bottom:6px;">
        <i class="fa-solid fa-pen"></i> معاينة وتعديل الرسالة قبل الإرسال:
      </label>
      <textarea id="waCustomMessageBox" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #cbd5e1;font-family:inherit;font-size:0.92rem;line-height:1.6;resize:vertical;"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
        <button type="button" id="cancelWaSendBtn" style="padding:9px 18px;border-radius:10px;border:1px solid #cbd5e1;background:#ffffff;color:#475569;font-family:inherit;font-weight:700;cursor:pointer;">إغلاق</button>
        <button type="button" id="sendWaCustomBtn" style="padding:9px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:#ffffff;font-family:inherit;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
          <i class="fa-brands fa-whatsapp"></i>
          <span>إرسال عبر واتساب</span>
        </button>
      </div>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const listEl = card.querySelector('#waTemplatesList');
  const textarea = card.querySelector('#waCustomMessageBox');
  textarea.value = formattedMessages[0] || '';

  formattedMessages.forEach((msgText, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#ffffff;display:flex;flex-direction:column;gap:8px;transition:border-color 0.2s;';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.78rem;font-weight:800;color:#15803d;background:#dcfce7;padding:3px 10px;border-radius:999px;';
    badge.textContent = `رسالة ${idx + 1}`;

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;';

    const editPickBtn = document.createElement('button');
    editPickBtn.type = 'button';
    editPickBtn.textContent = 'تعديل';
    editPickBtn.style.cssText = 'padding:5px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-family:inherit;font-size:0.78rem;font-weight:700;cursor:pointer;';
    editPickBtn.onclick = () => {
      textarea.value = msgText;
      textarea.focus();
    };

    const quickSendBtn = document.createElement('button');
    quickSendBtn.type = 'button';
    quickSendBtn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> إرسال مباشرة';
    quickSendBtn.style.cssText = 'padding:5px 12px;border-radius:8px;border:none;background:#16a34a;color:#ffffff;font-family:inherit;font-size:0.78rem;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:5px;';
    quickSendBtn.onclick = () => {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msgText)}`, '_blank', 'noopener');
      overlay.remove();
    };

    btns.appendChild(editPickBtn);
    btns.appendChild(quickSendBtn);
    top.appendChild(badge);
    top.appendChild(btns);

    const p = document.createElement('p');
    p.style.cssText = 'margin:0;font-size:0.9rem;line-height:1.65;color:#1e293b;';
    p.textContent = msgText;

    item.appendChild(top);
    item.appendChild(p);
    listEl.appendChild(item);
  });

  const closeFn = () => overlay.remove();
  card.querySelector('#closeWaTemplatesBtn').onclick = closeFn;
  card.querySelector('#cancelWaSendBtn').onclick = closeFn;
  overlay.onclick = (e) => { if (e.target === overlay) closeFn(); };
  card.querySelector('#sendWaCustomBtn').onclick = () => {
    const finalMsg = (textarea.value || '').trim();
    if (!finalMsg) {
      showToast('يرجى كتابة نص الرسالة أولاً', 'error');
      return;
    }
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`, '_blank', 'noopener');
    closeFn();
  };
}
