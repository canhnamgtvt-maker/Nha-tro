const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'state.json');
let state = {
  lastScanTime: '',
  defaultChatId: '',
  defaultUserName: '',
  knownContacts: {},
  sentLocks: {}
};

if (fs.existsSync(statePath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = {
      lastScanTime: loaded.lastScanTime || '',
      defaultChatId: loaded.defaultChatId || '',
      defaultUserName: loaded.defaultUserName || '',
      knownContacts: loaded.knownContacts || {},
      sentLocks: loaded.sentLocks || {}
    };
  } catch (e) {}
}

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
const MODE = (process.env.MODE || 'schedule').trim();
const TARGET_USER = (process.env.TARGET_USER || 'auto').trim();
const CUSTOM_MSG = (process.env.CUSTOM_MSG || '').trim();

// =========================================================================
// 1. KỊCH BẢN HẸN GIỜ TỰ ĐỘNG
// Mục "to" để là "auto": Bot sẽ TỰ ĐỘNG lấy thẳng Chat ID từ file state.json
// (Hoặc nếu có nhiều người trong state.json, bạn chỉ cần gõ Tên Zalo của họ vào mục "to")
// =========================================================================
const TASKS = [
  {
    id: "nhac_thu_tien_tro_ngay_10_15",
    enabled: true,           // Đang BẬT tự động nhắc ngày 10 và 15 hàng tháng
    to: "auto",              // Tự động lấy trực tiếp Chat ID từ state.json
    type: "monthly",
    days: [10, 15],          // Chạy vào ngày 10 và ngày 15 hàng tháng
    hour: 8,                 // Khung 8h00 sáng (giờ Việt Nam)
    messages: [
      `Đến hẹn lại lên! Hôm nay đến lịch thu tiền phòng trọ rồi, nhớ kiểm tra và thu tiền các phòng nhé!`,
      `Nhắc nhẹ: Đến ngày thu tiền phòng trọ định kỳ rồi, kiểm tra sổ sách và nhắc các phòng đóng tiền nhé!`,
      `Ting ting! Đừng quên lịch thu tiền phòng trọ hôm nay nhé, rà soát xem còn phòng nào chưa đóng không nha!`
    ]
  },
  {
    id: "chuc_buoi_sang",
    enabled: false,          // Đang TẮT (Đổi thành true nếu muốn bật)
    to: "auto",
    type: "daily",
    hour: 7,
    messages: [
      `Chúc ngày mới tốt lành và nhiều niềm vui nhé!`
    ]
  },
  {
    id: "nhac_mung_1_va_ram",
    enabled: false,          // Đang TẮT (Đổi thành true nếu muốn bật)
    to: "auto",
    type: "lunar",
    lunarDays: [1, 15],
    hour: 6,
    messages: [
      `Hôm nay là ngày tuần (Mùng 1 / Rằm Âm lịch) nhé!`
    ]
  }
];

// =========================================================================
// 2. HÀM TỰ ĐỘNG LẤY CHAT ID TRỰC TIẾP TỪ FILE STATE.JSON
// =========================================================================
function getChatIdFromState(targetKey) {
  // 1. Nếu để "auto" hoặc "nguoi_rieng_1" -> Lấy ngay defaultChatId hoặc người đầu tiên trong state.json
  if (!targetKey || targetKey === 'auto' || targetKey === 'nguoi_rieng_1') {
    if (state.defaultChatId) return state.defaultChatId;
    const allIds = Object.keys(state.knownContacts);
    if (allIds.length > 0) return allIds[allIds.length - 1];
    return '';
  }

  // 2. Nếu truyền vào chính là dãy số Chat ID có trong state.json
  if (state.knownContacts[targetKey]) {
    return targetKey;
  }

  // 3. Nếu ghi Tên Zalo -> Tự động dò trong state.json xem ai trùng tên để lấy Chat ID
  const searchName = targetKey.toLowerCase();
  for (const [id, info] of Object.entries(state.knownContacts)) {
    if (info.name && info.name.toLowerCase().includes(searchName)) {
      return id;
    }
  }

  // 4. Dự phòng: Lấy defaultChatId trong state.json
  return state.defaultChatId || targetKey;
}

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
  if (!chatId) {
    console.log("⚠️ Trong state.json chưa có Chat ID nào. Hãy nhắn 1 tin vào Bot rồi chạy scan_id!");
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

// Quét tin nhắn và tự động lưu thẳng vào state.json để dùng luôn
async function scanContacts(isManualScan) {
  const maxLoops = isManualScan ? 3 : 1;
  const waitMs = isManualScan ? 30000 : 4000;

  console.log(`🔍 Đang mở cổng chờ tin nhắn Zalo (Tối đa ${maxLoops * (waitMs / 1000)} giây)...`);

  for (let i = 0; i < maxLoops; i++) {
    const json = await fetchOneUpdate(waitMs);
    if (!json || !json.ok || !json.result) continue;

    const items = Array.isArray(json.result) ? json.result : [json.result];
    if (items.length === 0) continue;

    let caughtAny = false;
    for (const item of items) {
      const msg = item?.message || item;
      const chat = msg?.chat;
      const from = msg?.from || msg?.sender;
      const chatId = chat?.id || from?.id;

      if (chatId) {
        const idStr = String(chatId);
        const displayName = from?.display_name || from?.name || chat?.title || 'Người dùng Zalo';
        const chatType = chat?.chat_type || 'PRIVATE';

        state.knownContacts[idStr] = {
          name: displayName,
          chatId: idStr,
          type: chatType,
          lastMessage: msg?.text || '(Nhãn dán/Hình ảnh)',
          updatedAt: formatDateTimeVN(getVNDate())
        };

        // Tự động đặt làm người nhận mặc định trong state.json (ưu tiên chat cá nhân PRIVATE)
        if (chatType !== 'GROUP' || !state.defaultChatId) {
          state.defaultChatId = idStr;
          state.defaultUserName = displayName;
        }

        caughtAny = true;
        console.log(`🎯 Đã tự động lưu Chat ID vào state.json: "${idStr}" (${displayName})`);

        if (isManualScan) {
          const replyMsg = `✅ Bot đã tự động lưu mã kết nối của ${displayName} vào hệ thống!`;
          await sendZalo(idStr, replyMsg);
        }
      }
    }

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
    console.log("📋 Trạng thái state.json hiện tại:", JSON.stringify(state, null, 2));
    return;
  }

  await scanContacts(false);

  // Chế độ nhắn thử ngay lập tức (Lấy thẳng Chat ID từ state.json)
  if (MODE === 'send_now') {
    const targetId = getChatIdFromState(TARGET_USER);
    const msgToSend = CUSTOM_MSG || `Tin nhắn kiểm tra kết nối từ hệ thống Bot!`;
    await sendZalo(targetId, msgToSend);
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
    else if (task.type === 'monthly') {
      if (Array.isArray(task.days) && task.days.includes(curDay)) isMatch = true;
      else if (task.day === curDay) isMatch = true;
    }
    else if (task.type === 'weekly' && Array.isArray(task.daysOfWeek) && task.daysOfWeek.includes(curDow)) isMatch = true;
    else if (task.type === 'lunar' && Array.isArray(task.lunarDays) && task.lunarDays.includes(curLunarDay)) isMatch = true;
    else if (task.type === 'yearly' && task.dateMonth === dayMonthStr) isMatch = true;

    if (isMatch) {
      const targetId = getChatIdFromState(task.to);
      if (!targetId) {
        console.log(`⚠️ Bỏ qua [${task.id}] vì chưa có Chat ID trong state.json.`);
        continue;
      }
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
