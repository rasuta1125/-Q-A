-- Q&Aデータテーブル
CREATE TABLE IF NOT EXISTS qa_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,           -- カテゴリ（予約方法、料金、キャンセル等）
  question TEXT NOT NULL,            -- 質問
  answer TEXT NOT NULL,              -- 回答
  keywords TEXT,                     -- 検索用キーワード（カンマ区切り）
  priority INTEGER DEFAULT 1,        -- 優先度（1=高、2=中、3=低）
  is_active INTEGER DEFAULT 1,       -- 有効フラグ（1=有効、0=無効）
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Webソースデータテーブル（将来用）
CREATE TABLE IF NOT EXISTS web_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  content TEXT,
  last_crawled DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_qa_category ON qa_items(category);
CREATE INDEX IF NOT EXISTS idx_qa_active ON qa_items(is_active);
CREATE INDEX IF NOT EXISTS idx_qa_priority ON qa_items(priority);
