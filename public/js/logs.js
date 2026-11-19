let allLogs = [];
let availableUsers = [];
let currentScope = 'today'; // يفتح تلقائياً وبشكل افتراضي على السجل اليومي (يومياً)
let currentActionFilter = 'all'; // 'all' | 'contracted' | 'postponed' | 'negotiation' | 'notes'
let currentSpecificUser = 'all';

// متغيرات التحميل اللانهائي الذكي (Infinite Scroll - 15 عملية في كل دفعة)
const CHUNK_SIZE = 15;
let currentVisibleLimit = CHUNK_SIZE;
let currentFilteredLogs = [];
let isInfiniteLoading = false;
let infiniteObserver = null;

document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    document.body.classList.add('page-revealed');
  });
  verifySession();
  initInfiniteScrollObserver();
});

// التحكم الذكي في حقل البحث وزر المسح السريع
function onSearchInput(input) {
  const clearBtn = document.getElementById('btnClearSearch');
  if (clearBtn) {
    clearBtn.classList.toggle('d-none', !input.value.trim());
  }
  filterLogsTable();
}

function clearSearchInput() {
  const input = document.getElementById('logSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('btnClearSearch');
  if (clearBtn) {
    clearBtn.classList.add('d-none');
  }
  filterLogsTable();
}

// فحص واستبعاد أي حركة منسوبة للمدير العام (الأونر) لحصر السجل في نشاط مسؤولي السيلز فقط
function isOwnerLog(log) {
  if (!log) return false;
  const actorRole = log.user_role || '';
  const actorName = log.user_name || '';
  const actorEmail = log.user_email || '';
  return actorEmail === '1@1.com' ||
         actorRole.includes('Owner') ||
         actorRole.includes('المالك') ||
         actorName.includes('المدير العام') ||
         actorName.includes('الأونر');
}

// دالة مساعدة لتحديد ما إذا كانت الحركة مسجلة اليوم (منذ منتصف الليل حتى الآن)
function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

// دالة مساعدة لتحديد ما إذا كانت الحركة مسجلة خلال الشهر الحالي
function isThisMonth(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth();
}

// 1. التحقق من جلسة الأونر (الصفحة للمدير العام فقط)
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
    document.getElementById('ownerNameDisplay').textContent = user.fullName || 'المدير العام';
    document.getElementById('ownerEmailDisplay').textContent = user.email || '1@1.com';

    // حماية زر مسح السجل ليكون متاحاً للأونر فقط
    const isOwner = user.email === '1@1.com' || (user.role && (user.role.includes('Owner') || user.role.includes('المالك')));
    const clearBtn = document.getElementById('btnClearAllLogs');
    if (clearBtn) {
      clearBtn.style.display = isOwner ? 'inline-flex' : 'none';
    }

    // تحميل السجل وقائمة المستخدمين
    loadLogs();
  } catch (err) {
    window.location.href = '/';
  }
}

// 2. جلب سجل العمليات الرقابي لنشاط السيلز من PostgreSQL
async function loadLogs() {
  try {
    const [logsRes, usersRes] = await Promise.all([
      fetch('/api/audit-logs?limit=1000&sales_only=true'),
      fetch('/api/users')
    ]);

    const logsData = await logsRes.json();
    if (logsData.success && logsData.logs) {
      // فلترة صارمة: استبعاد أي حركة للمدير العام وحصر السجل في نشاط فريق السيلز فقط
      allLogs = logsData.logs.filter(l => !isOwnerLog(l));
    }

    try {
      const usersData = await usersRes.json();
      if (usersData.success && usersData.users) {
        // حصر قائمة المستخدمين في موظفي السيلز فقط
        availableUsers = usersData.users.filter(u => {
          const role = u.role || '';
          return !role.includes('Owner') && !role.includes('المالك') && u.email !== '1@1.com';
        });
      }
    } catch (e) {
      console.warn('فشل جلب قائمة موظفي السيلز:', e);
    }

    // تحديث أعداد تبويبات النطاق الزمني (يومياً - شهرياً - الكل) لنشاط السيلز
    const todayLogsCount = allLogs.filter(l => isToday(l.created_at)).length;
    const monthLogsCount = allLogs.filter(l => isThisMonth(l.created_at)).length;
    const allLogsCount = allLogs.length;

    const scopeCountToday = document.getElementById('scopeCountToday');
    const scopeCountMonth = document.getElementById('scopeCountMonth');
    const scopeCountAll = document.getElementById('scopeCountAll');

    if (scopeCountToday) scopeCountToday.textContent = todayLogsCount;
    if (scopeCountMonth) scopeCountMonth.textContent = monthLogsCount;
    if (scopeCountAll) scopeCountAll.textContent = allLogsCount;

    // تسميات التواريخ الذكية
    const todayDateLabel = document.getElementById('todayDateLabel');
    if (todayDateLabel) {
      todayDateLabel.textContent = new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'short' });
    }

    const monthDateLabel = document.getElementById('monthDateLabel');
    if (monthDateLabel) {
      monthDateLabel.textContent = new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    }

    // تحديث بطاقات المؤشرات (KPIs)
    updateKPIs(logsData ? logsData.stats : null);

    // تحديث أزرار الإجراءات وقائمة السيلز والجدول
    updateActionCounts();
    populateSalesFilterOptions();
    filterLogsTable();
    showToast('تم تحديث سجل نشاط السيلز بنجاح', 'info');
  } catch (err) {
    console.error('خطأ في جلب السجل:', err);
    showToast('خطأ في الاتصال بالخادم', 'error');
  }
}

// 3. فحص تطابق الحركة مع نوع إجراء السيلز
function isLogMatchingAction(log, actionKey) {
  if (actionKey === 'all') return true;

  const action = log.action_type || '';
  const details = log.details || '';

  if (actionKey === 'contracted') {
    return action.includes('تعاقد') || details.includes('تعاقد') || action.includes('نجاح الصفقة');
  }
  if (actionKey === 'postponed') {
    return action.includes('تأجيل') || action.includes('مؤجل') || details.includes('تأجيل') || action.includes('جدولة متابعة');
  }
  if (actionKey === 'negotiation') {
    return action.includes('متابعة') || action.includes('تفاوض') || details.includes('متابعة') || details.includes('تفاوض');
  }
  if (actionKey === 'notes') {
    return action.includes('ملاحظات') || details.includes('ملاحظات');
  }

  return true;
}

// 4. تحديث الأعداد الحية لأزرار فلترة إجراءات السيلز حسب النطاق المختار (يومياً / شهرياً / الكل)
function updateActionCounts() {
  let baseLogs = allLogs;
  if (currentScope === 'today') {
    baseLogs = allLogs.filter(l => isToday(l.created_at));
  } else if (currentScope === 'monthly') {
    baseLogs = allLogs.filter(l => isThisMonth(l.created_at));
  }

  let countAll = baseLogs.length;
  let countContracted = 0;
  let countPostponed = 0;
  let countNegotiation = 0;
  let countNotes = 0;

  baseLogs.forEach(log => {
    if (isLogMatchingAction(log, 'contracted')) countContracted++;
    if (isLogMatchingAction(log, 'postponed')) countPostponed++;
    if (isLogMatchingAction(log, 'negotiation')) countNegotiation++;
    if (isLogMatchingAction(log, 'notes')) countNotes++;
  });

  const elAll = document.getElementById('countAll');
  const elContracted = document.getElementById('countContracted');
  const elPostponed = document.getElementById('countPostponed');
  const elNegotiation = document.getElementById('countNegotiation');
  const elNotes = document.getElementById('countNotes');

  if (elAll) elAll.textContent = countAll;
  if (elContracted) elContracted.textContent = countContracted;
  if (elPostponed) elPostponed.textContent = countPostponed;
  if (elNegotiation) elNegotiation.textContent = countNegotiation;
  if (elNotes) elNotes.textContent = countNotes;

  const scopeCountToday = document.getElementById('scopeCountToday');
  const scopeCountMonth = document.getElementById('scopeCountMonth');
  const scopeCountAll = document.getElementById('scopeCountAll');
  if (scopeCountToday) scopeCountToday.textContent = allLogs.filter(l => isToday(l.created_at)).length;
  if (scopeCountMonth) scopeCountMonth.textContent = allLogs.filter(l => isThisMonth(l.created_at)).length;
  if (scopeCountAll) scopeCountAll.textContent = allLogs.length;
}

// 5. بناء قائمة اختيار موظف السيلز بالاسم (فريق المبيعات فقط)
function populateSalesFilterOptions() {
  const salesGroup = document.getElementById('salesOptionsGroup');
  if (!salesGroup) return;

  const userMap = new Map();

  availableUsers.forEach(u => {
    if (u.full_name) {
      userMap.set(u.full_name.trim().toLowerCase(), {
        id: u.id,
        name: u.full_name.trim()
      });
    }
  });

  allLogs.forEach(l => {
    if (l.user_name && !isOwnerLog(l)) {
      const key = l.user_name.trim().toLowerCase();
      if (!userMap.has(key)) {
        userMap.set(key, {
          id: l.user_id || null,
          name: l.user_name.trim()
        });
      }
    }
  });

  const sales = Array.from(userMap.values());
  sales.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  salesGroup.innerHTML = sales.map(s => 
    `<option value="${escapeHtml(s.name)}">👤 ${escapeHtml(s.name)} (مسؤول سيلز)</option>`
  ).join('');
}

// 6. تحديث بطاقات المؤشرات (KPIs) - خاصة بالسيلز
function updateKPIs(stats) {
  const todayCount = allLogs.filter(l => isToday(l.created_at)).length;
  const monthCount = allLogs.filter(l => isThisMonth(l.created_at)).length;
  const contractedCount = allLogs.filter(l => isLogMatchingAction(l, 'contracted')).length;

  const elToday = document.getElementById('kpiTodayLogs');
  const elMonth = document.getElementById('kpiMonthLogs');
  const elTotal = document.getElementById('kpiTotalLogs');
  const elContracted = document.getElementById('kpiContractedEvents');

  if (elToday) elToday.textContent = todayCount;
  if (elMonth) elMonth.textContent = monthCount;
  if (elTotal) elTotal.textContent = allLogs.length;
  if (elContracted) elContracted.textContent = contractedCount;
}

// 7. تصفية السجل وتطبيق الفلاتر والتمرير اللانهائي (15 حركة في كل دفعة)
function filterLogsTable(resetPage = true) {
  if (resetPage) {
    currentVisibleLimit = CHUNK_SIZE;
  }

  const searchVal = (document.getElementById('logSearchInput').value || '').trim().toLowerCase();

  let scopePrefix = '';
  if (currentScope === 'today') {
    scopePrefix = 'حركات السيلز اليوم — ';
  } else if (currentScope === 'monthly') {
    scopePrefix = 'حركات السيلز هذا الشهر — ';
  } else {
    scopePrefix = 'سجل شامل للسيلز — ';
  }

  let activeTitle = '';
  if (currentSpecificUser !== 'all') {
    activeTitle = `${scopePrefix}مسؤول السيلز: ${currentSpecificUser}`;
  } else if (currentActionFilter === 'contracted') {
    activeTitle = `${scopePrefix}الصفقات المتعاقد عليها 🏆`;
  } else if (currentActionFilter === 'postponed') {
    activeTitle = `${scopePrefix}المتابعات المؤجلة ⏳`;
  } else if (currentActionFilter === 'negotiation') {
    activeTitle = `${scopePrefix}حالات التفاوض والمتابعة 🤝`;
  } else if (currentActionFilter === 'notes') {
    activeTitle = `${scopePrefix}الملاحظات والتحديثات 📝`;
  } else if (currentScope === 'today') {
    activeTitle = 'حركات فريق السيلز لليوم فقط (تلقائي)';
  } else if (currentScope === 'monthly') {
    activeTitle = 'سجل حركات السيلز لهذا الشهر';
  } else {
    activeTitle = 'سجل شامل لكافة حركات السيلز';
  }

  let filtered = allLogs.filter(log => {
    // 0) استبعاد أي حركة تخص الأونر قطيعاً
    if (isOwnerLog(log)) return false;

    // 1) نطاق التاريخ الزمني
    if (currentScope === 'today' && !isToday(log.created_at)) {
      return false;
    }
    if (currentScope === 'monthly' && !isThisMonth(log.created_at)) {
      return false;
    }

    // 2) الفلترة حسب نوع إجراء السيلز
    if (currentActionFilter !== 'all') {
      if (!isLogMatchingAction(log, currentActionFilter)) {
        return false;
      }
    }

    // 3) الفلترة حسب موظف سيلز محدد بالاسم
    if (currentSpecificUser !== 'all') {
      const unameLower = currentSpecificUser.toLowerCase();
      const matchActor = log.user_name && log.user_name.toLowerCase().includes(unameLower);
      const matchDetails = log.details && log.details.toLowerCase().includes(unameLower);
      if (!matchActor && !matchDetails) {
        return false;
      }
    }

    // 4) البحث النصي
    if (searchVal) {
      const details = (log.details || '').toLowerCase();
      const user = (log.user_name || '').toLowerCase();
      const target = (log.target_name || '').toLowerCase();
      const action = (log.action_type || '').toLowerCase();
      return details.includes(searchVal) || user.includes(searchVal) || target.includes(searchVal) || action.includes(searchVal);
    }

    return true;
  });

  currentFilteredLogs = filtered;

  // تحديث شريط التنبيه عند تطبيق فلترة إضافية
  const alertEl = document.getElementById('activeFilterAlert');
  const alertNameEl = document.getElementById('activeFilterName');
  const alertCountEl = document.getElementById('filteredCount');

  const hasExtraFilter = (currentActionFilter !== 'all' || currentSpecificUser !== 'all' || searchVal !== '');
  if (hasExtraFilter) {
    if (alertEl) alertEl.classList.remove('d-none');
    if (alertNameEl) alertNameEl.textContent = activeTitle;
    if (alertCountEl) alertCountEl.textContent = filtered.length;
  } else {
    if (alertEl) alertEl.classList.add('d-none');
  }

  // تحديث بطاقة ومؤشر تقييم أداء مسؤول السيلز المحدد
  updateSalesEvaluationCard();

  // اقتطاع الدفعة المرئية الحالية (أول 15 عملية)
  const visibleSlice = currentFilteredLogs.slice(0, currentVisibleLimit);
  renderLogsCards(visibleSlice);

  // تحديث حالة مؤشرات التمرير اللانهائي
  updateInfiniteScrollUI(currentFilteredLogs.length);
}

// 7.1 تحديث مؤشرات حالة التمرير اللانهائي
function updateInfiniteScrollUI(totalCount) {
  const loader = document.getElementById('infiniteScrollLoader');
  const endBox = document.getElementById('infiniteScrollEnd');
  const statusEl = document.getElementById('infiniteScrollStatus');
  const endText = document.getElementById('infiniteScrollEndText');

  if (loader) loader.classList.add('d-none');

  if (totalCount === 0) {
    if (endBox) endBox.classList.add('d-none');
    if (statusEl) statusEl.textContent = '';
    return;
  }

  const showingCount = Math.min(currentVisibleLimit, totalCount);

  if (statusEl) {
    statusEl.innerHTML = `يتم عرض <strong>${showingCount}</strong> من إجمالي <strong>${totalCount}</strong> عملية مسجلة`;
  }

  if (showingCount >= totalCount) {
    if (endBox) {
      if (totalCount > CHUNK_SIZE) {
        endBox.classList.remove('d-none');
        if (endText) {
          endText.textContent = `تم استعراض كافة العمليات المسجلة لهذا النطاق بالكامل (${totalCount} عملية)`;
        }
      } else {
        endBox.classList.add('d-none');
      }
    }
  } else {
    if (endBox) endBox.classList.add('d-none');
  }
}

// 7.2 محرك جلب الدفعة التالية (15 حركة) أثناء التمرير لأسفل (Infinite Scroll)
function handleInfiniteScrollTrigger() {
  if (isInfiniteLoading || currentVisibleLimit >= currentFilteredLogs.length) {
    return;
  }

  isInfiniteLoading = true;
  const loader = document.getElementById('infiniteScrollLoader');
  if (loader) loader.classList.remove('d-none');

  // تأخير بسيط لانسيابية ظهور الدفعة
  setTimeout(() => {
    const nextBatch = currentFilteredLogs.slice(currentVisibleLimit, currentVisibleLimit + CHUNK_SIZE);
    currentVisibleLimit += nextBatch.length;

    const container = document.getElementById('timelineCardsContainer');
    if (container && nextBatch.length > 0) {
      const nextHtml = nextBatch.map(createLogCardHtml).join('');
      container.insertAdjacentHTML('beforeend', nextHtml);
    }

    if (loader) loader.classList.add('d-none');
    isInfiniteLoading = false;

    updateInfiniteScrollUI(currentFilteredLogs.length);
  }, 180);
}

// 7.3 تفعيل مراقب التمرير التلقائي (IntersectionObserver)
function initInfiniteScrollObserver() {
  const container = document.getElementById('infiniteScrollContainer');
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

// 7.1 تحديث بطاقة ومؤشر تقييم أداء مسؤول السيلز المحدد عند اختياره
function updateSalesEvaluationCard() {
  const card = document.getElementById('salesPerformanceCard');
  if (!card) return;

  if (currentSpecificUser === 'all') {
    card.classList.add('d-none');
    return;
  }

  const uname = currentSpecificUser;
  const userObj = availableUsers.find(u => u.full_name && u.full_name.trim().toLowerCase() === uname.toLowerCase()) || { id: null, full_name: uname };

  // حساب الحركات الخاصة بهذا الموظف من السجل ضمن النطاق الزمني المختار (اليوم / الشهر / الكل)
  let repLogs = allLogs.filter(l => l.user_name && l.user_name.toLowerCase().includes(uname.toLowerCase()));
  if (currentScope === 'today') {
    repLogs = repLogs.filter(l => isToday(l.created_at));
  } else if (currentScope === 'monthly') {
    repLogs = repLogs.filter(l => isThisMonth(l.created_at));
  }

  const activityCount = repLogs.length;
  const contractedLogs = repLogs.filter(l => isLogMatchingAction(l, 'contracted'));
  const postponedLogs = repLogs.filter(l => isLogMatchingAction(l, 'postponed'));
  const negotiationLogs = repLogs.filter(l => isLogMatchingAction(l, 'negotiation'));

  // عناصر واجهة كارت التقييم
  const avatarEl = document.getElementById('evalRepAvatar');
  const nameEl = document.getElementById('evalRepName');
  const scopeBadge = document.getElementById('evalScopeBadge');

  if (avatarEl) avatarEl.textContent = getInitials(uname);
  if (nameEl) nameEl.textContent = uname;
  if (scopeBadge) {
    if (currentScope === 'today') scopeBadge.textContent = 'حركات اليوم';
    else if (currentScope === 'monthly') scopeBadge.textContent = 'حركات هذا الشهر';
    else scopeBadge.textContent = 'السجل الشامل';
  }

  // أرقام أولية فورية من السجل
  document.getElementById('evalActivityCount').textContent = activityCount;
  document.getElementById('evalActivitySub').textContent = `${activityCount} حركة في ${scopeBadge ? scopeBadge.textContent : 'الفترة'}`;
  document.getElementById('evalContractedCount').textContent = `${contractedLogs.length} صفقة مسجلة بالسجل`;
  document.getElementById('evalNegotiationCount').textContent = negotiationLogs.length;
  document.getElementById('evalPostponedCount').textContent = postponedLogs.length;

  card.classList.remove('d-none');

  // جلب إحصائيات المحفظة الدقيقة والتقييم وقيم الصفقات الحية من السيرفر
  if (userObj.id) {
    fetch(`/api/sales-portal/stats?sales_id=${userObj.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.stats) {
          const s = data.stats;
          const scoreEl = document.getElementById('evalScoreNumber');
          if (scoreEl) scoreEl.textContent = `${s.performanceScore}%`;
          
          const ratingBadge = document.getElementById('evalRatingBadge');
          if (ratingBadge) {
            ratingBadge.textContent = s.ratingLabel;
            ratingBadge.className = `eval-rating-badge ${s.ratingClass || 'rating-excellent'}`;
          }

          const contractedValEl = document.getElementById('evalContractedVal');
          if (contractedValEl) {
            contractedValEl.textContent = s.closedDealsValue > 0 ? `${Number(s.closedDealsValue).toLocaleString('ar-EG')} ج.م` : `${s.contracted} عقود`;
          }

          const contractedCountEl = document.getElementById('evalContractedCount');
          if (contractedCountEl) {
            contractedCountEl.textContent = `${s.contracted} عقود مبرمة بنجاح`;
          }

          const negEl = document.getElementById('evalNegotiationCount');
          if (negEl) negEl.textContent = s.inProgress;

          const postEl = document.getElementById('evalPostponedCount');
          if (postEl) postEl.textContent = s.delayed;

          const convRateEl = document.getElementById('evalConversionRate');
          if (convRateEl) convRateEl.textContent = `${s.conversionRate}%`;

          const convBar = document.getElementById('evalConversionBar');
          if (convBar) convBar.style.width = `${Math.min(100, Math.max(0, s.conversionRate))}%`;
        }
      })
      .catch(e => console.warn('فشل جلب إحصائيات السيلز المحددة:', e));
  } else {
    // تقييم تقديري فوري في حال عدم وجود معرف مسبق
    const score = Math.min(100, Math.max(50, 60 + contractedLogs.length * 15 + negotiationLogs.length * 5));
    const scoreEl = document.getElementById('evalScoreNumber');
    if (scoreEl) scoreEl.textContent = `${score}%`;
    const ratingBadge = document.getElementById('evalRatingBadge');
    if (ratingBadge) {
      ratingBadge.textContent = score >= 85 ? 'ممتاز 🌟' : 'نشط وفعال ⚡';
      ratingBadge.className = `eval-rating-badge ${score >= 85 ? 'rating-excellent' : 'rating-very-good'}`;
    }
  }
}

// 8. التبديل الثلاثي بين: يومياً - شهرياً - الكل
function setScopeFilter(scope) {
  currentScope = scope;

  const btnToday = document.getElementById('scopeTabToday');
  const btnMonthly = document.getElementById('scopeTabMonthly');
  const btnAll = document.getElementById('scopeTabAll');

  if (btnToday) btnToday.classList.toggle('active', scope === 'today');
  if (btnMonthly) btnMonthly.classList.toggle('active', scope === 'monthly');
  if (btnAll) btnAll.classList.toggle('active', scope === 'all');

  updateActionCounts();
  filterLogsTable();
}

// 9. فلترة إجراءات السيلز المباشرة (تعاقدات / تأجيلات / تفاوض / ملاحظات)
function setActionFilter(actionKey, btn) {
  currentActionFilter = actionKey;

  document.querySelectorAll('.filter-pill-group .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const targetBtn = document.querySelector(`.filter-pill-group .filter-btn[data-action="${actionKey}"]`);
    if (targetBtn) targetBtn.classList.add('active');
  }

  filterLogsTable();
}

function onUserFilterSelectChange() {
  const selVal = document.getElementById('userFilterSelect').value;
  currentSpecificUser = selVal;
  filterLogsTable();
}

function resetAllFilters() {
  currentActionFilter = 'all';
  currentSpecificUser = 'all';

  const sel = document.getElementById('userFilterSelect');
  if (sel) sel.value = 'all';

  const searchInp = document.getElementById('logSearchInput');
  if (searchInp) searchInp.value = '';

  document.querySelectorAll('.filter-pill-group .filter-btn').forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.filter-pill-group .filter-btn[data-action="all"]');
  if (allBtn) allBtn.classList.add('active');

  updateActionCounts();
  filterLogsTable();
}

// 10. استخراج الحروف الأولى للمونوغرام (Monogram Initials)
function getInitials(name) {
  if (!name) return 'س';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

// 11. تنسيق تفاصيل العمليات وإبراز المبالغ ومواعيد التأجيل والمشاريع
function formatLogDetails(rawDetails) {
  if (!rawDetails) return '--';
  let safe = escapeHtml(rawDetails);

  // إبراز المبالغ والتعاقدات المالية
  safe = safe.replace(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:ج\.م|جنيه)/g, '<span class="detail-deal-value"><i class="fa-solid fa-coins"></i> $1 ج.م</span>');

  // إبراز مواعيد المتابعات المؤجلة المكتوبة بين أقواس [ ... ]
  safe = safe.replace(/\[([^\]]+)\]/g, '<span class="detail-postpone-date"><i class="fa-regular fa-clock"></i> $1</span>');

  // إبراز سبب التأجيل
  safe = safe.replace(/(سبب التأجيل:|السبب:)\s*([^\-]+)/g, '<span class="detail-reason-tag"><i class="fa-solid fa-circle-info"></i> $1 $2</span>');

  // إبراز المشاريع
  safe = safe.replace(/لمشروع\s*\(([^)]+)\)/g, '<span class="detail-tag"><i class="fa-solid fa-building"></i> $1</span>');

  return safe;
}

// 12. قالب رسالة الحالة الفارغة (مشترك بين عرض الجدول وعرض البطاقات)
function getEmptyStateHtml() {
  if (currentScope === 'today' && currentActionFilter === 'all' && currentSpecificUser === 'all') {
    return `
      <i class="fa-solid fa-calendar-check text-amber" style="font-size:2.4rem; margin-bottom:12px; display:block;"></i>
      <strong style="font-size:1.05rem; display:block; margin-bottom:6px;">لا توجد أي تحركات أو عمليات مسجلة لفريق السيلز اليوم حتى الآن.</strong>
      <p style="font-size:0.86rem; color:var(--text-muted); margin-bottom:14px;">يفتح السجل تلقائياً على حركات اليوم للمراقبة الفورية. يمكنك استعراض سجل الشهر الحالي أو الأرشيف الكامل للسيلز أدناه.</p>
      <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
        <button class="btn-clear-filter" onclick="setScopeFilter('monthly')" style="padding:8px 16px; font-size:0.88rem;">
          <i class="fa-solid fa-calendar-days text-amber"></i> استعراض حركات السيلز هذا الشهر
        </button>
        <button class="btn-clear-filter" onclick="setScopeFilter('all')" style="padding:8px 16px; font-size:0.88rem;">
          <i class="fa-solid fa-layer-group"></i> فتح الأرشيف الشامل للسيلز
        </button>
      </div>
    `;
  } else if (currentScope === 'monthly' && currentActionFilter === 'all' && currentSpecificUser === 'all') {
    return `
      <i class="fa-solid fa-calendar-xmark text-amber" style="font-size:2.4rem; margin-bottom:12px; display:block;"></i>
      <strong style="font-size:1.05rem; display:block; margin-bottom:6px;">لا توجد حركات مسجلة لفريق السيلز خلال هذا الشهر حتى الآن.</strong>
      <div style="margin-top:12px;">
        <button class="btn-clear-filter" onclick="setScopeFilter('all')" style="padding:8px 16px; font-size:0.88rem;">
          <i class="fa-solid fa-layer-group"></i> فتح الأرشيف الشامل للسيلز
        </button>
      </div>
    `;
  } else {
    return `
      <i class="fa-solid fa-filter-circle-xmark" style="font-size:2.4rem; margin-bottom:12px; display:block;"></i>
      <strong style="font-size:1rem; display:block; margin-bottom:6px;">لا توجد حركات سيلز تطابق معايير الفلترة الحالية.</strong>
      <div style="margin-top:10px;">
        <button class="btn-clear-filter" onclick="resetAllFilters()" style="padding:7px 15px; font-size:0.85rem;">
          <i class="fa-solid fa-rotate-left"></i> إعادة ضبط الفلاتر
        </button>
      </div>
    `;
  }
}

// 12.1 تحديد فئة إطار البطاقة الزمنية بناءً على نوع الحركة
function getCardBorderClass(actionType) {
  const type = actionType || '';
  if (type.includes('تعاقد') || type.includes('نجاح الصفقة')) return 'card-border-contracted';
  if (type.includes('تأجيل') || type.includes('مؤجل') || type.includes('جدولة متابعة')) return 'card-border-postpone';
  if (type.includes('إلغاء') || type.includes('ملغي') || type.includes('غير مهتم')) return 'card-border-cancelled';
  if (type.includes('متابعة والتفاوض') || type.includes('بدء التفاوض') || type.includes('قيد المتابعة')) return 'card-border-negotiation';
  if (type.includes('ملاحظات')) return 'card-border-notes';
  return 'card-border-default';
}

// دالة بناء كود HTML لكرت الحركة الفردي في السجل
function createLogCardHtml(log) {
  const timeFormatted = formatLogTime(log.created_at);
  const relativeTime = getRelativeTime(log.created_at);
  const badgeData = getActionBadge(log.action_type);
  const borderClass = getCardBorderClass(log.action_type);

  return `
    <article class="log-timeline-card ${borderClass}">
      <!-- سطر الرأس: الوقت والتاريخ وشارة نوع الإجراء -->
      <div class="card-timeline-header">
        <div class="time-cell-box">
          <span class="time-exact"><i class="fa-regular fa-clock text-amber"></i> ${timeFormatted}</span>
          <span class="time-relative">${relativeTime}</span>
        </div>
        <span class="action-badge ${badgeData.className}">
          <i class="fa-solid ${badgeData.icon}"></i>
          <span>${escapeHtml(log.action_type)}</span>
        </span>
      </div>

      <!-- سطر الهوية: مسؤول السيلز والعميل المستهدف -->
      <div class="card-timeline-actors">
        <div class="actor-box">
          <div class="actor-avatar actor-sales" title="مسؤول سيلز">${getInitials(log.user_name)}</div>
          <div class="actor-details">
            <strong>${escapeHtml(log.user_name || 'مسؤول مبيعات')}</strong>
            <small><i class="fa-solid fa-headset text-blue"></i> مسؤول سيلز</small>
          </div>
        </div>

        <div class="card-target-client">
          <span class="target-badge" title="العميل المرتبط بهذه الحركة">
            <i class="fa-regular fa-user"></i> <span>العميل:</span> <strong>${escapeHtml(log.target_name || log.target_type || 'عميل')}</strong>
          </span>
        </div>
      </div>

      <!-- جسم الحركة: نص التفاصيل وتوضيح المبالغ والمواعيد والنتائج -->
      <div class="card-timeline-body">
        <div class="log-details-text">
          ${formatLogDetails(log.details)}
        </div>
      </div>
    </article>
  `;
}

// 12.3 رسم البطاقات الزمنية المتجاوبة (مثالية للموبايل والتابلت واللابتوب)
function renderLogsCards(logs) {
  const container = document.getElementById('timelineCardsContainer');
  if (!container) return;

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="empty-cards-state text-center py-5" style="color:var(--text-muted); background:#ffffff; border-radius:var(--radius-lg); border:1px solid var(--border-color); padding: 32px 16px;">
        ${getEmptyStateHtml()}
      </div>
    `;
    return;
  }

  container.innerHTML = logs.map(createLogCardHtml).join('');
}

// 13. تحديد شكل ولون شارة نوع العملية
function getActionBadge(actionType) {
  const type = actionType || '';

  if (type.includes('تعاقد') || type.includes('نجاح الصفقة')) {
    return { className: 'badge-contracted', icon: 'fa-trophy' };
  }
  if (type.includes('تأجيل') || type.includes('مؤجل') || type.includes('جدولة متابعة')) {
    return { className: 'badge-postpone', icon: 'fa-clock' };
  }
  if (type.includes('إلغاء') || type.includes('ملغي') || type.includes('غير مهتم')) {
    return { className: 'badge-cancelled', icon: 'fa-ban' };
  }
  if (type.includes('متابعة والتفاوض') || type.includes('بدء التفاوض') || type.includes('قيد المتابعة')) {
    return { className: 'badge-negotiation', icon: 'fa-handshake' };
  }
  if (type.includes('تنبيه') || type.includes('تأكيد التواصل') || type.includes('حل التنبيه')) {
    return { className: 'badge-reminder', icon: 'fa-bell-concierge' };
  }
  if (type.includes('ملاحظات')) {
    return { className: 'badge-notes', icon: 'fa-comment-dots' };
  }
  if (type.includes('إسناد')) {
    return { className: 'badge-assign', icon: 'fa-user-check' };
  }
  if (type.includes('حالة') || type.includes('مسار الصفقة')) {
    return { className: 'badge-status', icon: 'fa-arrows-rotate' };
  }

  return { className: 'badge-default', icon: 'fa-circle-dot' };
}

// 14. تنسيق التاريخ والوقت
function formatLogTime(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr);
  const options = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  return d.toLocaleString('ar-EG', options);
}

function getRelativeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diffSec < 60) return 'الآن';
  if (diffSec < 3600) return `منذ ${Math.floor(diffSec / 60)} دقيقة`;
  if (diffSec < 86400) return `منذ ${Math.floor(diffSec / 3600)} ساعة`;
  return `منذ ${Math.floor(diffSec / 86400)} يوم`;
}

// 15. إشعارات التوست
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-green' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// 16. تسجيل الخروج
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 17. وظائف مسح سجل العمليات بالكامل (مخصصة للأونر فقط)
function openClearLogsModal() {
  const modal = document.getElementById('clearLogsModal');
  if (modal) modal.classList.remove('d-none');
}

function closeClearLogsModal() {
  const modal = document.getElementById('clearLogsModal');
  if (modal) modal.classList.add('d-none');
}

function handleClearModalBackdropClick(e) {
  if (e.target.id === 'clearLogsModal') {
    closeClearLogsModal();
  }
}

async function executeClearLogs() {
  const btn = document.getElementById('btnExecuteClearLogs');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري مسح السجل...';
  }

  try {
    const res = await fetch('/api/audit-logs', {
      method: 'DELETE'
    });

    const data = await res.json();
    if (data.success) {
      closeClearLogsModal();
      showToast(data.message, 'success');
      allLogs = [];
      updateActionCounts();
      updateKPIs({
        totalLogs: 0,
        todayLogs: 0,
        monthLogs: 0,
        contractedEvents: 0
      });
      filterLogsTable();
    } else {
      showToast(data.message || 'فشل مسح السجل', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم أثناء مسح السجل', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// إغلاق النافذة المنبثقة بالضغط على زر Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeClearLogsModal();
  }
});
