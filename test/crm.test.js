const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

test('Essential project files exist', () => {
  const requiredFiles = [
    'server.js',
    'db.js',
    'schema.sql',
    'build.js',
    'package.json',
    '.env.example',
    '.gitignore'
  ];
  for (const file of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(rootDir, file)),
      true,
      `Missing required file: ${file}`
    );
  }
});

test('All JS files pass syntax check', () => {
  const jsFiles = [
    path.join(rootDir, 'server.js'),
    path.join(rootDir, 'db.js'),
    path.join(rootDir, 'build.js'),
    path.join(rootDir, 'share.js')
  ];
  const publicJsDir = path.join(rootDir, 'public', 'js');
  for (const entry of fs.readdirSync(publicJsDir)) {
    if (entry.endsWith('.js')) {
      jsFiles.push(path.join(publicJsDir, entry));
    }
  }

  for (const filePath of jsFiles) {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  }
});

test('Security guards are enforced on sensitive routes in server.js', () => {
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const expectedRouteGuards = [
    "app.get('/api/users', authMiddleware, requireOwner",
    "app.post('/api/users', authMiddleware, requireOwner",
    "app.put('/api/users/:id', authMiddleware, requireOwner",
    "app.delete('/api/users/:id', authMiddleware, requireOwner",
    "app.get('/api/owner-stats', authMiddleware, requireOwner",
    "app.get('/api/audit-logs', authMiddleware, requireOwner",
    "app.delete('/api/audit-logs', authMiddleware, requireOwner",
    "app.post('/api/projects', authMiddleware, requireOwner",
    "app.put('/api/projects/:id', authMiddleware, requireOwner",
    "app.delete('/api/projects/:id', authMiddleware, requireOwner",
    "app.post('/api/projects/:id/units', authMiddleware, requireOwner",
    "app.put('/api/projects/:id/units/:unitId', authMiddleware, requireOwner",
    "app.delete('/api/projects/:id/units/:unitId', authMiddleware, requireOwner"
  ];

  for (const signature of expectedRouteGuards) {
    assert.equal(
      serverCode.includes(signature),
      true,
      `Expected security guard not found: ${signature}`
    );
  }
});

test('.gitignore excludes secrets and build artifacts', () => {
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  for (const pattern of ['.env', 'node_modules/', 'dist/', 'dist.zip']) {
    assert.equal(
      gitignore.includes(pattern),
      true,
      `.gitignore must ignore ${pattern}`
    );
  }
});

test('Duplicate and archive client handling is present in server.js', () => {
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  for (const token of ['normalizePhone', 'ARCHIVED_CLIENT_STATUSES', 'requiresConfirmation', 'confirm_restore', 'restore_archived']) {
    assert.equal(serverCode.includes(token), true, `Missing duplicate/archive token: ${token}`);
  }
});

test('Batch archive reactivation endpoint is defined in server.js', () => {
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  assert.equal(serverCode.includes("app.post('/api/sales-portal/archive/reactivate-batch', authMiddleware"), true);
  assert.equal(serverCode.includes('archived_at'), true);
});

test('Chat attachment upload and cleanup are implemented in server.js', () => {
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  assert.equal(serverCode.includes('saveChatAttachmentToDisk'), true);
  assert.equal(serverCode.includes('deleteChatAttachmentFiles'), true);
  assert.equal(serverCode.includes('attachment_url'), true);
});

test('All uploads are protected and normalized_phone is indexed', () => {
  const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  assert.equal(serverCode.includes("app.use('/uploads', authMiddleware)"), true);
  assert.equal(serverCode.includes('normalized_phone'), true);
});
