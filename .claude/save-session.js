/**
 * .claude/save-session.js
 * Được gọi bởi Stop hook — ghi tóm tắt phiên làm việc vào session-log.md
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = 'C:/Users/TRIET/erp-xe-may-dien';
const TMP_FILE = path.join(ROOT, '.claude', '.session-changes.tmp');
const LOG_FILE = path.join(ROOT, '.claude', 'session-log.md');

// ── Đọc danh sách file đã thay đổi ──────────────────────────────────────────
let changedFiles = [];
try {
  const raw = fs.readFileSync(TMP_FILE, 'utf8');
  changedFiles = [...new Set(
    raw.split('\n')
       .map(l => l.trim())
       .filter(Boolean)
  )];
} catch (_) {
  // Không có file tạm → không có gì để ghi
}

// Không có thay đổi nào → bỏ qua, không ghi log trống
if (!changedFiles.length) process.exit(0);

// ── Xác định ngày giờ theo múi giờ VN ───────────────────────────────────────
const now = new Date();
const dateStr = now.toLocaleDateString('vi-VN', {
  timeZone:  'Asia/Ho_Chi_Minh',
  day:   '2-digit',
  month: '2-digit',
  year:  'numeric',
});
const timeStr = now.toLocaleTimeString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour:   '2-digit',
  minute: '2-digit',
});

// ── Phân nhóm file theo thư mục ─────────────────────────────────────────────
const groups = {};
for (const f of changedFiles) {
  const parts  = f.split('/');
  const folder = parts.length > 1 ? parts[0] : '(root)';
  if (!groups[folder]) groups[folder] = [];
  groups[folder].push(f);
}

// ── Tóm tắt nhanh theo pattern tên file ────────────────────────────────────
function guessFeature(files) {
  const hints = [];
  const s = files.join(' ').toLowerCase();
  if (s.includes('auth'))                   hints.push('Xác thực / Auth');
  if (s.includes('customer'))               hints.push('Quản lý khách hàng');
  if (s.includes('inventory') || s.includes('import')) hints.push('Kho xe / Import Excel');
  if (s.includes('sales'))                  hints.push('Bán hàng');
  if (s.includes('warranty'))              hints.push('Bảo hành');
  if (s.includes('finance') || s.includes('accounting')) hints.push('Tài chính / Kế toán');
  if (s.includes('purchase'))              hints.push('Đơn nhập hàng');
  if (s.includes('vehicle'))               hints.push('Mẫu xe');
  if (s.includes('dashboard'))             hints.push('Dashboard');
  if (s.includes('report'))                hints.push('Báo cáo');
  if (s.includes('settings') || s.includes('.claude')) hints.push('Cấu hình hệ thống');
  return hints.length ? hints : ['(không xác định)'];
}

const features = guessFeature(changedFiles);

// ── Sinh nội dung log ────────────────────────────────────────────────────────
const groupLines = Object.entries(groups)
  .map(([folder, files]) => {
    const fileLines = files.map(f => `  - \`${f}\``).join('\n');
    return `**${folder}/**\n${fileLines}`;
  })
  .join('\n\n');

const entry = [
  '',
  '---',
  '',
  `## 📅 Phiên: ${dateStr} ${timeStr}`,
  '',
  '### ✅ Tính năng liên quan',
  ...features.map(f => `- ${f}`),
  '',
  '### 📝 Files đã thay đổi',
  groupLines,
  '',
  '### 🔜 Bước tiếp theo',
  '_Cập nhật thủ công sau khi kết thúc phiên nếu cần_',
  '',
].join('\n');

// ── Khởi tạo file log nếu chưa có ───────────────────────────────────────────
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, [
    '# 📋 Lịch sử phiên làm việc — ERP Xe Máy Điện',
    '',
    '> File này được tự động cập nhật sau mỗi phiên Claude Code.',
    '> Chỉnh sửa thủ công phần "Bước tiếp theo" sau mỗi phiên.',
    '',
  ].join('\n'), 'utf8');
}

// ── Ghi vào cuối file ────────────────────────────────────────────────────────
fs.appendFileSync(LOG_FILE, entry, 'utf8');

// ── Xoá file tạm ─────────────────────────────────────────────────────────────
try { fs.unlinkSync(TMP_FILE); } catch (_) {}

process.exit(0);
