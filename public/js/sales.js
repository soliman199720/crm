let allClients = [];
let allSalesReps = [];
let currentFilter = 'all';
let filterByRepId = null;
let currentSort = 'newest';
let selectedClientIds = new Set();

// إعدادات التمرير اللانهائي (Infinite Scroll - دفعة 15 عميلاً)
const CHUNK_SIZE = 15;
let currentVisibleLimit = CHUNK_SIZE;
let isInfiniteLoading = false;
let infiniteObserver = null;

document.addEventListener('DOMContentLoaded', () => {
  verifySession();
  initInfiniteScrollObserver();
});

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
    document.getElementById('ownerNameDisplay').textContent = user.fullName || 'المدير العام';
    document.getElementById('ownerEmailDisplay').textContent = user.email || '1@1.com';

    // تحميل كافة البيانات بعد تأكيد الجلسة
    loadAllData();
  } catch (err) {
    window.location.href = '/';
  }
}

// 2. تحميل كافة بيانات اللوحة
async function loadAllData() {
  await Promise.all([
    loadStats(),
    loadSalesReps(),
    loadClients()
  ]);
}

// 3. جلب المؤشرات العامة (KPIs)
async function loadStats() {
  try {
    const res = await fetch('/api/owner-stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('kpiTotalClients').textContent = s.totalClients;
      document.getElementById('kpiUnassignedClients').textContent = s.unassignedClients;
      document.getElementById('kpiSalesCount').textContent = s.salesCount;
      document.getElementById('kpiTotalValue').textContent = formatCurrency(s.totalValue) + ' ج.م';

      const unassignedCard = document.querySelector('.highlight-amber');
      if (s.unassignedClients > 0) {
        document.getElementById('kpiUnassignedHint').innerHTML = `⚠️ <strong style="color:#b45309">${s.unassignedClients} عملاء بانتظار التوزيع</strong>`;
      } else {
        document.getElementById('kpiUnassignedHint').textContent = '✅ جميع العملاء موزعون بالكامل';
      }
    }
  } catch (err) {
    console.error('خطأ في جلب المؤشرات:', err);
  }
}

// 4. جلب فريق السيلز وتوليد الكروت والقوائم المنسدلة
async function loadSalesReps() {
  try {
    const res = await fetch('/api/sales-reps');
    const data = await res.json();
    if (data.success && data.salesReps) {
      allSalesReps = data.salesReps;
      renderSalesCards(allSalesReps);
      populateSalesDropdowns(allSalesReps);
    }
  } catch (err) {
    console.error('خطأ في جلب مسؤولي المبيعات:', err);
  }
}

// عرض كروت مسؤولي المبيعات
function renderSalesCards(reps) {
  const container = document.getElementById('salesCardsContainer');
  if (reps.length === 0) {
    container.innerHTML = `
      <div class="sales-rep-card" style="grid-column: 1 / -1; text-align:center; padding: 24px;">
        <i class="fa-solid fa-users" style="font-size:2rem; color:var(--text-muted); margin-bottom:8px; display:block;"></i>
        <p style="color:var(--text-muted); margin:0;">لا يوجد مسؤولو مبيعات مسجلين حالياً في المنظومة (يتم إنشاء الحسابات من صفحة إدارة المستخدمين).</p>
      </div>
    `;
    return;
  }

  container.innerHTML = reps.map(rep => {
    const initial = rep.full_name ? rep.full_name.trim().charAt(0) : 'س';
    const isFiltered = filterByRepId === rep.id;
    return `
      <div class="sales-rep-card ${isFiltered ? 'border-primary' : ''}">
        <div class="sales-card-header">
          <div class="sales-avatar">${escapeHtml(initial)}</div>
          <div class="sales-details">
            <strong>${escapeHtml(rep.full_name)}</strong>
            <small><i class="fa-solid fa-phone"></i> ${escapeHtml(rep.phone || 'بدون هاتف')} &bull; ${escapeHtml(rep.email)}</small>
          </div>
        </div>
        <div class="sales-workload-box">
          <span class="workload-label">العملاء المسندون:</span>
          <span class="workload-count" id="repCount_${rep.id}">${rep.assigned_count || 0} عميل</span>
        </div>
        <button class="btn-filter-rep" onclick="filterBySalesRep(${rep.id}, '${escapeHtml(rep.full_name)}')">
          <i class="fa-solid ${isFiltered ? 'fa-check' : 'fa-filter'}"></i>
          <span>${isFiltered ? 'إلغاء الفلترة' : 'عرض عملاء هذا الموظف'}</span>
        </button>
      </div>
    `;
  }).join('');
}

// تعبئة القوائم المنسدلة في النوافذ المنبثقة وشريط الإسناد الجماعي
function populateSalesDropdowns(reps) {
  const bulkSelect = document.getElementById('bulkSalesSelect');
  const modalSelect = document.getElementById('newClientAssignSelect');

  const optionsHtml = reps.map(r => `
    <option value="${r.id}">${escapeHtml(r.full_name)} (معه ${r.assigned_count || 0} عملاء)</option>
  `).join('');

  if (bulkSelect) {
    bulkSelect.innerHTML = '<option value="">-- اختر موظف السيلز للإسناد الجماعي --</option>' + optionsHtml;
  }
  if (modalSelect) {
    modalSelect.innerHTML = '<option value="">-- تركه بدون إسناد (عميل جديد بحاجة لتوزيع) --</option>' + optionsHtml;
  }
}

// 5. جلب العملاء
async function loadClients() {
  try {
    const res = await fetch('/api/clients');
    const data = await res.json();
    if (data.success && data.clients) {
      allClients = data.clients;
      updateFilterCounts();
      renderClientsTable();
    }
  } catch (err) {
    console.error('خطأ في جلب العملاء:', err);
  }
}

// تحديث أعداد أزرار الفلترة
function updateFilterCounts() {
  const allCount = allClients.length;
  const unassignedCount = allClients.filter(c => !c.assigned_sales_id).length;
  const assignedCount = allClients.filter(c => !!c.assigned_sales_id).length;

  document.getElementById('countAll').textContent = allCount;
  document.getElementById('countUnassigned').textContent = unassignedCount;
  document.getElementById('countAssigned').textContent = assignedCount;
}

// جلب قائمة العملاء مفلترة بحسب محددات البحث والحالة الحالية مع الترتيب الذكي
function getFilteredClients() {
  const searchVal = (document.getElementById('clientSearchInput')?.value || '').trim().toLowerCase();

  let list = allClients.filter(client => {
    if (currentFilter === 'unassigned' && client.assigned_sales_id) return false;
    if (currentFilter === 'assigned' && !client.assigned_sales_id) return false;
    if (filterByRepId && client.assigned_sales_id !== filterByRepId) return false;

    if (searchVal) {
      const matchName = (client.name || '').toLowerCase().includes(searchVal);
      const matchCompany = (client.company || '').toLowerCase().includes(searchVal);
      const matchPhone = (client.phone || '').toLowerCase().includes(searchVal);
      const matchInterest = (client.project_interest || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchCompany && !matchPhone && !matchInterest) return false;
    }

    return true;
  });

  // تطبيق الترتيب الذكي للتوزيع
  if (currentSort === 'newest') {
    list.sort((a, b) => b.id - a.id);
  } else if (currentSort === 'oldest_unassigned') {
    list.sort((a, b) => {
      const aUn = !a.assigned_sales_id ? 1 : 0;
      const bUn = !b.assigned_sales_id ? 1 : 0;
      if (aUn !== bUn) return bUn - aUn; // غير المسندين أولاً
      return a.id - b.id; // الأقدم أولاً لسرعة إسناده
    });
  } else if (currentSort === 'highest_value') {
    list.sort((a, b) => (Number(b.total_value) || 0) - (Number(a.total_value) || 0));
  } else if (currentSort === 'lowest_value') {
    list.sort((a, b) => (Number(a.total_value) || 0) - (Number(b.total_value) || 0));
  } else if (currentSort === 'name_asc') {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  }

  return list;
}

// تغيير نمط الترتيب وإعادة العرض من البداية
function changeClientsSorting(newSort) {
  currentSort = newSort;
  renderClientsTable(true);
}

// دالة حساب الوقت النسبي الذكي لوصول العميل (Lead Timing)
function formatRelativeTime(dateStr) {
  if (!dateStr) return 'حديثاً';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'الآن';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `منذ ${diffMin} د`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    if (diffHours === 1) return 'منذ ساعة';
    if (diffHours === 2) return 'منذ ساعتين';
    if (diffHours <= 10) return `منذ ${diffHours} ساعات`;
    return `منذ ${diffHours} ساعة`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'أمس';
  if (diffDays === 2) return 'منذ يومين';
  if (diffDays <= 7) return `منذ ${diffDays} أيام`;
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

// بناء كود HTML لكرت العميل التفاعلي (نظام موحد لكافة الأجهزة)
function createClientCardHtml(c) {
  const isUnassigned = !c.assigned_sales_id;
  const isChecked = selectedClientIds.has(c.id);

  const salesOptions = allSalesReps.map(r => `
    <option value="${r.id}" ${c.assigned_sales_id === r.id ? 'selected' : ''}>
      ${escapeHtml(r.full_name)}
    </option>
  `).join('');

  const cleanPhone = (c.phone || '').replace(/[^0-9]/g, '');
  const waLink = cleanPhone ? `https://wa.me/2${cleanPhone}` : '#';

  return `
    <div class="client-mobile-card ${isUnassigned ? 'card-unassigned' : ''} ${isChecked ? 'card-selected' : ''}" id="client-card-${c.id}">
      <div class="client-card-header">
        <div class="client-card-identity">
          <input type="checkbox" class="client-checkbox" value="${c.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectClient(${c.id}, this)">
          <div class="client-card-name-box">
            <div class="client-card-name-row">
              <strong class="client-card-name">${escapeHtml(c.name)}</strong>
              <span class="lead-age-badge" title="تاريخ الإضافة: ${formatFullDate(c.created_at)}">
                <i class="fa-regular fa-clock"></i> ${formatRelativeTime(c.created_at)}
              </span>
            </div>
            <span class="client-card-company"><i class="fa-regular fa-building"></i> ${escapeHtml(c.company || 'جهة خاصة')}</span>
          </div>
        </div>
        <div class="card-header-left">
          <span class="status-pill ${getStatusClass(c.status)}">${escapeHtml(c.status || 'جديد')}</span>
        </div>
      </div>

      <div class="client-card-body">
        <div class="client-detail-item">
          <span class="detail-label"><i class="fa-solid fa-briefcase"></i> المشروع المطلوب:</span>
          <span class="detail-val">${escapeHtml(c.project_interest || 'مشروع / خدمة عامة')}</span>
        </div>
        <div class="client-detail-item">
          <span class="detail-label"><i class="fa-solid fa-sack-dollar"></i> القيمة المتوقعة:</span>
          <span class="detail-val text-green">${formatCurrency(c.total_value)} ج.م</span>
        </div>
        ${c.notes ? `
          <div class="client-detail-item notes-full">
            <span class="detail-label"><i class="fa-regular fa-comment-dots"></i> ملاحظات:</span>
            <span class="detail-val notes-text">${escapeHtml(c.notes)}</span>
          </div>
        ` : ''}
      </div>

      <div class="client-card-contact">
        <div class="contact-phone-badge">
          <i class="fa-solid fa-phone-volume"></i>
          <code>${escapeHtml(c.phone || '—')}</code>
        </div>
        ${cleanPhone ? `
          <div class="card-quick-actions">
            <a href="${waLink}" target="_blank" class="card-btn-action wa-btn" title="مراسلة واتساب">
              <i class="fa-brands fa-whatsapp"></i> واتساب
            </a>
            <a href="tel:${cleanPhone}" class="card-btn-action call-btn" title="اتصال هاتفي">
              <i class="fa-solid fa-phone"></i> اتصال
            </a>
          </div>
        ` : ''}
      </div>

      <div class="client-card-footer">
        <label class="assign-label">
          <i class="fa-solid fa-user-check"></i> مسؤول السيلز:
        </label>
        <select 
          class="select-sales-dropdown ${isUnassigned ? 'unassigned' : 'assigned'}" 
          onchange="handleDirectAssign(${c.id}, this.value, this)"
        >
          <option value="unassigned" ${isUnassigned ? 'selected' : ''}>⚠️ غير مسند (اختر موظف سيلز)</option>
          ${salesOptions}
        </select>

        <!-- أزرار الإدارة المباشرة للكرت (تعديل وحذف) -->
        <div class="client-card-admin-row">
          <button type="button" class="card-admin-btn btn-edit-client" onclick="openEditClientModal(${c.id})" title="تعديل بيانات العميل">
            <i class="fa-solid fa-pen-to-square"></i>
            <span>تعديل العميل</span>
          </button>
          <button type="button" class="card-admin-btn btn-delete-client" onclick="openDeleteClientModal(${c.id})" title="حذف العميل نهائياً">
            <i class="fa-solid fa-trash-can"></i>
            <span>حذف</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// رسم كروت العملاء بنظام التمرير اللانهائي (Infinite Scroll: 15 عميلاً في كل دفعة)
function renderClientsTable(resetLimit = true) {
  if (resetLimit) {
    currentVisibleLimit = CHUNK_SIZE;
  }

  const cardsGrid = document.getElementById('clientsCardsGrid');
  const cardsCountBadge = document.getElementById('cardsCountBadge');

  const filtered = getFilteredClients();

  if (cardsCountBadge) {
    cardsCountBadge.textContent = `${filtered.length} عميل`;
  }

  // في حالة عدم وجود نتائج
  if (filtered.length === 0) {
    if (cardsGrid) {
      cardsGrid.innerHTML = `
        <div class="empty-cards-state" style="grid-column:1/-1; text-align:center; padding:36px 16px; color:var(--text-muted); background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">
          <i class="fa-regular fa-folder-open" style="font-size:32px; margin-bottom:8px; display:block; color:#94a3b8;"></i>
          <strong>لا توجد نتائج مطابقة للشروط المحددة</strong>
          <p style="font-size:0.85rem; margin-top:4px;">جرّب تعديل البحث أو الفلتر أعلاه</p>
        </div>
      `;
    }
    updateInfiniteScrollUI(0);
    return;
  }

  // الدفعة الأولى المحددة (تصل حتى 15 عميلاً في البداية)
  const initialBatch = filtered.slice(0, currentVisibleLimit);

  if (cardsGrid) {
    cardsGrid.innerHTML = initialBatch.map(createClientCardHtml).join('');
  }

  updateInfiniteScrollUI(filtered.length);
}

// محرك جلب الدفعة التالية (15 عميلاً) أثناء التمرير لأسفل (Infinite Scroll)
function handleInfiniteScrollTrigger() {
  const filtered = getFilteredClients();
  if (isInfiniteLoading || currentVisibleLimit >= filtered.length) {
    return;
  }

  isInfiniteLoading = true;
  const loader = document.getElementById('infiniteScrollLoader');
  if (loader) loader.classList.remove('d-none');

  // تأخير بسيط لإعطاء انسيابية بث البيانات مثل فيسبوك
  setTimeout(() => {
    const nextBatch = filtered.slice(currentVisibleLimit, currentVisibleLimit + CHUNK_SIZE);
    currentVisibleLimit += nextBatch.length;

    const cardsGrid = document.getElementById('clientsCardsGrid');
    if (cardsGrid && nextBatch.length > 0) {
      cardsGrid.insertAdjacentHTML('beforeend', nextBatch.map(createClientCardHtml).join(''));
    }

    if (loader) loader.classList.add('d-none');
    isInfiniteLoading = false;

    updateInfiniteScrollUI(filtered.length);
  }, 200);
}

// تحديث مؤشرات حالة التمرير اللانهائي
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
    statusEl.innerHTML = `يتم عرض <strong>${showingCount}</strong> من إجمالي <strong>${totalCount}</strong> عميل`;
  }

  if (showingCount >= totalCount) {
    if (endBox) {
      endBox.classList.remove('d-none');
      if (endText) {
        endText.textContent = `تم استعراض كافة العملاء بنجاح (${totalCount} عميل)`;
      }
    }
  } else {
    if (endBox) endBox.classList.add('d-none');
  }
}

// تفعيل مراقب التمرير التلقائي (IntersectionObserver)
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

  // إمكانية الضغط اليدوي على الحاوية كخيار بديل وسريع
  container.onclick = () => {
    handleInfiniteScrollTrigger();
  };
}

// 6. الإسناد المباشر من الجدول
async function handleDirectAssign(clientId, salesId, selectElement) {
  selectElement.disabled = true;
  try {
    const res = await fetch(`/api/clients/${clientId}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sales_id: salesId === 'unassigned' ? null : parseInt(salesId, 10) })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await loadAllData();
    } else {
      showToast('فشل الإسناد: ' + (data.message || 'خطأ غير معروف'), 'error');
      selectElement.disabled = false;
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', 'error');
    selectElement.disabled = false;
  }
}

// 7. التوزيع التلقائي العادل (Round-Robin) بضغطة زر
async function triggerAutoDistribute() {
  const unassigned = allClients.filter(c => !c.assigned_sales_id);
  if (unassigned.length === 0) {
    showToast('جميع العملاء موزعون بالفعل بالتساوي على فريق السيلز! 👍', 'info');
    return;
  }

  if (allSalesReps.length === 0) {
    showToast('يرجى إضافة مسؤولي سيلز أولاً لتتمكن من التوزيع عليهم', 'error');
    return;
  }

  const confirmMsg = `هل تريد بالتأكيد توزيع عدد ${unassigned.length} عميل جديد بالتساوي على ${allSalesReps.length} من مسؤولي السيلز؟`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/clients/auto-distribute', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      await loadAllData();
    } else {
      showToast('خطأ: ' + (data.message || 'تعذر التوزيع التلقائي'), 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالخادم', 'error');
  }
}

// 8. الإسناد الجماعي (Bulk Assign) مع المزامنة بين الجدول والكروت
function toggleSelectClient(id, checkbox) {
  if (checkbox.checked) {
    selectedClientIds.add(id);
  } else {
    selectedClientIds.delete(id);
  }

  // مزامنة حالة الـ Checkbox عبر الجدول والكروت
  document.querySelectorAll(`.client-checkbox[value="${id}"]`).forEach(cb => {
    cb.checked = checkbox.checked;
  });

  const card = document.getElementById(`client-card-${id}`);
  if (card) {
    card.classList.toggle('card-selected', checkbox.checked);
  }

  updateBulkBar();
}

function toggleSelectAll(masterCheckbox) {
  const isChecked = masterCheckbox.checked;
  const filtered = getFilteredClients();

  filtered.forEach(c => {
    if (isChecked) {
      selectedClientIds.add(c.id);
    } else {
      selectedClientIds.delete(c.id);
    }
  });

  // مزامنة كافة مربعات الاختيار الفردية
  document.querySelectorAll('.client-checkbox').forEach(cb => {
    const id = parseInt(cb.value, 10);
    const checked = selectedClientIds.has(id);
    cb.checked = checked;
    const card = document.getElementById(`client-card-${id}`);
    if (card) {
      card.classList.toggle('card-selected', checked);
    }
  });

  // تحديث مربع تحديد الكل الرئيسي
  const master = document.getElementById('selectAllCheckbox');
  if (master) master.checked = isChecked;

  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkAssignBar');
  const countText = document.getElementById('selectedCountText');
  const count = selectedClientIds.size;

  if (count > 0) {
    bar.classList.remove('d-none');
    countText.textContent = count;
  } else {
    bar.classList.add('d-none');
  }
}

async function applyBulkAssignment() {
  const salesId = document.getElementById('bulkSalesSelect').value;
  if (!salesId) {
    showToast('يرجى اختيار مسؤول السيلز المراد الإسناد إليه', 'error');
    return;
  }

  const ids = Array.from(selectedClientIds);
  try {
    const res = await fetch('/api/clients/bulk-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_ids: ids, sales_id: parseInt(salesId, 10) })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      selectedClientIds.clear();
      updateBulkBar();
      const master = document.getElementById('selectAllCheckbox');
      if (master) master.checked = false;
      await loadAllData();
    } else {
      showToast(data.message || 'فشل الإسناد الجماعي', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال أثناء الإسناد الجماعي', 'error');
  }
}

// 9. الفلاتر والبحث
function setClientsFilter(filterType, btn) {
  currentFilter = filterType;
  filterByRepId = null;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  renderClientsTable();
  renderSalesCards(allSalesReps);
}

function filterBySalesRep(repId, repName) {
  if (filterByRepId === repId) {
    filterByRepId = null;
    showToast('تم إلغاء الفلترة حسب الموظف', 'info');
  } else {
    filterByRepId = repId;
    showToast(`عرض عملاء: ${repName}`, 'info');
  }
  renderClientsTable();
  renderSalesCards(allSalesReps);
}

function filterClientsTable() {
  renderClientsTable();
}

// 10. نافذة إضافة عميل جديد
let parsedExcelClients = [];
let parsedPastedClients = [];

function openNewClientModal() {
  document.getElementById('newClientModal').classList.remove('d-none');
}

function closeNewClientModal() {
  document.getElementById('newClientModal').classList.add('d-none');
  resetExcelImport();
}

// نافذة تعديل بيانات العميل
function openEditClientModal(clientId) {
  const client = allClients.find(c => String(c.id) === String(clientId));
  if (!client) {
    showToast('تعذر العثور على بيانات العميل', 'error');
    return;
  }

  document.getElementById('editClientId').value = client.id;
  document.getElementById('editClientName').value = client.name || '';
  document.getElementById('editClientPhone').value = client.phone || '';
  document.getElementById('editClientCompany').value = client.company || '';
  document.getElementById('editClientEmail').value = client.email || '';
  document.getElementById('editClientProject').value = client.project_interest || '';
  document.getElementById('editClientValue').value = client.total_value || 0;
  document.getElementById('editClientNotes').value = client.notes || '';

  document.getElementById('editClientModal').classList.remove('d-none');
}

function closeEditClientModal() {
  document.getElementById('editClientModal').classList.add('d-none');
  const form = document.getElementById('editClientForm');
  if (form) form.reset();
}

async function handleUpdateClient(e) {
  e.preventDefault();
  const clientId = document.getElementById('editClientId').value;
  const btn = document.getElementById('btnSaveEditClient');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
  }

  const payload = {
    id: parseInt(clientId, 10),
    name: document.getElementById('editClientName').value.trim(),
    phone: document.getElementById('editClientPhone').value.trim(),
    company: document.getElementById('editClientCompany').value.trim(),
    email: document.getElementById('editClientEmail').value.trim(),
    project_interest: document.getElementById('editClientProject').value.trim(),
    total_value: parseFloat(document.getElementById('editClientValue').value) || 0,
    notes: document.getElementById('editClientNotes').value.trim()
  };

  try {
    let res = await fetch(`/api/clients/${clientId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // توافقية كاملة مع كافة السيرفرات السحابية: تجربة مسار POST إذا كان PUT محظوراً أو غير مفعل
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await fetch('/api/clients/update-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.success) {
      showToast('تم حفظ وتحديث بيانات العميل بنجاح 👍', 'success');
      closeEditClientModal();
      
      const numId = parseInt(clientId, 10);
      const idx = allClients.findIndex(c => c.id === numId);
      if (idx !== -1 && data.client) {
        allClients[idx] = { ...allClients[idx], ...data.client };
      }
      renderClientsTable(false);
      loadStats();
    } else {
      const errMsg = (data && data.message) ? data.message : `تعذر حفظ التعديلات (رمز الخطأ: ${res.status})`;
      showToast('فشل التحديث: ' + errMsg, 'error');
    }
  } catch (err) {
    console.error('Client update error:', err);
    showToast('خطأ في الاتصال بالخادم أثناء حفظ التعديلات', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// نافذة تأكيد حذف العميل نهائياً
let clientToDeleteId = null;

function openDeleteClientModal(clientId) {
  const client = allClients.find(c => String(c.id) === String(clientId));
  if (!client) {
    showToast('تعذر العثور على بيانات العميل المراد حذفه', 'error');
    return;
  }
  clientToDeleteId = client.id;

  const nameEl = document.getElementById('deleteTargetClientName');
  if (nameEl) nameEl.textContent = client.name;

  const phoneEl = document.getElementById('deleteTargetClientPhone');
  if (phoneEl) phoneEl.textContent = client.phone || '—';

  const modal = document.getElementById('deleteClientModal');
  if (modal) modal.classList.remove('d-none');
}

function closeDeleteClientModal() {
  clientToDeleteId = null;
  const modal = document.getElementById('deleteClientModal');
  if (modal) modal.classList.add('d-none');
}

async function executeDeleteClient() {
  if (!clientToDeleteId) return;

  const btn = document.getElementById('btnExecuteDeleteClient');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحذف...';
  }

  try {
    let res = await fetch(`/api/clients/${clientToDeleteId}`, {
      method: 'DELETE'
    });

    // توافقية كاملة مع كافة السيرفرات السحابية: تجربة مسار POST إذا كان DELETE محظوراً
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await fetch('/api/clients/delete-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientToDeleteId })
      });
    }

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.success) {
      showToast(data.message || 'تم حذف العميل بنجاح 👍', 'success');
      const deletedId = parseInt(clientToDeleteId, 10);
      closeDeleteClientModal();

      selectedClientIds.delete(deletedId);
      allClients = allClients.filter(c => c.id !== deletedId);

      updateBulkBar();
      renderClientsTable(false);
      loadStats();
    } else {
      const errMsg = (data && data.message) ? data.message : `تعذر حذف العميل (رمز الخطأ: ${res.status})`;
      showToast('خطأ في الحذف: ' + errMsg, 'error');
    }
  } catch (err) {
    console.error('Client delete error:', err);
    showToast('حدث خطأ في الاتصال بالخادم أثناء الحذف', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// التبديل بين تبويبات الإدخال (فردي / إكسيل / نسخ ولصق)
function switchImportTab(tab) {
  document.querySelectorAll('.import-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.import-panel').forEach(p => p.classList.add('d-none'));

  if (tab === 'single') {
    document.getElementById('tabBtnSingle').classList.add('active');
    document.getElementById('panelSingle').classList.remove('d-none');
  } else if (tab === 'excel') {
    document.getElementById('tabBtnExcel').classList.add('active');
    document.getElementById('panelExcel').classList.remove('d-none');
  } else if (tab === 'paste') {
    document.getElementById('tabBtnPaste').classList.add('active');
    document.getElementById('panelPaste').classList.remove('d-none');
  }
}

// تحميل نموذج إكسيل تجريبي جاهز (Excel Template Download)
function downloadSampleExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('جاري تحميل مكتبة الإكسيل، يرجى الانتظار ثانية...', 'info');
    return;
  }

  const sampleData = [
    {
      "الاسم": "م. أحمد الشريف",
      "رقم الهاتف": "01011112222",
      "الشركة": "شركة النخبة للاستثمار",
      "نوع المشروع": "تشطيب فيلا سكنية فاخرة",
      "الميزانية": 4500000,
      "البريد الإلكتروني": "ahmed@elite.com",
      "ملاحظات": "مهتم بالتشطيب الداخلي والتسليم على المفتاح"
    },
    {
      "الاسم": "د. منى كمال",
      "رقم الهاتف": "01122223333",
      "الشركة": "المنشاوي جروب",
      "نوع المشروع": "تطوير أعمال وتوريدات",
      "الميزانية": 12000000,
      "البريد الإلكتروني": "mona@menshawy.com",
      "ملاحظات": "مشروع عاجل لتوريد وتطوير متكامل"
    },
    {
      "الاسم": "أ. حسام فؤاد",
      "رقم الهاتف": "01233334444",
      "الشركة": "شركة أفق للتجارة",
      "نوع المشروع": "خدمات لوجستية وتوريد",
      "الميزانية": 3800000,
      "البريد الإلكتروني": "hossam@ofoq.com",
      "ملاحظات": "مطلوب معاينة والبدء في الإجراءات"
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "عملاء_CRM");
  XLSX.writeFile(wb, "نموذج_إدراج_العملاء_CRM.xlsx");
  showToast('تم تحميل نموذج الإكسيل التجريبي بنجاح!', 'success');
}

// معالجة وقراءة ملف الإكسيل المرفوع
function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    showToast('مكتبة الإكسيل لم تكتمل بعد، يرجى التأكد من اتصال الإنترنت', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet);

      if (!rawRows || rawRows.length === 0) {
        showToast('ملف الإكسيل فارغ ولا يحتوي على صفوف بيانات', 'error');
        return;
      }

      // تحويل الأعمدة ومطابقتها بذكاء
      parsedExcelClients = rawRows.map(row => {
        // فحص الاسم
        const name = row['الاسم'] || row['اسم العميل'] || row['name'] || row['Name'] || row['العميل'] || '';
        // فحص الهاتف
        const phone = String(row['رقم الهاتف'] || row['الهاتف'] || row['phone'] || row['Phone'] || row['موبايل'] || row['الموبايل'] || '');
        // فحص الشركة
        const company = row['الشركة'] || row['اسم الشركة'] || row['company'] || row['Company'] || '';
        // نوع المشروع
        const project_interest = row['نوع المشروع'] || row['المشروع'] || row['الاهتمام'] || row['project'] || row['Project'] || 'خدمات عامة وتطوير';
        // الميزانية
        const total_value = parseFloat(row['الميزانية'] || row['القيمة'] || row['budget'] || row['Budget'] || 0) || 0;
        // البريد
        const email = row['البريد الإلكتروني'] || row['البريد'] || row['email'] || row['Email'] || '';
        // ملاحظات
        const notes = row['ملاحظات'] || row['notes'] || row['Notes'] || '';

        return { name, phone, company, project_interest, total_value, email, notes };
      }).filter(c => c.name || c.phone); // استبعاد الصفوف الخالية

      if (parsedExcelClients.length === 0) {
        showToast('لم يتم العثور على أعمدة صالحة في الملف (تأكد من وجود عمود باسم "الاسم" أو "رقم الهاتف")', 'error');
        return;
      }

      // عرض المعاينة
      displayExcelPreview(parsedExcelClients);
      document.getElementById('btnSubmitExcel').disabled = false;
      showToast(`تمت قراءة ${parsedExcelClients.length} عميل من الملف بنجاح! راجع المعاينة واضغط حفظ.`, 'success');

    } catch (err) {
      console.error('خطأ قراءة الإكسيل:', err);
      showToast('حدث خطأ أثناء قراءة ملف الإكسيل: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// عرض المعاينة لصفوف الإكسيل
function displayExcelPreview(clients) {
  const container = document.getElementById('excelPreviewContainer');
  const tbody = document.getElementById('excelPreviewTbody');
  const countEl = document.getElementById('excelRowsCount');

  countEl.textContent = clients.length;
  // عرض أول 8 صفوف كمعاينة
  const previewRows = clients.slice(0, 8);

  tbody.innerHTML = previewRows.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(c.name || 'بدون اسم')}</strong></td>
      <td><code>${escapeHtml(c.phone || '—')}</code></td>
      <td>${escapeHtml(c.company || '—')}</td>
      <td><small>${escapeHtml(c.project_interest || 'خدمات عامة')}</small></td>
      <td>${formatCurrency(c.total_value)} ج.م</td>
    </tr>
  `).join('') + (clients.length > 8 ? `<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">... وباقي ${clients.length - 8} عميل إضافي</td></tr>` : '');

  container.classList.remove('d-none');
}

// إعادة ضبط إدخال الإكسيل
function resetExcelImport() {
  parsedExcelClients = [];
  document.getElementById('excelFileInput').value = '';
  document.getElementById('excelPreviewContainer').classList.add('d-none');
  document.getElementById('btnSubmitExcel').disabled = true;
}

// إرسال وحفظ عملاء الإكسيل في قاعدة البيانات
async function submitExcelClients() {
  if (parsedExcelClients.length === 0) return;

  const btn = document.getElementById('btnSubmitExcel');
  const autoDistribute = document.getElementById('excelAutoDistribute').checked;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حفظ العملاء في PostgreSQL...';

  try {
    const res = await fetch('/api/clients/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: parsedExcelClients, auto_distribute: autoDistribute })
    });

    const data = await res.json();
    if (data.success) {
      closeNewClientModal();
      showToast(data.message, 'success');
      resetExcelImport();
      await loadAllData();
    } else {
      showToast('فشل الاستيراد: ' + (data.message || 'خطأ غير معروف'), 'error');
    }
  } catch (err) {
    showToast('حدث خطأ في الاتصال بالخادم أثناء حفظ العملاء', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> <span>بدء استيراد وحفظ العملاء في PostgreSQL</span>';
  }
}

// ==================== معالجة النسخ واللصق السريع ====================
function handlePasteInput() {
  const text = document.getElementById('pasteClientsText').value.trim();
  const previewBox = document.getElementById('pastePreviewContainer');
  const tbody = document.getElementById('pastePreviewTbody');
  const countEl = document.getElementById('pasteRowsCount');
  const btn = document.getElementById('btnSubmitPaste');

  if (!text) {
    previewBox.classList.add('d-none');
    btn.disabled = true;
    parsedPastedClients = [];
    return;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  parsedPastedClients = [];

  for (const line of lines) {
    // التقسيم بالفاصلة العربية أو الإنجليزية أو الشرطة أو Tab
    const parts = line.split(/[,،\t\-]+/).map(p => p.trim());
    if (parts.length > 0) {
      const name = parts[0] || 'عميل';
      const phone = parts[1] || '';
      const project_interest = parts[2] || 'مشروع وتطوير أعمال';
      const company = parts[3] || '';
      parsedPastedClients.push({ name, phone, project_interest, company, total_value: 0, notes: 'مستورد عبر النسخ السريع' });
    }
  }

  if (parsedPastedClients.length > 0) {
    countEl.textContent = parsedPastedClients.length;
    tbody.innerHTML = parsedPastedClients.slice(0, 6).map((c, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td><code>${escapeHtml(c.phone || '—')}</code></td>
        <td><small>${escapeHtml(c.project_interest)}</small></td>
        <td>${escapeHtml(c.company || 'جهة خاصة')}</td>
      </tr>
    `).join('') + (parsedPastedClients.length > 6 ? `<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">... و ${parsedPastedClients.length - 6} عميل إضافي</td></tr>` : '');

    previewBox.classList.remove('d-none');
    btn.disabled = false;
  } else {
    previewBox.classList.add('d-none');
    btn.disabled = true;
  }
}

// حفظ العملاء المنسوخين
async function submitPastedClients() {
  if (parsedPastedClients.length === 0) return;

  const btn = document.getElementById('btnSubmitPaste');
  const autoDistribute = document.getElementById('pasteAutoDistribute').checked;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ في PostgreSQL...';

  try {
    const res = await fetch('/api/clients/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: parsedPastedClients, auto_distribute: autoDistribute })
    });

    const data = await res.json();
    if (data.success) {
      closeNewClientModal();
      showToast(data.message, 'success');
      document.getElementById('pasteClientsText').value = '';
      document.getElementById('pastePreviewContainer').classList.add('d-none');
      parsedPastedClients = [];
      await loadAllData();
    } else {
      showToast('فشل الإدراج: ' + (data.message || 'خطأ غير معروف'), 'error');
    }
  } catch (err) {
    showToast('حدث خطأ أثناء إدراج العملاء', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paste"></i> <span>إدراج وحفظ العملاء المنسوخين</span>';
  }
}

async function handleCreateClient(e) {
  e.preventDefault();
  const name = document.getElementById('newClientName').value.trim();
  const company = document.getElementById('newClientCompany').value.trim();
  const phone = document.getElementById('newClientPhone').value.trim();
  const email = document.getElementById('newClientEmail').value.trim();
  const project_interest = document.getElementById('newClientInterest').value.trim();
  const total_value = parseFloat(document.getElementById('newClientValue').value) || 0;
  const assignVal = document.getElementById('newClientAssignSelect').value;
  const assigned_sales_id = assignVal ? parseInt(assignVal, 10) : null;
  const notes = document.getElementById('newClientNotes').value.trim();

  try {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, company, phone, email, project_interest, total_value, assigned_sales_id, notes })
    });

    const data = await res.json();
    if (data.success) {
      closeNewClientModal();
      showToast(data.message || 'تمت إضافة العميل بنجاح في قاعدة البيانات', 'success');
      e.target.reset();
      await loadAllData();
    } else {
      showToast(data.message || 'فشل حفظ العميل', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', 'error');
  }
}

// 12. إشعارات التوست
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
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

// ==================== 14. التوزيع المخصص بالحصص (Custom Quota Distribution) ====================

function openCustomQuotaModal() {
  const unassignedCount = allClients.filter(c => !c.assigned_sales_id).length;
  document.getElementById('quotaAvailableCount').textContent = unassignedCount;
  
  const container = document.getElementById('quotaSalesList');
  if (!allSalesReps || allSalesReps.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px; color:var(--text-muted)">
        <i class="fa-solid fa-user-xmark" style="font-size:2rem; margin-bottom:10px; display:block;"></i>
        لا يوجد موظفو سيلز مسجلون حالياً لتوزيع العملاء عليهم.
      </div>
    `;
    document.getElementById('btnApplyQuota').disabled = true;
  } else {
    document.getElementById('btnApplyQuota').disabled = (unassignedCount === 0);
    container.innerHTML = allSalesReps.map(rep => {
      const initial = rep.full_name ? rep.full_name.trim().charAt(0) : 'س';
      return `
        <div class="quota-rep-row" id="quotaRow_${rep.id}">
          <div class="quota-rep-info">
            <div class="quota-avatar">${initial}</div>
            <div class="quota-rep-details">
              <h5>${escapeHtml(rep.full_name)}</h5>
              <div>
                <span class="current-load">${rep.assigned_count || 0} عميل حالياً</span>
                <span>${escapeHtml(rep.phone || rep.email || '')}</span>
              </div>
            </div>
          </div>
          <div class="quota-control-group">
            <div class="quota-chips">
              <button type="button" class="btn-mini-chip" onclick="adjustRepQuota(${rep.id}, 5)" title="إضافة 5 عملاء">+5</button>
              <button type="button" class="btn-mini-chip" onclick="adjustRepQuota(${rep.id}, 10)" title="إضافة 10 عملاء">+10</button>
            </div>
            <div class="quota-input-wrapper">
              <button type="button" class="btn-step" onclick="stepRepQuota(${rep.id}, -1)">-</button>
              <input 
                type="number" 
                min="0" 
                value="0" 
                class="input-quota-count" 
                id="quotaInput_${rep.id}" 
                data-sales-id="${rep.id}"
                oninput="handleQuotaInputChange()"
              >
              <button type="button" class="btn-step" onclick="stepRepQuota(${rep.id}, 1)">+</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateQuotaCalculations();
  document.getElementById('customQuotaModal').classList.remove('d-none');
}

function closeCustomQuotaModal() {
  document.getElementById('customQuotaModal').classList.add('d-none');
}

function stepRepQuota(repId, delta) {
  const input = document.getElementById(`quotaInput_${repId}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 0;
  val = Math.max(0, val + delta);
  input.value = val;
  updateQuotaCalculations();
}

function adjustRepQuota(repId, delta) {
  stepRepQuota(repId, delta);
}

function resetQuotaInputs() {
  document.querySelectorAll('.input-quota-count').forEach(inp => {
    inp.value = 0;
  });
  updateQuotaCalculations();
}

function presetEqualQuotas() {
  const unassignedCount = allClients.filter(c => !c.assigned_sales_id).length;
  const reps = allSalesReps || [];
  if (reps.length === 0 || unassignedCount === 0) return;

  const base = Math.floor(unassignedCount / reps.length);
  const remainder = unassignedCount % reps.length;

  reps.forEach((rep, idx) => {
    const input = document.getElementById(`quotaInput_${rep.id}`);
    if (input) {
      input.value = base + (idx < remainder ? 1 : 0);
    }
  });

  updateQuotaCalculations();
}

function handleQuotaInputChange() {
  updateQuotaCalculations();
}

function updateQuotaCalculations() {
  const unassignedCount = allClients.filter(c => !c.assigned_sales_id).length;
  let totalSum = 0;

  document.querySelectorAll('.input-quota-count').forEach(inp => {
    const val = parseInt(inp.value, 10) || 0;
    if (val < 0) inp.value = 0;
    totalSum += Math.max(0, val);
  });

  document.getElementById('quotaTotalSum').textContent = totalSum;
  
  const remaining = unassignedCount - totalSum;
  const remainingEl = document.getElementById('quotaRemainingCount');
  
  if (remaining < 0) {
    remainingEl.textContent = `فائض المطلوب (+${Math.abs(remaining)})`;
    remainingEl.style.color = '#dc2626';
    remainingEl.style.fontWeight = '800';
  } else {
    remainingEl.textContent = remaining;
    remainingEl.style.color = '';
    remainingEl.style.fontWeight = '';
  }

  const btnApply = document.getElementById('btnApplyQuota');
  if (allSalesReps.length === 0 || unassignedCount === 0 || totalSum === 0) {
    btnApply.disabled = true;
  } else {
    btnApply.disabled = false;
  }
}

async function applyCustomQuotaDistribution() {
  const unassignedCount = allClients.filter(c => !c.assigned_sales_id).length;
  if (unassignedCount === 0) {
    showToast('لا يوجد عملاء غير مسندين متاحين حالياً للتوزيع!', 'error');
    return;
  }

  const quotas = [];
  let totalRequested = 0;

  document.querySelectorAll('.input-quota-count').forEach(inp => {
    const salesId = parseInt(inp.getAttribute('data-sales-id'), 10);
    const count = parseInt(inp.value, 10) || 0;
    if (salesId && count > 0) {
      quotas.push({ sales_id: salesId, count });
      totalRequested += count;
    }
  });

  if (quotas.length === 0 || totalRequested === 0) {
    showToast('يرجى تحديد حصة عملاء (> 0) لموظف واحد على الأقل', 'error');
    return;
  }

  if (totalRequested > unassignedCount) {
    const confirmOver = confirm(`تنبيه: إجمالي المطلوب توزيعه (${totalRequested}) أكبر من العملاء المتاحين (${unassignedCount}).\nسيتم توزيع المتاح فقط حتى نفادهم حسب الترتيب المحدد. هل تود الاستمرار؟`);
    if (!confirmOver) return;
  }

  const btn = document.getElementById('btnApplyQuota');
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حفظ وتوزيع العملاء في PostgreSQL...';

  try {
    const res = await fetch('/api/clients/custom-quota-distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotas })
    });

    const data = await res.json();
    if (data.success) {
      closeCustomQuotaModal();
      showToast(data.message, 'success');
      await loadAllData();
    } else {
      showToast(data.message || 'فشل التوزيع المخصص للعملاء', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم أثناء التوزيع', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
  }
}

// 13. تسجيل الخروج
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/';
}

function formatCurrency(num) {
  if (!num) return '0';
  return Number(num).toLocaleString('ar-EG');
}

function getStatusClass(status) {
  if (!status) return 'status-new';
  if (status.includes('جديد')) return 'status-new';
  if (status.includes('إسناد') || status.includes('متابعة')) return 'status-assigned';
  if (status.includes('تواصل')) return 'status-contacted';
  if (status.includes('تفاوض') || status.includes('معاينة')) return 'status-negotiating';
  if (status.includes('إغلاق') || status.includes('تعاقد')) return 'status-closed';
  return 'status-assigned';
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


