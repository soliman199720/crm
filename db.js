const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'crm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '112233',
});

async function initDB() {
  try {
    const client = await pool.connect();
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

    // تنظيف الجداول القديمة غير المستخدمة
    await client.query(`DROP TABLE IF EXISTS projects CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS invoices CASCADE;`);

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
        assigned_sales_id INT,
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

    const salt = await bcrypt.genSalt(10);
    const defaultPassword = await bcrypt.hash('112233', salt);

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

    client.release();
    return true;
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
    return false;
  }
}

module.exports = {
  pool,
  initDB
};
