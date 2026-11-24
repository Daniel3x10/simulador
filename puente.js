const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8080;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js':   'application/javascript; charset=UTF-8',
  '.css':  'text/css; charset=UTF-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

// 1. Servidor HTTP local de archivos estáticos
const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  
  const filePath = path.join(ROOT_DIR, reqPath);

  // Seguridad: evitar path traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404 No encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Servidor Local] Escuchando en http://localhost:${PORT}`);
  startTunnel();
});

// 2. Puente público SSH (localhost.run)
function startTunnel() {
  console.log('[Puente] Conectando túnel público HTTPS seguro...');

  const ssh = spawn('ssh', [
    '-T',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', `80:127.0.0.1:${PORT}`,
    'nokey@localhost.run'
  ]);

  let urlFound = false;

  ssh.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-.]+\.lhr\.life/);
    if (match && !urlFound) {
      urlFound = true;
      const publicUrl = match[0];
      console.log('\n=============================================================');
      console.log('🚀 PUENTE PÚBLICO ACTIVO (SIN NECESIDAD DE DEPLOY)');
      console.log('=============================================================');
      console.log(`\n🔗 ENLACE PÚBLICO (HTTPS):`);
      console.log(`   ${publicUrl}`);
      console.log(`\n💻 Enlace local:`);
      console.log(`   http://localhost:${PORT}`);
      console.log('\n✨ Cualquier persona en internet o desde tu móvil puede entrar ahora.');
      console.log('Presiona Ctrl + C en esta terminal cuando desees cerrar el puente.');
      console.log('=============================================================\n');
    }
  });

  ssh.stderr.on('data', (data) => {
    // Info de conexión de SSH
  });

  ssh.on('close', (code) => {
    console.log(`[Puente] Túnel cerrado (código ${code}).`);
  });
}
