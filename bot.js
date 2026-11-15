const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'state.json');
let state = { sentLocks: {}, knownContacts: {} };
if (fs.existsSync(statePath)) {
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
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
  "nguoi_rieng_1": "ĐIỀN_CHAT_ID_VÀO_ĐÂY",
  "ban_than":      "ĐIỀN_CHAT_ID_CỦA_BẠN_VÀO_ĐÂY"
};

// =========================================================================
// 2. KỊCH BẢN HẸN GIỜ TỰ ĐỘNG (Có thể thêm/bớt bao nhiêu mục tùy ý)
// =========================================================================
const TASKS = [
  {
    id: "chuc_buoi_sang",
    enabled: true,
    to: "nguoi_rieng_1",     // Tên trong CONTACTS hoặc điền thẳng Chat ID
    type: "daily",           // daily: Hàng ngày
    hour: 7,                 // Gửi vào khung 7h sáng (Từ 7h00 - 7h59)
    messages: [
      "Chúc ngày mới tốt lành và nhiều niềm vui nhé!",
      "Sáng rồi, đừng quên ăn sáng đầy đủ trước khi làm việc nhé!"
    ]
  },
  {
    id: "nhac_lich_hang_thang",
    enabled: true,
    to: "nguoi_rieng_1",
    type: "monthly",         // monthly: Ngày cố định hàng tháng (Dương lịch)
    day: 10,                 // Ngày 10 hàng tháng
    hour: 8,                 // Khung 8h sáng
    messages: [
      "Hôm nay ngày 10 rồi, nhớ kiểm tra công việc định kỳ tháng này nhé!"
    ]
  },
  {
    id: "nhac_mung_1_va_ram",
    enabled: false,          // Đổi thành true nếu muốn bật
    to: "ban_than",
    type: "lunar",           // lunar: Theo ngày Âm lịch hàng tháng
    lunarDays: [1, 15],      // Mùng 1 và Rằm (15) Âm lịch
    hour: 6,                 // Khung 6h sáng
    messages: [
      "Hôm nay là ngày tuần (Mùng 1 / Rằm Âm lịch) nhé!"
    ]
  },
  {
    id: "nhac_cuoi_tuan",
    enabled: false,          // Đổi thành true nếu muốn bật
    to: "nguoi_rieng_1",
    type: "weekly",          // weekly: Theo thứ trong tuần (0: CN, 1: T2 ... 6: T7)
    daysOfWeek: [6],         // Thứ Bảy hàng tuần
    hour: 9,
    messages: [
      "Cuối tuần thư giãn và nghỉ ngơi vui vẻ nhé!"
    ]
  },
  {
    id: "ngay_ky_niem_sinh_nhat",
    enabled: false,          // Đổi thành true nếu muốn bật
    to: "nguoi_rieng_1",
    type: "yearly",          // yearly: Ngày cố định trong năm (dd/MM)
    dateMonth: "20/10",      // Ngày 20/10
    hour: 7,
    messages: [
      "Chúc ngày 20/10 thật nhiều niềm vui và hạnh phúc!"
    ]
  }
];

// =========================================================================
// 3. BỘ XỬ LÝ HỆ THỐNG & CHỐT KHÓA CHỐNG GỬI TRÙNG
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
  if (!chatId || chatId.startsWith("ĐIỀN_")) {
    console.log("⚠️ Chưa điền Chat ID hợp lệ cho người nhận này.");
    return false;
  }
  try {
    const res = await fetch(`https://bot-api.zapps.me/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(chatId), text: text })
    });
    const resultText = await res.text();
    console.log(`✅ Kết quả gửi tới [${chatId}]:`, resultText);
    return res.ok;
  } catch (e) {
    console.error(`❌ Lỗi gửi tới [${chatId}]:`, e.message);
    return false;
  }
}

// Chế độ 1: Quét và lưu danh sách những người đã nhắn tin cho Bot
async function scanContacts() {
  console.log("🔍 Đang quét các tin nhắn mới gửi tới Bot...");
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`https://bot-api.zapps.me/bot${BOT_TOKEN}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!json || !json.ok || !json.result) break;

      const items = Array.isArray(json.result) ? json.result : [json.result];
      if (items.length === 0) break;

      items.forEach(item => {
        const chat = item?.message?.chat;
        const from = item?.message?.from;
        const text = item?.message?.text;
        if (chat && chat.id) {
          state.knownContacts[chat.id] = {
            name: from?.display_name || 'Không rõ tên',
            type: chat.chat_type || 'PRIVATE',
            lastMessage: text || '',
            updatedAt: formatDateVN(getVNDate())
          };
        }
      });
    }

    console.log("\n================ DANH BẠ ĐÃ QUÉT ĐƯỢC ================");
    const ids = Object.keys(state.knownContacts);
    if (ids.length === 0) {
      console.log("⚠️ Chưa tìm thấy tin nhắn mới nào. Hãy bảo người đó nhắn chữ 'alo' vào Bot trước!");
    } else {
      ids.forEach(id => {
        const info = state.knownContacts[id];
        console.log(`👤 Tên: ${info.name} | Loại: ${info.type} | 👉 Mã Chat ID: "${id}" | Tin nhắn: "${info.lastMessage}"`);
      });
    }
    console.log("======================================================\n");

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error("Lỗi khi quét Chat ID:", e.message);
  }
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ Chưa cấu hình ZALO_BOT_TOKEN trong mục Settings -> Secrets!");
    return;
  }

  // CHẾ ĐỘ 1: DÒ TÌM CHAT ID NGƯỜI MỚI
  if (MODE === 'scan_id') {
    await scanContacts();
    return;
  }

  // CHẾ ĐỘ 2: BẤM NÚT NHẮN TIN NGAY LẬP TỨC TỪ GITHUB
  if (MODE === 'send_now') {
    const targetId = CONTACTS[TARGET_USER] || TARGET_USER;
    if (!targetId || !CUSTOM_MSG) {
      console.error("⚠️ Vui lòng nhập Người nhận và Nội dung tin nhắn!");
      return;
    }
    await sendZalo(targetId, CUSTOM_MSG);
    return;
  }

  // CHẾ ĐỘ 3: CHẠY TỰ ĐỘNG THEO LỊCH HẸN (CÓ KHÓA CHỐNG LẶP TRONG NGÀY)
  const now = getVNDate();
  const todayStr = formatDateVN(now);
  const dayMonthStr = todayStr.slice(0, 5); // "dd/MM"
  const curHour = now.getHours();
  const curDay = now.getDate();
  const curDow = now.getDay();
  const curLunarDay = getLunarDay(now);

  let stateChanged = false;

  for (const task of TASKS) {
    if (!task.enabled) continue;

    // Chốt khóa: Nếu việc này hôm nay đã gửi rồi thì bỏ qua ngay
    if (state.sentLocks[task.id] === todayStr) continue;

    // Kiểm tra giờ (Cho phép lệch tối đa 1 tiếng phòng khi GitHub chạy trễ)
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
      const msg = task.messages[Math.floor(Math.random() * task.messages.length)];
      const ok = await sendZalo(targetId, msg);
      if (ok) {
        state.sentLocks[task.id] = todayStr; // Khóa lại không gửi lần 2 trong ngày
        stateChanged = true;
      }
    }
  }

  if (stateChanged) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

run();
