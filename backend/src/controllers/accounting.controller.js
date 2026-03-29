const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════════════════════
// TỔNG QUAN / DASHBOARD KẾ TOÁN
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/dashboard
const getDashboard = async (req, res) => {
  try {
    const orgId = req.query.org_id || '00000000-0000-0000-0000-000000000001';

    const now    = new Date();
    const year   = now.getFullYear();
    const month  = now.getMonth() + 1;

    // Chạy song song: số dư tháng hiện tại + công nợ + sync queue
    const [balancesRes, arRes, apRes, syncRes] = await Promise.all([
      // Tổng số dư hợp nhất tháng hiện tại (từ view)
      supabaseAdmin
        .from('v_acc_consolidated_balances')
        .select('account_code,account_name,account_type,closing_debit,closing_credit')
        .eq('org_id', orgId)
        .eq('year', year)
        .eq('month', month),

      // Tổng công nợ phải thu
      supabaseAdmin
        .from('v_acc_ar_outstanding')
        .select('balance_due,earliest_due')
        .eq('org_id', orgId),

      // Tổng công nợ phải trả (từ acc_suppliers)
      supabaseAdmin
        .from('acc_suppliers')
        .select('balance_due')
        .eq('org_id', orgId)
        .gt('balance_due', 0),

      // Hàng đợi sync AMIS cần xử lý
      supabaseAdmin
        .from('v_acc_sync_pending')
        .select('id,voucher_number,status,error_code')
        .limit(10),
    ]);

    // Tổng hợp số liệu
    const balances   = balancesRes.data  || [];
    const arList     = arRes.data        || [];
    const apList     = apRes.data        || [];
    const syncPending = syncRes.data     || [];

    // Tính tổng AR
    const totalAR = arList.reduce((s, r) => s + Number(r.balance_due || 0), 0);
    const overdueAR = arList.filter(r =>
      r.earliest_due && new Date(r.earliest_due) < now
    ).reduce((s, r) => s + Number(r.balance_due || 0), 0);

    // Tính tổng AP
    const totalAP = apList.reduce((s, r) => s + Number(r.balance_due || 0), 0);

    // Tóm tắt doanh thu / chi phí tháng hiện tại
    const revenueAccounts = balances.filter(b => b.account_type === 'revenue');
    const expenseAccounts = balances.filter(b =>
      ['expense','cogs'].includes(b.account_type)
    );
    const totalRevenue = revenueAccounts.reduce((s, b) =>
      s + Number(b.closing_credit || 0), 0
    );
    const totalExpense = expenseAccounts.reduce((s, b) =>
      s + Number(b.closing_debit || 0), 0
    );

    res.json({
      period: { year, month },
      summary: {
        revenue:        totalRevenue,
        expense:        totalExpense,
        gross_profit:   totalRevenue - totalExpense,
        ar_total:       totalAR,
        ar_overdue:     overdueAR,
        ap_total:       totalAP,
      },
      amis_sync: {
        pending_count:  syncPending.filter(s => s.status === 'pending').length,
        failed_count:   syncPending.filter(s => s.status === 'failed').length,
        items:          syncPending,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// KỲ KẾ TOÁN (Fiscal Periods)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/periods
const getFiscalPeriods = async (req, res) => {
  try {
    const orgId = req.query.org_id || '00000000-0000-0000-0000-000000000001';
    const { data, error } = await supabaseAdmin
      .from('acc_fiscal_periods')
      .select('*')
      .eq('org_id', orgId)
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/accounting/periods
const createFiscalPeriod = async (req, res) => {
  try {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const { year, month } = req.body;

    // Tính ngày đầu / cuối tháng
    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 0);     // ngày 0 của tháng sau = cuối tháng này

    const periodName = `Tháng ${String(month).padStart(2,'0')}/${year}`;

    const { data, error } = await supabaseAdmin
      .from('acc_fiscal_periods')
      .insert([{
        org_id:      orgId,
        period_name: periodName,
        year,
        month,
        start_date:  startDate.toISOString().slice(0, 10),
        end_date:    endDate.toISOString().slice(0, 10),
        status:      'open',
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: `Kỳ ${periodName} đã tồn tại` });
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ message: `Đã tạo kỳ kế toán ${periodName}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/accounting/periods/:id/status
const updatePeriodStatus = async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;  // 'closed' | 'locked'

    // Không cho mở lại kỳ đã locked
    const { data: current } = await supabaseAdmin
      .from('acc_fiscal_periods')
      .select('status,period_name')
      .eq('id', id)
      .single();

    if (!current) return res.status(404).json({ error: 'Không tìm thấy kỳ kế toán' });
    if (current.status === 'locked')
      return res.status(409).json({ error: `Kỳ ${current.period_name} đã khoá vĩnh viễn, không thể thay đổi` });

    const { data, error } = await supabaseAdmin
      .from('acc_fiscal_periods')
      .update({ status, closed_by: req.user.sub, closed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đã cập nhật kỳ ${current.period_name} → ${status}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// TÀI KHOẢN KẾ TOÁN (Chart of Accounts)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/accounts
const getAccounts = async (req, res) => {
  try {
    const orgId      = req.query.org_id || '00000000-0000-0000-0000-000000000001';
    const { search, account_type, is_detail, is_active = 'true' } = req.query;

    let q = supabaseAdmin
      .from('acc_accounts')
      .select('*')
      .eq('org_id', orgId)
      .order('account_code');

    if (is_active !== 'all')
      q = q.eq('is_active', is_active === 'true');
    if (account_type)
      q = q.eq('account_type', account_type);
    if (is_detail !== undefined)
      q = q.eq('is_detail', is_detail === 'true');
    if (search)
      q = q.or(`account_code.ilike.%${search}%,account_name.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/accounting/accounts
const createAccount = async (req, res) => {
  try {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const { account_code, account_name, account_name_en, parent_code,
            level, account_type, normal_balance, is_detail, description } = req.body;

    // Kiểm tra mã chưa tồn tại
    const { data: exists } = await supabaseAdmin
      .from('acc_accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('account_code', account_code)
      .single();

    if (exists) return res.status(409).json({ error: `Mã tài khoản ${account_code} đã tồn tại` });

    const { data, error } = await supabaseAdmin
      .from('acc_accounts')
      .insert([{
        org_id: orgId,
        account_code, account_name, account_name_en,
        parent_code, level: level || 3,
        account_type, normal_balance,
        is_detail: is_detail !== false,
        description,
        display_order: 0,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Đã tạo tài khoản kế toán', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/accounting/accounts/:id
const updateAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    ['account_name','account_name_en','description','is_detail','is_active']
      .forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await supabaseAdmin
      .from('acc_accounts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    res.json({ message: 'Đã cập nhật tài khoản', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// NHÀ CUNG CẤP (Suppliers)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/suppliers
const getSuppliers = async (req, res) => {
  try {
    const orgId  = req.query.org_id || '00000000-0000-0000-0000-000000000001';
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const search = req.query.search;

    let q = supabaseAdmin
      .from('acc_suppliers')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('supplier_name');

    if (req.query.is_active !== 'all')
      q = q.eq('is_active', req.query.is_active !== 'false');
    if (search)
      q = q.or(`supplier_name.ilike.%${search}%,supplier_code.ilike.%${search}%,phone.ilike.%${search}%`);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/accounting/suppliers
const createSupplier = async (req, res) => {
  try {
    const orgId = '00000000-0000-0000-0000-000000000001';

    // Tự sinh supplier_code: NCC000001
    const { count } = await supabaseAdmin
      .from('acc_suppliers')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId);

    const supplierCode = `NCC${String((count || 0) + 1).padStart(6, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('acc_suppliers')
      .insert([{ org_id: orgId, supplier_code: supplierCode, ...req.body }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: 'Đã thêm nhà cung cấp', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/accounting/suppliers/:id
const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['supplier_name','contact_person','phone','email','address',
                     'tax_code','bank_account','bank_name','payment_terms',
                     'credit_limit','is_active','notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await supabaseAdmin
      .from('acc_suppliers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    res.json({ message: 'Đã cập nhật nhà cung cấp', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/accounting/suppliers/:id
const getSupplierDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const [supplierRes, apRes] = await Promise.all([
      supabaseAdmin.from('acc_suppliers').select('*').eq('id', id).single(),
      supabaseAdmin
        .from('acc_ap_ledger')
        .select('*')
        .eq('supplier_id', id)
        .order('voucher_date', { ascending: false })
        .limit(20),
    ]);

    if (!supplierRes.data) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    res.json({ supplier: supplierRes.data, ap_ledger: apRes.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHỨNG TỪ KẾ TOÁN (Vouchers)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/vouchers
const getVouchers = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const { voucher_type, status, branch_id, from_date, to_date, search } = req.query;

    let q = supabaseAdmin
      .from('acc_vouchers')
      .select(`
        id, voucher_number, voucher_type, voucher_date, status,
        description, total_debit, total_credit, amis_sync_status,
        created_at,
        acc_branches ( branch_code, branch_name ),
        customers    ( customer_code, full_name )
      `, { count: 'exact' })
      .order('voucher_date', { ascending: false })
      .order('created_at',   { ascending: false });

    if (voucher_type) q = q.eq('voucher_type', voucher_type);
    if (status)       q = q.eq('status', status);
    if (branch_id)    q = q.eq('branch_id', branch_id);
    if (from_date)    q = q.gte('voucher_date', from_date);
    if (to_date)      q = q.lte('voucher_date', to_date);
    if (search)       q = q.ilike('voucher_number', `%${search}%`);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/accounting/vouchers/:id
const getVoucherDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const [voucherRes, linesRes] = await Promise.all([
      supabaseAdmin
        .from('acc_vouchers')
        .select(`
          *,
          acc_branches    ( branch_code, branch_name ),
          customers       ( customer_code, full_name, phone ),
          acc_suppliers   ( supplier_code, supplier_name ),
          acc_fiscal_periods ( period_name, status )
        `)
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('acc_journal_entry_lines')
        .select(`
          id, line_number, account_code, description,
          debit_amount, credit_amount,
          acc_accounts ( account_name, account_type )
        `)
        .eq('voucher_id', id)
        .order('line_number'),
    ]);

    if (!voucherRes.data) return res.status(404).json({ error: 'Không tìm thấy chứng từ' });
    res.json({ voucher: voucherRes.data, lines: linesRes.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/accounting/vouchers — Tạo chứng từ + bút toán (draft)
const createVoucher = async (req, res) => {
  try {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const {
      branch_id, voucher_type, voucher_date, fiscal_period_id,
      description, customer_id, supplier_id,
      reference_type, reference_id, lines,
    } = req.body;

    // Kiểm tra kỳ kế toán còn mở
    const { data: period } = await supabaseAdmin
      .from('acc_fiscal_periods')
      .select('status, period_name')
      .eq('id', fiscal_period_id)
      .single();

    if (!period) return res.status(404).json({ error: 'Không tìm thấy kỳ kế toán' });
    if (period.status !== 'open')
      return res.status(409).json({ error: `Kỳ ${period.period_name} đã bị khoá, không thể tạo chứng từ` });

    // Tự sinh voucher_number
    const typeCode = {
      receipt: 'PT', payment: 'PC', journal: 'BK',
      sales_invoice: 'HDB', purchase_invoice: 'HDM',
      inventory_in: 'PKN', inventory_out: 'PXK',
      intercompany: 'NB', allocation: 'KB',
    }[voucher_type] || 'BK';

    const yyyymm = voucher_date.slice(0, 7).replace('-', '');
    const { count } = await supabaseAdmin
      .from('acc_vouchers')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .like('voucher_number', `${typeCode}${yyyymm}%`);

    const voucherNumber = `${typeCode}${yyyymm}${String((count || 0) + 1).padStart(4, '0')}`;

    // Tạo header chứng từ
    const { data: voucher, error: vErr } = await supabaseAdmin
      .from('acc_vouchers')
      .insert([{
        org_id: orgId,
        branch_id, voucher_type, voucher_date, fiscal_period_id,
        voucher_number: voucherNumber,
        description, customer_id, supplier_id,
        reference_type, reference_id,
        status: 'draft',
        created_by: req.user.sub,
      }])
      .select()
      .single();

    if (vErr) return res.status(400).json({ error: vErr.message });

    // Lấy account_code cho từng dòng
    const accountIds = [...new Set(lines.map(l => l.account_id))];
    const { data: accounts } = await supabaseAdmin
      .from('acc_accounts')
      .select('id, account_code, is_detail')
      .in('id', accountIds);

    const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));

    // Kiểm tra tài khoản phải là is_detail=true
    for (const ln of lines) {
      const acc = accountMap[ln.account_id];
      if (!acc) return res.status(400).json({ error: `Không tìm thấy tài khoản ${ln.account_id}` });
      if (!acc.is_detail)
        return res.status(400).json({ error: `Tài khoản ${acc.account_code} là tài khoản tổng hợp, không được hạch toán` });
    }

    // Tạo bút toán chi tiết
    const lineRows = lines.map((ln, idx) => ({
      voucher_id:    voucher.id,
      line_number:   idx + 1,
      account_id:    ln.account_id,
      account_code:  accountMap[ln.account_id].account_code,
      description:   ln.description || null,
      debit_amount:  ln.debit_amount  || 0,
      credit_amount: ln.credit_amount || 0,
      customer_id:   ln.customer_id  || null,
      supplier_id:   ln.supplier_id  || null,
    }));

    const { error: lErr } = await supabaseAdmin
      .from('acc_journal_entry_lines')
      .insert(lineRows);

    if (lErr) {
      // Rollback: xóa voucher vừa tạo
      await supabaseAdmin.from('acc_vouchers').delete().eq('id', voucher.id);
      return res.status(400).json({ error: lErr.message });
    }

    res.status(201).json({ message: `Đã tạo chứng từ ${voucherNumber}`, data: voucher });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/accounting/vouchers/:id/post — Vào sổ (draft → posted)
const postVoucher = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabaseAdmin
      .from('acc_vouchers')
      .select('status, voucher_number')
      .eq('id', id)
      .single();

    if (!current) return res.status(404).json({ error: 'Không tìm thấy chứng từ' });
    if (current.status !== 'draft')
      return res.status(409).json({ error: `Chứng từ ${current.voucher_number} đang ở trạng thái ${current.status}, chỉ được vào sổ từ draft` });

    // Trigger fn_validate_voucher_balance sẽ kiểm tra Nợ=Có tự động
    const { data, error } = await supabaseAdmin
      .from('acc_vouchers')
      .update({ status: 'posted', posted_by: req.user.sub, posted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // Lỗi từ trigger (lệch sổ, kỳ khoá...) trả về message rõ ràng
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: `Chứng từ ${current.voucher_number} đã vào sổ thành công`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/accounting/vouchers/:id/reverse — Đảo bút toán
const reverseVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: original, error: oErr } = await supabaseAdmin
      .from('acc_vouchers')
      .select(`*, acc_journal_entry_lines(*)`)
      .eq('id', id)
      .single();

    if (oErr || !original)
      return res.status(404).json({ error: 'Không tìm thấy chứng từ' });
    if (original.status !== 'posted')
      return res.status(409).json({ error: 'Chỉ đảo được chứng từ đã vào sổ' });

    // Tạo chứng từ đảo (đổi chiều Nợ ↔ Có)
    const reversalNumber = `${original.voucher_number}-ĐẢO`;
    const today = new Date().toISOString().slice(0, 10);

    const { data: reversal, error: rErr } = await supabaseAdmin
      .from('acc_vouchers')
      .insert([{
        org_id:           original.org_id,
        branch_id:        original.branch_id,
        voucher_type:     original.voucher_type,
        voucher_date:     today,
        fiscal_period_id: original.fiscal_period_id,
        voucher_number:   reversalNumber,
        description:      `Đảo bút toán: ${original.voucher_number}. Lý do: ${reason || 'không ghi chú'}`,
        customer_id:      original.customer_id,
        supplier_id:      original.supplier_id,
        reverse_of:       original.id,
        status:           'draft',
        created_by:       req.user.sub,
      }])
      .select()
      .single();

    if (rErr) return res.status(400).json({ error: rErr.message });

    // Tạo bút toán đảo (đổi chiều)
    const reversalLines = original.acc_journal_entry_lines.map((ln, idx) => ({
      voucher_id:    reversal.id,
      line_number:   idx + 1,
      account_id:    ln.account_id,
      account_code:  ln.account_code,
      description:   `Đảo: ${ln.description || ''}`,
      debit_amount:  ln.credit_amount,  // Đảo chiều
      credit_amount: ln.debit_amount,   // Đảo chiều
      customer_id:   ln.customer_id,
      supplier_id:   ln.supplier_id,
    }));

    await supabaseAdmin.from('acc_journal_entry_lines').insert(reversalLines);

    // Đánh dấu chứng từ gốc đã bị đảo
    await supabaseAdmin
      .from('acc_vouchers')
      .update({ status: 'reversed', reversed_by: req.user.sub, reversed_at: new Date().toISOString() })
      .eq('id', id);

    res.status(201).json({
      message: `Đã tạo chứng từ đảo ${reversalNumber}`,
      data: reversal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// SỔ CÁI / BÁO CÁO (Reports)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/accounting/trial-balance?year=2026&month=3&branch_id=...
const getTrialBalance = async (req, res) => {
  try {
    const orgId    = '00000000-0000-0000-0000-000000000001';
    const { year, month, branch_id } = req.query;
    if (!year || !month)
      return res.status(400).json({ error: 'Cần truyền year và month' });

    let q = supabaseAdmin
      .from('v_acc_consolidated_balances')
      .select('*')
      .eq('org_id', orgId)
      .eq('year', parseInt(year))
      .eq('month', parseInt(month))
      .order('account_code');

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    const totalDebit  = data.reduce((s, r) => s + Number(r.period_debit  || 0), 0);
    const totalCredit = data.reduce((s, r) => s + Number(r.period_credit || 0), 0);

    res.json({ data, total_debit: totalDebit, total_credit: totalCredit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/accounting/general-ledger?account_code=1111&from_date=...&to_date=...
const getGeneralLedger = async (req, res) => {
  try {
    const { account_code, from_date, to_date, branch_id } = req.query;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);

    let q = supabaseAdmin
      .from('v_acc_general_ledger')
      .select('*', { count: 'exact' });

    if (account_code) q = q.eq('account_code', account_code);
    if (branch_id)    q = q.eq('branch_id', branch_id);
    if (from_date)    q = q.gte('voucher_date', from_date);
    if (to_date)      q = q.lte('voucher_date', to_date);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/accounting/ar-outstanding — Công nợ phải thu tồn
const getAROutstanding = async (req, res) => {
  try {
    const { branch_id, customer_id } = req.query;
    let q = supabaseAdmin.from('v_acc_ar_outstanding').select('*');
    if (branch_id)   q = q.eq('branch_id', branch_id);
    if (customer_id) q = q.eq('customer_id', customer_id);
    q = q.order('earliest_due', { nullsFirst: false });
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    const total = data.reduce((s, r) => s + Number(r.balance_due || 0), 0);
    res.json({ data, total_outstanding: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/accounting/amis-sync — Trạng thái đồng bộ AMIS
const getAmisSyncStatus = async (req, res) => {
  try {
    const { status } = req.query;
    let q = supabaseAdmin
      .from('v_acc_sync_pending')
      .select('*')
      .limit(50);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/accounting/amis-sync/:queueId/retry — Thử lại sync 1 item
const retryAmisSyncItem = async (req, res) => {
  try {
    const { queueId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('acc_sync_queue')
      .update({ status: 'pending', next_retry_at: null, error_message: null })
      .eq('id', queueId)
      .in('status', ['failed','skipped'])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Không tìm thấy item hoặc không thể retry' });
    res.json({ message: 'Đã đưa vào hàng đợi retry', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getDashboard,
  getFiscalPeriods, createFiscalPeriod, updatePeriodStatus,
  getAccounts, createAccount, updateAccount,
  getSuppliers, createSupplier, updateSupplier, getSupplierDetail,
  getVouchers, getVoucherDetail, createVoucher, postVoucher, reverseVoucher,
  getTrialBalance, getGeneralLedger, getAROutstanding,
  getAmisSyncStatus, retryAmisSyncItem,
};
