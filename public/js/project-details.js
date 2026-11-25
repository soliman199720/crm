/**
 * project-details.js
 * عرض صفحة تفاصيل المشروع الفردي + إدارة وحدات المشروع وإضافة وحدة بصور متعددة
 */

let currentProject = null;
let allProjectUnits = [];
let selectedUnitImages = [];
let isTotalPriceManuallyEdited = false;
let editingUnitId = null;
let currentUserIsOwner = false;

document.addEventListener('DOMContentLoaded', () => {
  loadProjectDetails();
});

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get('id');
  if (queryId && /^\d+$/.test(queryId)) return queryId;

  const match = window.location.pathname.match(/\/projects\/(\d+)/);
  return match ? match[1] : null;
}

function getCategoryMeta(cat) {
  if (cat === 'commercial') {
    return {
      label: 'تجاري',
      icon: 'fa-building',
      badgeClass: 'cat-badge-commercial',
      backUrl: '/projects/commercial',
      backLabel: 'العودة لمشروعات تجاري',
      floorLabel: 'الدور',
      floorPlaceholder: 'مثال: أرضي / أول / ثاني',
      unitTypes: ['محل تجاري', 'مكتب إداري', 'عيادة', 'كشك / مساحة خارجية']
    };
  }
  if (cat === 'residential') {
    return {
      label: 'سكني',
      icon: 'fa-house-chimney',
      badgeClass: 'cat-badge-residential',
      backUrl: '/projects/residential',
      backLabel: 'العودة لمشروعات سكني',
      floorLabel: 'الدور',
      floorPlaceholder: 'مثال: أرضي / متكرر / ثالث / روف',
      unitTypes: ['شقة', 'دوبلكس', 'بنتهاوس', 'فيلا', 'تاون هاوس']
    };
  }
  if (cat === 'lands') {
    return {
      label: 'أراضي',
      icon: 'fa-mountain-city',
      badgeClass: 'cat-badge-lands',
      backUrl: '/projects/lands',
      backLabel: 'العودة لمشروعات أراضي',
      floorLabel: 'المرحلة / البلوك / الشارع',
      floorPlaceholder: 'مثال: بلوك B / شارع رئيسي / ناصية',
      unitTypes: ['قطعة أرض سكنية', 'قطعة أرض تجارية', 'قطعة أرض ناصية', 'قطعة أرض صناعية']
    };
  }
  return {
    label: 'مشروع',
    icon: 'fa-layer-group',
    badgeClass: 'cat-badge-default',
    backUrl: '/projects',
    backLabel: 'العودة لقسم المشروعات',
    floorLabel: 'الدور / الموقع',
    floorPlaceholder: 'مثال: أرضي / بلوك A',
    unitTypes: ['وحدة']
  };
}

// escapeHtml provided globally by global-loader.js

function showUnitToast(message, type = 'success') {
  const existing = document.getElementById('unitToastMsg');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'unitToastMsg';
  toast.className = `unit-toast unit-toast-${type}`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> <span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function loadProjectDetails() {
  const root = document.getElementById('projectDetailsRoot');
  if (!root) return;

  // التحقق من دور المستخدم الحالي لضبط رابط العودة وصلاحية حذف الوحدات
  try {
    const meRes = await fetch('/api/me');
    if (meRes.ok) {
      const meData = await meRes.json();
      const role = meData.user?.role || '';
      currentUserIsOwner = role.includes('Owner') || role.includes('المالك');
      if (typeof window.applyProjectsTopbarForRole === 'function') {
        window.applyProjectsTopbarForRole(meData.user);
      }
    }
  } catch (_) {}

  const projectId = getProjectIdFromUrl();
  if (!projectId) {
    renderError(root, 'معرف المشروع غير موجود في الرابط.');
    return;
  }

  try {
    const res = await fetch(`/api/projects/${projectId}`);
    const data = await res.json();

    if (!res.ok || !data.success || !data.project) {
      renderError(root, data.message || 'تعذر العثور على هذا المشروع.');
      return;
    }

    currentProject = data.project;
    renderProjectDetails(root, currentProject);
    injectAddUnitModal(currentProject);
    await loadProjectUnits(currentProject.id);
  } catch (err) {
    renderError(root, 'حدث خطأ أثناء الاتصال بالخادم: ' + err.message);
  }
}

function renderError(root, message) {
  root.innerHTML = `
    <div class="projects-error-state" style="background:#fff; border-radius:18px; border:1px solid #fecaca; padding:50px 20px;">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <p style="font-size:1.05rem; font-weight:700; margin:10px 0 18px;">${escapeHtml(message)}</p>
      <a href="/projects" class="btn-retry" style="text-decoration:none; display:inline-block;">العودة لقسم المشروعات</a>
    </div>
  `;
}

function renderProjectDetails(root, p) {
  const meta = getCategoryMeta(p.category);
  const area = parseFloat(p.area_sqm) || 0;
  const createdDate = p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'غير محدد';

  document.title = `${p.name} | تفاصيل المشروع CRM`;

  let images = [];
  try {
    images = JSON.parse(p.images_json || '[]');
  } catch (_) {}
  if ((!Array.isArray(images) || images.length === 0) && p.image_url) {
    images = [p.image_url];
  }

  const safeImages = Array.isArray(images)
    ? images.filter(url => typeof url === 'string' && (url.startsWith('/uploads/') || /^https?:\/\//i.test(url)))
    : [];

  const galleryHtml = safeImages.length > 0 ? `
    <div class="details-gallery-section">
      <h3><i class="fa-regular fa-images"></i> صور المشروع (${safeImages.length})</h3>
      <div class="details-gallery-grid">
        ${safeImages.map((url, idx) => `
          <div class="details-gallery-item" data-lightbox-url="${escapeHtml(url)}" onclick="openImageLightbox(this.dataset.lightboxUrl)">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(p.name)} - صورة ${idx + 1}" loading="lazy">
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  root.innerHTML = `
    <div class="project-details-topbar">
      <a href="${meta.backUrl}" class="btn-back-category">
        <i class="fa-solid fa-arrow-right"></i>
        <span>${meta.backLabel}</span>
      </a>
      <a href="/projects" class="btn-back-all">
        <i class="fa-solid fa-layer-group"></i>
        <span>كافة المشروعات</span>
      </a>
    </div>

    <section class="project-details-hero-card">
      <div class="details-hero-head">
        <span class="project-cat-badge ${meta.badgeClass}">
          <i class="fa-solid ${meta.icon}"></i> ${meta.label}
        </span>
        <span class="card-status-pill">${escapeHtml(p.status || 'نشط')}</span>
      </div>

      <h2 class="details-project-title">${escapeHtml(p.name)}</h2>

      <div class="details-info-grid">
        <div class="details-info-item">
          <div class="details-info-icon"><i class="fa-solid fa-ruler-combined"></i></div>
          <div>
            <small>المساحة الإجمالية</small>
            <strong>${area.toLocaleString('en-US')} م²</strong>
          </div>
        </div>

        <div class="details-info-item">
          <div class="details-info-icon"><i class="fa-solid fa-location-dot"></i></div>
          <div>
            <small>موقع المشروع</small>
            <strong>${escapeHtml(p.location || 'غير محدد')}</strong>
          </div>
        </div>

        <div class="details-info-item">
          <div class="details-info-icon"><i class="fa-solid ${meta.icon}"></i></div>
          <div>
            <small>التصنيف</small>
            <strong>${meta.label}</strong>
          </div>
        </div>

        <div class="details-info-item">
          <div class="details-info-icon"><i class="fa-regular fa-calendar"></i></div>
          <div>
            <small>تاريخ الإضافة</small>
            <strong>${createdDate}</strong>
          </div>
        </div>
      </div>

      <div class="details-description-section">
        <h3><i class="fa-regular fa-file-lines"></i> التفاصيل والملاحظات</h3>
        <p>${p.description ? escapeHtml(p.description) : 'لا توجد تفاصيل إضافية مسجلة لهذا المشروع حتى الآن.'}</p>
      </div>

      ${galleryHtml}
    </section>

    <!-- قسم وحدات المشروع -->
    <section class="project-units-section">
      <div class="units-section-header">
        <div>
          <h3><i class="fa-solid fa-cubes"></i> وحدات المشروع</h3>
          <small>إدارة الوحدات والقطع الخاصة بهذا المشروع</small>
        </div>
        <button type="button" class="btn-add-main-project" onclick="openAddUnitModal()">
          <i class="fa-solid fa-plus-circle"></i>
          <span>إضافة وحدة</span>
        </button>
      </div>

      <div class="units-stats-strip" id="unitsStatsStrip">
        <div class="unit-stat-pill"><span>إجمالي الوحدات</span><strong id="statTotalUnits">0</strong></div>
        <div class="unit-stat-pill pill-avail"><span>متاح</span><strong id="statAvailUnits">0</strong></div>
        <div class="unit-stat-pill pill-res"><span>محجوز</span><strong id="statResUnits">0</strong></div>
        <div class="unit-stat-pill pill-sold"><span>تم التعاقد</span><strong id="statSoldUnits">0</strong></div>
      </div>

      <div class="units-filter-bar">
        <div class="search-box-wrap" style="flex:1; min-width:220px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="unitSearchInput" placeholder="بحث بكود الوحدة، الدور، أو العميل..." oninput="filterUnitsGrid()">
        </div>
        <select id="unitStatusFilter" class="custom-form-select" style="width:auto; min-width:160px;" onchange="filterUnitsGrid()">
          <option value="all">كل الحالات</option>
          <option value="متاح">متاح</option>
          <option value="محجوز">محجوز</option>
          <option value="تم التعاقد">تم التعاقد</option>
        </select>
      </div>

      <div id="projectUnitsGrid" class="project-units-grid">
        <div class="projects-loading-state">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <p>جاري تحميل وحدات المشروع...</p>
        </div>
      </div>
    </section>

    <div id="projectImageLightbox" class="proj-lightbox d-none" onclick="closeImageLightbox()">
      <button type="button" class="proj-lightbox-close" onclick="closeImageLightbox()">&times;</button>
      <img id="projectLightboxImg" src="" alt="معاينة الصورة" onclick="event.stopPropagation()">
    </div>
  `;
}

function injectAddUnitModal(project) {
  if (document.getElementById('addUnitModal')) return;
  const meta = getCategoryMeta(project.category);

  const modalHtml = `
    <div class="modal-backdrop d-none" id="addUnitModal">
      <div class="modal-card add-project-modal-card" style="max-height:92vh; overflow-y:auto;">
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="modal-header-icon" style="background:#eef2ff; color:#4f46e5; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
              <i class="fa-solid fa-cube"></i>
            </div>
            <div>
              <h3 id="addUnitModalTitle" style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">إضافة وحدة</h3>
              <small id="addUnitModalSubtitle" style="color:#64748b;">إضافة وحدة جديدة في مشروع (${escapeHtml(project.name)}) - ${meta.label}</small>
            </div>
          </div>
          <button type="button" class="btn-close" onclick="closeAddUnitModal()">&times;</button>
        </div>

        <form id="addUnitForm" onsubmit="handleSaveUnit(event)" style="margin-top:16px;">
          <div class="unit-form-two-cols">
            <div class="form-group">
              <label class="unit-form-label">1. كود / رقم الوحدة *</label>
              <input type="text" id="unitCodeInput" class="custom-form-input" placeholder="مثال: A-101 أو قطعة 12" required>
            </div>

            <div class="form-group">
              <label class="unit-form-label">2. نوع الوحدة *</label>
              <select id="unitTypeInput" class="custom-form-select" required>
                ${meta.unitTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="unit-form-two-cols">
            <div class="form-group">
              <label class="unit-form-label">3. ${meta.floorLabel} *</label>
              <input type="text" id="unitFloorInput" class="custom-form-input" placeholder="${meta.floorPlaceholder}" required>
            </div>

            <div class="form-group">
              <label class="unit-form-label">4. المساحة (م²) *</label>
              <input type="number" id="unitAreaInput" class="custom-form-input" placeholder="مثال: 120" min="1" step="0.5" oninput="autoCalcUnitTotalPrice()" required>
            </div>
          </div>

          <div class="unit-form-two-cols">
            <div class="form-group">
              <label class="unit-form-label">5. سعر المتر (جنيه)</label>
              <input type="number" id="unitMeterPriceInput" class="custom-form-input" placeholder="مثال: 25000" min="0" step="100" oninput="autoCalcUnitTotalPrice()">
            </div>

            <div class="form-group">
              <label class="unit-form-label">6. السعر الإجمالي (جنيه)</label>
              <input type="number" id="unitTotalPriceInput" class="custom-form-input" placeholder="يحسب تلقائياً أو اكتبه يدوياً" min="0" step="100" oninput="markTotalPriceManual()">
            </div>
          </div>

          <div class="unit-form-two-cols">
            <div class="form-group">
              <label class="unit-form-label">7. حالة الوحدة</label>
              <select id="unitStatusInput" class="custom-form-select" onchange="toggleUnitClientField()">
                <option value="متاح">🟢 متاح</option>
                <option value="محجوز">🟡 محجوز</option>
                <option value="تم التعاقد">🔵 تم التعاقد</option>
              </select>
            </div>

            <div class="form-group d-none" id="unitClientGroup">
              <label class="unit-form-label">اسم العميل</label>
              <input type="text" id="unitClientNameInput" class="custom-form-input" placeholder="اسم العميل الحاجز أو المتعاقد">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:14px;">
            <label class="unit-form-label">8. ملاحظات إضافية</label>
            <textarea id="unitNotesInput" class="custom-form-textarea" rows="2" placeholder="تشطيب، واجهة، نظام سداد خاص بالوحدة..."></textarea>
          </div>

          <div class="form-group" style="margin-bottom:18px;">
            <label class="unit-form-label">9. صور الوحدة (اختياري - يمكنك اختيار أكثر من صورة)</label>
            <input type="file" id="unitImagesInput" accept="image/*" multiple style="display:none;" onchange="handleUnitImagesSelected(event)">
            <div class="proj-upload-dropzone" onclick="document.getElementById('unitImagesInput').click()">
              <i class="fa-solid fa-cloud-arrow-up"></i>
              <div>
                <strong>اضغط لاختيار صور للوحدة من الكمبيوتر أو الموبايل</strong>
                <small>يمكنك تحديد أكثر من صورة معاً</small>
              </div>
            </div>
            <div id="unitImagesPreviewGrid" class="proj-images-preview-grid"></div>
          </div>

          <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:10px; padding-top:14px; border-top:1px solid #f1f5f9;">
            <button type="button" class="btn-secondary" onclick="closeAddUnitModal()">إلغاء</button>
            <button type="submit" class="btn-primary-gradient" id="btnSubmitUnit">
              <i class="fa-solid fa-check"></i>
              <span>حفظ الوحدة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openAddUnitModal() {
  const modal = document.getElementById('addUnitModal');
  const form = document.getElementById('addUnitForm');
  if (form) form.reset();

  editingUnitId = null;
  selectedUnitImages = [];
  isTotalPriceManuallyEdited = false;
  renderSelectedUnitImages();
  toggleUnitClientField();

  const meta = getCategoryMeta(currentProject?.category);
  const titleEl = document.getElementById('addUnitModalTitle');
  const subEl = document.getElementById('addUnitModalSubtitle');
  const btnEl = document.getElementById('btnSubmitUnit');
  if (titleEl) titleEl.textContent = 'إضافة وحدة';
  if (subEl) subEl.textContent = `إضافة وحدة جديدة في مشروع (${currentProject?.name || ''}) - ${meta.label}`;
  if (btnEl) btnEl.innerHTML = `<i class="fa-solid fa-check"></i><span>حفظ الوحدة</span>`;

  if (modal) modal.classList.remove('d-none');
}

function openEditUnitModal(unitId) {
  const unit = allProjectUnits.find(u => u.id === unitId);
  if (!unit) return;

  const modal = document.getElementById('addUnitModal');
  const form = document.getElementById('addUnitForm');
  if (form) form.reset();

  editingUnitId = unitId;

  document.getElementById('unitCodeInput').value = unit.unit_code || '';
  const typeSelect = document.getElementById('unitTypeInput');
  if (typeSelect) {
    const hasOption = Array.from(typeSelect.options).some(opt => opt.value === unit.unit_type);
    if (!hasOption && unit.unit_type) {
      typeSelect.add(new Option(unit.unit_type, unit.unit_type));
    }
    typeSelect.value = unit.unit_type || '';
  }
  document.getElementById('unitFloorInput').value = unit.floor || '';
  document.getElementById('unitAreaInput').value = unit.area_sqm || '';
  document.getElementById('unitMeterPriceInput').value = unit.meter_price || '';
  document.getElementById('unitTotalPriceInput').value = unit.total_price || '';
  document.getElementById('unitStatusInput').value = unit.status || 'متاح';
  document.getElementById('unitClientNameInput').value = unit.reserved_client_name || '';
  document.getElementById('unitNotesInput').value = unit.notes || '';

  isTotalPriceManuallyEdited = Boolean(unit.total_price);
  toggleUnitClientField();

  let existingUrls = [];
  try { existingUrls = JSON.parse(unit.images_json || '[]'); } catch (_) {}
  selectedUnitImages = (Array.isArray(existingUrls) ? existingUrls : []).map(url => ({
    url,
    dataUrl: url,
    isExisting: true
  }));
  renderSelectedUnitImages();

  const titleEl = document.getElementById('addUnitModalTitle');
  const subEl = document.getElementById('addUnitModalSubtitle');
  const btnEl = document.getElementById('btnSubmitUnit');
  if (titleEl) titleEl.textContent = 'تعديل بيانات الوحدة';
  if (subEl) subEl.textContent = `تحديث بيانات وصور الوحدة (${unit.unit_code})`;
  if (btnEl) btnEl.innerHTML = `<i class="fa-solid fa-floppy-disk"></i><span>حفظ التعديلات</span>`;

  if (modal) modal.classList.remove('d-none');
}

function closeAddUnitModal() {
  editingUnitId = null;
  const modal = document.getElementById('addUnitModal');
  if (modal) modal.classList.add('d-none');
}

function toggleUnitClientField() {
  const status = document.getElementById('unitStatusInput')?.value;
  const group = document.getElementById('unitClientGroup');
  if (!group) return;
  if (status === 'محجوز' || status === 'تم التعاقد') {
    group.classList.remove('d-none');
  } else {
    group.classList.add('d-none');
  }
}

function markTotalPriceManual() {
  const val = document.getElementById('unitTotalPriceInput')?.value;
  isTotalPriceManuallyEdited = val !== '';
}

function autoCalcUnitTotalPrice() {
  if (isTotalPriceManuallyEdited) return;
  const area = parseFloat(document.getElementById('unitAreaInput')?.value) || 0;
  const mPrice = parseFloat(document.getElementById('unitMeterPriceInput')?.value) || 0;
  const totalInput = document.getElementById('unitTotalPriceInput');
  if (totalInput) {
    totalInput.value = area > 0 && mPrice > 0 ? Math.round(area * mPrice) : '';
  }
}

function compressUnitImageFile(file, maxSize = 1400, quality = 0.82) {
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
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
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

async function handleUnitImagesSelected(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await compressUnitImageFile(file);
      selectedUnitImages.push({ name: file.name, dataUrl });
    } catch (_) {}
  }

  event.target.value = '';
  renderSelectedUnitImages();
}

function removeSelectedUnitImage(index) {
  selectedUnitImages.splice(index, 1);
  renderSelectedUnitImages();
}

function renderSelectedUnitImages() {
  const grid = document.getElementById('unitImagesPreviewGrid');
  if (!grid) return;

  if (selectedUnitImages.length === 0) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = selectedUnitImages.map((img, idx) => {
    const safeSrc = (typeof window.isSafeImageUrl === 'function' && window.isSafeImageUrl(img.dataUrl)) ? img.dataUrl : '';
    return `
      <div class="proj-preview-thumb">
        <img src="${escapeHtml(safeSrc)}" alt="صورة وحدة ${idx + 1}">
        <button type="button" class="btn-remove-preview" onclick="removeSelectedUnitImage(${idx})" title="إزالة الصورة">&times;</button>
      </div>
    `;
  }).join('');
}

async function handleSaveUnit(event) {
  event.preventDefault();
  if (!currentProject) return;

  const btn = document.getElementById('btnSubmitUnit');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...`;
  }

  const isEdit = Boolean(editingUnitId);
  const payload = {
    unit_code: document.getElementById('unitCodeInput')?.value.trim(),
    unit_type: document.getElementById('unitTypeInput')?.value,
    floor: document.getElementById('unitFloorInput')?.value.trim(),
    area_sqm: parseFloat(document.getElementById('unitAreaInput')?.value) || 0,
    meter_price: parseFloat(document.getElementById('unitMeterPriceInput')?.value) || 0,
    total_price: parseFloat(document.getElementById('unitTotalPriceInput')?.value) || 0,
    status: document.getElementById('unitStatusInput')?.value || 'متاح',
    reserved_client_name: document.getElementById('unitClientNameInput')?.value.trim() || null,
    notes: document.getElementById('unitNotesInput')?.value.trim() || '',
    images: selectedUnitImages.filter(img => !img.isExisting).map(img => img.dataUrl)
  };
  if (isEdit) {
    payload.existing_images = selectedUnitImages.filter(img => img.isExisting).map(img => img.url);
  }

  const url = isEdit
    ? `/api/projects/${currentProject.id}/units/${editingUnitId}`
    : `/api/projects/${currentProject.id}/units`;
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeAddUnitModal();
      showUnitToast(isEdit ? `تم تحديث الوحدة (${payload.unit_code}) بنجاح` : `تمت إضافة الوحدة (${payload.unit_code}) بنجاح`, 'success');
      await loadProjectUnits(currentProject.id);
    } else {
      showUnitToast(data.message || 'تعذر حفظ الوحدة', 'error');
    }
  } catch (err) {
    showUnitToast('خطأ في الاتصال بالخادم: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function loadProjectUnits(projectId) {
  const grid = document.getElementById('projectUnitsGrid');
  try {
    const res = await fetch(`/api/projects/${projectId}/units`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (grid) grid.innerHTML = `<div class="projects-error-state">${escapeHtml(data.message || 'تعذر جلب الوحدات')}</div>`;
      return;
    }

    allProjectUnits = data.units || [];
    const stats = data.stats || {};
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('statTotalUnits', stats.total || 0);
    setEl('statAvailUnits', stats.available || 0);
    setEl('statResUnits', stats.reserved || 0);
    setEl('statSoldUnits', stats.sold || 0);

    filterUnitsGrid();
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="projects-error-state">خطأ في تحميل الوحدات: ${escapeHtml(err.message)}</div>`;
  }
}

function filterUnitsGrid() {
  const search = (document.getElementById('unitSearchInput')?.value || '').trim().toLowerCase();
  const status = document.getElementById('unitStatusFilter')?.value || 'all';

  const filtered = allProjectUnits.filter(u => {
    const matchStatus = status === 'all' || u.status === status;
    const matchSearch = !search ||
      (u.unit_code && u.unit_code.toLowerCase().includes(search)) ||
      (u.floor && u.floor.toLowerCase().includes(search)) ||
      (u.unit_type && u.unit_type.toLowerCase().includes(search)) ||
      (u.reserved_client_name && u.reserved_client_name.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  renderUnitsGrid(filtered);
}

function renderUnitsGrid(units) {
  const grid = document.getElementById('projectUnitsGrid');
  if (!grid) return;

  if (!units || units.length === 0) {
    grid.innerHTML = `
      <div class="projects-empty-state" style="padding:40px 20px;">
        <div class="empty-icon-wrap"><i class="fa-solid fa-cubes"></i></div>
        <h3>لا توجد وحدات مضافة بعد</h3>
        <p>اضغط على زر <strong>"إضافة وحدة"</strong> لإضافة أول وحدة لهذا المشروع.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = units.map(u => {
    let rawUnitImages = [];
    try { rawUnitImages = JSON.parse(u.images_json || '[]'); } catch (_) {}
    const unitImages = Array.isArray(rawUnitImages)
      ? rawUnitImages.filter(url => typeof url === 'string' && (url.startsWith('/uploads/') || /^https?:\/\//i.test(url)))
      : [];
    const cover = unitImages.length > 0 ? unitImages[0] : '';

    let statusClass = 'unit-status-avail';
    if (u.status === 'محجوز') statusClass = 'unit-status-res';
    if (u.status === 'تم التعاقد' || u.status === 'مباع') statusClass = 'unit-status-sold';

    const area = parseFloat(u.area_sqm) || 0;
    const mPrice = parseFloat(u.meter_price) || 0;
    const tPrice = parseFloat(u.total_price) || 0;

    return `
      <div class="unit-card">
        ${cover ? `
          <div class="unit-card-cover" data-lightbox-url="${escapeHtml(cover)}" onclick="openImageLightbox(this.dataset.lightboxUrl)">
            <img src="${escapeHtml(cover)}" alt="${escapeHtml(u.unit_code)}" loading="lazy">
            ${unitImages.length > 1 ? `<span class="project-card-photos-count"><i class="fa-regular fa-images"></i> ${unitImages.length} صور</span>` : ''}
          </div>
        ` : ''}

        <div class="unit-card-head">
          <div>
            <span class="unit-code-badge">${escapeHtml(u.unit_code)}</span>
            <small class="unit-type-text">${escapeHtml(u.unit_type)}</small>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="unit-status-pill ${statusClass}">${escapeHtml(u.status)}</span>
            <button type="button" class="btn-icon-edit-card" onclick="openEditUnitModal(${u.id})" title="تعديل الوحدة">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            ${currentUserIsOwner ? `
              <button type="button" class="btn-icon-del-card" onclick="deleteUnit(${u.id}, '${escapeHtml(u.unit_code)}')" title="حذف الوحدة">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div class="unit-card-specs">
          <div><small>الموقع / الدور</small><strong>${escapeHtml(u.floor)}</strong></div>
          <div><small>المساحة</small><strong>${area.toLocaleString('en-US')} م²</strong></div>
          <div><small>سعر المتر</small><strong>${mPrice ? mPrice.toLocaleString('en-US') + ' ج.م' : '—'}</strong></div>
          <div><small>السعر الإجمالي</small><strong style="color:#4f46e5;">${tPrice ? tPrice.toLocaleString('en-US') + ' ج.م' : '—'}</strong></div>
        </div>

        ${unitImages.length > 1 ? `
          <div class="unit-mini-thumbs">
            ${unitImages.map((imgUrl, idx) => `
              <img src="${escapeHtml(imgUrl)}" alt="صورة ${idx + 1}" data-lightbox-url="${escapeHtml(imgUrl)}" onclick="openImageLightbox(this.dataset.lightboxUrl)">
            `).join('')}
          </div>
        ` : ''}

        ${u.reserved_client_name ? `
          <div class="unit-client-tag">
            <i class="fa-solid fa-user-check"></i> العميل: <strong>${escapeHtml(u.reserved_client_name)}</strong>
          </div>
        ` : ''}

        ${u.notes ? `<p class="unit-notes-text">${escapeHtml(u.notes)}</p>` : ''}
      </div>
    `;
  }).join('');
}

async function deleteUnit(unitId, unitCode) {
  if (!currentProject) return;
  if (!confirm(`هل أنت متأكد من حذف الوحدة (${unitCode})؟`)) return;

  try {
    const res = await fetch(`/api/projects/${currentProject.id}/units/${unitId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showUnitToast(`تم حذف الوحدة (${unitCode})`, 'success');
      await loadProjectUnits(currentProject.id);
    } else {
      showUnitToast(data.message || 'تعذر حذف الوحدة', 'error');
    }
  } catch (err) {
    showUnitToast('خطأ في الاتصال بالخادم', 'error');
  }
}

function openImageLightbox(url) {
  const modal = document.getElementById('projectImageLightbox');
  const img = document.getElementById('projectLightboxImg');
  if (modal && img) {
    img.src = url;
    modal.classList.remove('d-none');
  }
}

function closeImageLightbox() {
  const modal = document.getElementById('projectImageLightbox');
  if (modal) modal.classList.add('d-none');
}
