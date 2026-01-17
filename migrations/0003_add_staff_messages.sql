-- スタッフ連絡掲示板テーブル
CREATE TABLE IF NOT EXISTS staff_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_name TEXT NOT NULL,              -- スタッフの名前
  message_date DATE NOT NULL,            -- 連絡日（YYYY-MM-DD）
  content TEXT NOT NULL,                 -- 連絡内容
  is_completed INTEGER DEFAULT 0,        -- 対応済みフラグ（0=未対応、1=対応済み）
  completed_at DATETIME,                 -- 対応完了日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_staff_messages_date ON staff_messages(message_date);
CREATE INDEX IF NOT EXISTS idx_staff_messages_completed ON staff_messages(is_completed);
CREATE INDEX IF NOT EXISTS idx_staff_messages_staff_name ON staff_messages(staff_name);
