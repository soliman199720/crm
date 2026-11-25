const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, initDB } = require('./db');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' 
  ? (() => { console.error('CRITICAL: JWT_SECRET environment variable is required in production!'); return crypto.randomBytes(64).toString('hex'); })()
  : 'crm_super_secure_vault_development_key_2026_x89');

// ترويسات الأمان (Security Headers)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  next();
});

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// دالة مساعدة للتحقق من المعرفات الرقمية الصحيحة الموجبة
function parsePositiveInt(val) {
  const num = parseInt(val, 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

const ALLOWED_CLIENT_STATUSES = ['عميل جديد', 'جديد', 'تم الإسناد', 'قيد المتابعة', 'مؤجل', 'تم التعاقد', 'ملغي'];

// دالة التحقق من رتبة المالك / المدير العام (مبنية على الدور فقط من قاعدة البيانات)
function isUserOwner(user) {
  if (!user) return false;
  const role = user.role || '';
  return role.includes('Owner') || role.includes('المالك');
}

// ميدلوير فرض صلاحية المالك (الأونر) فقط
function requireOwner(req, res, next) {
  if (!isUserOwner(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'عذراً، هذه الصلاحية مقتصرة على المدير العام (المالك) فقط، وليس لموظفي السيلز' 
    });
  }
  next();
}

// حارس التنقل بين الصفحات وحماية صفحات الأونر من موظفي السيلز
async function pageGuard(req, res, next) {
  const p = req.path.toLowerCase();
  const isOwnerPage = ['/crm', '/crm.html', '/sales', '/sales.html', '/users', '/users.html', '/logs', '/logs.html'].includes(p);
  const isSharedAuthPage = ['/sales-portal', '/sales-portal.html'].includes(p) || p.startsWith('/projects') || p.startsWith('/project-details');

  if (!isOwnerPage && !isSharedAuthPage) {
    return next();
  }

  const token = req.cookies.crm_token;
  if (!token) {
    return res.redirect('/');
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    const userCheck = await pool.query('SELECT is_active FROM users WHERE id = $1', [user.id]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].is_active === false) {
      res.clearCookie('crm_token');
      return res.redirect('/');
    }
    req.user = user;

    if (isOwnerPage) {
      if (!isUserOwner(user)) {
        // سيلز يحاول الدخول لصفحات الأونر -> يُحوّل فوراً إلى لوحة السيلز
        return res.redirect('/sales-portal');
      }
      return next();
    }

    if (isSharedAuthPage) {
      return next();
    }
  } catch (err) {
    res.clearCookie('crm_token');
    return res.redirect('/');
  }

  next();
}

app.use(pageGuard);
app.use(express.static(path.join(__dirname, 'public')));

// التحقق من التوكن (Authentication Middleware)
async function authMiddleware(req, res, next) {
  const token = req.cookies.crm_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ success: false, message: 'غير مصرح، يرجى تسجيل الدخول أولاً' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // فحص ما إذا كان الحساب نشطاً في قاعدة البيانات
    const userCheck = await pool.query('SELECT is_active FROM users WHERE id = $1', [decoded.id]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].is_active === false) {
      return res.status(403).json({ success: false, message: 'تم تعطيل هذا الحساب أو أنه لم يعد موجوداً، يرجى مراجعة الإدارة' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'جلسة الدخول منتهية أو غير صالحة' });
  }
}

// دالة مساعدة لتسجيل وتوثيق أي عملية في سجل الرقابة audit_logs
async function logActivity({ userId, userName, userEmail, userRole, actionType, actionCategory, targetType, targetName, details, req }) {
  try {
    const ip = req ? getClientIp(req) : '';
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, user_email, user_role, action_type, action_category, target_type, target_name, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId || (req && req.user ? req.user.id : null),
        userName || (req && req.user ? req.user.full_name : 'المدير العام'),
        userEmail || (req && req.user ? req.user.email : '1@1.com'),
        userRole || (req && req.user ? req.user.role : 'المالك (Owner)'),
        actionType,
        actionCategory || 'سيلز ومبيعات',
        targetType || 'نظام',
        targetName || '',
        details,
        ip
      ]
    );
  } catch (err) {
    console.error('خطأ تسجيل النشاط في audit_logs:', err.message);
  }
}

// توجيه مسار /crm لعرض لوحة القيادة المركزية للأونر
app.get('/crm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});

// توجيه مسار /sales لعرض صفحة إدارة وتقسيم العملاء على السيلز (للأونر)
app.get('/sales', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sales.html'));
});

// توجيه مسار /users لعرض صفحة إدارة المستخدمين والسيلز (للأونر)
app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

// توجيه مسار /logs لعرض صفحة سجل العمليات والرقابة الكاملة (للأونر)
app.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});

// توجيه مسار /projects لعرض صفحة المشروعات (للأونر)
app.get(['/projects', '/projects.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'projects.html'));
});

// توجيه مسار مشروعات تجاري (للأونر)
app.get(['/projects/commercial', '/projects-commercial', '/projects-commercial.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'projects-commercial.html'));
});

// توجيه مسار مشروعات سكني (للأونر)
app.get(['/projects/residential', '/projects-residential', '/projects-residential.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'projects-residential.html'));
});

// توجيه مسار مشروعات أراضي (للأونر)
app.get(['/projects/lands', '/projects-lands', '/projects-lands.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'projects-lands.html'));
});

// توجيه مسار تفاصيل المشروع الفردي (للأونر)
app.get(['/projects/:id', '/project-details', '/project-details.html'], (req, res, next) => {
  if (req.params.id && !/^\d+$/.test(req.params.id)) return next();
  res.sendFile(path.join(__dirname, 'public', 'project-details.html'));
});

// توجيه مسار /sales-portal لعرض لوحة تحكم السيلز الخاصة المستقلة
app.get('/sales-portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sales-portal.html'));
});

// توجيه مسارات الأرشيف القديمة تلقائياً إلى لوحة تحكم السيلز الموحدة
app.get(['/sales-archive', '/sales-archive.html'], (req, res) => {
  res.redirect('/sales-portal');
});



// فحص حالة الاتصال بقاعدة البيانات (عام - بدون تفاصيل حساسة)
app.get('/api/db-status', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'متصل' });
  } catch (err) {
    res.status(500).json({ success: false, status: 'غير متصل' });
  }
});

// دالة استخراج وتطهير عنوان الـ IP الحقيقي بأمان (تعتمد على req.ip المضبوط عبر trust proxy)
function getClientIp(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  return String(ip).slice(0, 45);
}

// حماية ضد هجمات التخمين عبر قاعدة البيانات PostgreSQL (متوافقة مع Multi-Process / Cluster)
setInterval(async () => {
  try {
    await pool.query(
      "DELETE FROM login_attempts WHERE first_attempt_at < NOW() - INTERVAL '30 minutes' AND (blocked_until IS NULL OR blocked_until < NOW())"
    );
  } catch (e) {}
}, 15 * 60 * 1000).unref();

async function loginRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  try {
    const result = await pool.query(
      'SELECT blocked_until FROM login_attempts WHERE ip = $1',
      [ip]
    );
    if (result.rows.length > 0 && result.rows[0].blocked_until) {
      const blockedUntilMs = new Date(result.rows[0].blocked_until).getTime();
      const now = Date.now();
      if (now < blockedUntilMs) {
        const minutesLeft = Math.ceil((blockedUntilMs - now) / 60000);
        return res.status(429).json({
          success: false,
          message: `تم تجاوز الحد الأقصى لمحاولات الدخول الخاطئة. تم حظر هذا الجهاز مؤقتاً، يرجى المحاولة بعد ${minutesLeft} دقيقة.`
        });
      }
    }
  } catch (err) {
    console.warn('Rate limiter check warning:', err.message);
  }
  next();
}

async function recordFailedLogin(ip) {
  try {
    await pool.query(`
      INSERT INTO login_attempts (ip, attempts, first_attempt_at, blocked_until)
      VALUES ($1, 1, NOW(), NULL)
      ON CONFLICT (ip) DO UPDATE SET
        attempts = CASE
          WHEN login_attempts.first_attempt_at < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE login_attempts.attempts + 1
        END,
        first_attempt_at = CASE
          WHEN login_attempts.first_attempt_at < NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE login_attempts.first_attempt_at
        END,
        blocked_until = CASE
          WHEN login_attempts.first_attempt_at < NOW() - INTERVAL '15 minutes' THEN NULL
          WHEN login_attempts.attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
          ELSE login_attempts.blocked_until
        END
    `, [ip]);
  } catch (err) {
    console.warn('recordFailedLogin warning:', err.message);
  }
}

async function clearFailedLogin(ip) {
  try {
    await pool.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
  } catch (err) {
    console.warn('clearFailedLogin warning:', err.message);
  }
}

// مسار تسجيل الدخول الآمن مع حماية ضد التخمين وفحص تفعيل الحساب
app.post('/api/login', loginRateLimiter, async (req, res) => {
  const identifier = req.body.identifier || req.body.email || req.body.username;
  const { password, rememberMe } = req.body;
  const reqIp = getClientIp(req);

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: 'يرجى إدخال البريد الإلكتروني وكلمة المرور'
    });
  }

  const cleanIdentifier = identifier.trim().toLowerCase();

  try {
    const query = `
      SELECT id, username, email, password, full_name, role, phone, is_active, created_at 
      FROM users 
      WHERE LOWER(email) = $1 OR LOWER(username) = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [cleanIdentifier]);

    if (result.rows.length === 0) {
      await recordFailedLogin(reqIp);
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة، يرجى التأكد من البريد وكلمة المرور'
      });
    }

    const user = result.rows[0];

    // التحقق من حالة تفعيل الحساب
    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'عذراً، هذا الحساب معطل حالياً من قبل الإدارة. يرجى التواصل مع المسؤول.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await recordFailedLogin(reqIp);
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة، يرجى التأكد من البريد وكلمة المرور'
      });
    }

    // تسجيل الدخول ناجح: تصفير عداد المحاولات الفاشلة للـ IP
    await clearFailedLogin(reqIp);

    const tokenExpiry = rememberMe ? '30d' : '1d';
    const cookieMaxAge = rememberMe ? (30 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('crm_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isHttps,
      maxAge: cookieMaxAge
    });

    const isOwner = isUserOwner(user);
    const redirectTo = isOwner ? '/crm' : '/sales-portal';

    return res.json({
      success: true,
      message: `أهلاً بك، ${user.full_name}`,
      redirectTo,
      isOwner,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('خطأ تسجيل الدخول:', err);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ في الخادم'
    });
  }
});

// جلب بيانات المستخدم الحالي
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, full_name, phone, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

// ==================== مسارات إدارة المستخدمين وطاقم العمل للأونر ====================

// جلب جميع المستخدمين مع إحصائيات العملاء المسندين (للأونر فقط)
app.get('/api/users', authMiddleware, requireOwner, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, 
        u.username,
        u.full_name, 
        u.email, 
        u.phone,
        u.role,
        u.created_at,
        COUNT(c.id) AS assigned_clients_count
      FROM users u
      LEFT JOIN clients c ON c.assigned_sales_id = u.id
      GROUP BY u.id, u.username, u.full_name, u.email, u.phone, u.role, u.created_at
      ORDER BY 
        CASE WHEN u.role LIKE '%Owner%' OR u.role LIKE '%المالك%' THEN 0 ELSE 1 END ASC,
        u.id ASC
    `;
    const result = await pool.query(query);
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// إنشاء حساب مستخدم جديد (سيلز أو أونر) من قبل الأونر فقط
app.post('/api/users', authMiddleware, requireOwner, async (req, res) => {
  const { full_name, email, password, role } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم، البريد الإلكتروني، وكلمة المرور' });
  }
  if (typeof password !== 'string' || password.trim().length < 6) {
    return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  try {
    const existCheck = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً في النظام' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password.trim(), salt);
    const baseUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'user';
    const username = `${baseUsername}_${Date.now().toString().slice(-4)}${Math.floor(100 + Math.random() * 900)}`;
    
    let userRole = 'سيلز (Sales)';
    if (role && (role.includes('Owner') || role.includes('أونر') || role.includes('المالك'))) {
      userRole = 'المالك (Owner)';
    }

    const query = `
      INSERT INTO users (username, email, password, full_name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, email, full_name, role, created_at
    `;
    const result = await pool.query(query, [username, cleanEmail, hashedPassword, full_name.trim(), userRole]);

    const roleTitle = userRole.includes('Owner') ? 'أونر' : 'سيلز';
    // تسجيل العملية في سجل النشاطات
    await logActivity({
      req,
      actionType: `إنشاء حساب ${roleTitle}`,
      actionCategory: 'إدارة المستخدمين',
      targetType: roleTitle,
      targetName: full_name.trim(),
      details: `تم إنشاء حساب ${roleTitle} جديد باسم (${full_name.trim()}) بالبريد: ${cleanEmail}`
    });

    res.status(201).json({ success: true, user: result.rows[0], message: `تم إنشاء حساب ${roleTitle} (${full_name}) بنجاح!` });
  } catch (err) {
    console.error('خطأ إنشاء المستخدم:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// تعديل بيانات المستخدم أو تغيير كلمة المرور
app.put('/api/users/:id', authMiddleware, requireOwner, async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم غير صحيح' });
  }
  const { full_name, password, role, is_active } = req.body;
  if (password && password.trim() !== '' && password.trim().length < 6) {
    return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const targetUser = userRes.rows[0];
    const isMasterAccount = (targetUser.id === 1);
    const isRequesterMaster = (req.user.id === 1);

    // حظر تعديل حساب الأونر الرئيسي إلا من قبل صاحب الحساب نفسه لمنع تصعيد الصلاحيات
    if (isMasterAccount && !isRequesterMaster) {
      return res.status(403).json({ 
        success: false, 
        message: 'عذراً، بيانات وكلمة مرور حساب المدير العام الرئيسي لا يمكن تعديلها إلا من نفس الحساب' 
      });
    }

    const isPrimaryOwner = isMasterAccount;

    let updateQuery = '';
    let params = [];

    // تحديد الدور (مع حماية حساب الأونر الرئيسي 1@1.com من تغيير دوره)
    let newRole = null;
    if (role && !isPrimaryOwner) {
      if (role.includes('Owner') || role.includes('أونر') || role.includes('المالك')) {
        newRole = 'المالك (Owner)';
      } else {
        newRole = 'سيلز (Sales)';
      }
    }

    const trimmedFullName = (typeof full_name === 'string' && full_name.trim()) ? full_name.trim() : null;
    const newIsActive = (!isPrimaryOwner && typeof is_active === 'boolean') ? is_active : null;

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password.trim(), salt);
      updateQuery = `
        UPDATE users 
        SET full_name = COALESCE($1, full_name), 
            role = COALESCE($2, role),
            is_active = COALESCE($3, is_active),
            password = $4 
        WHERE id = $5 
        RETURNING id, username, email, full_name, role, is_active
      `;
      params = [trimmedFullName, newRole, newIsActive, hashedPassword, userId];
    } else {
      updateQuery = `
        UPDATE users 
        SET full_name = COALESCE($1, full_name),
            role = COALESCE($2, role),
            is_active = COALESCE($3, is_active)
        WHERE id = $4 
        RETURNING id, username, email, full_name, role, is_active
      `;
      params = [trimmedFullName, newRole, newIsActive, userId];
    }

    const result = await pool.query(updateQuery, params);

    // تسجيل العملية في سجل النشاطات
    await logActivity({
      req,
      actionType: password ? 'تغيير كلمة المرور' : 'تعديل بيانات المستخدم',
      actionCategory: 'إدارة المستخدمين',
      targetType: result.rows[0].role.includes('Owner') ? 'أونر' : 'سيلز',
      targetName: result.rows[0].full_name,
      details: password 
        ? `تم تحديث كلمة المرور وبيانات (${result.rows[0].full_name})`
        : `تم تعديل بيانات (${result.rows[0].full_name})`
    });

    res.json({ success: true, user: result.rows[0], message: 'تم تحديث بيانات الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// حذف مستخدم (مع منع حذف الأونر وفك إسناد العملاء التابعين له)
app.delete('/api/users/:id', authMiddleware, requireOwner, async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم غير صحيح' });
  }

  try {
    const userRes = await pool.query('SELECT id, email, role, full_name FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const targetUser = userRes.rows[0];
    if (targetUser.id === 1) {
      return res.status(403).json({ success: false, message: 'لا يمكن حذف حساب الأونر / المدير العام الرئيسي للنظام' });
    }

    // فك إسناد أي عملاء كانوا مسندين لهذا الموظف مع الحفاظ على حالة الصفقات المتقدمة
    await pool.query(
      `UPDATE clients 
       SET assigned_sales_id = NULL, assigned_sales_name = NULL, 
           status = CASE WHEN status = 'تم الإسناد' THEN 'عميل جديد' ELSE status END 
       WHERE assigned_sales_id = $1`,
      [userId]
    );

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    const roleTitle = targetUser.role && targetUser.role.includes('Owner') ? 'أونر' : 'سيلز';

    // تسجيل العملية في سجل النشاطات
    await logActivity({
      req,
      actionType: `حذف حساب ${roleTitle}`,
      actionCategory: 'إدارة المستخدمين',
      targetType: roleTitle,
      targetName: targetUser.full_name,
      details: `تم حذف حساب ${roleTitle} (${targetUser.full_name}) وفك إسناد أي عملاء مرتبطين به`
    });

    res.json({ success: true, message: `تم حذف حساب (${targetUser.full_name}) بنجاح وتحويل أي عملاء مسندين له إلى غير مسندين` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// ==================== مسارات إدارة وتوزيع المبيعات للأونر ====================

// 1. جلب فريق السيلز مع إحصائية عدد العملاء المسندين لكل شخص (للأونر فقط)
app.get('/api/sales-reps', authMiddleware, requireOwner, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, 
        u.full_name, 
        u.email, 
        u.phone,
        u.role,
        COUNT(c.id) AS assigned_count
      FROM users u
      LEFT JOIN clients c ON c.assigned_sales_id = u.id
      WHERE (u.role LIKE '%سيلز%' OR u.role LIKE '%Sales%')
        AND (u.is_active IS NULL OR u.is_active = TRUE)
      GROUP BY u.id, u.full_name, u.email, u.phone, u.role
      ORDER BY u.id ASC
    `;
    const result = await pool.query(query);
    res.json({ success: true, salesReps: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 2. إضافة موظف سيلز جديد من قبل الأونر فقط
app.post('/api/sales-reps', authMiddleware, requireOwner, async (req, res) => {
  const { full_name, email, phone, password } = req.body;
  if (!full_name || !email) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال الاسم والبريد الإلكتروني' });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.trim().length < 6)) {
    return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  try {
    const existCheck = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً في النظام' });
    }

    const salt = await bcrypt.genSalt(12);
    const rawPassword = (password && typeof password === 'string' && password.trim().length >= 6)
      ? password.trim()
      : crypto.randomBytes(12).toString('hex');
    const hashedPassword = await bcrypt.hash(rawPassword, salt);
    const baseUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'sales';
    const username = `${baseUsername}_${Date.now().toString().slice(-4)}${Math.floor(100 + Math.random() * 900)}`;

    const query = `
      INSERT INTO users (username, email, password, full_name, phone, role)
      VALUES ($1, $2, $3, $4, $5, 'سيلز (Sales)')
      RETURNING id, full_name, email, phone, role
    `;
    const result = await pool.query(query, [username, cleanEmail, hashedPassword, full_name.trim(), phone || '']);

    await logActivity({
      req,
      actionType: 'إنشاء حساب سيلز',
      actionCategory: 'إدارة المستخدمين',
      targetType: 'سيلز',
      targetName: full_name.trim(),
      details: `تم إنشاء حساب سيلز جديد باسم (${full_name.trim()}) بالبريد: ${cleanEmail}`
    });

    res.status(201).json({ success: true, salesRep: result.rows[0], message: 'تمت إضافة مسؤول المبيعات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 3. جلب العملاء (للأونر كافة العملاء، وللسيلز عملاؤه المسندون إليه فقط)
app.get('/api/clients', authMiddleware, async (req, res) => {
  try {
    const isOwner = isUserOwner(req.user);
    let query;
    let params = [];

    if (isOwner) {
      query = `
        SELECT 
          c.id, 
          c.name, 
          c.company, 
          c.phone, 
          c.email, 
          c.project_interest,
          c.total_value, 
          c.status, 
          c.assigned_sales_id,
          COALESCE(u.full_name, c.assigned_sales_name, 'غير مسند') AS assigned_sales_name,
          c.created_by_id,
          c.created_by_name,
          c.notes,
          c.created_at,
          c.postponed_until,
          c.postpone_reason,
          c.is_reminder_resolved
        FROM clients c
        LEFT JOIN users u ON u.id = c.assigned_sales_id
        ORDER BY 
          CASE WHEN c.assigned_sales_id IS NULL THEN 0 ELSE 1 END ASC,
          c.id DESC
      `;
    } else {
      // موظف سيلز: يرى فقط العملاء المسندين إليه
      query = `
        SELECT 
          c.id, 
          c.name, 
          c.company, 
          c.phone, 
          c.email, 
          c.project_interest,
          c.total_value, 
          c.status, 
          c.assigned_sales_id,
          c.assigned_sales_name,
          c.created_by_id,
          c.created_by_name,
          c.notes,
          c.created_at,
          c.postponed_until,
          c.postpone_reason,
          c.is_reminder_resolved
        FROM clients c
        WHERE c.assigned_sales_id = $1
        ORDER BY c.id DESC
      `;
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, clients: result.rows, isOwner });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 4. إضافة عميل جديد (للأونر أو لموظف السيلز مع توثيق المنشئ)
app.post('/api/clients', authMiddleware, async (req, res) => {
  const { name, company, phone, email, project_interest, total_value, assigned_sales_id, notes } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال اسم العميل ورقم هاتفه' });
  }

  try {
    const isOwner = isUserOwner(req.user);
    let salesId = null;
    let salesName = null;
    let clientStatus = 'عميل جديد';
    let createdById = req.user ? req.user.id : null;
    let createdByName = req.user ? req.user.full_name : 'المدير العام';

    if (isOwner) {
      const parsedAssignedId = parsePositiveInt(assigned_sales_id);
      if (parsedAssignedId) {
        const salesQuery = await pool.query(
          'SELECT full_name FROM users WHERE id = $1 AND (is_active IS NULL OR is_active = TRUE)',
          [parsedAssignedId]
        );
        if (salesQuery.rows.length > 0) {
          salesId = parsedAssignedId;
          salesName = salesQuery.rows[0].full_name;
          clientStatus = 'قيد المتابعة';
        }
      }
    } else {
      // موظف سيلز يضيف عميل: يرتبط به تلقائياً وفوراً كعميل مسند إليه، مع ظهوره للأونر وموثقاً باسم السيلز
      salesId = req.user.id;
      salesName = req.user.full_name;
      clientStatus = 'قيد المتابعة';
      createdById = req.user.id;
      createdByName = req.user.full_name;
    }

    const query = `
      INSERT INTO clients (name, company, phone, email, project_interest, total_value, assigned_sales_id, assigned_sales_name, created_by_id, created_by_name, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const result = await pool.query(query, [
      name.trim(),
      company || '',
      phone.trim(),
      email || '',
      project_interest || 'مشروع وتطوير أعمال',
      Math.max(0, parseFloat(total_value) || 0),
      salesId,
      salesName,
      createdById,
      createdByName,
      notes || '',
      clientStatus
    ]);

    // تسجيل العملية في سجل الرقابة
    const detailsText = isOwner
      ? `تم تسجيل العميل (${name.trim()}) في المنظومة بمشروع (${project_interest || 'عام'})${salesName ? ' وإسناده فوراً إلى ' + salesName : ' (غير مسند)'}`
      : `قام مسؤول المبيعات (${req.user.full_name}) بإضافة العميل (${name.trim()}) وارتبط بحسابه تلقائياً لمتابعته`;

    await logActivity({
      req,
      actionType: 'إضافة عميل جديد',
      actionCategory: 'إدارة العملاء',
      targetType: 'عميل',
      targetName: name.trim(),
      details: detailsText
    });

    res.status(201).json({ 
      success: true, 
      client: result.rows[0], 
      message: isOwner ? 'تمت إضافة العميل بنجاح' : 'تمت إضافة العميل وإسناده لحسابك تلقائياً بنجاح للبدء في متابعته' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 4.1 إضافة مجموعة عملاء دفعة واحدة (إكسيل / نسخ ولصق) مع خيار التوزيع التلقائي (للأونر فقط)
app.post('/api/clients/bulk-create', authMiddleware, requireOwner, async (req, res) => {
  const { clients, auto_distribute } = req.body;

  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ success: false, message: 'لم يتم إرسال أي بيانات عملاء للإدراج' });
  }

  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');
    const insertedIds = [];

    for (const c of clients) {
      const name = (c.name || '').trim();
      const phone = (c.phone || '').trim();
      if (!name && !phone) continue; // تخطي الأسطر الفارغة

      const company = (c.company || '').trim();
      const email = (c.email || '').trim();
      const project_interest = (c.project_interest || 'مشروع وتطوير أعمال').trim();
      const total_value = Math.max(0, parseFloat(c.total_value) || 0);
      const notes = (c.notes || '').trim();

      const insertRes = await clientDb.query(
        `INSERT INTO clients (name, company, phone, email, project_interest, total_value, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'عميل جديد')
         RETURNING id`,
        [name || 'عميل بدون اسم', company, phone || '—', email, project_interest, total_value, notes]
      );
      insertedIds.push(insertRes.rows[0].id);
    }

    if (insertedIds.length === 0) {
      await clientDb.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'لم يتم العثور على بيانات صالحة في القائمة المدخلة' });
    }

    let distributedInfo = '';
    // في حال تفعيل خيار التوزيع التلقائي الفوري
    if (auto_distribute === true) {
      const salesQuery = await clientDb.query(
        "SELECT id, full_name FROM users WHERE (role LIKE '%سيلز%' OR role LIKE '%Sales%') AND (is_active IS NULL OR is_active = TRUE) ORDER BY id ASC"
      );
      const salesTeam = salesQuery.rows;

      if (salesTeam.length > 0) {
        for (let i = 0; i < insertedIds.length; i++) {
          const rep = salesTeam[i % salesTeam.length];
          await clientDb.query(
            "UPDATE clients SET assigned_sales_id = $1, assigned_sales_name = $2, status = 'تم الإسناد' WHERE id = $3",
            [rep.id, rep.full_name, insertedIds[i]]
          );
        }
        distributedInfo = ` وتم توزيعهم بالتساوي فوراً على ${salesTeam.length} من مسؤولي السيلز`;
      }
    }

    await clientDb.query('COMMIT');

    // تسجيل العملية في سجل الرقابة
    await logActivity({
      req,
      actionType: 'إدراج عملاء جماعي',
      actionCategory: 'إدارة العملاء',
      targetType: 'عملاء',
      targetName: `${insertedIds.length} عميل`,
      details: `تم إدراج ${insertedIds.length} عميل دفعة واحدة في المنظومة (Excel / نسخ ولصق)${distributedInfo}`
    });

    res.status(201).json({
      success: true,
      count: insertedIds.length,
      message: `تم إدراج ${insertedIds.length} عميل بنجاح في قاعدة البيانات PostgreSQL${distributedInfo}!`
    });
  } catch (err) {
    await clientDb.query('ROLLBACK');
    console.error('خطأ الإدراج الجماعي:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  } finally {
    clientDb.release();
  }
});

// 4.2 تعديل بيانات العميل الأساسية (للأونر فقط - متوافق مع كافة بيئات الاستضافة والسيرفرات السحابية)
const updateClientHandler = async (req, res) => {
  const clientId = parseInt(req.params.id || req.body.id || req.body.client_id, 10);
  const { name, company, phone, email, project_interest, total_value, notes } = req.body;

  if (isNaN(clientId)) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح أو مفقود' });
  }

  if (!name || !phone) {
    return res.status(400).json({ success: false, message: 'اسم العميل ورقم الهاتف مطلوبان' });
  }

  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const oldClient = checkClient.rows[0];

    const result = await pool.query(
      `UPDATE clients 
       SET name = $1, company = $2, phone = $3, email = $4, project_interest = $5, total_value = $6, notes = $7
       WHERE id = $8
       RETURNING *`,
      [
        name.trim(),
        company ? company.trim() : '',
        phone.trim(),
        email ? email.trim() : '',
        project_interest ? project_interest.trim() : 'مشروع وتطوير أعمال',
        Math.max(0, parseFloat(total_value) || 0),
        notes ? notes.trim() : '',
        clientId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'تعذر العثور على العميل لتحديثه' });
    }

    // تسجيل العملية في سجل الرقابة
    try {
      await logActivity({
        req,
        actionType: 'تعديل بيانات عميل',
        actionCategory: 'إدارة العملاء',
        targetType: 'عميل',
        targetName: name.trim(),
        details: `تم تحديث بيانات العميل (${oldClient.name} إلى ${name.trim()}) الهاتف: (${phone.trim()}) القيمة: (${total_value || 0} ج.م)`
      });
    } catch (logErr) {
      console.warn('تحذير في تسجيل النشاط:', logErr.message);
    }

    res.json({ success: true, client: result.rows[0], message: 'تم تحديث بيانات العميل بنجاح' });
  } catch (err) {
    console.error('خطأ تحديث العميل:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
};

// المسارات الثابتة أولاً (قبل الديناميكية لتجنب تعارض Express Router)
app.post('/api/clients/update-client', authMiddleware, requireOwner, updateClientHandler);

// المسارات الديناميكية بعدها
app.put('/api/clients/:id', authMiddleware, requireOwner, updateClientHandler);
app.post('/api/clients/:id/update', authMiddleware, requireOwner, updateClientHandler);
// ملاحظة: تم حذف app.post('/api/clients/:id') لتجنب التعارض مع delete-client وغيرها

// 4.3 حذف عميل نهائياً من المنظومة (للأونر فقط - متوافق مع كافة بيئات الاستضافة والسيرفرات السحابية)
const deleteClientHandler = async (req, res) => {
  const clientId = parseInt(req.params.id || req.body.id || req.body.client_id, 10);
  if (isNaN(clientId)) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح أو مفقود' });
  }

  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود أو تم حذفه مسبقاً' });
    }
    const client = checkClient.rows[0];

    await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);

    // تسجيل الحذف في سجل الرقابة
    try {
      await logActivity({
        req,
        actionType: 'حذف عميل',
        actionCategory: 'إدارة العملاء',
        targetType: 'عميل',
        targetName: client.name,
        details: `تم حذف العميل (${client.name}) ورقم هاتفه (${client.phone}) نهائياً من المنظومة بواسطة الإدارة`
      });
    } catch (logErr) {
      console.warn('تحذير في تسجيل النشاط:', logErr.message);
    }

    res.json({ success: true, message: `تم حذف العميل (${client.name}) بنجاح` });
  } catch (err) {
    console.error('خطأ حذف العميل:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
};

// المسار الثابت أولاً (قبل الديناميكي لتجنب تعارض Express Router)
app.post('/api/clients/delete-client', authMiddleware, requireOwner, deleteClientHandler);

// المسارات الديناميكية بعدها
app.delete('/api/clients/:id', authMiddleware, requireOwner, deleteClientHandler);
app.post('/api/clients/:id/delete', authMiddleware, requireOwner, deleteClientHandler);

// 5. إسناد عميل محدد إلى مسؤول سيلز معين (للأونر فقط)
app.put('/api/clients/:id/assign', authMiddleware, requireOwner, async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  if (isNaN(clientId)) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }
  const { sales_id } = req.body;

  try {
    let salesName = null;
    let newSalesId = null;

    if (sales_id && sales_id !== 'unassigned') {
      const parsedSalesId = parsePositiveInt(sales_id);
      if (!parsedSalesId) {
        return res.status(400).json({ success: false, message: 'معرف مسؤول المبيعات غير صحيح' });
      }
      const salesQuery = await pool.query(
        'SELECT id, full_name FROM users WHERE id = $1 AND (is_active IS NULL OR is_active = TRUE)',
        [parsedSalesId]
      );
      if (salesQuery.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'مسؤول المبيعات غير موجود أو معطل' });
      }
      newSalesId = salesQuery.rows[0].id;
      salesName = salesQuery.rows[0].full_name;
    }

    const query = `
      UPDATE clients 
      SET 
        assigned_sales_id = $1::int, 
        assigned_sales_name = $2,
        status = CASE 
          WHEN $1::int IS NULL THEN 'عميل جديد'
          WHEN status = 'عميل جديد' THEN 'تم الإسناد'
          ELSE status 
        END
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [newSalesId, salesName, clientId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }

    // تسجيل العملية في سجل الرقابة
    await logActivity({
      req,
      actionType: newSalesId ? 'إسناد عميل لسيلز' : 'إلغاء إسناد عميل',
      actionCategory: 'توزيع العملاء',
      targetType: 'عميل',
      targetName: result.rows[0].name,
      details: newSalesId 
        ? `تم إسناد العميل (${result.rows[0].name}) إلى مسؤول المبيعات (${salesName})`
        : `تم إلغاء إسناد العميل (${result.rows[0].name}) وإعادته إلى قائمة غير المسندين`
    });

    res.json({
      success: true,
      message: newSalesId ? `تم إسناد العميل إلى ${salesName}` : 'تم إلغاء إسناد العميل',
      client: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 6. التوزيع التلقائي الذكي والعادل (Round-Robin Auto Distribution) (للأونر فقط - مع المعاملات المجمعة Transaction)
app.post('/api/clients/auto-distribute', authMiddleware, requireOwner, async (req, res) => {
  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');

    // جلب فريق السيلز النشطين
    const salesResult = await clientDb.query(
      "SELECT id, full_name FROM users WHERE (role LIKE '%سيلز%' OR role LIKE '%Sales%') AND (is_active IS NULL OR is_active = TRUE) ORDER BY id ASC"
    );
    const salesTeam = salesResult.rows;

    if (salesTeam.length === 0) {
      await clientDb.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'لا يوجد موظفي سيلز مسجلين في النظام للتوزيع عليهم' });
    }

    // جلب العملاء غير المسندين مع القفل لضمان سلامة التوزيع التزامني
    const unassignedResult = await clientDb.query("SELECT id FROM clients WHERE assigned_sales_id IS NULL ORDER BY id ASC FOR UPDATE");
    const unassignedClients = unassignedResult.rows;

    if (unassignedClients.length === 0) {
      await clientDb.query('ROLLBACK');
      return res.json({ success: true, message: 'جميع العملاء موزعون بالفعل، لا يوجد عملاء غير مسندين حالياً', distributedCount: 0 });
    }

    // تجميع المعرفات لكل موظف سيلز لتقليل الاستعلامات وحل مشكلة N+1
    const repAssignments = new Map();
    salesTeam.forEach(rep => repAssignments.set(rep.id, { rep, ids: [] }));

    for (let i = 0; i < unassignedClients.length; i++) {
      const rep = salesTeam[i % salesTeam.length];
      repAssignments.get(rep.id).ids.push(unassignedClients[i].id);
    }

    let distributedCount = 0;
    for (const [repId, { rep, ids }] of repAssignments.entries()) {
      if (ids.length > 0) {
        await clientDb.query(
          "UPDATE clients SET assigned_sales_id = $1, assigned_sales_name = $2, status = 'تم الإسناد' WHERE id = ANY($3::int[])",
          [rep.id, rep.full_name, ids]
        );
        distributedCount += ids.length;
      }
    }

    await clientDb.query('COMMIT');

    // تسجيل العملية في سجل الرقابة
    await logActivity({
      req,
      actionType: 'توزيع بالتساوي (Round-Robin)',
      actionCategory: 'توزيع العملاء',
      targetType: 'فريق السيلز',
      targetName: `${salesTeam.length} سيلز`,
      details: `تم توزيع ${distributedCount} عميل بالتساوي التلقائي (Round-Robin) على ${salesTeam.length} من مسؤولي السيلز (${salesTeam.map(s => s.full_name).join('، ')})`
    });

    res.json({
      success: true,
      message: `تم توزيع ${distributedCount} عميل بالتساوي على ${salesTeam.length} من مسؤولي السيلز بنجاح!`,
      distributedCount
    });
  } catch (err) {
    await clientDb.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  } finally {
    clientDb.release();
  }
});

// 6.1 التوزيع المخصص بحصص وأعداد محددة لكل سيلز (Custom Quota Distribution) (للأونر فقط)
app.post('/api/clients/custom-quota-distribute', authMiddleware, requireOwner, async (req, res) => {
  const { quotas } = req.body; // مصفوفة [{ sales_id, count }]

  if (!Array.isArray(quotas) || quotas.length === 0) {
    return res.status(400).json({ success: false, message: 'يرجى تحديد حصص العملاء لكل موظف' });
  }

  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');

    // جلب العملاء غير المسندين مع قفل السجلات للتحديث الآمن
    const unassignedRes = await clientDb.query(
      "SELECT id FROM clients WHERE assigned_sales_id IS NULL ORDER BY id ASC FOR UPDATE"
    );
    const unassignedClients = unassignedRes.rows;

    if (unassignedClients.length === 0) {
      await clientDb.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'لا يوجد عملاء غير مسندين في المنظومة حالياً لتوزيعهم' });
    }

    let clientIndex = 0;
    let totalDistributed = 0;
    const summaryList = [];

    for (const q of quotas) {
      const salesId = parseInt(q.sales_id, 10);
      const requestedCount = parseInt(q.count, 10) || 0;

      if (!salesId || requestedCount <= 0) continue;
      if (clientIndex >= unassignedClients.length) break;

      // جلب اسم موظف السيلز النشط
      const salesQuery = await clientDb.query(
        "SELECT full_name FROM users WHERE id = $1 AND (role LIKE '%سيلز%' OR role LIKE '%Sales%') AND (is_active IS NULL OR is_active = TRUE)",
        [salesId]
      );
      if (salesQuery.rows.length === 0) continue;
      const salesName = salesQuery.rows[0].full_name;

      const clientsToAssign = [];
      for (let i = 0; i < requestedCount && clientIndex < unassignedClients.length; i++) {
        clientsToAssign.push(unassignedClients[clientIndex].id);
        clientIndex++;
      }

      if (clientsToAssign.length > 0) {
        await clientDb.query(
          `UPDATE clients 
           SET assigned_sales_id = $1, assigned_sales_name = $2, 
               status = CASE WHEN status = 'عميل جديد' THEN 'تم الإسناد' ELSE status END
           WHERE id = ANY($3::int[])`,
          [salesId, salesName, clientsToAssign]
        );
        totalDistributed += clientsToAssign.length;
        summaryList.push(`${salesName} (${clientsToAssign.length})`);
      }
    }

    if (totalDistributed === 0) {
      await clientDb.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'لم يتم تحديد أي أعداد صالحة للتوزيع (الأعداد المدخلة 0)' });
    }

    await clientDb.query('COMMIT');

    const remaining = unassignedClients.length - totalDistributed;
    const remainingText = remaining > 0 ? ` (المتبقي غير موزع: ${remaining} عميل)` : ' (تم توزيع كافة العملاء بالكامل)';

    // تسجيل العملية في سجل الرقابة
    await logActivity({
      req,
      actionType: 'توزيع مخصص بالحصص',
      actionCategory: 'توزيع العملاء',
      targetType: 'حصص السيلز',
      targetName: `${totalDistributed} عميل`,
      details: `تم تطبيق توزيع مخصص بالحصص لـ ${totalDistributed} عميل: ${summaryList.join(' • ')}${remainingText}`
    });

    res.json({
      success: true,
      totalDistributed,
      message: `تم التوزيع المخصص بنجاح (${totalDistributed} عميل): ${summaryList.join(' &bull; ')}${remainingText}`
    });
  } catch (err) {
    await clientDb.query('ROLLBACK');
    console.error('خطأ التوزيع المخصص:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  } finally {
    clientDb.release();
  }
});

// 7. إسناد جماعي لمجموعة عملاء دفعة واحدة (Bulk Assignment) (للأونر فقط)
app.post('/api/clients/bulk-assign', authMiddleware, requireOwner, async (req, res) => {
  const { client_ids, sales_id } = req.body;
  const parsedSalesId = parsePositiveInt(sales_id);
  const validClientIds = Array.isArray(client_ids) ? client_ids.map(parsePositiveInt).filter(Boolean) : [];
  if (validClientIds.length === 0 || !parsedSalesId) {
    return res.status(400).json({ success: false, message: 'يرجى تحديد العملاء ومسؤول السيلز بشكل صحيح' });
  }

  try {
    const salesQuery = await pool.query('SELECT full_name FROM users WHERE id = $1', [parsedSalesId]);
    if (salesQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'مسؤول المبيعات غير موجود' });
    }
    const salesName = salesQuery.rows[0].full_name;

    await pool.query(
      `UPDATE clients 
       SET assigned_sales_id = $1, assigned_sales_name = $2, 
           status = CASE WHEN status = 'عميل جديد' THEN 'تم الإسناد' ELSE status END
       WHERE id = ANY($3::int[])`,
      [parsedSalesId, salesName, validClientIds]
    );

    // تسجيل العملية في سجل الرقابة
    await logActivity({
      req,
      actionType: 'إسناد جماعي للعملاء',
      actionCategory: 'توزيع العملاء',
      targetType: 'عملاء',
      targetName: `${validClientIds.length} عميل`,
      details: `تم إسناد مجموعة من ${validClientIds.length} عملاء دفعة واحدة إلى مسؤول المبيعات (${salesName})`
    });

    res.json({
      success: true,
      message: `تم إسناد ${validClientIds.length} عملاء إلى ${salesName} بنجاح!`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8. تحديث حالة العميل (للأونر أو مسؤول السيلز المسند إليه العميل)
app.put('/api/clients/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const clientId = parsePositiveInt(req.params.id);
  if (!clientId) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }
  if (!status || !ALLOWED_CLIENT_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'حالة العميل غير صالحة' });
  }

  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = checkClient.rows[0];

    // التحقق من الملكية: إذا كان المستخدم سيلز، التأكد من أن العميل مسند إليه
    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    let updateQuery = `UPDATE clients SET status = $1`;
    if (status !== 'مؤجل') {
      updateQuery += `, is_reminder_resolved = true`;
    }
    updateQuery += ` WHERE id = $2 RETURNING *`;

    const result = await pool.query(updateQuery, [status, clientId]);

    // تسجيل العملية بدقة وتفصيل في سجل الرقابة
    let actionType = 'تحديث حالة العميل';
    let actionDetails = `قام (${req.user.full_name || 'مسؤول السيلز'}) بتحديث حالة العميل (${client.name}) إلى [${status}]`;
    const dealFormatted = (client.total_value && Number(client.total_value) > 0) ? ` بقيمة تعاقدية ${Number(client.total_value).toLocaleString('ar-EG')} ج.م` : '';
    const projectFormatted = client.project_interest ? ` - لمشروع (${client.project_interest})` : '';

    if (status === 'تم التعاقد') {
      actionType = 'إبرام تعاقد ونجاح الصفقة';
      actionDetails = `🏆 قام (${req.user.full_name || 'مسؤول السيلز'}) بإبرام التعاقد بنجاح مع العميل (${client.name})${dealFormatted}${projectFormatted}`;
    } else if (status === 'ملغي') {
      actionType = 'إلغاء الصفقة / غير مهتم';
      actionDetails = `🚫 قام (${req.user.full_name || 'مسؤول السيلز'}) بنقل صفقة العميل (${client.name}) إلى ملغي / غير مهتم${projectFormatted}`;
    } else if (status === 'قيد المتابعة') {
      actionType = 'نقل لقيد المتابعة والتفاوض';
      actionDetails = `🤝 قام (${req.user.full_name || 'مسؤول السيلز'}) ببدء التفاوض والمتابعة مع العميل (${client.name})${dealFormatted}${projectFormatted}`;
    } else if (status === 'عميل جديد' || status === 'جديد') {
      actionType = 'إعادة لعميل جديد / إسناد';
      actionDetails = `🎯 قام (${req.user.full_name || 'مسؤول السيلز'}) بإعادة العميل (${client.name}) إلى مرحلة عميل جديد / إسناد`;
    }

    await logActivity({
      req,
      actionType,
      actionCategory: 'متابعة السيلز',
      targetType: 'عميل',
      targetName: client.name,
      details: actionDetails
    });

    res.json({ success: true, client: result.rows[0], message: 'تم تحديث حالة العميل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.2 جدولة تأجيل وتحديد موعد متابعة قادمة للعميل مع تفعيل التنبيه
app.put('/api/clients/:id/postpone', authMiddleware, async (req, res) => {
  const { postponed_until, postpone_reason } = req.body;
  const clientId = parsePositiveInt(req.params.id);
  if (!clientId) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }
  if (postponed_until && isNaN(Date.parse(postponed_until))) {
    return res.status(400).json({ success: false, message: 'تاريخ التأجيل غير صالح' });
  }

  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = checkClient.rows[0];

    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    const result = await pool.query(
      `UPDATE clients 
       SET status = 'مؤجل', 
           postponed_until = $1, 
           postpone_reason = $2, 
           is_reminder_resolved = false 
       WHERE id = $3 RETURNING *`,
      [postponed_until || null, postpone_reason || '', clientId]
    );

    const formattedTime = postponed_until ? new Date(postponed_until).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' }) : 'بدون موعد محدد';
    const dealFormatted = (client.total_value && Number(client.total_value) > 0) ? ` بقيمة ${Number(client.total_value).toLocaleString('ar-EG')} ج.م` : '';

    await logActivity({
      req,
      actionType: 'تأجيل وجدولة متابعة',
      actionCategory: 'متابعة السيلز',
      targetType: 'عميل',
      targetName: client.name,
      details: `⏳ قام (${req.user.full_name || 'مسؤول السيلز'}) بتأجيل متابعة العميل (${client.name})${dealFormatted} إلى [${formattedTime}] - سبب التأجيل: ${postpone_reason || 'غير محدد'}`
    });

    res.json({ success: true, client: result.rows[0], message: 'تمت جدولة موعد المتابعة وتفعيل التنبيه بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.3 جلب تنبيهات المتابعات المؤجلة المستحقة لمسؤول السيلز (أو الأونر)
app.get('/api/sales-portal/reminders', authMiddleware, async (req, res) => {
  try {
    let query = `
      SELECT 
        id, 
        name, 
        company, 
        phone, 
        project_interest, 
        total_value, 
        status, 
        notes, 
        postponed_until, 
        postpone_reason,
        CASE WHEN postponed_until <= NOW() THEN true ELSE false END AS is_due
      FROM clients
      WHERE status = 'مؤجل' AND postponed_until IS NOT NULL AND is_reminder_resolved = false
    `;
    const params = [];
    if (!isUserOwner(req.user)) {
      query += ` AND assigned_sales_id = $1`;
      params.push(req.user.id);
    }
    query += ` ORDER BY is_due DESC, postponed_until ASC`;

    const result = await pool.query(query, params);
    const reminders = result.rows;
    const dueCount = reminders.filter(r => r.is_due).length;
    res.json({ success: true, reminders, due_count: dueCount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.4 تمييز التنبيه كمكتمل أو تم التواصل ونقل الصفقة إلى قيد المتابعة
app.put('/api/clients/:id/resolve-reminder', authMiddleware, async (req, res) => {
  const clientId = parsePositiveInt(req.params.id);
  if (!clientId) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }
  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = checkClient.rows[0];

    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    const result = await pool.query(
      `UPDATE clients 
       SET status = 'قيد المتابعة', 
           is_reminder_resolved = true 
       WHERE id = $1 RETURNING *`, 
      [clientId]
    );

    // تسجيل العملية في سجل الرقابة والنشاط
    await logActivity({
      req,
      actionType: 'تأكيد التواصل ومتابعة',
      actionCategory: 'متابعة السيلز',
      targetType: 'عميل',
      targetName: client.name,
      details: `قام (${req.user.full_name || 'مسؤول السيلز'}) بتأكيد التواصل مع العميل (${client.name}) ونقل الصفقة إلى [قيد المتابعة]`
    });

    res.json({ success: true, client: result.rows[0], message: 'تم استيفاء التنبيه ونقل الصفقة إلى قيد المتابعة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.1 تحديث ملاحظات ومتابعة العميل من قبل مسؤول السيلز أو الأونر
app.put('/api/clients/:id/notes', authMiddleware, async (req, res) => {
  const { notes } = req.body;
  const clientId = parsePositiveInt(req.params.id);
  if (!clientId) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }

  try {
    const checkClient = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (checkClient.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = checkClient.rows[0];

    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    const result = await pool.query('UPDATE clients SET notes = $1 WHERE id = $2 RETURNING *', [notes || '', clientId]);

    await logActivity({
      req,
      actionType: 'تحديث ملاحظات العميل',
      actionCategory: 'متابعة السيلز',
      targetType: 'عميل',
      targetName: client.name,
      details: `قام (${req.user.full_name || 'مسؤول السيلز'}) بتسجيل ملاحظات ومتابعة للعميل (${client.name})`
    });

    res.json({ success: true, client: result.rows[0], message: 'تم حفظ الملاحظات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.5 جلب سجل المتابعات التفاعلية الزمني للعميل (Client Interaction Timeline)
app.get('/api/clients/:id/activities', authMiddleware, async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  if (isNaN(clientId)) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }

  try {
    const clientRes = await pool.query('SELECT id, name, phone, company, status, assigned_sales_id, assigned_sales_name FROM clients WHERE id = $1', [clientId]);
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = clientRes.rows[0];

    // التحقق من الصلاحيات: الأونر يرى كافة العملاء، والسيلز يرى عملاءه فقط
    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    const activitiesRes = await pool.query(`
      SELECT 
        a.id, 
        a.client_id, 
        a.user_id, 
        a.user_name, 
        a.user_role, 
        a.activity_type, 
        a.outcome, 
        a.details, 
        a.created_at
      FROM client_activities a
      WHERE a.client_id = $1
      ORDER BY a.created_at DESC, a.id DESC
    `, [clientId]);

    res.json({
      success: true,
      client,
      activities: activitiesRes.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.6 إضافة متابعة تفاعلية جديدة في السجل الزمني للعميل
app.post('/api/clients/:id/activities', authMiddleware, async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const { activity_type, outcome, details, update_client_status } = req.body;

  if (isNaN(clientId)) {
    return res.status(400).json({ success: false, message: 'معرف العميل غير صحيح' });
  }

  if (!details || details.trim() === '') {
    return res.status(400).json({ success: false, message: 'يرجى كتابة تفاصيل وملاحظات المتابعة' });
  }

  const validTypes = ['call', 'whatsapp', 'meeting', 'quotation', 'note'];
  const type = validTypes.includes(activity_type) ? activity_type : 'note';

  try {
    const clientRes = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    const client = clientRes.rows[0];

    if (!isUserOwner(req.user) && client.assigned_sales_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'عذراً، هذا العميل غير مسند لحسابك' });
    }

    const userName = req.user.full_name || req.user.fullName || (isUserOwner(req.user) ? 'المدير العام' : 'مسؤول السيلز');
    const userRole = req.user.role || 'سيلز (Sales)';

    // إدراج المتابعة في الجدول
    const insertRes = await pool.query(`
      INSERT INTO client_activities (client_id, user_id, user_name, user_role, activity_type, outcome, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, client_id, user_id, user_name, user_role, activity_type, outcome, details, created_at
    `, [clientId, req.user.id, userName, userRole, type, outcome || '', details.trim()]);

    const newActivity = insertRes.rows[0];

    // تحديث حالة العميل إذا تم تمريرها بشكل صالح أو نقله تلقائياً لقيد المتابعة إن كان جديداً
    let newStatus = client.status;
    if (update_client_status && update_client_status !== client.status) {
      if (!ALLOWED_CLIENT_STATUSES.includes(update_client_status)) {
        return res.status(400).json({ success: false, message: 'حالة العميل المطلوبة غير صالحة' });
      }
      await pool.query('UPDATE clients SET status = $1 WHERE id = $2', [update_client_status, clientId]);
      newStatus = update_client_status;
    } else if (client.status === 'عميل جديد' || client.status === 'تم الإسناد') {
      await pool.query("UPDATE clients SET status = 'قيد المتابعة' WHERE id = $1", [clientId]);
      newStatus = 'قيد المتابعة';
    }

    const typeLabel = {
      call: 'مكالمة هاتفية 📞',
      whatsapp: 'مراسلة واتساب 💬',
      meeting: 'اجتماع / زيارة 🤝',
      quotation: 'عرض سعر 📄',
      note: 'ملاحظة متابعة 📝'
    }[type] || 'متابعة';

    await logActivity({
      req,
      actionType: `تسجيل ${typeLabel}`,
      actionCategory: 'متابعة السيلز',
      targetType: 'عميل',
      targetName: client.name,
      details: `قام (${userName}) بتسجيل [${typeLabel}] مع العميل (${client.name}): "${details.trim()}" ${outcome ? `(النتيجة: ${outcome})` : ''}`
    });

    res.status(201).json({
      success: true,
      message: 'تم تسجيل المتابعة في السجل الزمني بنجاح 👍',
      activity: newActivity,
      updatedStatus: newStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 8.2 إحصائيات ولوحة تقييم أداء مسؤول السيلز
app.get('/api/sales-portal/stats', authMiddleware, async (req, res) => {
  try {
    let userId = req.user.id;
    // تمكين الأونر من تمرير sales_id لجلب تقييم ومؤشرات أي موظف سيلز يختاره
    if (isUserOwner(req.user) && req.query.sales_id) {
      const requestedId = parsePositiveInt(req.query.sales_id);
      if (!requestedId) {
        return res.status(400).json({ success: false, message: 'معرف مسؤول السيلز غير صحيح' });
      }
      userId = requestedId;
    }

    const [totalRes, statusRes, valuesRes, salesUserRes] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM clients WHERE assigned_sales_id = $1', [userId]),
      pool.query('SELECT status, COUNT(*) AS count FROM clients WHERE assigned_sales_id = $1 GROUP BY status', [userId]),
      pool.query(`
        SELECT 
          COALESCE(SUM(total_value), 0) AS total_val, 
          COALESCE(SUM(CASE WHEN status = 'تم التعاقد' THEN total_value ELSE 0 END), 0) AS closed_val 
        FROM clients 
        WHERE assigned_sales_id = $1
      `, [userId]),
      pool.query('SELECT id, full_name, email, phone, role FROM users WHERE id = $1', [userId])
    ]);

    const statusBreakdown = {};
    statusRes.rows.forEach(r => { statusBreakdown[r.status] = parseInt(r.count, 10); });

    const totalClients = parseInt(totalRes.rows[0].total, 10);
    const contracted = statusBreakdown['تم التعاقد'] || 0;
    const inProgress = statusBreakdown['قيد المتابعة'] || 0;
    const delayed = statusBreakdown['مؤجل'] || 0;
    const cancelled = statusBreakdown['ملغي'] || 0;
    const conversionRate = totalClients > 0 ? Math.round((contracted / totalClients) * 100) : 0;

    // حساب تقييم الأداء المئوي
    let performanceScore = 80;
    if (totalClients > 0) {
      const winFactor = Math.min(50, Math.round((contracted / totalClients) * 100));
      const activityFactor = Math.min(30, inProgress * 10 + delayed * 5);
      const disciplineFactor = cancelled > 0 ? 10 : 20;
      performanceScore = Math.min(100, Math.max(40, winFactor + activityFactor + disciplineFactor));
    }

    let ratingLabel = 'ممتاز 🌟';
    let ratingClass = 'rating-excellent';
    if (performanceScore < 60) {
      ratingLabel = 'بحاجة لتحفيز ومتابعة ⚠️';
      ratingClass = 'rating-needs-work';
    } else if (performanceScore < 75) {
      ratingLabel = 'نشط وجاري المتابعة 📈';
      ratingClass = 'rating-good';
    } else if (performanceScore < 90) {
      ratingLabel = 'جيد جداً وفعال ⚡';
      ratingClass = 'rating-very-good';
    }

    res.json({
      success: true,
      salesUser: salesUserRes.rows[0] || null,
      stats: {
        totalClients,
        newClients: (statusBreakdown['عميل جديد'] || 0) + (statusBreakdown['تم الإسناد'] || 0),
        inProgress,
        contracted,
        delayed,
        cancelled,
        totalDealsValue: parseFloat(valuesRes.rows[0].total_val) || 0,
        closedDealsValue: parseFloat(valuesRes.rows[0].closed_val) || 0,
        conversionRate,
        performanceScore,
        ratingLabel,
        ratingClass
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});





// 10. جلب سجل النشاطات والعمليات الرقابية الكاملة (للأونر فقط)
app.get('/api/audit-logs', authMiddleware, requireOwner, async (req, res) => {
  try {
    const { action_type, search, limit, user_id, user_name, period, sales_only } = req.query;
    let query = `
      SELECT id, user_id, user_name, user_email, user_role, action_type, action_category, target_type, target_name, details, ip_address, created_at
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];

    // حصر السجل في نشاط مسؤولي السيلز فقط واستبعاد الأونر
    if (sales_only !== 'false') {
      query += ` AND (user_email != '1@1.com' OR user_email IS NULL) AND (user_role NOT LIKE '%Owner%' AND user_role NOT LIKE '%المالك%')`;
    }

    if (period === 'today') {
      query += ` AND created_at >= CURRENT_DATE`;
    } else if (period === 'monthly' || period === 'month') {
      query += ` AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    }

    if (action_type && action_type !== 'all') {
      params.push(action_type);
      query += ` AND action_type = $${params.length}`;
    }

    if (user_id && user_id !== 'all') {
      const parsedUserId = parsePositiveInt(user_id);
      if (parsedUserId) {
        params.push(parsedUserId);
        query += ` AND user_id = $${params.length}`;
      }
    }

    if (user_name && user_name.trim() !== '' && user_name !== 'all') {
      params.push(`%${user_name.trim().toLowerCase()}%`);
      query += ` AND (LOWER(user_name) LIKE $${params.length} OR LOWER(target_name) LIKE $${params.length} OR LOWER(details) LIKE $${params.length})`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(details) LIKE $${params.length} OR LOWER(user_name) LIKE $${params.length} OR LOWER(target_name) LIKE $${params.length} OR LOWER(action_type) LIKE $${params.length})`;
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 1000);
    params.push(parsedLimit);
    query += ` ORDER BY id DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    // إحصائيات سريعة خاصة بنشاط السيلز فقط
    const [totalRes, todayRes, monthRes, contractedRes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE (user_email != '1@1.com' OR user_email IS NULL) AND (user_role NOT LIKE '%Owner%' AND user_role NOT LIKE '%المالك%')"),
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE (user_email != '1@1.com' OR user_email IS NULL) AND (user_role NOT LIKE '%Owner%' AND user_role NOT LIKE '%المالك%') AND created_at >= CURRENT_DATE"),
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE (user_email != '1@1.com' OR user_email IS NULL) AND (user_role NOT LIKE '%Owner%' AND user_role NOT LIKE '%المالك%') AND created_at >= DATE_TRUNC('month', CURRENT_DATE)"),
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE (user_email != '1@1.com' OR user_email IS NULL) AND (user_role NOT LIKE '%Owner%' AND user_role NOT LIKE '%المالك%') AND (action_type LIKE '%تعاقد%' OR details LIKE '%تعاقد%')")
    ]);

    res.json({
      success: true,
      logs: result.rows,
      stats: {
        totalLogs: parseInt(totalRes.rows[0].count, 10),
        todayLogs: parseInt(todayRes.rows[0].count, 10),
        monthLogs: parseInt(monthRes.rows[0].count, 10),
        contractedEvents: parseInt(contractedRes.rows[0].count, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// ==================== 9. مسارات إدارة المشروعات (Projects API) ====================

// 9.1 جلب المشروعات حسب الفئة (تجاري، سكني، أراضي) مع الإحصائيات
app.get('/api/projects', authMiddleware, async (req, res) => {
  try {
    let category = req.query.category || 'all';
    if (category === 'تجاري') category = 'commercial';
    else if (category === 'سكني') category = 'residential';
    else if (category === 'أراضي' || category === 'اراضي') category = 'lands';

    const status = req.query.status;
    const search = req.query.search;

    let query = 'SELECT * FROM projects';
    const params = [];
    const conditions = [];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(location) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(project_type) LIKE $${params.length} OR LOWER(status) LIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY id DESC';

    let statsQuery = `
      SELECT 
        COUNT(id) AS total,
        COUNT(CASE WHEN category = 'commercial' THEN 1 END) AS commercial_count,
        COUNT(CASE WHEN category = 'residential' THEN 1 END) AS residential_count,
        COUNT(CASE WHEN category = 'lands' THEN 1 END) AS lands_count,
        COALESCE(SUM(area_sqm), 0) AS total_area
      FROM projects
    `;
    const statsParams = [];
    if (category && category !== 'all') {
      statsQuery += ' WHERE category = $1';
      statsParams.push(category);
    }

    const [projectsRes, statsRes] = await Promise.all([
      pool.query(query, params),
      pool.query(statsQuery, statsParams)
    ]);

    const statsRow = statsRes.rows[0] || {};

    res.json({
      success: true,
      category,
      projects: projectsRes.rows,
      stats: {
        total: parseInt(statsRow.total, 10) || 0,
        commercial: parseInt(statsRow.commercial_count, 10) || 0,
        residential: parseInt(statsRow.residential_count, 10) || 0,
        lands: parseInt(statsRow.lands_count, 10) || 0,
        totalArea: parseFloat(statsRow.total_area) || 0
      }
    });
  } catch (err) {
    console.error('خطأ جلب المشروعات:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.1.5 جلب تفاصيل مشروع واحد بالمعرف
app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صالح' });
  }
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    console.error('خطأ جلب تفاصيل المشروع:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

const MAX_SINGLE_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB حد أقصى للصورة الواحدة
const MAX_IMAGES_PER_REQUEST = 15; // حد أقصى لعدد الصور في الطلب الواحد

// دالة عامة لحفظ الصور المرفوعة (مشروعات أو وحدات) على القرص بشكل غير متزامن
async function saveUploadedImagesToDisk(imagesArray, folderName, filePrefix) {
  if (!Array.isArray(imagesArray) || imagesArray.length === 0) return [];

  const limitedImages = imagesArray.slice(0, MAX_IMAGES_PER_REQUEST);
  const uploadDir = path.join(__dirname, 'public', 'uploads', folderName);
  await fs.promises.mkdir(uploadDir, { recursive: true });

  const savedUrls = [];
  const timestamp = Date.now();

  for (let idx = 0; idx < limitedImages.length; idx++) {
    const dataUrl = limitedImages[idx];
    if (typeof dataUrl !== 'string') continue;
    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (!match) continue;

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_SINGLE_IMAGE_BYTES) continue;

    const filename = `${filePrefix}_${timestamp}_${idx}.${ext}`;
    const filePath = path.join(uploadDir, filename);

    await fs.promises.writeFile(filePath, buffer);
    savedUrls.push(`/uploads/${folderName}/${filename}`);
  }

  return savedUrls;
}

// دالة عامة لحذف الصور المرتبطة من القرص بشكل غير متزامن
async function deleteUploadedImagesFromDisk(imagesJson, expectedPrefix) {
  let imagesToDelete = [];
  try {
    imagesToDelete = JSON.parse(imagesJson || '[]');
  } catch (_) {}

  if (!Array.isArray(imagesToDelete)) return;
  for (const imgUrl of imagesToDelete) {
    if (typeof imgUrl === 'string' && imgUrl.startsWith(expectedPrefix)) {
      const fullPath = path.join(__dirname, 'public', imgUrl);
      try {
        await fs.promises.unlink(fullPath);
      } catch (_) {}
    }
  }
}

// دالة عامة لدمج الصور القديمة المحتفظ بها مع الصور الجديدة وحذف المحذوفة من القرص
async function mergeAndSaveImages(existingImages, newBase64Images, oldImagesJson, folderName, filePrefix, urlPrefix) {
  let oldUrls = [];
  try {
    oldUrls = JSON.parse(oldImagesJson || '[]');
  } catch (_) {}
  if (!Array.isArray(oldUrls)) oldUrls = [];

  const keptUrls = Array.isArray(existingImages)
    ? existingImages.filter(u => typeof u === 'string' && oldUrls.includes(u))
    : oldUrls;

  // حذف الصور التي أزالها المستخدم من القرص
  for (const oldUrl of oldUrls) {
    if (!keptUrls.includes(oldUrl) && typeof oldUrl === 'string' && oldUrl.startsWith(urlPrefix)) {
      const fullPath = path.join(__dirname, 'public', oldUrl);
      try {
        await fs.promises.unlink(fullPath);
      } catch (_) {}
    }
  }

  const newUrls = await saveUploadedImagesToDisk(newBase64Images, folderName, filePrefix);
  return [...keptUrls, ...newUrls];
}

// 9.2 إضافة مشروع جديد (للأونر فقط)
app.post('/api/projects', authMiddleware, requireOwner, async (req, res) => {
  let {
    category = 'commercial',
    name,
    area_sqm = 0,
    location = '',
    description = '',
    images = []
  } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: 'يرجى كتابة اسم المشروع' });
  }

  // ضبط التصنيف تلقائياً
  let normalizedCategory = (category || 'commercial').trim().toLowerCase();
  if (normalizedCategory === 'تجاري') normalizedCategory = 'commercial';
  else if (normalizedCategory === 'سكني') normalizedCategory = 'residential';
  else if (normalizedCategory === 'أراضي' || normalizedCategory === 'اراضي') normalizedCategory = 'lands';

  if (!['commercial', 'residential', 'lands'].includes(normalizedCategory)) {
    normalizedCategory = 'commercial';
  }

  const area = Math.max(0, parseFloat(area_sqm) || 0);

  try {
    const query = `
      INSERT INTO projects (
        category, name, area_sqm, location, description, project_type, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const defaultType = normalizedCategory === 'commercial' ? 'تجاري' : (normalizedCategory === 'residential' ? 'سكني' : 'أراضي');
    const result = await pool.query(query, [
      normalizedCategory,
      name.trim(),
      area,
      location ? location.trim() : '',
      description ? description.trim() : '',
      defaultType,
      'متاح'
    ]);

    let projectRow = result.rows[0];

    // حفظ الصور المرفوعة إن وُجدت
    const savedUrls = await saveUploadedImagesToDisk(images, 'projects', `proj_${projectRow.id}`);
    if (savedUrls.length > 0) {
      const updateRes = await pool.query(
        'UPDATE projects SET image_url = $1, images_json = $2 WHERE id = $3 RETURNING *',
        [savedUrls[0], JSON.stringify(savedUrls), projectRow.id]
      );
      projectRow = updateRes.rows[0];
    }

    await logActivity({
      req,
      actionType: 'إضافة مشروع جديد',
      actionCategory: 'إدارة المشروعات',
      targetType: 'مشروع',
      targetName: name.trim(),
      details: `تمت إضافة مشروع جديد (${name.trim()}) في تصنيف (${normalizedCategory}) بمساحة (${area} م²)${savedUrls.length ? ` مع ${savedUrls.length} صور` : ''}`
    });

    res.status(201).json({
      success: true,
      project: projectRow,
      message: 'تمت إضافة المشروع بنجاح'
    });
  } catch (err) {
    console.error('خطأ إضافة مشروع:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.3 تعديل بيانات مشروع (للأونر فقط)
app.put('/api/projects/:id', authMiddleware, requireOwner, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صحيح' });
  }

  const {
    category,
    name,
    area_sqm,
    location,
    project_type,
    meter_price,
    starting_price,
    down_payment_pct,
    installment_years,
    delivery_date,
    units_available,
    units_total,
    status,
    image_url,
    brochure_url,
    location_url,
    description,
    existing_images,
    images
  } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: 'يرجى كتابة اسم المشروع' });
  }

  try {
    const existingRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    const current = existingRes.rows[0];

    let normalizedCategory = (category || current.category || 'commercial').trim().toLowerCase();
    if (normalizedCategory === 'تجاري') normalizedCategory = 'commercial';
    else if (normalizedCategory === 'سكني') normalizedCategory = 'residential';
    else if (normalizedCategory === 'أراضي' || normalizedCategory === 'اراضي') normalizedCategory = 'lands';
    if (!['commercial', 'residential', 'lands'].includes(normalizedCategory)) {
      normalizedCategory = current.category || 'commercial';
    }

    let finalImagesJson = current.images_json || '[]';
    const isSafeImageUrl = (u) => typeof u === 'string' && (u === '' || u.startsWith('/uploads/') || /^https?:\/\//i.test(u));
    let finalImageUrl = (image_url !== undefined && isSafeImageUrl(image_url)) ? image_url : (current.image_url || '');
    if (existing_images !== undefined || (Array.isArray(images) && images.length > 0)) {
      const mergedUrls = await mergeAndSaveImages(
        existing_images,
        images,
        current.images_json,
        'projects',
        `proj_${projectId}`,
        '/uploads/projects/'
      );
      finalImagesJson = JSON.stringify(mergedUrls);
      finalImageUrl = mergedUrls[0] || '';
    }

    const query = `
      UPDATE projects
      SET 
        category = $1,
        name = $2,
        area_sqm = $3,
        location = $4,
        project_type = $5,
        meter_price = $6,
        starting_price = $7,
        down_payment_pct = $8,
        installment_years = $9,
        delivery_date = $10,
        units_available = $11,
        units_total = $12,
        status = $13,
        image_url = $14,
        images_json = $15,
        brochure_url = $16,
        location_url = $17,
        description = $18
      WHERE id = $19
      RETURNING *
    `;
    const result = await pool.query(query, [
      normalizedCategory,
      name.trim(),
      area_sqm !== undefined ? Math.max(0, parseFloat(area_sqm) || 0) : current.area_sqm,
      location !== undefined ? location.trim() : (current.location || ''),
      project_type ? project_type.trim() : (current.project_type || 'تجاري'),
      meter_price !== undefined ? Math.max(0, parseFloat(meter_price) || 0) : current.meter_price,
      starting_price !== undefined ? Math.max(0, parseFloat(starting_price) || 0) : current.starting_price,
      down_payment_pct !== undefined ? (parseFloat(down_payment_pct) || 10) : current.down_payment_pct,
      installment_years !== undefined ? (parseInt(installment_years, 10) || 5) : current.installment_years,
      delivery_date !== undefined ? delivery_date.trim() : current.delivery_date,
      units_available !== undefined ? (parseInt(units_available, 10) || 0) : current.units_available,
      units_total !== undefined ? (parseInt(units_total, 10) || 0) : current.units_total,
      status !== undefined ? status : current.status,
      finalImageUrl,
      finalImagesJson,
      brochure_url !== undefined ? brochure_url : (current.brochure_url || ''),
      location_url !== undefined ? location_url : (current.location_url || ''),
      description !== undefined ? description.trim() : (current.description || ''),
      projectId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    await logActivity({
      req,
      actionType: 'تعديل مشروع',
      actionCategory: 'إدارة المشروعات',
      targetType: 'مشروع',
      targetName: name.trim(),
      details: `تم تحديث بيانات المشروع (${name.trim()})`
    });

    res.json({
      success: true,
      project: result.rows[0],
      message: 'تم تحديث بيانات المشروع بنجاح'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.4 حذف مشروع
app.delete('/api/projects/:id', authMiddleware, requireOwner, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صحيح' });
  }

  try {
    const check = await pool.query('SELECT name, images_json FROM projects WHERE id = $1', [projectId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    const projectName = check.rows[0].name;
    const projImagesJson = check.rows[0].images_json;

    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);

    // حذف ملفات الصور المرتبطة بالمشروع من القرص
    await deleteUploadedImagesFromDisk(projImagesJson, '/uploads/projects/');

    await logActivity({
      req,
      actionType: 'حذف مشروع',
      actionCategory: 'إدارة المشروعات',
      targetType: 'مشروع',
      targetName: projectName,
      details: `تم حذف المشروع (${projectName}) نهائياً من المنظومة`
    });

    res.json({ success: true, message: 'تم حذف المشروع بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.5 جلب العملاء المهتمين بمشروع معين (CRM Leads Matching)
app.get('/api/projects/:id/interested-clients', authMiddleware, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صحيح' });
  }

  try {
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    const project = projectRes.rows[0];

    const locationPart = (project.location || '').split('-')[0].trim();
    const categoryKeywordsMap = {
      commercial: ['تجاري', 'إداري', 'مول', 'مكتب'],
      residential: ['سكني', 'شقة', 'فيلا', 'كمبوند'],
      lands: ['أرض', 'أراضي', 'قطعة']
    };
    const catKeywords = categoryKeywordsMap[project.category] || ['تجاري', 'سكني', 'أراضي'];
    const params = [`%${project.name}%`, `%${locationPart}%`];
    const catConditions = catKeywords.map(kw => {
      params.push(`%${kw}%`);
      return `LOWER(c.project_interest) LIKE LOWER($${params.length})`;
    }).join(' OR ');

    let salesFilterSql = '';
    if (!isUserOwner(req.user)) {
      params.push(req.user.id);
      salesFilterSql = `AND c.assigned_sales_id = $${params.length}`;
    }

    const query = `
      SELECT 
        c.id, c.name, c.phone, c.project_interest, c.total_value, c.status,
        c.assigned_sales_name, c.created_at, c.notes
      FROM clients c
      WHERE (
        LOWER(c.project_interest) LIKE LOWER($1)
        OR LOWER(c.notes) LIKE LOWER($1)
        OR (length($2) > 3 AND (LOWER(c.project_interest) LIKE LOWER($2) OR LOWER(c.notes) LIKE LOWER($2)))
        OR ${catConditions}
      )
      ${salesFilterSql}
      ORDER BY c.id DESC
      LIMIT 50
    `;

    const clientsRes = await pool.query(query, params);

    res.json({
      success: true,
      project,
      clients: clientsRes.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// ==================== 9.6 مسارات إدارة وحدات المشروعات (Units Inventory API) ====================

// دالة مساعدة لمزامنة أعداد وحدات المشروع
async function syncProjectUnitsCounters(projectId) {
  try {
    await pool.query(`
      UPDATE projects 
      SET 
        units_available = (SELECT COUNT(id) FROM project_units WHERE project_id = $1 AND status = 'متاح'),
        units_total = (SELECT COUNT(id) FROM project_units WHERE project_id = $1)
      WHERE id = $1
    `, [projectId]);
  } catch (e) {
    console.error('خطأ مزامنة عدادات وحدات المشروع:', e.message);
  }
}

// 9.6.1 جلب كافة وحدات مشروع معين مع الإحصائيات
app.get('/api/projects/:id/units', authMiddleware, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صحيح' });
  }

  const { status, unit_type, search } = req.query;

  try {
    const projectRes = await pool.query('SELECT id, name, category, location, status, units_available, units_total FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    const project = projectRes.rows[0];

    let query = 'SELECT * FROM project_units WHERE project_id = $1';
    const params = [projectId];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (unit_type && unit_type !== 'all') {
      params.push(`%${unit_type}%`);
      query += ` AND unit_type LIKE $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      query += ` AND (LOWER(unit_code) LIKE LOWER($${params.length}) OR LOWER(floor) LIKE LOWER($${params.length}) OR LOWER(reserved_client_name) LIKE LOWER($${params.length}))`;
    }

    query += ' ORDER BY id ASC';

    const [unitsRes, statsRes] = await Promise.all([
      pool.query(query, params),
      pool.query(`
        SELECT 
          COUNT(id) AS total,
          COUNT(CASE WHEN status = 'متاح' THEN 1 END) AS available,
          COUNT(CASE WHEN status = 'محجوز' THEN 1 END) AS reserved,
          COUNT(CASE WHEN status = 'تم التعاقد' OR status = 'مباع' THEN 1 END) AS sold,
          COALESCE(SUM(area_sqm), 0) AS total_area,
          COALESCE(SUM(total_price), 0) AS total_value
        FROM project_units
        WHERE project_id = $1
      `, [projectId])
    ]);

    const stats = statsRes.rows[0] || {};

    res.json({
      success: true,
      project,
      units: unitsRes.rows,
      stats: {
        total: parseInt(stats.total, 10) || 0,
        available: parseInt(stats.available, 10) || 0,
        reserved: parseInt(stats.reserved, 10) || 0,
        sold: parseInt(stats.sold, 10) || 0,
        totalArea: parseFloat(stats.total_area) || 0,
        totalValue: parseFloat(stats.total_value) || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.6.2 إضافة وحدة جديدة للمشروع (للأونر فقط)
app.post('/api/projects/:id/units', authMiddleware, requireOwner, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ success: false, message: 'معرف المشروع غير صحيح' });
  }

  const {
    unit_code,
    unit_type = 'تجاري / محلات',
    floor = 'أرضي',
    area_sqm = 0,
    meter_price = 0,
    total_price = 0,
    status = 'متاح',
    reserved_client_name = null,
    notes = '',
    images = []
  } = req.body;

  if (!unit_code || !unit_code.trim()) {
    return res.status(400).json({ success: false, message: 'يرجى إدخال كود الوحدة' });
  }

  try {
    const projCheck = await pool.query('SELECT name FROM projects WHERE id = $1', [projectId]);
    if (projCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }
    const projectName = projCheck.rows[0].name;

    // التحقق من عدم تكرار كود الوحدة داخل هذا المشروع
    const dupCheck = await pool.query('SELECT id FROM project_units WHERE project_id = $1 AND LOWER(unit_code) = LOWER($2)', [projectId, unit_code.trim()]);
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: `كود الوحدة (${unit_code}) موجود بالفعل في هذا المشروع` });
    }

    const area = Math.max(0, parseFloat(area_sqm) || 0);
    const mPrice = Math.max(0, parseFloat(meter_price) || 0);
    const calcTotalPrice = Math.max(0, parseFloat(total_price) || (area * mPrice) || 0);

    const insertRes = await pool.query(`
      INSERT INTO project_units (
        project_id, unit_code, unit_type, floor, area_sqm, meter_price, total_price, status, reserved_client_name, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      projectId,
      unit_code.trim(),
      unit_type,
      floor,
      area,
      mPrice,
      calcTotalPrice,
      status,
      reserved_client_name,
      notes
    ]);

    let unitRow = insertRes.rows[0];
    const savedUnitUrls = await saveUploadedImagesToDisk(images, 'units', `unit_${projectId}_${unitRow.id}`);
    if (savedUnitUrls.length > 0) {
      const updRes = await pool.query(
        'UPDATE project_units SET images_json = $1 WHERE id = $2 RETURNING *',
        [JSON.stringify(savedUnitUrls), unitRow.id]
      );
      unitRow = updRes.rows[0];
    }

    await syncProjectUnitsCounters(projectId);

    await logActivity({
      req,
      actionType: 'إضافة وحدة',
      actionCategory: 'إدارة المشروعات',
      targetType: 'وحدة مشروع',
      targetName: `${unit_code} - ${projectName}`,
      details: `تمت إضافة الوحدة (${unit_code}) في مشروع (${projectName}) بمساحة ${area}م² وسعر ${calcTotalPrice}${savedUnitUrls.length ? ` مع ${savedUnitUrls.length} صور` : ''}`
    });

    res.json({
      success: true,
      message: 'تمت إضافة الوحدة بنجاح',
      unit: unitRow
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.6.3 تعديل بيانات وحدة (للأونر فقط)
app.put('/api/projects/:id/units/:unitId', authMiddleware, requireOwner, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const unitId = parseInt(req.params.unitId, 10);
  if (isNaN(projectId) || isNaN(unitId)) {
    return res.status(400).json({ success: false, message: 'معرف غير صحيح' });
  }

  const {
    unit_code,
    unit_type,
    floor,
    area_sqm,
    meter_price,
    total_price,
    status,
    reserved_client_name,
    notes,
    existing_images,
    images
  } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM project_units WHERE id = $1 AND project_id = $2', [unitId, projectId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الوحدة غير موجودة' });
    }
    const current = existing.rows[0];

    if (unit_code && unit_code.trim().toLowerCase() !== current.unit_code.toLowerCase()) {
      const dup = await pool.query('SELECT id FROM project_units WHERE project_id = $1 AND LOWER(unit_code) = LOWER($2) AND id != $3', [projectId, unit_code.trim(), unitId]);
      if (dup.rows.length > 0) {
        return res.status(400).json({ success: false, message: `كود الوحدة (${unit_code}) مستخدم بالفعل في هذا المشروع` });
      }
    }

    const parsedArea = area_sqm !== undefined ? parseFloat(area_sqm) : NaN;
    const area = Number.isFinite(parsedArea) ? Math.max(0, parsedArea) : (parseFloat(current.area_sqm) || 0);
    const parsedMPrice = meter_price !== undefined ? parseFloat(meter_price) : NaN;
    const mPrice = Number.isFinite(parsedMPrice) ? Math.max(0, parsedMPrice) : (parseFloat(current.meter_price) || 0);
    const parsedTotal = total_price !== undefined ? parseFloat(total_price) : NaN;
    const finalTotal = Number.isFinite(parsedTotal)
      ? Math.max(0, parsedTotal)
      : ((area_sqm !== undefined || meter_price !== undefined) ? (area * mPrice) : (parseFloat(current.total_price) || 0));

    let finalUnitImagesJson = current.images_json || '[]';
    if (existing_images !== undefined || (Array.isArray(images) && images.length > 0)) {
      const mergedUnitUrls = await mergeAndSaveImages(
        existing_images,
        images,
        current.images_json,
        'units',
        `unit_${projectId}_${unitId}`,
        '/uploads/units/'
      );
      finalUnitImagesJson = JSON.stringify(mergedUnitUrls);
    }

    const updateRes = await pool.query(`
      UPDATE project_units
      SET 
        unit_code = COALESCE($1, unit_code),
        unit_type = COALESCE($2, unit_type),
        floor = COALESCE($3, floor),
        area_sqm = $4,
        meter_price = $5,
        total_price = $6,
        status = COALESCE($7, status),
        reserved_client_name = $8,
        notes = COALESCE($9, notes),
        images_json = $10,
        updated_at = NOW()
      WHERE id = $11 AND project_id = $12
      RETURNING *
    `, [
      unit_code ? unit_code.trim() : null,
      unit_type,
      floor,
      area,
      mPrice,
      finalTotal,
      status,
      reserved_client_name !== undefined ? reserved_client_name : current.reserved_client_name,
      notes,
      finalUnitImagesJson,
      unitId,
      projectId
    ]);

    await syncProjectUnitsCounters(projectId);

    await logActivity({
      req,
      actionType: 'تعديل وحدة',
      actionCategory: 'إدارة المشروعات',
      targetType: 'وحدة مشروع',
      targetName: updateRes.rows[0].unit_code,
      details: `تم تحديث بيانات وحالة الوحدة (${updateRes.rows[0].unit_code}) إلى (${updateRes.rows[0].status})`
    });

    res.json({
      success: true,
      message: 'تم تحديث الوحدة بنجاح',
      unit: updateRes.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 9.6.4 حذف وحدة من المشروع (للأونر فقط)
app.delete('/api/projects/:id/units/:unitId', authMiddleware, requireOwner, async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const unitId = parseInt(req.params.unitId, 10);
  if (isNaN(projectId) || isNaN(unitId)) {
    return res.status(400).json({ success: false, message: 'معرف غير صحيح' });
  }

  try {
    const existing = await pool.query('SELECT unit_code, images_json FROM project_units WHERE id = $1 AND project_id = $2', [unitId, projectId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الوحدة غير موجودة' });
    }
    const unitCode = existing.rows[0].unit_code;
    const unitImagesJson = existing.rows[0].images_json;

    await pool.query('DELETE FROM project_units WHERE id = $1 AND project_id = $2', [unitId, projectId]);
    await deleteUploadedImagesFromDisk(unitImagesJson, '/uploads/units/');
    await syncProjectUnitsCounters(projectId);

    await logActivity({
      req,
      actionType: 'حذف وحدة',
      actionCategory: 'إدارة المشروعات',
      targetType: 'وحدة مشروع',
      targetName: unitCode,
      details: `تم حذف الوحدة (${unitCode}) من المشروع`
    });

    res.json({ success: true, message: 'تم حذف الوحدة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 10.1 مسح وتفريغ سجل العمليات والرقابة بالكامل (للأونر / المدير العام فقط)
app.delete('/api/audit-logs', authMiddleware, requireOwner, async (req, res) => {
  try {
    // تفريغ جدول سجل العمليات وإعادة ترقيم المعرفات
    await pool.query('TRUNCATE TABLE audit_logs RESTART IDENTITY;');

    res.json({
      success: true,
      message: 'تم مسح وتفريغ سجل العمليات بالكامل بنجاح!'
    });
  } catch (err) {
    console.error('خطأ مسح السجل:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء مسح السجل' });
  }
});

// 9. إحصائيات عامة للأونر
app.get('/api/owner-stats', authMiddleware, requireOwner, async (req, res) => {
  try {
    const [totalClients, unassignedClients, salesCount, totalValue] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM clients'),
      pool.query('SELECT COUNT(*) FROM clients WHERE assigned_sales_id IS NULL'),
      pool.query("SELECT COUNT(*) FROM users WHERE role LIKE '%سيلز%' OR role LIKE '%Sales%'"),
      pool.query('SELECT COALESCE(SUM(total_value), 0) FROM clients')
    ]);

    res.json({
      success: true,
      stats: {
        totalClients: parseInt(totalClients.rows[0].count, 10),
        unassignedClients: parseInt(unassignedClients.rows[0].count, 10),
        salesCount: parseInt(salesCount.rows[0].count, 10),
        totalValue: parseFloat(totalValue.rows[0].coalesce)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// ==================== نظام المحادثات الفورية (WhatsApp Team Chat) ====================

// اتصالات البث المباشر للرسائل عبر SSE
let chatSseClients = [];
const MAX_SSE_CLIENTS = 100; // حد أقصى للاتصالات المتزامنة بالشات
let chatListenClient = null;
let chatPubSubReady = false;

function deliverChatMessageToLocalClients(msg) {
  const deadClientIds = [];
  chatSseClients.forEach(client => {
    try {
      // 1. إشعارات النظام ومسح الشات
      if (msg.type === 'chat_cleared') {
        if (!msg.with_user_id || client.userId === msg.with_user_id || client.userId === 1) {
          client.res.write(`data: ${JSON.stringify(msg)}\n\n`);
        }
        return;
      }

      // 2. المحادثات الخاصة: يتم إرسالها فقط للمرسل والمستلم (حماية الخصوصية ومنع التسريب)
      if (msg.chat_type === 'private' && msg.recipient_id) {
        if (client.userId === msg.sender_id || client.userId === msg.recipient_id) {
          client.res.write(`data: ${JSON.stringify(msg)}\n\n`);
        }
      } else {
        // 3. المحادثات العامة (الجروب): تُبث لكافة أعضاء الفريق
        client.res.write(`data: ${JSON.stringify(msg)}\n\n`);
      }
    } catch (e) {
      deadClientIds.push(client.id);
    }
  });
  if (deadClientIds.length > 0) {
    chatSseClients = chatSseClients.filter(c => !deadClientIds.includes(c.id));
  }
}

async function initChatPubSub() {
  try {
    if (chatListenClient) {
      try { chatListenClient.release(); } catch (_) {}
      chatListenClient = null;
    }
    chatPubSubReady = false;
    chatListenClient = await pool.connect();
    await chatListenClient.query('LISTEN crm_chat_channel');
    chatPubSubReady = true;

    chatListenClient.on('notification', (notification) => {
      if (notification.channel === 'crm_chat_channel' && notification.payload) {
        try {
          const parsedMsg = JSON.parse(notification.payload);
          deliverChatMessageToLocalClients(parsedMsg);
        } catch (e) {}
      }
    });

    chatListenClient.on('error', () => {
      chatPubSubReady = false;
      setTimeout(initChatPubSub, 5000);
    });

    chatListenClient.on('end', () => {
      chatPubSubReady = false;
      setTimeout(initChatPubSub, 5000);
    });
  } catch (err) {
    chatPubSubReady = false;
    console.warn('تحذير: تعذر تشغيل بث الشات عبر PostgreSQL، سيستمر البث المحلي:', err.message);
    setTimeout(initChatPubSub, 10000);
  }
}

async function broadcastChatMessage(msg) {
  const payload = JSON.stringify(msg);
  // pg_notify يدعم حتى ~8000 بايت؛ مع استخدام البث المحلي كـ fallback إذا تعذر الإرسال المشترك
  if (chatPubSubReady && Buffer.byteLength(payload, 'utf8') < 7500) {
    try {
      await pool.query("SELECT pg_notify('crm_chat_channel', $1)", [payload]);
      return;
    } catch (err) {
      console.warn('pg_notify fallback to local SSE:', err.message);
    }
  }
  deliverChatMessageToLocalClients(msg);
}

// ==================== الجدولة الأسبوعية: مسح الشات تلقائياً كل خميس الساعة 12:00 ليلاً (توقيت القاهرة) ====================
function getCairoNow(now = new Date()) {
  try {
    return new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  } catch (_) {
    return new Date(now);
  }
}

function getMostRecentThursdayMidnight(now = new Date()) {
  const d = getCairoNow(now);
  const day = d.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  // ليلة الخميس الساعة 12:00 منتصف الليل تطابق تقويمياً يوم الجمعة الساعة 00:00:00
  const daysSince = (day - 5 + 7) % 7;
  const target = new Date(d);
  target.setDate(d.getDate() - daysSince);
  target.setHours(0, 0, 0, 0);
  // تحويل الفرق الزمني إلى UTC الفعلي
  const offsetMs = d.getTime() - now.getTime();
  return new Date(target.getTime() - offsetMs);
}

let lastThursdayMidnightClearedKey = null;

async function checkAndExecuteThursdayChatCleanup() {
  try {
    const now = new Date();
    const cairoNow = getCairoNow(now);
    const day = cairoNow.getDay();
    const hours = cairoNow.getHours();
    const minutes = cairoNow.getMinutes();

    const mostRecentMidnight = getMostRecentThursdayMidnight(now);

    // 1. مسح أي رسائل قديمة سبقت آخر موعد مسح مجدول (إذا كان السيرفر متوقفاً وتم تشغيله لاحقاً)
    const delOld = await pool.query(
      'DELETE FROM chat_messages WHERE created_at < $1 RETURNING id',
      [mostRecentMidnight]
    );

    if (delOld.rows.length > 0) {
      console.log(`🧹 [تنظيف الشات الأسبوعي] تم مسح ${delOld.rows.length} رسالة قديمة سبقت موعد الخميس 12:00 ليلاً.`);
      broadcastChatMessage({
        type: 'chat_cleared',
        message: 'تم مسح سجل المحادثات تلقائياً طبقاً للجدولة الأسبوعية (كل خميس الساعة 12:00 منتصف الليل)'
      });
    }

    // 2. فحص لحظة التحول الفعلية ليلة الخميس 12:00 ليلاً (بين الخميس 23:59:00 والجمعة 00:02:00)
    const isMidnightMoment = (day === 4 && hours === 23 && minutes >= 59) || 
                             (day === 5 && hours === 0 && minutes <= 2);

    if (isMidnightMoment) {
      const clearDate = (day === 4) ? new Date(now.getTime() + 120000) : now;
      const weekClearKey = `thu_clear_${clearDate.toISOString().slice(0, 10)}`;
      if (lastThursdayMidnightClearedKey !== weekClearKey) {
        lastThursdayMidnightClearedKey = weekClearKey;

        // مسح كافة الرسائل الحالية
        const fullClear = await pool.query('DELETE FROM chat_messages RETURNING id');
        console.log(`🧹 [الجدولة الأسبوعية] تم مسح ${fullClear.rows.length} رسالة محادثة في موعد الخميس الساعة 12:00 ليلاً.`);

        // توثيق في سجل العمليات والرقابة (Audit Log)
        try {
          await logActivity({
            userName: 'النظام التلقائي (System)',
            userEmail: 'system@crm.local',
            userRole: 'نظام آلي',
            actionType: 'مسح تلقائي للشات',
            actionCategory: 'المحادثات الفورية',
            targetType: 'شات الفريق',
            targetName: 'جروب المبيعات والإدارة',
            details: 'تم مسح وتصفير كافة محادثات الشات تلقائياً بحلول موعد منتصف ليل الخميس (الساعة 12:00 ليلاً).'
          });
        } catch (e) {
          console.error('خطأ توثيق مسح الشات في السجل:', e.message);
        }

        // تحديث جدول الإعدادات
        try {
          await pool.query(`
            INSERT INTO system_settings (key, value, updated_at)
            VALUES ('last_thursday_chat_clear', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `, [weekClearKey]);
        } catch (e) {}

        // بث لحظي لجميع المتصلين بالشات
        broadcastChatMessage({
          type: 'chat_cleared',
          message: 'تم مسح سجل المحادثات تلقائياً طبقاً للجدولة الأسبوعية (كل خميس الساعة 12:00 منتصف الليل)'
        });
      }
    }
  } catch (err) {
    console.error('خطأ أثناء فحص جدولة مسح الشات الأسبوعية:', err.message);
  }
}

// تشغيل الفحص الدوري كل 5 دقائق (تقليل الحِمل على DB بدلاً من 30 ثانية)
setInterval(checkAndExecuteThursdayChatCleanup, 5 * 60 * 1000).unref();

// 1. مسار البث اللحظي للرسائل (Server-Sent Events مع نبضات Keep-Alive لمنع انقطاع الاتصال)
app.get('/api/chat/stream', authMiddleware, (req, res) => {
  if (chatSseClients.length >= MAX_SSE_CLIENTS) {
    return res.status(503).json({ success: false, message: 'الخادم مشغول، يرجى المحاولة لاحقاً' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now() + Math.random();
  const newClient = { id: clientId, userId: req.user.id, res };
  chatSseClients.push(newClient);

  // إرسال نبض دوري كل 25 ثانية لمنع البروكسيات (Cloudflare / Nginx / Tunnels) من قطع الاتصال
  const keepAliveTimer = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (e) {
      clearInterval(keepAliveTimer);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    chatSseClients = chatSseClients.filter(c => c.id !== clientId);
  });
});

// 2. جلب سجل الرسائل الأخيرة (جروب عام أو محادثة خاصة)
app.get('/api/chat/messages', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 150, 1), 500);
    const chatType = req.query.type || 'group';
    const withUserId = req.query.withUserId ? parsePositiveInt(req.query.withUserId) : null;
    if (req.query.withUserId && !withUserId) {
      return res.status(400).json({ success: false, message: 'معرف المستخدم غير صحيح' });
    }
    const currentUserId = req.user.id;

    let result;
    if (chatType === 'private' && withUserId) {
      // محادثة خاصة بين المستخدم الحالي والشخص المحدد فقط
      result = await pool.query(`
        SELECT id, sender_id, sender_name, sender_role, recipient_id, recipient_name, chat_type, message, created_at
        FROM chat_messages
        WHERE chat_type = 'private'
          AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
        ORDER BY id ASC
        LIMIT $3
      `, [currentUserId, withUserId, limit]);
    } else {
      // محادثة الجروب العام (الفريق بالكامل)
      result = await pool.query(`
        SELECT id, sender_id, sender_name, sender_role, recipient_id, recipient_name, chat_type, message, created_at
        FROM chat_messages
        WHERE chat_type = 'group' OR recipient_id IS NULL
        ORDER BY id ASC
        LIMIT $1
      `, [limit]);
    }

    // جلب قائمة بآخر المحادثات الخاصة النشطة للمستخدم الحالي
    const privateSummaries = await pool.query(`
      SELECT 
        CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_user_id,
        CASE WHEN sender_id = $1 THEN recipient_name ELSE sender_name END AS other_user_name,
        COUNT(id) AS total_messages,
        MAX(created_at) AS last_message_at
      FROM chat_messages
      WHERE chat_type = 'private' AND (sender_id = $1 OR recipient_id = $1)
      GROUP BY other_user_id, other_user_name
      ORDER BY last_message_at DESC
    `, [currentUserId]);

    res.json({
      success: true,
      chatType,
      withUserId,
      messages: result.rows,
      privateConversations: privateSummaries.rows,
      currentUser: {
        id: req.user.id,
        name: req.user.full_name || req.user.fullName || (isUserOwner(req.user) ? 'المدير العام' : 'سيلز'),
        role: req.user.role || 'سيلز (Sales)'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 3. إرسال رسالة جديدة وحفظها في PostgreSQL وبثها لحظياً (جروب أو خاص)
app.post('/api/chat/messages', authMiddleware, async (req, res) => {
  const { message, chat_type, recipient_id } = req.body;
  if (!message || message.trim() === '') {
    return res.status(400).json({ success: false, message: 'لا يمكن إرسال رسالة فارغة' });
  }

  try {
    const senderId = req.user.id;
    const senderName = req.user.full_name || req.user.fullName || (isUserOwner(req.user) ? 'المدير العام' : 'سيلز');
    const senderRole = req.user.role || 'سيلز (Sales)';

    let targetChatType = 'group';
    let targetRecipientId = null;
    let targetRecipientName = null;

    if (chat_type === 'private' && recipient_id) {
      targetChatType = 'private';
      targetRecipientId = parsePositiveInt(recipient_id);
      if (!targetRecipientId) {
        return res.status(400).json({ success: false, message: 'معرف المستلم غير صحيح' });
      }
      
      const userRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [targetRecipientId]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'المستلم غير موجود' });
      }
      targetRecipientName = userRes.rows[0].full_name;
    }

    const result = await pool.query(`
      INSERT INTO chat_messages (sender_id, sender_name, sender_role, recipient_id, recipient_name, chat_type, message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, sender_id, sender_name, sender_role, recipient_id, recipient_name, chat_type, message, created_at
    `, [senderId, senderName, senderRole, targetRecipientId, targetRecipientName, targetChatType, message.trim()]);

    const savedMsg = result.rows[0];

    // بث الرسالة لحظياً لكل النوافذ المفتوحة
    broadcastChatMessage(savedMsg);

    res.json({ success: true, message: savedMsg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 4. جلب قائمة أعضاء الفريق المتواجدين في الشات (تتحدث تلقائياً مع كل سيلز جديد يُضاف)
app.get('/api/chat/members', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, email, role, is_active, created_at
      FROM users
      ORDER BY 
        CASE WHEN role LIKE '%Owner%' OR role LIKE '%المالك%' THEN 0 ELSE 1 END ASC,
        full_name ASC
    `);

    res.json({
      success: true,
      members: result.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// 5. مسح الشات يدوياً من الإعدادات (خاص بالمالك / الأونر فقط)
app.post('/api/chat/clear', authMiddleware, requireOwner, async (req, res) => {
  const { target, with_user_id } = req.body || {}; // target: 'group' | 'all' | 'private'

  try {
    let delRes;
    let clearDesc = '';

    if (target === 'group') {
      delRes = await pool.query("DELETE FROM chat_messages WHERE chat_type = 'group' OR recipient_id IS NULL RETURNING id");
      clearDesc = 'مسح محادثات الجروب العام للفريق';
    } else if (target === 'private' && with_user_id) {
      const parsedWithUserId = parsePositiveInt(with_user_id);
      if (!parsedWithUserId) {
        return res.status(400).json({ success: false, message: 'معرف الموظف غير صحيح' });
      }
      delRes = await pool.query(`
        DELETE FROM chat_messages 
        WHERE chat_type = 'private' 
          AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)) 
        RETURNING id
      `, [req.user.id, parsedWithUserId]);
      clearDesc = `مسح المحادثة الخاصة مع الموظف رقم (${parsedWithUserId})`;
    } else {
      delRes = await pool.query('DELETE FROM chat_messages RETURNING id');
      clearDesc = 'مسح وتصفير كافة محادثات النظام بالكامل (الجروب والخاص)';
    }
    
    await logActivity({
      req,
      actionType: 'مسح يدوي للشات من الإعدادات',
      actionCategory: 'المحادثات الفورية',
      targetType: 'شات الفريق',
      targetName: 'إعدادات الشات',
      details: `قام المالك (${req.user.full_name || 'المدير العام'}) بـ ${clearDesc} (تم حذف ${delRes.rows.length} رسالة).`
    });

    broadcastChatMessage({
      type: 'chat_cleared',
      target: target || 'all',
      with_user_id: with_user_id || null,
      message: `قام المالك بـ ${clearDesc}`
    });

    res.json({ 
      success: true, 
      message: `تمت العملية بنجاح: ${clearDesc}`, 
      deletedCount: delRes.rows.length 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
  }
});

// تسجيل الخروج
app.post('/api/logout', (req, res) => {
  res.clearCookie('crm_token', { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

// مسار 404 لأي استدعاء API غير معروف
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'المسار البرمجي المطلوب غير موجود' });
});

// معالج الأخطاء العام (Global Error Handler)
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'حدث خطأ غير متوقع في الخادم' : (err.message || 'حدث خطأ في الطلب')
  });
});

// بدء الخادم بعد تهيئة قاعدة البيانات
initDB().then(async () => {
  // تفعيل البث المشترك للشات عبر PostgreSQL LISTEN/NOTIFY
  await initChatPubSub();

  // فحص الجدولة الأسبوعية للشات فور بدء التشغيل
  await checkAndExecuteThursdayChatCleanup();

  app.listen(PORT, () => {
    console.log(`🚀 تطبيق نظام إدارة العملاء والمبيعات CRM (واجهة الأونر وتوزيع السيلز) يعمل الآن على: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('فشل بدء التطبيق:', err);
});
