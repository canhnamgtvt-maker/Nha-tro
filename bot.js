const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'state.json');
let state = {
  lastScanTime: '',
  lastZaloResponse: null,
  knownContacts: {},
  sentLocks: {}
};

if (fs.existsSync(statePath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = {
      lastScanTime: loaded.lastScanTime || '',
      lastZaloResponse: loaded.lastZaloResponse || null,
      knownContacts: loaded.knownContacts || {},
      sentLocks: loaded.sentLocks || {}
    };
  } catch (e) {}
}

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
const MODE = (process.env.MODE || 'schedule').trim();
const TARGET_USER = (process.env.TARGET_USER || '').trim();
const CUSTOM_MSG = (process.env.CUSTOM_MSG || '').trim();

// =========================================================================
// 1. DANH BẠ NGƯỜI NHẬN (Đặt tên gợi nhớ : "Mã Chat ID")
// =========================================================================
const CONTACTS = {
  "nguoi_rieng_1": "DIEN_CHAT_ID_VAO_DAY",
  "ban_than": "DIEN_CHAT_ID_CUA_BAN_VAO_DAY"
};

// =========================================================================
// 2. KỊCH BẢN HẸN GIỜ TỰ ĐỘNG (Đổi enabled: true để bật, false để tắt)
// =========================================================================
const TASKS = [
  {
    id: "chuc_buoi_sang",
    enabled: true,
    to: "nguoi_rieng_1",
    type: "daily",
    hour: 7,
    messages: [
      `Chúc ngày mới tốt lành và nhiều niềm vui nhé!`,
      `Sáng rồi, đừng quên ăn sáng đầy đủ trước khi làm việc nhé!`
    ]
  },
  {
    id: "nhac_tien_nha_hang_thang",
    enabled: false,
    to: "nguoi_rieng_1",
    type: "monthly",
    day: 10,
    hour: 8,
    messages: [
      `Hôm nay ngày 10 rồi, nhớ kiểm tra công việc định kỳ tháng này nhé!`
    ]
  }
];

// =========================================================================
// 3. BỘ XỬ LÝ HỆ THỐNG TỰ ĐỘNG
// =========================================================================
function getVNDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7));
}

function formatDateVN(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateTimeVN(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min} - ${formatDateVN(date)}`;
}

function getLunarDay(date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { day: 'numeric' });
    const parts = fmt.formatToParts(date);
    return parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
  } catch (e) {
    return 0;
  }
}

async function sendZalo(chatId, text) {
  if (!chatId || chatId.startsWith("DIEN_")) {
    console.log("⚠️ Chưa điền Chat ID hợp lệ cho người nhận.");
    return false;
  }
  try {
    const res = await fetch(`https://bot-api.zapps.me/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text: text })
    });
    console.log(`✅ Kết quả gửi tới [${chatId}]:`, await res.text());
    return res.ok;
  } catch (e) {
    console.error(`❌ Lỗi gửi tới [${chatId}]:`, e.message);
    return false;
  }
}

async function fetchOneUpdate(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://bot-api.zapps.me/bot${BOT_TOKEN}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: controller.signal
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

// Mở cổng lắng nghe 90 giây khi ở chế độ scan_id, bắt được tin là báo lại qua Zalo ngay
async function scanContacts(isManualScan) {
  const maxLoops = isManualScan ? 3 : 1;
  const waitMs = isManualScan ? 30000 : 4000;

  console.log(`🔍 Đang mở cổng chờ tin nhắn Zalo (Tối đa ${maxLoops * (waitMs / 1000)} giây)...`);

  for (let i = 0; i < maxLoops; i++) {
    const json = await fetchOneUpdate(waitMs);
    if (!json) continue;

    state.lastZaloResponse = json;
    if (!json.ok || !json.result) continue;

    const items = Array.isArray(json.result) ? json.result : [json.result];
    if (items.length === 0) continue;

    let caughtAny = false;
    for (const item of items) {
      const msg = item?.message || item;
      const chat = msg?.chat;
      const from = msg?.from || msg?.sender;
      const chatId = chat?.id || from?.id;

      if (chatId) {
        const displayName = from?.display_name || from?.name || chat?.title || 'Người dùng Zalo';
        state.knownContacts[String(chatId)] = {
          name: displayName,
          chatId: String(chatId),
          type: chat?.chat_type || 'PRIVATE',
          lastMessage: msg?.text || '(Nhãn dán/Hình ảnh)',
          updatedAt: formatDateTimeVN(getVNDate())
        };
        caughtAny = true;
        console.log(`🎯 Đã bắt được Chat ID: "${chatId}" | Tên: ${displayName}`);

        // Tự động nhắn trả lời mã Chat ID ngay vào Zalo nếu đang ở chế độ quét ID
        if (isManualScan) {
          const replyMsg = `✅ Đã lấy mã thành công!\n👤 Tên: ${displayName}\n🔑 Mã Chat ID: ${chatId}`;
          await sendZalo(String(chatId), replyMsg);
        }
      }
    }

    // Nếu đã bắt được tin nhắn thì thoát vòng chờ sớm để lưu file ngay
    if (caughtAny) break;
  }

  state.lastScanTime = formatDateTimeVN(getVNDate());
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ LỖI: Chưa nhập ZALO_BOT_TOKEN trong mục Settings -> Secrets -> Actions!");
    return;
  }

  if (MODE === 'scan_id') {
    await scanContacts(true);
    console.log("📋 Danh bạ hiện có:", JSON.stringify(state.knownContacts, null, 2));
    return;
  }

  // Quét nhanh 4 giây ở các chế độ khác
  await scanContacts(false);

  if (MODE === 'send_now') {
    const targetId = CONTACTS[TARGET_USER] || TARGET_USER;
    if (!targetId || !CUSTOM_MSG) {
      console.error("⚠️ Vui lòng nhập Người nhận (target_user) và Nội dung tin nhắn (custom_msg)!");
      return;
    }
    await sendZalo(targetId, CUSTOM_MSG);
    return;
  }

  const now = getVNDate();
  const todayStr = formatDateVN(now);
  const dayMonthStr = todayStr.slice(0, 5);
  const curHour = now.getHours();
  const curDay = now.getDate();
  const curDow = now.getDay();
  const curLunarDay = getLunarDay(now);

  let stateChanged = false;

  for (const task of TASKS) {
    if (!task.enabled) continue;
    if (state.sentLocks[task.id] === todayStr) continue;
    if (typeof task.hour === 'number' && (curHour < task.hour || curHour > task.hour + 1)) {
      continue;
    }

    let isMatch = false;
    if (task.type === 'daily') isMatch = true;
    else if (task.type === 'monthly' && task.day === curDay) isMatch = true;
    else if (task.type === 'weekly' && Array.isArray(task.daysOfWeek) && task.daysOfWeek.includes(curDow)) isMatch = true;
    else if (task.type === 'lunar' && Array.isArray(task.lunarDays) && task.lunarDays.includes(curLunarDay)) isMatch = true;
    else if (task.type === 'yearly' && task.dateMonth === dayMonthStr) isMatch = true;

    if (isMatch) {
      const targetId = CONTACTS[task.to] || task.to;
      const randomMsg = task.messages[Math.floor(Math.random() * task.messages.length)];
      const sentOk = await sendZalo(targetId, randomMsg);
      if (sentOk) {
        state.sentLocks[task.id] = todayStr;
        stateChanged = true;
      }
    }
  }

  if (stateChanged) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

run();
