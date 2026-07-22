-- 出勤記録テーブル
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_name TEXT NOT NULL,              -- スタッフ名
  work_date DATE NOT NULL,               -- 勤務日（YYYY-MM-DD）
  clock_in TIME,                         -- 出勤時刻（HH:MM）
  clock_out TIME,                        -- 退勤時刻（HH:MM）
  break_minutes INTEGER DEFAULT 0,       -- 休憩時間（分）
  work_minutes INTEGER,                  -- 実労働時間（分）
  notes TEXT,                            -- 備考
  status TEXT DEFAULT 'present',         -- ステータス: present/absent/late/half_day
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(staff_name, work_date)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance(staff_name);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- スタッフマスターテーブル
CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,             -- スタッフ名
  display_order INTEGER DEFAULT 99,      -- 表示順
  is_active INTEGER DEFAULT 1,          -- 有効フラグ
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- デフォルトスタッフを挿入（既存のstaff_messagesと合わせる）
INSERT OR IGNORE INTO staff_members (name, display_order) VALUES ('坂口', 1);
INSERT OR IGNORE INTO staff_members (name, display_order) VALUES ('小百合', 2);
INSERT OR IGNORE INTO staff_members (name, display_order) VALUES ('全員', 99);
