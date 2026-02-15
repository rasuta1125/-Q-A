-- スタッフ連絡板にTO（宛先）フィールドを追加

ALTER TABLE staff_messages ADD COLUMN to_staff TEXT;

-- to_staffカラムには複数のスタッフ名をカンマ区切りで格納
-- 例: "坂口,小百合" または "全員"
