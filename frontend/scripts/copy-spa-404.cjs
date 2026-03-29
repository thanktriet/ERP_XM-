/* GitHub Pages: phục vụ 404.html = index.html để React Router xử lý deep link */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const indexHtml = path.join(dist, 'index.html');
const notFoundHtml = path.join(dist, '404.html');

if (!fs.existsSync(indexHtml)) {
  console.error('Thiếu dist/index.html — chạy vite build trước.');
  process.exit(1);
}
fs.copyFileSync(indexHtml, notFoundHtml);
console.log('SPA: đã copy index.html → 404.html');
