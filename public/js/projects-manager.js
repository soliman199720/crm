/**
 * projects-manager.js
 * إدارة وعرض وتصنيف المشروعات (تجاري / سكني / أراضي)
 * نظام إدارة العملاء والمشروعات CRM
 */

let allLoadedProjects = [];
let pendingDeleteId = null;
let selectedProjectImages = [];
let editingProjectId = null;
let currentUserIsOwner = false;

// إعدادات التحميل التدريجي (Infinite Scroll - 20 مشروعاً لكل دفعة)
const PROJECTS_CHUNK_SIZE = 20;
let currentFilteredProjects = [];
let currentVisibleProjectsLimit = PROJECTS_CHUNK_SIZE;
let projectsInfiniteObserver = null;
let isLoadingMoreProjects = false;
let searchDebounceTimer = null;
let currentProjectsFetchController = null;

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

  // التحقق من دور المستخدم الحالي (أونر أم سيلز) لضبط رابط العودة وصلاحية الحذف
  try {
    const meRes = await fetch('/api/me');
    if (meRes.ok) {
      const meData = await meRes.json();
      const role = meData.user?.role || '';
      currentUserIsOwner = role.includes('Owner') || role.includes('المالك');
      if (!currentUserIsOwner) {
        document.querySelectorAll('a[href="/crm"]').forEach(link => {
          link.setAttribute('href', '/sales-portal');
          link.setAttribute('title', 'العودة لبوابة السيلز');
        });
      }
    }
  } catch (_) {}

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
              <h3 id="addProjectModalTitle" style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">إضافة مشروع جديد</h3>
              <small id="addProjectModalSubtitle" style="color:#64748b;">أدخل تفاصيل المشروع وسيتم توجيهه لقسمه تلقائياً</small>
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
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">5. التفاصيل والملاحظات</label>
            <textarea id="projDescInput" class="custom-form-textarea" rows="3" placeholder="مواصفات المشروع، أنظمة السداد، الخدمات المتاحة، الملاحظات الإدارية..."></textarea>
          </div>

          <!-- 6. صور المشروع (رفع متعدد من الجهاز أو الموبايل) -->
          <div class="form-group" style="margin-bottom: 18px;">
            <label style="font-weight:700; color:#0f172a; margin-bottom:6px; display:block;">6. صور المشروع (اختياري - يمكنك اختيار أكثر من صورة)</label>
            <input type="file" id="projImagesInput" accept="image/*" multiple style="display:none;" onchange="handleProjectImagesSelected(event)">
            <div class="proj-upload-dropzone" onclick="document.getElementById('projImagesInput').click()">
              <i class="fa-solid fa-cloud-arrow-up"></i>
              <div>
                <strong>اضغط هنا لاختيار صور من الكمبيوتر أو الموبايل</strong>
                <small>يمكنك تحديد أكثر من صورة معاً (JPG, PNG, WEBP)</small>
              </div>
            </div>
            <div id="projImagesPreviewGrid" class="proj-images-preview-grid"></div>
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

// 3. جلب المشروعات من الخادم (مع دعم البحث المباشر في قاعدة البيانات)
async function loadProjects(searchQuery) {
  const currentCat = getCurrentCategory();
  const grid = document.getElementById('projectsGrid');
  const countPill = document.getElementById('projectsCountPill');

  const effectiveSearch = typeof searchQuery === 'string'
    ? searchQuery.trim()
    : (document.getElementById('projectSearchInput')?.value || '').trim();

  if (currentProjectsFetchController) {
    currentProjectsFetchController.abort();
  }
  currentProjectsFetchController = new AbortController();

  try {
    const queryParams = new URLSearchParams();
    queryParams.set('category', currentCat === 'all' ? 'all' : currentCat);
    if (effectiveSearch) {
      queryParams.set('search', effectiveSearch);
    }

    const res = await fetch(`/api/projects?${queryParams.toString()}`, {
      signal: currentProjectsFetchController.signal
    });
    if (!res.ok) throw new Error('فشل جلب المشروعات');

    const data = await res.json();
    if (data.success) {
      allLoadedProjects = data.projects || [];
      if (countPill) countPill.textContent = `${allLoadedProjects.length} مشروع`;
      renderProjects(allLoadedProjects, effectiveSearch);
    } else {
      if (grid) grid.innerHTML = `<div class="projects-error-state">${escapeHtml(data.message)}</div>`;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
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

// بناء كارت المشروع الواحد
function createProjectCardHtml(p) {
  const catLabel = getCategoryLabel(p.category);
  const badgeClass = getCategoryBadgeClass(p.category);
  const area = parseFloat(p.area_sqm) || 0;

  let catIcon = 'fa-building';
  if (p.category === 'residential') catIcon = 'fa-house-chimney';
  if (p.category === 'lands') catIcon = 'fa-mountain-city';

  let projImages = [];
  try {
    projImages = JSON.parse(p.images_json || '[]');
  } catch (_) {}
  if ((!Array.isArray(projImages) || projImages.length === 0) && p.image_url) {
    projImages = [p.image_url];
  }
  const rawCoverUrl = Array.isArray(projImages) && projImages.length > 0 ? projImages[0] : '';
  const coverUrl = (typeof rawCoverUrl === 'string' && (rawCoverUrl.startsWith('/uploads/') || /^https?:\/\//i.test(rawCoverUrl))) ? rawCoverUrl : '';

  return `
    <div class="project-unified-card project-card-clickable" onclick="openProjectPage(${p.id})" title="اضغط لفتح صفحة المشروع">
      ${coverUrl ? `
        <div class="project-card-cover">
          <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">
          ${projImages.length > 1 ? `<span class="project-card-photos-count"><i class="fa-regular fa-images"></i> ${projImages.length} صور</span>` : ''}
        </div>
      ` : ''}
      <div class="card-top-header">
        <span class="project-cat-badge ${badgeClass}">
          <i class="fa-solid ${catIcon}"></i> ${catLabel}
        </span>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn-icon-edit-card" onclick="event.stopPropagation(); openEditProjectModal(${p.id})" title="تعديل المشروع">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          ${currentUserIsOwner ? `
            <button class="btn-icon-del-card" onclick="event.stopPropagation(); promptDeleteProject(${p.id})" title="حذف المشروع">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
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
        <span class="card-open-hint">فتح الصفحة <i class="fa-solid fa-arrow-left"></i></span>
      </div>
    </div>
  `;
}

// 4. عرض كروت المشروعات (20 مشروعاً في البداية + تحميل الباقي أثناء التمرير)
function renderProjects(projects, searchTerm = '') {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (projectsInfiniteObserver) {
    projectsInfiniteObserver.disconnect();
    projectsInfiniteObserver = null;
  }

  const currentCat = getCurrentCategory();
  currentFilteredProjects = Array.isArray(projects) ? projects : [];
  currentVisibleProjectsLimit = PROJECTS_CHUNK_SIZE;
  isLoadingMoreProjects = false;

  const existingSentinel = document.getElementById('projectsInfiniteSentinel');
  if (existingSentinel) existingSentinel.remove();

  if (currentFilteredProjects.length === 0) {
    if (searchTerm) {
      grid.innerHTML = `
        <div class="projects-empty-state">
          <div class="empty-icon-wrap">
            <i class="fa-solid fa-magnifying-glass"></i>
          </div>
          <h3>لا توجد نتائج مطابقة لـ "${escapeHtml(searchTerm)}"</h3>
          <p>جرّب البحث باسم مشروع آخر أو موقع أو نوع مختلف.</p>
          <button class="btn-retry" onclick="clearProjectsSearch()">
            <i class="fa-solid fa-rotate-left"></i>
            <span>عرض كافة المشروعات</span>
          </button>
        </div>
      `;
      return;
    }

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

  const initialBatch = currentFilteredProjects.slice(0, currentVisibleProjectsLimit);
  currentVisibleProjectsLimit = initialBatch.length;
  grid.innerHTML = initialBatch.map(createProjectCardHtml).join('');

  if (currentVisibleProjectsLimit < currentFilteredProjects.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'projectsInfiniteSentinel';
    sentinel.style.cssText = 'text-align:center; padding:18px; color:#64748b; font-size:0.9rem; font-weight:600;';
    sentinel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل المزيد من المشروعات...';
    grid.insertAdjacentElement('afterend', sentinel);
    setupProjectsInfiniteScroll(sentinel);
  }
}

function loadMoreProjectsChunk() {
  if (isLoadingMoreProjects) return;
  if (currentVisibleProjectsLimit >= currentFilteredProjects.length) return;

  const grid = document.getElementById('projectsGrid');
  const sentinel = document.getElementById('projectsInfiniteSentinel');
  if (!grid) return;

  isLoadingMoreProjects = true;
  const nextBatch = currentFilteredProjects.slice(
    currentVisibleProjectsLimit,
    currentVisibleProjectsLimit + PROJECTS_CHUNK_SIZE
  );
  currentVisibleProjectsLimit += nextBatch.length;

  if (nextBatch.length > 0) {
    grid.insertAdjacentHTML('beforeend', nextBatch.map(createProjectCardHtml).join(''));
  }

  if (currentVisibleProjectsLimit >= currentFilteredProjects.length) {
    if (projectsInfiniteObserver) {
      projectsInfiniteObserver.disconnect();
      projectsInfiniteObserver = null;
    }
    if (sentinel) sentinel.remove();
  }

  isLoadingMoreProjects = false;
}

function setupProjectsInfiniteScroll(sentinel) {
  if (!sentinel) return;
  if (!('IntersectionObserver' in window)) {
    // متصفحات قديمة: عرض الباقي مباشرة
    while (currentVisibleProjectsLimit < currentFilteredProjects.length) {
      loadMoreProjectsChunk();
    }
    return;
  }

  projectsInfiniteObserver = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) {
      loadMoreProjectsChunk();
    }
  }, { rootMargin: '250px' });

  projectsInfiniteObserver.observe(sentinel);
}

function openProjectPage(projectId) {
  if (!projectId) return;
  window.location.href = `/projects/${projectId}`;
}

// 5. فتح وإغلاق نافذة الإضافة والتعديل
function openAddProjectModal() {
  const modal = document.getElementById('addProjectModal');
  const form = document.getElementById('addProjectForm');
  if (form) form.reset();

  editingProjectId = null;
  selectedProjectImages = [];
  renderSelectedProjectImages();

  const titleEl = document.getElementById('addProjectModalTitle');
  const subEl = document.getElementById('addProjectModalSubtitle');
  const btnEl = document.getElementById('btnSubmitProject');
  if (titleEl) titleEl.textContent = 'إضافة مشروع جديد';
  if (subEl) subEl.textContent = 'أدخل تفاصيل المشروع وسيتم توجيهه لقسمه تلقائياً';
  if (btnEl) btnEl.innerHTML = `<i class="fa-solid fa-check"></i><span>حفظ المشروع وتوجيهه</span>`;

  // ضبط نوع المشروع الافتراضي حسب الصفحة المفتوحة
  const currentCat = getCurrentCategory();
  const catSelect = document.getElementById('projCategoryInput');
  if (catSelect && currentCat !== 'all') {
    catSelect.value = currentCat;
  }

  if (modal) modal.classList.remove('d-none');
}

function openEditProjectModal(projectId) {
  const project = allLoadedProjects.find(p => p.id === projectId);
  if (!project) return;

  const modal = document.getElementById('addProjectModal');
  const form = document.getElementById('addProjectForm');
  if (form) form.reset();

  editingProjectId = projectId;

  document.getElementById('projCategoryInput').value = project.category || 'commercial';
  document.getElementById('projNameInput').value = project.name || '';
  document.getElementById('projAreaInput').value = project.area_sqm || '';
  document.getElementById('projLocationInput').value = project.location || '';
  document.getElementById('projDescInput').value = project.description || '';

  let existingUrls = [];
  try { existingUrls = JSON.parse(project.images_json || '[]'); } catch (_) {}
  if ((!Array.isArray(existingUrls) || existingUrls.length === 0) && project.image_url) {
    existingUrls = [project.image_url];
  }
  selectedProjectImages = (Array.isArray(existingUrls) ? existingUrls : []).map(url => ({
    url,
    dataUrl: url,
    isExisting: true
  }));
  renderSelectedProjectImages();

  const titleEl = document.getElementById('addProjectModalTitle');
  const subEl = document.getElementById('addProjectModalSubtitle');
  const btnEl = document.getElementById('btnSubmitProject');
  if (titleEl) titleEl.textContent = 'تعديل بيانات المشروع';
  if (subEl) subEl.textContent = `تحديث بيانات وصور (${project.name})`;
  if (btnEl) btnEl.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>حفظ التعديلات</span>`;

  if (modal) modal.classList.remove('d-none');
}

function closeAddProjectModal() {
  editingProjectId = null;
  const modal = document.getElementById('addProjectModal');
  if (modal) modal.classList.add('d-none');
}

// معالجة وضغط الصور المختارة من الجهاز أو الموبايل
function compressImageFile(file, maxSize = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(outputType, quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleProjectImagesSelected(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await compressImageFile(file);
      selectedProjectImages.push({ name: file.name, dataUrl });
    } catch (_) {}
  }

  event.target.value = '';
  renderSelectedProjectImages();
}

function removeSelectedProjectImage(index) {
  selectedProjectImages.splice(index, 1);
  renderSelectedProjectImages();
}

function renderSelectedProjectImages() {
  const grid = document.getElementById('projImagesPreviewGrid');
  if (!grid) return;

  if (selectedProjectImages.length === 0) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = selectedProjectImages.map((img, idx) => `
    <div class="proj-preview-thumb">
      <img src="${img.dataUrl}" alt="صورة ${idx + 1}">
      <button type="button" class="btn-remove-preview" onclick="removeSelectedProjectImage(${idx})" title="إزالة الصورة">&times;</button>
    </div>
  `).join('');
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

  const isEdit = Boolean(editingProjectId);
  const url = isEdit ? `/api/projects/${editingProjectId}` : '/api/projects';
  const method = isEdit ? 'PUT' : 'POST';

  const bodyPayload = {
    category,
    name,
    area_sqm,
    location,
    description,
    images: selectedProjectImages.filter(img => !img.isExisting).map(img => img.dataUrl)
  };
  if (isEdit) {
    bodyPayload.existing_images = selectedProjectImages.filter(img => img.isExisting).map(img => img.url);
  }

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeAddProjectModal();
      showToast(
        isEdit
          ? `تم تحديث المشروع "${name}" بنجاح`
          : `تمت إضافة المشروع "${name}" بنجاح في قسم (${getCategoryLabel(category)})`,
        'success'
      );

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
function promptDeleteProject(id) {
  pendingDeleteId = id;
  const proj = allLoadedProjects.find(p => p.id === id);
  const modal = document.getElementById('deleteProjectModal');
  const badge = document.getElementById('deleteProjectTargetBadge');
  if (badge) badge.textContent = proj ? proj.name : '';
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

// 8. البحث الفوري في قاعدة البيانات (مع Debounce لمنع الضغط أثناء الكتابة)
function handleSearchProjects() {
  const query = (document.getElementById('projectSearchInput')?.value || '').trim();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadProjects(query);
  }, 300);
}

function clearProjectsSearch() {
  const input = document.getElementById('projectSearchInput');
  if (input) input.value = '';
  clearTimeout(searchDebounceTimer);
  loadProjects('');
}

// 9. دوال مساعدة عامة (escapeHtml provided globally by global-loader.js)

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
