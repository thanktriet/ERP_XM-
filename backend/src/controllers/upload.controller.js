const { supabaseAdmin } = require('../config/supabase');
const path = require('path');

// Các loại ảnh hợp lệ
const MIME_ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
// Dung lượng tối đa: 5 MB
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/upload/image
 * Body: multipart/form-data, field "file"
 * Query: bucket (mặc định "vehicle-images"), folder (mặc định "")
 * Trả về: { url: "https://..." }
 */
const uploadImage = async (req, res) => {
  try {
    const file = req.file; // được inject bởi multer (memoryStorage)
    if (!file) {
      return res.status(400).json({ error: 'Vui lòng chọn file ảnh' });
    }

    // Kiểm tra loại file
    if (!MIME_ALLOWED.includes(file.mimetype)) {
      return res.status(400).json({ error: `Chỉ chấp nhận: ${MIME_ALLOWED.join(', ')}` });
    }

    // Kiểm tra dung lượng
    if (file.size > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: 'Ảnh tối đa 5MB' });
    }

    const bucket = req.query.bucket || 'vehicle-images';
    const folder = req.query.folder ? `${req.query.folder}/` : '';
    const ext    = path.extname(file.originalname).toLowerCase() || '.jpg';

    // Tạo tên file duy nhất: <timestamp>-<random>.<ext>
    const fileName = `${folder}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    // Upload lên Supabase Storage
    const { error: upErr } = await supabaseAdmin
      .storage
      .from(bucket)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert:      false,
      });

    if (upErr) {
      // Nếu bucket chưa tồn tại → trả lỗi rõ ràng
      if (upErr.message?.includes('Bucket not found') || upErr.statusCode === '404') {
        return res.status(400).json({
          error: `Storage bucket "${bucket}" chưa tồn tại. Tạo bucket trong Supabase Dashboard → Storage.`,
        });
      }
      return res.status(400).json({ error: upErr.message });
    }

    // Lấy URL công khai
    const { data: urlData } = supabaseAdmin
      .storage
      .from(bucket)
      .getPublicUrl(fileName);

    res.status(201).json({ url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/upload/image
 * Body: { url: "https://..." }
 * Xoá file khỏi Supabase Storage
 */
const deleteImage = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Thiếu url' });

    // Trích path từ URL: .../<bucket>/<path>
    const bucket = req.query.bucket || 'vehicle-images';
    const prefix = `/${bucket}/`;
    const idx    = url.indexOf(prefix);
    if (idx === -1) return res.status(400).json({ error: 'URL không hợp lệ' });

    const filePath = decodeURIComponent(url.slice(idx + prefix.length));

    const { error } = await supabaseAdmin.storage.from(bucket).remove([filePath]);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Đã xoá ảnh' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { uploadImage, deleteImage };
