let allUsers = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  verifySession();
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
    const role = user.role || '';
    if (!role.includes('Owner') && !role.includes('المالك')) {
      window.location.replace('/sales-portal');
      return;
    }
    document.getElementById('ownerNameDisplay').textContent = user.fullName || 'المدير العام';
    document.getElementById('ownerEmailDisplay').textContent = user.email || '1@1.com';

    // تحميل قائمة المستخدمين
    loadUsers();
  } catch (err) {
    window.location.href = '/';
  }
}

// 2. جلب جميع المستخدمين وتحديث المؤشرات والجدول
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();

    if (data.success && data.users) {
      allUsers = data.users;
      updateKPIs(allUsers);
      filterUsersTable();
    } else {
      showToast(data.message || 'فشل جلب المستخدمين', 'error');
    }
  } catch (err) {
    console.error('خطأ في جلب المستخدمين:', err);
    showToast('خطأ في الاتصال بالخادم', 'error');
  }
}

// 3. تحديث بطاقات المؤشرات (KPIs)
function updateKPIs(users) {
  const total = users.length;
  const sales = users.filter(u => u.role && (u.role.includes('سيلز') || u.role.includes('Sales'))).length;
  const owners = users.filter(u => u.role && (u.role.includes('Owner') || u.role.includes('المالك'))).length;
  const totalAssigned = users.reduce((sum, u) => sum + (parseInt(u.assigned_clients_count, 10) || 0), 0);

  const elTotal = document.getElementById('kpiTotalUsers');
  const elSales = document.getElementById('kpiSalesCount');
  const elOwner = document.getElementById('kpiOwnerCount') || document.getElementById('kpiManagersCount');
  const elAssigned = document.getElementById('kpiAssignedClients');

  if (elTotal) elTotal.textContent = total;
  if (elSales) elSales.textContent = sales;
  if (elOwner) elOwner.textContent = owners;
  if (elAssigned) elAssigned.textContent = totalAssigned;

  const countAll = document.getElementById('countAll');
  const countSales = document.getElementById('countSales');
  const countOwner = document.getElementById('countOwner');

  if (countAll) countAll.textContent = total;
  if (countSales) countSales.textContent = sales;
  if (countOwner) countOwner.textContent = owners;
}

// 4. تصفية وبحث في جدول المستخدمين
function filterUsersTable() {
  const searchVal = (document.getElementById('userSearchInput').value || '').trim().toLowerCase();

  let filtered = allUsers.filter(u => {
    // تصفية حسب الدور
    if (currentFilter === 'sales') {
      const isSales = u.role && (u.role.includes('سيلز') || u.role.includes('Sales'));
      if (!isSales) return false;
    } else if (currentFilter === 'owner') {
      const isOwner = u.role && (u.role.includes('Owner') || u.role.includes('المالك'));
      if (!isOwner) return false;
    }

    // تصفية حسب نص البحث
    if (searchVal) {
      const name = (u.full_name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const phone = (u.phone || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      return name.includes(searchVal) || email.includes(searchVal) || phone.includes(searchVal) || username.includes(searchVal);
    }

    return true;
  });

  renderUsersTable(filtered);
}

function setUserFilter(filterType, btn) {
  currentFilter = filterType;
  document.querySelectorAll('.filter-pill-group .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  filterUsersTable();
}

// 5. رسم بطاقات المستخدمين التفاعلية (متوافقة مع جميع الشاشات)
function renderUsersTable(users) {
  const container = document.getElementById('usersCardsContainer');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = `
      <div class="empty-users-state" style="grid-column: 1 / -1; text-align:center; padding: 48px 16px; background:#fff; border-radius:var(--radius-lg); border:1px dashed #cbd5e1; color:var(--text-muted);">
        <i class="fa-solid fa-user-slash" style="font-size:2.5rem; margin-bottom:12px; display:block; color:#94a3b8;"></i>
        <strong style="font-size:1.1rem; color:var(--text-main); display:block; margin-bottom:4px;">لا يوجد مستخدمون يطابقون شروط البحث أو الفلتر</strong>
        <p style="font-size:0.88rem; margin:0;">جرّب تعديل كلمة البحث أو تغيير تبويب التصفية أعلاه</p>
      </div>
    `;
    return;
  }

  container.innerHTML = users.map(user => {
    const isMasterOwner = (user.id === 1);
    const isOwner = isMasterOwner || (user.role && (user.role.includes('Owner') || user.role.includes('المالك')));
    const isSales = !isOwner;

    const avatarClass = isOwner ? 'avatar-owner' : 'avatar-sales';
    const initial = user.full_name ? user.full_name.trim().charAt(0) : (isOwner ? 'أ' : 'س');

    const roleClass = isOwner ? 'role-owner' : 'role-sales';
    const roleIcon = isOwner ? '<i class="fa-solid fa-crown text-amber"></i> ' : '<i class="fa-solid fa-headset"></i> ';

    const assignedCount = parseInt(user.assigned_clients_count, 10) || 0;
    const loadClass = assignedCount > 0 ? 'has-leads' : '';

    const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '--';

    const cleanPhone = (user.phone || '').replace(/[^0-9]/g, '');
    const waNumber = formatWhatsAppNumber(user.phone);
    const waLink = waNumber ? `https://wa.me/${waNumber}` : '#';

    return `
      <div class="user-profile-card ${isOwner ? 'card-owner-border' : ''}">
        <!-- رأس كارت المستخدم: الأفاتار، الاسم، والشارة -->
        <div class="user-card-header">
          <div class="user-card-identity">
            <div class="user-card-avatar ${avatarClass}">
              <span>${initial}</span>
              ${isOwner ? '<span class="avatar-crown-indicator" title="المدير العام"><i class="fa-solid fa-crown"></i></span>' : ''}
            </div>
            <div class="user-card-names">
              <strong class="user-display-name">${escapeHtml(user.full_name)}</strong>
              <span class="user-username-badge">@${escapeHtml(user.username || 'user')}</span>
            </div>
          </div>
          <div class="user-card-role-wrap">
            <span class="role-badge ${roleClass}">${roleIcon}${escapeHtml(user.role || 'سيلز (Sales)')}</span>
          </div>
        </div>

        <!-- جسم الكارت: بيانات الاتصال والتفاصيل -->
        <div class="user-card-body">
          <!-- البريد الإلكتروني -->
          <div class="user-detail-row">
            <span class="detail-label"><i class="fa-regular fa-envelope"></i> البريد:</span>
            <span class="detail-val detail-email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
          </div>

          <!-- رقم الهاتف (إن وجد) -->
          <div class="user-detail-row">
            <span class="detail-label"><i class="fa-solid fa-phone"></i> الهاتف:</span>
            <span class="detail-val detail-phone">${user.phone ? `<code>${escapeHtml(user.phone)}</code>` : '<span style="color:#94a3b8">غير مسجل</span>'}</span>
          </div>

          <!-- تاريخ الإنشاء والانضمام -->
          <div class="user-detail-row">
            <span class="detail-label"><i class="fa-regular fa-calendar-check"></i> الانضمام:</span>
            <span class="detail-val text-muted">${createdDate}</span>
          </div>
        </div>

        <!-- شريط عبء العمل والعملاء المسندين -->
        <div class="user-workload-bar">
          <div class="workload-info">
            <span class="workload-title"><i class="fa-solid fa-briefcase"></i> العملاء المسندين:</span>
            <span class="load-pill ${loadClass}">
              <i class="fa-solid fa-user-group"></i>
              <strong>${assignedCount}</strong> عميل
            </span>
          </div>
          ${cleanPhone ? `
            <div class="quick-contact-actions">
              <a href="${waLink}" target="_blank" class="quick-act-btn btn-wa" title="مراسلة واتساب">
                <i class="fa-brands fa-whatsapp"></i>
              </a>
              <a href="tel:${cleanPhone}" class="quick-act-btn btn-call" title="اتصال هاتفي">
                <i class="fa-solid fa-phone"></i>
              </a>
            </div>
          ` : ''}
        </div>

        <!-- تذييل الكارت: أزرار التحكم والإدارة -->
        <div class="user-card-footer">
          <button type="button" class="btn-card-edit" onclick="openEditUserModal(${user.id})" title="تعديل الاسم أو تعيين كلمة مرور جديدة">
            <i class="fa-solid fa-user-pen"></i>
            <span>تعديل الحساب</span>
          </button>
          ${!isMasterOwner ? `
            <button type="button" class="btn-card-delete" onclick="openDeleteUserModal(${user.id})" title="حذف حساب الموظف">
              <i class="fa-solid fa-trash-can"></i>
              <span>حذف</span>
            </button>
          ` : `
            <div class="owner-protected-badge" title="حساب الأونر الرئيسي محمي ضد الحذف">
              <i class="fa-solid fa-shield-halved"></i>
              <span>حساب رئيسي محمي</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// 6. إضافة موظف سيلز جديد
function openCreateUserModal() {
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPass').value = '';
  const roleEl = document.getElementById('newUserRole');
  if (roleEl) roleEl.value = 'سيلز (Sales)';
  document.getElementById('createUserModal').classList.remove('d-none');
}

function closeCreateUserModal() {
  document.getElementById('createUserModal').classList.add('d-none');
}

async function handleCreateUser(e) {
  e.preventDefault();

  const full_name = document.getElementById('newUserName').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;

  if (!full_name || !email || !password) {
    showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitCreateUser');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء الحساب في PostgreSQL...';

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password, role })
    });

    const data = await res.json();
    if (data.success) {
      closeCreateUserModal();
      showToast(data.message, 'success');
      await loadUsers();
    } else {
      showToast(data.message || 'فشل إنشاء الحساب', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

// 7. تعديل بيانات المستخدم وإعادة ضبط كلمة المرور
function openEditUserModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = user.id;
  document.getElementById('editUserName').value = user.full_name || '';
  document.getElementById('editUserEmail').value = user.email || '';
  document.getElementById('editUserPassword').value = '';

  const roleSelect = document.getElementById('editUserRole');
  if (roleSelect) {
    if (user.role && (user.role.includes('Owner') || user.role.includes('المالك'))) {
      roleSelect.value = 'المالك (Owner)';
    } else {
      roleSelect.value = 'سيلز (Sales)';
    }
    // حماية حساب الأونر الرئيسي
    roleSelect.disabled = (user.id === 1);
  }

  document.getElementById('editUserModal').classList.remove('d-none');
}

function closeEditUserModal() {
  document.getElementById('editUserModal').classList.add('d-none');
}

async function handleEditUser(e) {
  e.preventDefault();

  const userId = document.getElementById('editUserId').value;
  const full_name = document.getElementById('editUserName').value.trim();
  const password = document.getElementById('editUserPassword').value;
  const roleSelect = document.getElementById('editUserRole');
  const role = roleSelect ? roleSelect.value : null;

  const btn = document.getElementById('btnSubmitEditUser');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حفظ التعديلات...';

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, password, role })
    });

    const data = await res.json();
    if (data.success) {
      closeEditUserModal();
      showToast(data.message, 'success');
      await loadUsers();
    } else {
      showToast(data.message || 'فشل التعديل', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

// 8. حذف مستخدم مع نافذة تأكيد مخصصة في منتصف الشاشة
let userToDeleteId = null;

function openDeleteUserModal(userId) {
  userToDeleteId = userId;
  const userObj = allUsers.find(u => u.id === userId);
  const nameEl = document.getElementById('deleteTargetUserName');
  if (nameEl) nameEl.textContent = userObj ? userObj.full_name : '';
  const modal = document.getElementById('deleteUserModal');
  if (modal) modal.classList.remove('d-none');
}

function closeDeleteUserModal() {
  userToDeleteId = null;
  const modal = document.getElementById('deleteUserModal');
  if (modal) modal.classList.add('d-none');
}

function handleDeleteModalBackdropClick(e) {
  if (e.target.id === 'deleteUserModal') {
    closeDeleteUserModal();
  }
}

async function executeDeleteUser() {
  if (!userToDeleteId) return;

  const btn = document.getElementById('btnExecuteDeleteUser');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحذف...';
  }

  try {
    const res = await fetch(`/api/users/${userToDeleteId}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (data.success) {
      closeDeleteUserModal();
      showToast(data.message, 'success');
      await loadUsers();
    } else {
      showToast(data.message || 'فشل حذف الحساب', 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال بالخادم أثناء الحذف', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// دعم إغلاق النوافذ بمفتاح Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDeleteUserModal();
    closeCreateUserModal();
    closeEditUserModal();
  }
});

// 9. إشعارات التوست
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

// 10. تسجيل الخروج
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {}
  window.location.href = '/';
}

// escapeHtml provided globally by global-loader.js

// دالة ذكية لتنسيق رقم الواتساب ليعمل بسلاسة في مصر والأرقام الدولية
function formatWhatsAppNumber(phone) {
  let cleaned = (phone || '').replace(/[^0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('01') && cleaned.length === 11) {
    return '2' + cleaned;
  }
  if (cleaned.startsWith('00')) {
    return cleaned.substring(2);
  }
  return cleaned;
}

