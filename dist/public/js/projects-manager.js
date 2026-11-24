/**
 * projects-manager.js
 * إدارة وعرض وتصنيف المشروعات (تجاري / سكني / أراضي)
 * نظام إدارة العملاء والمشروعات CRM
 */

let allLoadedProjects = [];
let pendingDeleteId = null;

// تحديد التصنيف الحالي بناءً على مسار الصفحة
function getCurrentCategory() {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('/commercial')) return 'commercial';
  if (path.includes('/residential')) return 'residential';
  if (path.includes('/lands')) return 'lands';
  return 'all';
}

function getCategoryLabel(cat) {
  if (cat === 'commercial') return 'تجاري';
  if (cat === 'residential') return 'سكني';
  if (cat === 'lands') return 'أراضي';
  return 'كافة المشروعات';
}

function getCategoryBadgeClass(cat) {
  if (cat === 'commercial') return 'cat-badge-commercial';
  if (cat === 'residential') return 'cat-badge-residential';
  if (cat === 'lands') return 'cat-badge-lands';
  return 'cat-badge-default';
}

document.addEventListener('DOMContentLoaded', () => {
  initProjectsPage();
});

// 1. تهيئة الصفحة وعناصر التحكم والنافذة المنبثقة
async function initProjectsPage() {
  const container = document.querySelector('.projects-hub-container') || document.querySelector('.projects-subpage-container');
  if (!container) return;

  const currentCat = getCurrentCategory();

  // حقن شريط الأدوات والشبكة إن لم تكن موجودة
  let contentArea = document.getElementById('projectsContentArea');
  if (!contentArea) {
    contentArea = document.createElement('div');
    contentArea.id = 'projectsContentArea';
    contentArea.innerHTML = `
      <!-- شريط الإجراءات والبحث والزر الرئيسي لإضافة مشروع -->
      <section class="projects-action-bar">
        <div class="projects-bar-title">
          <h2><i class="fa-solid fa-layer-group"></i> <span>${getCategoryLabel(currentCat)}</span></h2>
          <span class="projects-count-pill" id="projectsCountPill">0 مشروع</span>
        </div>

        <div class="projects-bar-controls">
          <div class="search-box-wrap">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="projectSearchInput" placeholder="بحث بالاسم، الموقع، أو التفاصيل..." oninput="handleSearchProjects()">
          </div>

          <button class="btn-add-main-project" onclick="openAddProjectModal()">
            <i class="fa-solid fa-plus-circle"></i>
            <span>إضافة مشروع جديد</span>
          </button>
        </div>
      </section>

      <!-- شبكة عرض المشروعات -->
      <div id="projectsGrid" class="projects-grid-container">
        <div class="projects-loading-state">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <p>جاري استرجاع المشروعات...</p>
        </div>
      </div>
    `;
    container.appendChild(contentArea);
  }

  // حقن النوافذ المنبثقة المشتركة (إضافة مشروع + تأكيد الحذف)
  injectModals();

  // جلب البيانات من الخادم
  await loadProjects();
}

// 2. حقن النوافذ المنبثقة
function injectModals() {
  if (document.getElementById('addProjectModal')) return;

  const modalsHtml = `
    <!-- نافذة منبثقة: إضافة مشروع جديد -->
    <div class="modal-backdrop d-none" id="addProjectModal">
      <div class="modal-card add-project-modal-card">
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap: 10px;">
            <div class="modal-header-icon" style="background:#e0f2fe; color:#0284c7; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
              <i class="fa-solid fa-folder-plus"></i>
            </div>
            <div>
              <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">إضافة مشروع جديد</h3>
              <small style="color:#64748b;">أدخل تفاصيل المشروع وسيتم توجيهه لقسمه تلقائياً</small>
            </div>
          </div>
          <button class="btn-close" onclick="closeAddProjectModal()">&times;</button>
        </div>

        <form id="addProjectForm" onsubmit="handleSaveProject(event)" style="margin-top: 18px;">
          
          <!-- 1. نوع المشروع (سكني / تجاري / أراضي) -->
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">1. نوع المشروع *</label>
            <select id="projCategoryInput" class="custom-form-select" required>
              <option value="commercial">🏢 تجاري (مولات ومحلات وإداري)</option>
              <option value="residential">🏡 سكني (شقق وكمبوندات وفلل)</option>
              <option value="lands">🏞️ أراضي (مخططات وقطع أراضي)</option>
            </select>
          </div>

          <!-- 2. اسم المشروع -->
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">2. اسم المشروع *</label>
            <input type="text" id="projNameInput" class="custom-form-input" placeholder="مثال: مول كابيتال هاب / كمبوند النرجس / قطعة رقم 44" required>
          </div>

          <!-- 3. مساحة المشروع بالمتر -->
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">3. مساحة المشروع بالمتر (م²) *</label>
            <input type="number" id="projAreaInput" class="custom-form-input" placeholder="مثال: 5000 أو 750" min="1" step="0.5" required>
          </div>

          <!-- 4. موقع المشروع -->
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">4. موقع المشروع *</label>
            <input type="text" id="projLocationInput" class="custom-form-input" placeholder="مثال: التجمع الخامس - التسعين الشمالي" required>
          </div>

          <!-- 5. التفاصيل -->
          <div class="form-group" style="margin-bottom: 18px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">5. التفاصيل والملاحظات</label>
            <textarea id="projDescInput" class="custom-form-textarea" rows="3" placeholder="مواصفات المشروع، أنظمة السداد، الخدمات المتاحة، الملاحظات الإدارية..."></textarea>
          </div>

          <div class="modal-footer" style="display:flex; justify-content:flex-end; gap: 10px; padding-top:14px; border-top: 1px solid #f1f5f9;">
            <button type="button" class="btn-secondary" onclick="closeAddProjectModal()">إلغاء</button>
            <button type="submit" class="btn-primary-gradient" id="btnSubmitProject">
              <i class="fa-solid fa-check"></i>
              <span>حفظ المشروع وتوجيهه</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- نافذة تأكيد حذف المشروع -->
    <div class="modal-backdrop d-none" id="deleteProjectModal">
      <div class="modal-card delete-confirm-modal-card">
        <div class="delete-icon-pulse-wrap">
          <div class="delete-pulse-ring"></div>
          <div class="delete-icon-circle">
            <i class="fa-solid fa-trash-can"></i>
          </div>
        </div>
        <h3 class="delete-modal-title">تأكيد حذف المشروع</h3>
        <p class="delete-modal-desc">هل أنت متأكد من رغبتك في حذف هذا المشروع نهائياً من المنظومة؟</p>
        <div class="delete-target-badge" id="deleteProjectTargetBadge"></div>
        <div class="delete-modal-actions" style="margin-top: 18px;">
          <button type="button" class="btn-cancel-delete" onclick="closeDeleteModal()">إلغاء</button>
          <button type="button" class="btn-confirm-delete" id="btnConfirmDeleteProject" onclick="executeDeleteProject()">
            <i class="fa-solid fa-trash-can"></i>
            <span>نعم، حذف المشروع</span>
          </button>
        </div>
      </div>
    </div>

    <!-- شريط التنبيهات Toast -->
    <div class="toast-container" id="toastContainer"></div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalsHtml);
}

// 3. جلب المشروعات من الخادم
async function loadProjects() {
  const currentCat = getCurrentCategory();
  const grid = document.getElementById('projectsGrid');
  const countPill = document.getElementById('projectsCountPill');

  try {
    const url = currentCat === 'all' 
      ? '/api/projects?category=all' 
      : `/api/projects?category=${currentCat}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('فشل جلب المشروعات');

    const data = await res.json();
    if (data.success) {
      allLoadedProjects = data.projects || [];
      if (countPill) countPill.textContent = `${allLoadedProjects.length} مشروع`;
      renderProjects(allLoadedProjects);
    } else {
      if (grid) grid.innerHTML = `<div class="projects-error-state">${escapeHtml(data.message)}</div>`;
    }
  } catch (err) {
    if (grid) {
      grid.innerHTML = `
        <div class="projects-error-state">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <p>تعذر تحميل المشروعات: ${escapeHtml(err.message)}</p>
          <button class="btn-retry" onclick="loadProjects()">إعادة المحاولة</button>
        </div>
      `;
    }
  }
}

// 4. عرض كروت المشروعات
function renderProjects(projects) {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  const currentCat = getCurrentCategory();

  if (!projects || projects.length === 0) {
    grid.innerHTML = `
      <div class="projects-empty-state">
        <div class="empty-icon-wrap">
          <i class="fa-solid fa-folder-open"></i>
        </div>
        <h3>لا توجد مشروعات مسجلة هنا حتى الآن</h3>
        <p>ابدأ بإضافة أول مشروع في قسم <strong>${getCategoryLabel(currentCat)}</strong> الآن.</p>
        <button class="btn-add-main-project" onclick="openAddProjectModal()">
          <i class="fa-solid fa-plus-circle"></i>
          <span>إضافة مشروع جديد الآن</span>
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const catLabel = getCategoryLabel(p.category);
    const badgeClass = getCategoryBadgeClass(p.category);
    const area = parseFloat(p.area_sqm) || 0;

    let catIcon = 'fa-building';
    if (p.category === 'residential') catIcon = 'fa-house-chimney';
    if (p.category === 'lands') catIcon = 'fa-mountain-city';

    return `
      <div class="project-unified-card">
        <div class="card-top-header">
          <span class="project-cat-badge ${badgeClass}">
            <i class="fa-solid ${catIcon}"></i> ${catLabel}
          </span>
          <button class="btn-icon-del-card" onclick="promptDeleteProject(${p.id}, '${escapeHtml(p.name)}')" title="حذف المشروع">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>

        <div class="card-main-info">
          <h3 class="project-card-title">${escapeHtml(p.name)}</h3>

          <div class="project-meta-row">
            <div class="meta-item">
              <i class="fa-solid fa-ruler-combined"></i>
              <span>المساحة: <strong>${area.toLocaleString('en-US')} م²</strong></span>
            </div>
            <div class="meta-item">
              <i class="fa-solid fa-location-dot"></i>
              <span>${escapeHtml(p.location || 'الموقع غير محدد')}</span>
            </div>
          </div>

          ${p.description ? `
            <div class="project-desc-box">
              <i class="fa-regular fa-comment-dots"></i>
              <p>${escapeHtml(p.description)}</p>
            </div>
          ` : `
            <div class="project-desc-box empty-desc">
              <p>لا توجد تفاصيل إضافية مسجلة.</p>
            </div>
          `}
        </div>

        <div class="card-footer-meta">
          <small><i class="fa-regular fa-calendar"></i> أُضيف: ${new Date(p.created_at).toLocaleDateString('ar-EG')}</small>
          <span class="card-status-pill">نشط</span>
        </div>
      </div>
    `;
  }).join('');
}

// 5. فتح وإغلاق نافذة الإضافة
function openAddProjectModal() {
  const modal = document.getElementById('addProjectModal');
  const form = document.getElementById('addProjectForm');
  if (form) form.reset();

  // ضبط نوع المشروع الافتراضي حسب الصفحة المفتوحة
  const currentCat = getCurrentCategory();
  const catSelect = document.getElementById('projCategoryInput');
  if (catSelect && currentCat !== 'all') {
    catSelect.value = currentCat;
  }

  if (modal) modal.classList.remove('d-none');
}

function closeAddProjectModal() {
  const modal = document.getElementById('addProjectModal');
  if (modal) modal.classList.add('d-none');
}

// 6. حفظ المشروع الجديد وتوجيهه تلقائياً
async function handleSaveProject(event) {
  event.preventDefault();

  const btn = document.getElementById('btnSubmitProject');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...`;
  }

  const category = document.getElementById('projCategoryInput')?.value || 'commercial';
  const name = document.getElementById('projNameInput')?.value.trim();
  const area_sqm = parseFloat(document.getElementById('projAreaInput')?.value) || 0;
  const location = document.getElementById('projLocationInput')?.value.trim();
  const description = document.getElementById('projDescInput')?.value.trim();

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        name,
        area_sqm,
        location,
        description
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeAddProjectModal();
      showToast(`تمت إضافة المشروع "${name}" بنجاح في قسم (${getCategoryLabel(category)})`, 'success');

      const currentCat = getCurrentCategory();

      // لو الصفحة الحالية مطابقة للقسم أو في الصفحة الرئيسية (كافة المشروعات)، نحدث القائمة فوراً
      if (currentCat === 'all' || currentCat === category) {
        await loadProjects();
      } else {
        // إذا أضاف في قسم آخر، نوجهه بعد ثانية لقسم مشروعه الجديد ليرى إضافته مباشرة
        setTimeout(() => {
          window.location.href = `/projects/${category}`;
        }, 800);
      }
    } else {
      showToast(data.message || 'فشل حفظ المشروع', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// 7. حذف المشروع
function promptDeleteProject(id, name) {
  pendingDeleteId = id;
  const modal = document.getElementById('deleteProjectModal');
  const badge = document.getElementById('deleteProjectTargetBadge');
  if (badge) badge.textContent = name;
  if (modal) modal.classList.remove('d-none');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('deleteProjectModal');
  if (modal) modal.classList.add('d-none');
}

async function executeDeleteProject() {
  if (!pendingDeleteId) return;

  const btn = document.getElementById('btnConfirmDeleteProject');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري الحذف...`;
  }

  try {
    const res = await fetch(`/api/projects/${pendingDeleteId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      closeDeleteModal();
      showToast('تم حذف المشروع بنجاح', 'success');
      await loadProjects();
    } else {
      showToast(data.message || 'فشل حذف المشروع', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// 8. البحث الفوري
function handleSearchProjects() {
  const query = (document.getElementById('projectSearchInput')?.value || '').trim().toLowerCase();
  if (!query) {
    renderProjects(allLoadedProjects);
    return;
  }

  const filtered = allLoadedProjects.filter(p => 
    (p.name && p.name.toLowerCase().includes(query)) ||
    (p.location && p.location.toLowerCase().includes(query)) ||
    (p.description && p.description.toLowerCase().includes(query))
  );

  renderProjects(filtered);
}

// 9. دوال مساعدة عامة
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-green' : type === 'error' ? 'fa-circle-exclamation text-red' : 'fa-circle-info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
