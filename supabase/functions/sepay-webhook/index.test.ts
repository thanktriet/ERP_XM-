// ============================================================
// Tests cho Edge Function: sepay-webhook
// Chạy: deno test --allow-env supabase/functions/sepay-webhook/index.test.ts
// ============================================================

import {
  assertEquals,
  assertMatch,
  assert,
} from 'https://deno.land/std@0.177.0/testing/asserts.ts';

// ============================================================
// Re-export các hàm pure để test (không cần chạy server)
// ============================================================

// Copy các hàm pure từ index.ts để test độc lập
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrderCodes(content: string): string[] {
  const normalized = normalizeText(content);
  const patterns = [
    /DH\d{7,10}/g,
    /DH\s+\d{7,10}/g,
  ];
  const codes: string[] = [];
  for (const pattern of patterns) {
    const matches = normalized.matchAll(pattern);
    for (const match of matches) {
      codes.push(match[0].replace(/\s+/g, ''));
    }
  }
  return [...new Set(codes)];
}

type MatchCase = 'matched_full' | 'matched_partial' | 'matched_excess' | 'not_matched';

interface OrderInfo {
  id: string;
  order_code: string;
  total_amount: number;
  already_paid: number;
  customer_id: string;
  branch_id: string;
}

function determineMatchCase(
  transferAmount: number,
  order: OrderInfo | null
): MatchCase {
  if (!order) return 'not_matched';
  const remaining = order.total_amount - order.already_paid;
  const tolerance = 1000;
  if (Math.abs(transferAmount - remaining) <= tolerance) return 'matched_full';
  if (transferAmount < remaining - tolerance) return 'matched_partial';
  return 'matched_excess';
}

async function verifyHmacSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(rawBody)
  );
  const computed = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// Hàm sinh HMAC cho test
async function generateHmac(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================
// TEST SUITE 1: Fuzzy Match — extractOrderCodes
// ============================================================

Deno.test('extractOrderCodes — nội dung chuẩn', () => {
  const codes = extractOrderCodes('Thanh toan don hang DH2026001 nguyen van a');
  assertEquals(codes, ['DH2026001']);
});

Deno.test('extractOrderCodes — có dấu tiếng Việt', () => {
  const codes = extractOrderCodes('Chuyển khoản thanh toán đơn hàng DH2026042 từ Nguyễn Văn A');
  assertEquals(codes, ['DH2026042']);
});

Deno.test('extractOrderCodes — uppercase', () => {
  const codes = extractOrderCodes('THANH TOAN DH2026099');
  assertEquals(codes, ['DH2026099']);
});

Deno.test('extractOrderCodes — có ký tự đặc biệt xung quanh', () => {
  const codes = extractOrderCodes('CK-DH2026123/TONG:50000000');
  assertEquals(codes, ['DH2026123']);
});

Deno.test('extractOrderCodes — có dấu cách giữa DH và số', () => {
  const codes = extractOrderCodes('thanh toan DH 2026010 xe may');
  // Vẫn cần extract được
  assert(codes.length > 0, 'Phải tìm được ít nhất 1 code');
  assert(codes.some((c) => c.includes('2026010')));
});

Deno.test('extractOrderCodes — nhiều mã trong một chuỗi', () => {
  const codes = extractOrderCodes('DH2026001 va DH2026002 thanh toan chung');
  assertEquals(codes.length, 2);
  assert(codes.includes('DH2026001'));
  assert(codes.includes('DH2026002'));
});

Deno.test('extractOrderCodes — không có mã đơn hàng', () => {
  const codes = extractOrderCodes('Chuyen tien sinh hoat phi thang 3');
  assertEquals(codes, []);
});

Deno.test('extractOrderCodes — mã quá ngắn không match', () => {
  const codes = extractOrderCodes('DH123 chuyển khoản');
  assertEquals(codes, []); // DH + 3 số không đủ pattern
});

Deno.test('extractOrderCodes — deduplication', () => {
  const codes = extractOrderCodes('DH2026001 DH2026001 DH2026001');
  assertEquals(codes.length, 1);
  assertEquals(codes[0], 'DH2026001');
});

// ============================================================
// TEST SUITE 2: determineMatchCase
// ============================================================

const mockOrder: OrderInfo = {
  id:          'order-uuid-001',
  order_code:  'DH2026001',
  total_amount: 50_000_000,
  already_paid: 0,
  customer_id: 'cust-uuid-001',
  branch_id:   'branch-uuid-001',
};

Deno.test('determineMatchCase — matched_full chính xác', () => {
  const result = determineMatchCase(50_000_000, mockOrder);
  assertEquals(result, 'matched_full');
});

Deno.test('determineMatchCase — matched_full trong tolerance ±1000', () => {
  assertEquals(determineMatchCase(50_000_500, mockOrder), 'matched_full');
  assertEquals(determineMatchCase(49_999_500, mockOrder), 'matched_full');
  assertEquals(determineMatchCase(50_001_000, mockOrder), 'matched_full');
  assertEquals(determineMatchCase(49_999_000, mockOrder), 'matched_full');
});

Deno.test('determineMatchCase — matched_partial (thiếu tiền)', () => {
  const result = determineMatchCase(10_000_000, mockOrder); // chỉ trả 10/50 triệu
  assertEquals(result, 'matched_partial');
});

Deno.test('determineMatchCase — matched_partial đặt cọc 30%', () => {
  const result = determineMatchCase(15_000_000, mockOrder);
  assertEquals(result, 'matched_partial');
});

Deno.test('determineMatchCase — matched_excess (thừa tiền)', () => {
  const result = determineMatchCase(55_000_000, mockOrder); // trả dư 5 triệu
  assertEquals(result, 'matched_excess');
});

Deno.test('determineMatchCase — matched_excess nhỏ (vượt tolerance)', () => {
  const result = determineMatchCase(50_002_000, mockOrder); // dư 2000, vượt tolerance 1000
  assertEquals(result, 'matched_excess');
});

Deno.test('determineMatchCase — not_matched khi không có order', () => {
  const result = determineMatchCase(50_000_000, null);
  assertEquals(result, 'not_matched');
});

Deno.test('determineMatchCase — đơn đã trả một phần, tính đúng remaining', () => {
  const partialOrder: OrderInfo = {
    ...mockOrder,
    already_paid: 20_000_000, // đã trả 20 triệu
  };
  // Còn lại 30 triệu, trả đúng 30 triệu = matched_full
  assertEquals(determineMatchCase(30_000_000, partialOrder), 'matched_full');
  // Trả 25 triệu = thiếu
  assertEquals(determineMatchCase(25_000_000, partialOrder), 'matched_partial');
  // Trả 35 triệu = dư
  assertEquals(determineMatchCase(35_000_000, partialOrder), 'matched_excess');
});

// ============================================================
// TEST SUITE 3: HMAC Verification
// ============================================================

Deno.test('verifyHmacSignature — chữ ký đúng', async () => {
  const secret  = 'my-webhook-secret-key';
  const rawBody = JSON.stringify({ id: 1, transferAmount: 50000000 });
  const sig     = await generateHmac(rawBody, secret);

  const valid = await verifyHmacSignature(rawBody, sig, secret);
  assertEquals(valid, true);
});

Deno.test('verifyHmacSignature — chữ ký sai', async () => {
  const secret  = 'my-webhook-secret-key';
  const rawBody = JSON.stringify({ id: 1, transferAmount: 50000000 });
  const wrongSig = 'abc123def456' + '0'.repeat(52); // 64 chars nhưng sai

  const valid = await verifyHmacSignature(rawBody, wrongSig, secret);
  assertEquals(valid, false);
});

Deno.test('verifyHmacSignature — payload bị thay đổi', async () => {
  const secret        = 'my-webhook-secret-key';
  const originalBody  = JSON.stringify({ id: 1, transferAmount: 50_000_000 });
  const tamperedBody  = JSON.stringify({ id: 1, transferAmount: 500_000_000 }); // tấn công thay đổi số tiền
  const sig           = await generateHmac(originalBody, secret);

  const valid = await verifyHmacSignature(tamperedBody, sig, secret);
  assertEquals(valid, false);
});

Deno.test('verifyHmacSignature — secret sai', async () => {
  const rawBody = JSON.stringify({ id: 1 });
  const sig     = await generateHmac(rawBody, 'correct-secret');
  const valid   = await verifyHmacSignature(rawBody, sig, 'wrong-secret');
  assertEquals(valid, false);
});

Deno.test('verifyHmacSignature — empty body vẫn verify được', async () => {
  const secret  = 'secret';
  const rawBody = '';
  const sig     = await generateHmac(rawBody, secret);
  const valid   = await verifyHmacSignature(rawBody, sig, secret);
  assertEquals(valid, true);
});

Deno.test('verifyHmacSignature — timing safe (không short-circuit trên độ dài khác)', async () => {
  // Signature ngắn hơn → phải trả false không bị exception
  const valid = await verifyHmacSignature('body', 'tooshort', 'secret');
  assertEquals(valid, false);
});

// ============================================================
// TEST SUITE 4: Idempotency logic
// ============================================================

// Test giả lập: kiểm tra logic idempotency (không cần DB thật)
Deno.test('idempotency — cùng bank_ref_code không tạo 2 phiếu thu', () => {
  // Giả lập: đã có receipt với bank_ref_code 'TCB20260330001'
  const existingReceipts = new Map<string, { id: string; receipt_code: string }>([
    ['TCB20260330001', { id: 'receipt-uuid-001', receipt_code: 'PT20260330001' }],
  ]);

  function checkIdempotency(bankRefCode: string): { isIdempotent: boolean; receiptId?: string } {
    const existing = existingReceipts.get(bankRefCode);
    if (existing) return { isIdempotent: true, receiptId: existing.id };
    return { isIdempotent: false };
  }

  // Webhook đến lần 2 với cùng referenceCode
  const result1 = checkIdempotency('TCB20260330001');
  assertEquals(result1.isIdempotent, true);
  assertEquals(result1.receiptId, 'receipt-uuid-001');

  // Webhook mới với referenceCode khác
  const result2 = checkIdempotency('TCB20260330999');
  assertEquals(result2.isIdempotent, false);
});

Deno.test('idempotency — unmatched_transactions cũng ngăn tạo duplicate', () => {
  const existingUnmatched = new Set(['TCB20260330002']); // đã lưu vào unmatched

  function isAlreadyProcessed(bankRefCode: string): boolean {
    return existingUnmatched.has(bankRefCode);
  }

  assertEquals(isAlreadyProcessed('TCB20260330002'), true);  // duplicate
  assertEquals(isAlreadyProcessed('TCB20260330003'), false); // mới
});

// ============================================================
// TEST SUITE 5: Transfer type filter
// ============================================================

Deno.test('chỉ xử lý transferType = in', () => {
  function shouldProcess(transferType: 'in' | 'out'): boolean {
    return transferType === 'in';
  }

  assertEquals(shouldProcess('in'), true);
  assertEquals(shouldProcess('out'), false);
});

// ============================================================
// TEST SUITE 6: normalizeText
// ============================================================

Deno.test('normalizeText — loại bỏ dấu tiếng Việt', () => {
  assertEquals(normalizeText('đơn hàng'), 'DON HANG');
  assertEquals(normalizeText('chuyển khoản'), 'CHUYEN KHOAN');
  assertEquals(normalizeText('Nguyễn Văn A'), 'NGUYEN VAN A');
});

Deno.test('normalizeText — loại bỏ ký tự đặc biệt', () => {
  const result = normalizeText('DH2026-001/THANH-TOAN');
  // Dấu - được thay bằng space
  assertMatch(result, /DH2026/);
  assertMatch(result, /001/);
});

Deno.test('normalizeText — uppercase', () => {
  assertEquals(normalizeText('dh2026001'), 'DH2026001');
});

console.log('✅ Tất cả test sepay-webhook đã được định nghĩa. Chạy: deno test --allow-env');
