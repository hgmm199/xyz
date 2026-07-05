require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const farm = require('./FARM/farm');
const Keep_alive = require('./web/Keep_alive');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const pause = require('./Commands/pause');
const resume = require('./Commands/resume');

// Thêm Express để làm giao diện Web
const express = require('express');
const app = express();
const PORT = 3000;

Keep_alive();

const c = {
  red:     s => `\x1b[31m${s}\x1b[0m`,
  green:   s => `\x1b[32m${s}\x1b[0m`,
  yellow:  s => `\x1b[33m${s}\x1b[0m`,
  blue:    s => `\x1b[34m${s}\x1b[0m`,
  magenta: s => `\x1b[35m${s}\x1b[0m`,
  cyan:    s => `\x1b[36m${s}\x1b[0m`,
};

const activeClients = new Map();
const profilesStatus = new Map(); // Lưu trạng thái hiển thị lên Web

function parseEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf8');
  const result = {};
  raw.split('\n').forEach(line => {
    const clean = line.replace(/\r/g, '').trim();
    if (!clean || clean.startsWith('#')) return;
    const idx = clean.indexOf('=');
    if (idx === -1) return;
    const key = clean.slice(0, idx).trim();
    const val = clean.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  });
  return result;
}

async function setupClientLogic(client, channelId, profileName = 'Root') {
  const state = {};
  const idUser = client.user.id;
  let channel;
  try {
    channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
  } catch (err) {
    console.log(c.red(`[${profileName}] ❌ Kênh lỗi: ${err.message}`));
  }
  client.on('messageCreate', msg => pause(client, msg, state, idUser));
  client.on('messageCreate', msg => resume(client, msg, state, idUser, channel));
  farm(client, channelId, state);
}

function startClient(profileName, envPath) {
  if (activeClients.has(profileName)) return;

  const env = parseEnv(envPath);
  const token     = env.TOKEN || env.DISCORD_TOKEN || null;
  const channelId = env.CHANNEL || env.CHANNEL_ID || null;

  if (!token || !channelId) {
    profilesStatus.set(profileName, { status: 'Lỗi cấu hình', user: 'Không rõ' });
    return;
  }

  profilesStatus.set(profileName, { status: 'Đang kết nối...', user: '...' });

  const client = new Client({ checkUpdate: false, readyStatus: false, selfbot: true });

  client.once('ready', async () => {
    console.log(c.green(`[${profileName}] ✅ Logged in as ${client.user.tag}`));
    activeClients.set(profileName, client);
    profilesStatus.set(profileName, { status: 'Đang chạy 🟢', user: client.user.tag, path: envPath });
    await setupClientLogic(client, channelId, profileName);
  });

  client.on('invalidated', () => {
    activeClients.delete(profileName);
    profilesStatus.set(profileName, { status: 'Mất kết nối 🔴', user: '...' });
    client.destroy();
    setTimeout(() => startClient(profileName, envPath), 5000);
  });

  client.login(token).catch(err => {
    profilesStatus.set(profileName, { status: 'Đăng nhập thất bại ❌', user: '...' });
    activeClients.delete(profileName);
  });
}

function stopClient(profileName) {
  const client = activeClients.get(profileName);
  if (!client) return;
  client.destroy();
  activeClients.delete(profileName);
  profilesStatus.set(profileName, { status: 'Đã dừng 🛑', user: '...' });
}

function watchProfiles() {
  const profilesDir = path.resolve('./profiles');
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });

  chokidar.watch(profilesDir, { persistent: true, depth: 2 }).on('add', filePath => {
    if (path.basename(filePath) !== '.env') return;
    const profileName = path.basename(path.dirname(filePath));
    startClient(profileName, filePath);
  });
}

// ─── PHẦN ĐIỀU KHIỂN WEB (HTML/API) ──────────────────────────────────────────
app.use(express.json());

// Gửi file HTML về trình duyệt
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API lấy danh sách bot hiện tại
app.get('/api/status', (req, res) => {
  res.json(Object.fromEntries(profilesStatus));
});

// API Nút bấm: Điều khiển Tắt/Mở bot từ Web
app.post('/api/control', (req, res) => {
  const { action, profile } = req.body;
  const data = profilesStatus.get(profile);

  if (action === 'stop') {
    stopClient(profile);
  } else if (action === 'start' && data?.path) {
    startClient(profile, data.path);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(c.cyan(`🌐 Giao diện quản lý: http://localhost:${PORT}`));
});

watchProfiles();
