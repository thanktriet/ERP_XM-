/**
 * Script chạy migration cho bảng accessories & gifts
 *
 * CÁCH DÙNG:
 *   node scripts/run_migration.js <DB_PASSWORD>
 *
 * DB_PASSWORD: lấy ở Supabase Dashboard → Settings → Database → Database password
 * (khác với service_role key)
 *
 * Hoặc set biến môi trường SUPABASE_DB_PASSWORD=xxx node scripts/run_migration.js
 */

require('dotenv').config({ path: './backend/.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'zmqukcucgpjhmyfjcjvd';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.argv[2];

if (!DB_PASSWORD) {
  console.error('\n❌ Thiếu DB password!');
  console.error('   Lấy tại: Supabase Dashboard → Settings → Database → Database password');
  console.error('   Chạy: node scripts/run_migration.js <password>');
  console.error('   Hoặc: SUPABASE_DB_PASSWORD=xxx node scripts/run_migration.js\n');
  process.exit(1);
}

const SQL_FILE = path.join(__dirname, '..', 'backend', 'migrations', 'add_accessories_and_gifts.sql');
const sql = fs.readFileSync(SQL_FILE, 'utf8');

const client = new Client({
  host:     `aws-0-ap-southeast-1.pooler.supabase.com`,
  port:     5432,
  database: 'postgres',
  user:     `postgres.${PROJECT_REF}`,
  password: DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
});

async function run() {
  console.log('🔌 Đang kết nối Supabase...');
  await client.connect();
  console.log('✅ Kết nối thành công!\n');
  console.log('📦 Đang chạy migration: add_accessories_and_gifts.sql');
  console.log('   ' + '-'.repeat(50));

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('\n✅ Migration chạy thành công!');

    // Verify
    const r1 = await client.query("SELECT COUNT(*) FROM accessories");
    const r2 = await client.query("SELECT COUNT(*) FROM gift_items");
    const r3 = await client.query("SELECT COUNT(*) FROM item_movements");
    const r4 = await client.query("SELECT COUNT(*) FROM order_gifts");
    console.log('\n📊 Kết quả verify:');
    console.log('   accessories:    ', r1.rows[0].count, 'rows');
    console.log('   gift_items:     ', r2.rows[0].count, 'rows');
    console.log('   item_movements: ', r3.rows[0].count, 'rows');
    console.log('   order_gifts:    ', r4.rows[0].count, 'rows');

    // Kiểm tra views
    const r5 = await client.query(`
      SELECT viewname FROM pg_views
      WHERE schemaname='public' AND viewname IN ('v_accessory_stock_alert','v_gift_stock_alert')
    `);
    console.log('\n📊 Views tạo được:', r5.rows.map(r=>r.viewname).join(', '));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Lỗi migration:', err.message);
    console.error('   Hint:', err.hint || 'N/A');
    process.exit(1);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
