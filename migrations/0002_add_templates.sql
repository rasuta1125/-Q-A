-- よく使う返信テンプレートテーブル
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,              -- タイトル（例: 営業時間のご案内）
  content TEXT NOT NULL,             -- 返信内容
  category TEXT,                     -- カテゴリ（任意）
  is_active INTEGER DEFAULT 1,       -- 有効フラグ（1=有効、0=無効）
  usage_count INTEGER DEFAULT 0,     -- 使用回数
  last_used DATETIME,                -- 最終使用日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_templates_active ON templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
