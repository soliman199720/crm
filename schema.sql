-- ========================================================
--   قاعدة بيانات منظومة إدارة العملاء CRM - DDL Schema
--   PostgreSQL Database: crm
-- ========================================================

-- 1. جدول المستخدمين وطاقم العمل
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

-- 2. جدول العملاء وإسناد السيلز
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

-- 3. جدول سجل العمليات والرقابة (Audit Activity Logs)
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

-- 4. جدول الرسائل الفورية وشات فريق العمل (WhatsApp Team Chat)
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

-- 5. جدول إعدادات النظام والمهام المجدولة
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

