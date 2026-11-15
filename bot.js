const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'state.json');
let state = {
  lastScanTime: '',
  knownContacts: {},
  sentLocks: {}
};

if (fs.existsSync(statePath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = {
      lastScanTime: loaded.lastScanTime || '',
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
// 1. DANH BẠ NGƯỜI NHẬN (Đặt tên gợi nhớ : "Mã Chat ID lấy từ state.json")
// =========================================================================
const CONTACTS = {
  "nguoi_rieng_1": "ĐIỀN_CHAT_ID_VÀO_ĐÂY",
  "ban_than":      "ĐIỀN_CHAT_ID_CỦA_BẠN_VÀO_ĐÂY"
};

// =========================================================================
// 2. KỊCH BẢN HẸN GIỜ TỰ ĐỘNG (Đổi enabled: true để bật, false để tắt)
// =========================================================================
const TASKS = [
  {
    id: "chuc_buoi_sang",
    enabled: true,
    to: "nguoi_rieng_1",     // Tên trong CONTACTS hoặc điền thẳng mã Chat ID
    type: "daily",           // daily: Nhắn hàng ngày
    hour: 7,                 // Khung 7h sáng (giờ Việt Nam)
    messages: [
      "Chúc ngày mới tốt lành và nhiều niềm vui nhé!",
      "Sáng rồi, đừng quên ăn sáng đầy đủ trước khi làm việc nhé!"
    ]
  },
  {
    id: "nhac_lich_hang_thang",
    enabled: false,
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
    enabled: false,
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
    enabled: false,
    to: "nguoi_rieng_1",
    type: "weekly",          // weekly: Theo thứ trong tuần (0: CN, 1: T2 ... 6: T7)
    daysOfWeek: [6],         // Thứ Bảy hàng tuần
    hour: 9,                 // Khung 9h sáng
    messages: [
      "Cuối tuần thư giãn và nghỉ ngơi vui vẻ nhé!"
    ]
  },
  {
    id: "ngay_ky_niem_sinh_nhat",
    enabled: false,
    to: "nguoi_rieng_1",
    type: "yearly",          // yearly: Ngày cố định trong năm (dd/MM)
    dateMonth: "20/10",      // Ngày 20/10 hàng năm
    hour: 7,
    messages: [
      "
