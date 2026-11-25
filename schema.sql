-- ========================================================
--   قاعدة بيانات منظومة إدارة العملاء CRM - DDL Schema
--   PostgreSQL Database: crm
-- ========================================================

-- تمكين الامتداد لتشفير كلمات المرور
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. جدول المستخدمين وطاقم العمل (Users & Staff)
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

-- 2. جدول العملاء وإسناد السيلز (Clients & Sales Assignment)
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
  created_by_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(100),
  notes TEXT,
  postponed_until TIMESTAMP,
  postpone_reason TEXT,
  is_reminder_resolved BOOLEAN DEFAULT FALSE,
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

-- 4. جدول سجل المتابعات التفاعلية الزمني للعميل (Client Interaction Timeline)
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

-- 4. جدول الرسائل الفورية وشات فريق العمل (Team Chat Messages)
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

-- 5. جدول إعدادات النظام والمهام المجدولة (System Settings)
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. جدول محاولات تسجيل الدخول الفاشلة (Cluster-safe Rate Limiting)
CREATE TABLE IF NOT EXISTS login_attempts (
  ip VARCHAR(45) PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_until TIMESTAMP NULL
);

-- إنشاء فهارس لتحسين الأداء (Indexes for Performance)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_clients_assigned_sales ON clients(assigned_sales_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_client_activities_client_id ON client_activities(client_id);
CREATE INDEX IF NOT EXISTS idx_client_activities_created_at ON client_activities(created_at);

-- 7. جدول المشروعات (المشروعات التجارية، السكنية، والأراضي)
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
  images_json TEXT DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- 9. جدول وحدات المشروعات (Project Units Inventory)
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
CREATE INDEX IF NOT EXISTS idx_units_project_id ON project_units(project_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON project_units(status);

-- إضافة المستخدم الافتراضي (المالك / المدير العام) بكلمة مرور 112233
INSERT INTO users (username, email, password, full_name, phone, role)
VALUES (
  'admin',
  '1@1.com',
  crypt('112233', gen_salt('bf', 10)),
  'المالك / المدير العام',
  '01000000001',
  'المالك (Owner)'
)
ON CONFLICT (email) DO NOTHING;

-- إضافة مستخدم سيلز تجريبي (أحمد) بكلمة مرور 112233
INSERT INTO users (username, email, password, full_name, phone, role)
VALUES (
  'ahmed',
  '2@2.com',
  crypt('112233', gen_salt('bf', 10)),
  'أحمد - مسؤول مبيعات',
  '01000000002',
  'سيلز (Sales)'
)
ON CONFLICT (email) DO NOTHING;

-- إضافة إعدادات النظام المبدئية
INSERT INTO system_settings (key, value, updated_at)
VALUES ('system_initialized', 'true', NOW())
ON CONFLICT (key) DO NOTHING;
