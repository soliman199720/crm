const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_TIMEZONE = (process.env.DB_TIMEZONE || 'Africa/Cairo').replace(/[^A-Za-z0-9_/+\\-]/g, '');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'crm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  options: `-c timezone=${DB_TIMEZONE}`,
});

async function initDB() {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات PostgreSQL (crm) بنجاح!');

    // 1. جدول المستخدمين
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        phone VARCHAR(30),
        role VARCHAR(50) DEFAULT 'سيلز (Sales)',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. جدول العملاء مع حقول التوزيع على السيلز
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        company VARCHAR(150),
        phone VARCHAR(30),
        email VARCHAR(100),
        project_interest VARCHAR(150),
        total_value NUMERIC(15, 2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'عميل جديد',
        assigned_sales_id INT REFERENCES users(id) ON DELETE SET NULL,
        assigned_sales_name VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // التأكد من وجود أعمدة التوزيع إذا كان الجدول منشأ سابقاً
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_sales_id INT;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_sales_name VARCHAR(100);`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS project_interest VARCHAR(150);`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'عميل جديد';`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS postponed_until TIMESTAMP;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS postpone_reason TEXT;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_reminder_resolved BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by_id INT;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(100);`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(30);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_normalized_phone ON clients(normalized_phone);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clients_archived_at ON clients(archived_at);`);
    await client.query(`UPDATE clients SET archived_at = COALESCE(created_at, NOW()) WHERE status IN ('تم التعاقد', 'ملغي') AND archived_at IS NULL;`);
    await client.query(`
      UPDATE clients
      SET normalized_phone = CASE
        WHEN regexp_replace(phone, '\\D', '', 'g') ~ '^00201[0-9]{9}$' THEN '0' || substring(regexp_replace(phone, '\\D', '', 'g') FROM 5)
        WHEN regexp_replace(phone, '\\D', '', 'g') ~ '^201[0-9]{9}$' THEN '0' || substring(regexp_replace(phone, '\\D', '', 'g') FROM 3)
        WHEN regexp_replace(phone, '\\D', '', 'g') ~ '^1[0-9]{9}$' THEN '0' || regexp_replace(phone, '\\D', '', 'g')
        ELSE regexp_replace(phone, '\\D', '', 'g')
      END
      WHERE phone IS NOT NULL AND phone != '' AND (normalized_phone IS NULL OR normalized_phone = '');
    `);

    // 3. جدول سجل العمليات والرقابة (Audit Activity Logs)
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT,
        user_name VARCHAR(100) NOT NULL,
        user_email VARCHAR(100),
        user_role VARCHAR(50),
        action_type VARCHAR(60) NOT NULL,
        action_category VARCHAR(60) DEFAULT 'سيلز ومبيعات',
        target_type VARCHAR(60),
        target_name VARCHAR(150),
        details TEXT NOT NULL,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. جدول سجل المتابعات التفاعلية الزمني للعميل (Client Interaction Timeline)
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_activities (
        id SERIAL PRIMARY KEY,
        client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(100) NOT NULL,
        user_role VARCHAR(50),
        activity_type VARCHAR(50) NOT NULL,
        outcome VARCHAR(50),
        details TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_client_activities_client_id ON client_activities(client_id);
      CREATE INDEX IF NOT EXISTS idx_client_activities_created_at ON client_activities(created_at);
    `);

    // 6. جدول الرسائل والمحادثات الفورية بين الأونر وفريق السيلز (WhatsApp Chat)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender_id INT NOT NULL,
        sender_name VARCHAR(100) NOT NULL,
        sender_role VARCHAR(50) NOT NULL,
        recipient_id INT NULL,
        recipient_name VARCHAR(100) NULL,
        chat_type VARCHAR(20) DEFAULT 'group',
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ترقية أعمدة المحادثات الخاصة إن لم تكن موجودة
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='recipient_id') THEN
          ALTER TABLE chat_messages ADD COLUMN recipient_id INT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='recipient_name') THEN
          ALTER TABLE chat_messages ADD COLUMN recipient_name VARCHAR(100) NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='chat_type') THEN
          ALTER TABLE chat_messages ADD COLUMN chat_type VARCHAR(20) DEFAULT 'group';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='attachment_url') THEN
          ALTER TABLE chat_messages ADD COLUMN attachment_url TEXT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='attachment_name') THEN
          ALTER TABLE chat_messages ADD COLUMN attachment_name VARCHAR(255) NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='attachment_type') THEN
          ALTER TABLE chat_messages ADD COLUMN attachment_type VARCHAR(30) NULL;
        END IF;
      END $$;
    `);

    // 7. جدول إعدادات النظام وتواريخ المهام المجدولة (مثل مسح الشات الأسبوعي)
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7.1 جدول محاولات تسجيل الدخول الفاشلة (مشترك بين كافة نسخ الخادم Cluster-safe Rate Limiting)
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip VARCHAR(45) PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 0,
        first_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        blocked_until TIMESTAMP NULL
      );
    `);

    // 8. جدول المشروعات (المشروعات التجارية والسكنية والأراضي)
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) DEFAULT 'commercial',
        name VARCHAR(150) NOT NULL,
        location VARCHAR(200),
        project_type VARCHAR(100),
        meter_price NUMERIC(15, 2) DEFAULT 0,
        starting_price NUMERIC(15, 2) DEFAULT 0,
        down_payment_pct NUMERIC(5, 2) DEFAULT 10,
        installment_years INT DEFAULT 5,
        delivery_date VARCHAR(50) DEFAULT 'استلام 2026',
        units_available INT DEFAULT 0,
        units_total INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'قيد الإنشاء',
        image_url TEXT,
        brochure_url TEXT,
        location_url TEXT,
        description TEXT,
        area_sqm NUMERIC(15, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS area_sqm NUMERIC(15, 2) DEFAULT 0;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS images_json TEXT DEFAULT '[]';
      CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    `);

    // 9. جدول وحدات المشروعات (Project Units Inventory)
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_units (
        id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        unit_code VARCHAR(50) NOT NULL,
        unit_type VARCHAR(50) NOT NULL,
        floor VARCHAR(50) NOT NULL,
        area_sqm NUMERIC(10, 2) NOT NULL DEFAULT 0,
        meter_price NUMERIC(15, 2) DEFAULT 0,
        total_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'متاح',
        reserved_client_id INT REFERENCES clients(id) ON DELETE SET NULL,
        reserved_client_name VARCHAR(100),
        notes TEXT,
        images_json TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_project_unit_code UNIQUE (project_id, unit_code)
      );
      ALTER TABLE project_units ADD COLUMN IF NOT EXISTS images_json TEXT DEFAULT '[]';
      CREATE INDEX IF NOT EXISTS idx_units_project_id ON project_units(project_id);
      CREATE INDEX IF NOT EXISTS idx_units_status ON project_units(status);
    `);

    // إضافة وحدات تجريبية للمشروعات التجارية إن كان جدول الوحدات فارغاً
    const unitsCountRes = await client.query('SELECT COUNT(id) FROM project_units');
    if (parseInt(unitsCountRes.rows[0].count, 10) === 0) {
      const projCheck = await client.query("SELECT id, name FROM projects WHERE category = 'commercial' ORDER BY id ASC LIMIT 1");
      if (projCheck.rows.length > 0) {
        const pId = projCheck.rows[0].id;
        await client.query(`
          INSERT INTO project_units (project_id, unit_code, unit_type, floor, area_sqm, meter_price, total_price, status, reserved_client_name, notes)
          VALUES 
            ($1, 'G-01', 'تجاري / محلات', 'أرضي', 45.00, 85000.00, 3825000.00, 'متاح', NULL, 'محل واجهة رئيسية مطلة على البلازا والمدخل'),
            ($1, 'G-02', 'تجاري / كافيه', 'أرضي', 70.00, 95000.00, 6650000.00, 'متاح', NULL, 'مساحة خارجية أوت دور 30م² مجانية'),
            ($1, 'F-101', 'إداري / مكاتب', 'أول', 60.00, 65000.00, 3900000.00, 'محجوز', 'شركة إعمار للاستشارات', 'تم دفع جدية حجز ومتبقي التعاقد'),
            ($1, 'F-102', 'إداري / مكاتب', 'أول', 85.00, 65000.00, 5525000.00, 'متاح', NULL, 'مكتب كورنر تشطيب ألترا سوبر لوكس بالتكييف'),
            ($1, 'C-201', 'طبي / عيادات', 'ثاني', 50.00, 70000.00, 3500000.00, 'تم التعاقد', 'د. طارق علام', 'عيادة أسنان مجهزة بكافة توصيلات الصرف والتعقيم')
          ON CONFLICT DO NOTHING;
        `, [pId]);

        // تحديث إحصائيات المشروع الأول
        await client.query(`
          UPDATE projects 
          SET units_available = (SELECT COUNT(id) FROM project_units WHERE project_id = $1 AND status = 'متاح'),
              units_total = (SELECT COUNT(id) FROM project_units WHERE project_id = $1)
          WHERE id = $1;
        `, [pId]);
      }
    }

    const salt = await bcrypt.genSalt(12);
    const initialAdminPass = process.env.DEFAULT_ADMIN_PASSWORD || '112233';
    const defaultPassword = await bcrypt.hash(initialAdminPass, salt);

    // التأكد من حساب الأدمن / المالك
    const checkAdmin = await client.query("SELECT id FROM users WHERE email = '1@1.com' OR username = 'admin' LIMIT 1");
    if (checkAdmin.rows.length === 0) {
      await client.query(`
        INSERT INTO users (username, email, password, full_name, phone, role)
        VALUES ('admin', '1@1.com', $1, 'المالك / المدير العام', '01000000001', 'المالك (Owner)')
      `, [defaultPassword]);
    } else {
      await client.query(`UPDATE users SET email = '1@1.com', role = 'المالك (Owner)' WHERE id = $1`, [checkAdmin.rows[0].id]);
    }

    return true;
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
    return false;
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  pool,
  initDB
};
