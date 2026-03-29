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

module.exports = { login, refresh, logout, getMe };
