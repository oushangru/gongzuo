'use strict';

/**
 * 服务入口：启动 HTTP 服务并自动打开浏览器。
 * 数据默认存储在 data/job-applications.db（SQLite 文件）。
 *
 * 可用环境变量：
 *   PORT    - 服务端口，默认 3000
 *   DB_PATH - 数据库文件路径
 *   NO_OPEN_BROWSER=1 - 不自动打开浏览器（测试等场景）
 */

const path = require('node:path');
const { exec } = require('node:child_process');
const { createApp } = require('./src/app');
const { openDatabase } = require('./src/db');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'job-applications.db');

const db = openDatabase(DB_PATH);
const app = createApp(db);

const server = app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  求职进度管理系统已启动');
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log('  数据文件: ' + DB_PATH);
  console.log('  按 Ctrl+C 停止服务');
  console.log('==============================================');

  if (process.env.NO_OPEN_BROWSER !== '1') {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
    try {
      exec(cmd);
    } catch {
      // 打开浏览器失败不影响服务运行
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[错误] 端口 ${PORT} 已被占用。可换端口启动：`);
    console.error('  PowerShell: $env:PORT=3001; npm start');
    console.error('  命令行(cmd): set PORT=3001 && npm start');
  } else {
    console.error('[错误] 服务启动失败:', err.message);
  }
  process.exit(1);
});
