// Supabase client cho Realtime — dùng anon key, RLS bảo vệ
// Chỉ dùng cho subscription realtime và auth kế toán
// Mọi mutation nghiệp vụ vẫn đi qua Express API (/api/...)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Nếu chưa cấu hình .env.local → export null, tránh crash toàn app
// Các component dùng supabase cần kiểm tra null trước khi gọi
let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnon) {
  supabase = createClient(supabaseUrl, supabaseAnon);
} else {
  console.warn(
    '[supabase] Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY.\n' +
    'Sao chép frontend/.env.local.example thành frontend/.env.local và điền giá trị.\n' +
    'Realtime và module kế toán sẽ không hoạt động cho đến khi cấu hình xong.'
  );
}

export { supabase };
