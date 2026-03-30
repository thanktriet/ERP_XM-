const { supabaseAdmin } = require('../config/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Đăng nhập
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    // Supabase Auth
    const { supabase } = require('../config/supabase');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });

    // Lấy thông tin user từ bảng users
    const { data: userProfile } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    res.json({
      message: 'Đăng nhập thành công',
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: Date.now() + data.session.expires_in * 1000, // ms timestamp hết hạn
      user: {
        id: userProfile?.id,
        email: userProfile?.email,
        full_name: userProfile?.full_name,
        role: userProfile?.role,
        avatar_url: userProfile?.avatar_url,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Làm mới access token bằng refresh token
const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Thiếu refresh token' });
  }
  try {
    const { supabase } = require('../config/supabase');
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      return res.status(401).json({ error: 'Refresh token không hợp lệ hoặc đã hết hạn' });
    }
    res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: Date.now() + data.session.expires_in * 1000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Đăng xuất
const logout = async (req, res) => {
  const { supabase } = require('../config/supabase');
  await supabase.auth.signOut();
  res.json({ message: 'Đăng xuất thành công' });
};

// Lấy thông tin user hiện tại
const getMe = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone, role, is_active, avatar_url, created_at')
      .eq('email', req.user.email)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy user' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Quản lý người dùng (chỉ admin/manager) ──────────────────────────────────

// Danh sách nhân viên
const getUsers = async (req, res) => {
  try {
    const { search, role, is_active } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    let q = supabaseAdmin
      .from('users')
      .select('id, email, full_name, phone, role, is_active, avatar_url, created_at', { count: 'exact' })
      .order('full_name');

    if (search)    q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    if (role)      q = q.eq('role', role);
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true');

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo nhân viên mới
const createUser = async (req, res) => {
  const { email, password, full_name, phone, role } = req.body;
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc: email, password, full_name, role' });
  }
  try {
    const { supabase: supabaseClient } = require('../config/supabase');

    // Tạo tài khoản Supabase Auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr) return res.status(400).json({ error: authErr.message });

    // Tạo profile trong bảng users (dùng email làm khóa liên kết)
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('users')
      .insert([{ email, full_name, phone: phone || null, role, is_active: true }])
      .select('id, email, full_name, phone, role, is_active, created_at')
      .single();

    if (profileErr) {
      // Rollback: xóa auth user nếu insert profile thất bại
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: profileErr.message });
    }

    res.status(201).json({ message: `Đã tạo tài khoản ${full_name}`, data: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật thông tin nhân viên
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['full_name', 'phone', 'role', 'avatar_url'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ error: 'Không có trường nào được cập nhật' });

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, email, full_name, phone, role, is_active, avatar_url')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật thông tin', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Bật/tắt tài khoản nhân viên
const toggleUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Không cho phép vô hiệu hóa chính mình
    if (req.user.sub === id || req.user.id === id)
      return res.status(409).json({ error: 'Không thể vô hiệu hóa tài khoản đang đăng nhập' });

    const { data: cur, error: fetchErr } = await supabaseAdmin
      .from('users').select('is_active, full_name').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ is_active: !cur.is_active })
      .eq('id', id)
      .select('id, email, full_name, role, is_active')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    const action = data.is_active ? 'kích hoạt' : 'vô hiệu hóa';
    res.json({ message: `Đã ${action} tài khoản ${cur.full_name}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Đổi mật khẩu (admin đổi cho người khác, hoặc tự đổi)
const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });

    // Lấy email của user cần đổi
    const { data: target, error: fetchErr } = await supabaseAdmin
      .from('users').select('email, full_name').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });

    // Tìm Supabase Auth user bằng email
    const { data: authList } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = authList?.users?.find(u => u.email === target.email);
    if (!authUser) return res.status(404).json({ error: 'Không tìm thấy tài khoản xác thực' });

    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password });
    if (pwErr) return res.status(400).json({ error: pwErr.message });

    res.json({ message: `Đã đổi mật khẩu cho ${target.full_name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { login, refresh, logout, getMe, getUsers, createUser, updateUser, toggleUser, changePassword };
