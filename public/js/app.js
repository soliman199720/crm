// فحص حالة الاتصال والحساب الحالي وتفعيل حركات التفاعل فور التحميل
document.addEventListener('DOMContentLoaded', () => {
  checkDatabaseStatus();
  checkCurrentSession();
  initTiltEffect();
});

// تأثير الإمالة ثلاثي الأبعاد المبهر (3D Tilt Effect)
function initTiltEffect() {
  const card = document.getElementById('tiltCard');
  if (!card) return;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -5;
    const rotateY = ((x - centerX) / centerX) * 5;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
  });
}

// فحص حالة الاتصال المشفر
async function checkDatabaseStatus() {
  const badge = document.getElementById('dbStatusBadge');
  const text = document.getElementById('dbStatusText');

  try {
    const res = await fetch('/api/db-status');
    const data = await res.json();

    if (data.success) {
      badge.className = 'db-status-pill';
      text.innerHTML = `النظام جاهز &bull; الاتصال مشفر ومؤمن`;
    } else {
      badge.className = 'db-status-pill error';
      text.textContent = 'خطأ في الاتصال بقاعدة البيانات';
    }
  } catch (err) {
    badge.className = 'db-status-pill error';
    text.textContent = 'تعذر الاتصال بالخادم';
  }
}

// إذا كان المستخدم مصادقاً عليه بالفعل، يتم توجيهه تلقائياً إلى لوحته المناسبة (أونر أو سيلز)
async function checkCurrentSession() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        const u = data.user;
        const isOwner = u.role && (u.role.includes('Owner') || u.role.includes('المالك'));
        window.location.href = isOwner ? '/crm' : '/sales-portal';
      }
    }
  } catch (err) {
    // يظل في صفحة تسجيل الدخول
  }
}

// إظهار تنبيه آمن
function showAlert(message, type = 'error') {
  const alertBox = document.getElementById('alertBox');
  alertBox.className = `alert-box ${type}`;
  const icon = document.createElement('i');
  icon.className = `fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`;
  const span = document.createElement('span');
  span.textContent = message;
  alertBox.innerHTML = '';
  alertBox.appendChild(icon);
  alertBox.appendChild(span);
  alertBox.classList.remove('d-none');
}

// إخفاء التنبيه
function hideAlert() {
  const alertBox = document.getElementById('alertBox');
  alertBox.classList.add('d-none');
  alertBox.innerHTML = '';
}

// تبديل إظهار / إخفاء كلمة المرور
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-regular fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-regular fa-eye';
  }
}

// معالجة تسجيل الدخول مع أنيميشن المصادقة والتحويل المبهر
async function handleLogin(e) {
  e.preventDefault();
  hideAlert();

  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;
  const rememberMe = document.getElementById('rememberMe') ? document.getElementById('rememberMe').checked : false;
  const submitBtn = document.getElementById('loginSubmitBtn');
  const btnText = submitBtn.querySelector('.btn-text');

  if (!identifier || !password) {
    showAlert('يرجى ملء جميع الحقول المطلوبة', 'error');
    return;
  }

  submitBtn.disabled = true;
  btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق من الهوية...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, rememberMe })
    });

    const data = await res.json();

    if (data.success) {
      // إطلاق شاشة الأنيميشن والمصادقة المبهرة
      triggerDazzlingLoginAnimation(data.user, data.redirectTo || '/crm');
    } else {
      showAlert(data.message || 'بيانات الدخول غير صحيحة', 'error');
      submitBtn.disabled = false;
      btnText.textContent = 'تسجيل الدخول للنظام';
    }
  } catch (err) {
    showAlert('حدث خطأ في الاتصال بالخادم، يرجى المحاولة لاحقاً', 'error');
    submitBtn.disabled = false;
    btnText.textContent = 'تسجيل الدخول للنظام';
  }
}

// دالة تشغيل أنيميشن المصادقة المتتابع
function triggerDazzlingLoginAnimation(user, redirectUrl) {
  const overlay = document.getElementById('loginTransitionOverlay');
  const progressBar = document.getElementById('cyberProgressFill');
  const centerIcon = document.getElementById('scannerCenterIcon');
  const title = document.getElementById('transitionTitle');
  const subtitle = document.getElementById('transitionSubtitle');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');

  if (!overlay) {
    window.location.href = redirectUrl;
    return;
  }

  // إظهار الشاشة
  overlay.classList.remove('d-none');

  // المرحلة 1 (فورية): تأكيد الاعتماد
  progressBar.style.width = '35%';
  step1.classList.add('completed');
  step2.classList.add('active');

  // المرحلة 2 (بعد 500 مللي ثانية): تأكيد قاعدة البيانات وفتح القفل
  setTimeout(() => {
    progressBar.style.width = '75%';
    step2.classList.remove('active');
    step2.classList.add('completed');
    step3.classList.add('active');

    // تحول القفل إلى مفتوح مع وميض زمردي
    centerIcon.classList.add('unlocked');
    centerIcon.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
    title.textContent = `تم التحقق بنجاح! مرحباً ${user.fullName || 'بك'}`;
    title.style.color = '#059669';
    subtitle.textContent = 'تم إرساء الاتصال الآمن مع قاعدة بيانات crm';
  }, 550);

  // المرحلة 3 (بعد 1100 مللي ثانية): اكتمال التحميل والتحويل النهائي
  setTimeout(() => {
    progressBar.style.width = '100%';
    step3.classList.remove('active');
    step3.classList.add('completed');
    step3.querySelector('.step-icon').innerHTML = '<i class="fa-solid fa-check"></i>';
    subtitle.textContent = redirectUrl.includes('sales-portal') ? 'جاري نقلك إلى بوابة المبيعات...' : 'جاري نقلك إلى لوحة تحكم CRM...';
  }, 1100);

  // التحويل بعد انتهاء المشهد (1.6 ثانية)
  setTimeout(() => {
    window.location.href = redirectUrl;
  }, 1600);
}
