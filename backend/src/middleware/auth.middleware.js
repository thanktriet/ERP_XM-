const { supabaseAdmin } = require('../config/supabase');
require('dotenv').config();

/**
 * Xác thực access_token của Supabase Auth qua GoTrue (không phụ thuộc JWT_SECRET trùng tay trong .env).
 * Gắn req.user: sub (auth user id), email, role (từ bảng users).
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Không có token xác thực' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    const u = authData.user;
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('email', u.email)
      .maybeSingle();

    req.user = {
      sub: u.id,
      email: u.email,
      role: profile?.role ?? undefined,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập' });
  }
  next();
};

module.exports = { authenticate, authorize };
