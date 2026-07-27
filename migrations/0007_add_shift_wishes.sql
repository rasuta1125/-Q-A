-- シフト希望メモテーブル
CREATE TABLE IF NOT EXISTS shift_wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_name TEXT NOT NULL,
  year_month TEXT NOT NULL,        -- 例: "2026-07"
  wish_date DATE NOT NULL,         -- 例: "2026-07-15"
  wish_type TEXT NOT NULL DEFAULT 'work', -- 'work'=出勤希望 / 'off'=休み希望 / 'note'=メモ
  note TEXT,                       -- 自由記述
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(staff_name, wish_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_wishes_ym   ON shift_wishes(year_month);
CREATE INDEX IF NOT EXISTS idx_shift_wishes_staff ON shift_wishes(staff_name);
