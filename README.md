# マカロニスタジオ Q&A回答ツール

マカロニスタジオのスタッフ向けの社内用Q&A回答生成ツールです。問い合わせ内容を入力すると、AIが過去のQ&Aデータから最適な回答を生成します。

## プロジェクト概要

- **名前**: マカロニスタジオ Q&A回答ツール
- **目的**: スタッフが顧客からの問い合わせに迅速かつ正確に回答できるようサポート
- **主な機能**:
  - 問い合わせ内容からAIが回答を自動生成（RAG方式）
  - 3つの回答スタイル（丁寧・カジュアル・短文）
  - 信頼度判定とエスカレーション提案
  - Q&Aデータの登録・編集・管理
  - 根拠情報の表示（参考元Q&A、類似度スコア）

## URL

- **開発環境**: https://3000-izplhik1li78rvkilsey9-2b54fc91.sandbox.novita.ai
- **回答生成画面**: `/`
- **Q&A管理画面**: `/admin`
- **GitHub**: (未設定)

## 現在完了している機能

### ✅ 回答生成機能
- 問い合わせ内容を入力すると、AIが適切な回答を生成
- OpenAI GPT-4o-miniを使用した高品質な日本語回答
- RAG（Retrieval-Augmented Generation）方式で根拠に基づく回答生成

### ✅ 回答スタイル切替
- **丁寧（推奨）**: やさしい敬語、箇条書き、構造化された回答
- **カジュアル**: 親しみやすい「です・ます」調
- **短文（コピペ用）**: 最も重要な情報のみ2-3文で完結

### ✅ 信頼度判定
- **A (十分な根拠あり)**: トップスコア85%以上、平均75%以上
- **B (要注意)**: トップスコア70%以上、平均60%以上 → 社内確認推奨
- **C (情報不足)**: 十分な情報なし → 社内確認必須、回答生成なし

### ✅ エスカレーション機能
- 信頼度に応じて、社内確認を促す注意メッセージを表示
- 情報不足の場合、確認すべきチェックリストを提案

### ✅ 根拠表示
- 参考にしたQ&A情報を最大3件表示
- カテゴリ、質問、回答の抜粋、類似度スコアを表示
- 優先順位: Q&Aデータ > Webソース（将来実装）

### ✅ Q&A管理機能
- Q&Aの新規登録、編集、削除（論理削除）
- カテゴリ分類（予約方法、料金、キャンセル、駐車場等）
- 優先度設定（高・中・低）
- 検索用キーワード登録
- 有効/無効フラグ

### ✅ データベース（Cloudflare D1）
- Q&Aアイテム管理（SQLite）
- ローカル開発環境対応（`--local`フラグ）
- マイグレーション管理
- サンプルデータ15件登録済み

## 機能URI一覧

### フロントエンド
| パス | 説明 | メソッド |
|------|------|---------|
| `/` | 回答生成画面（メイン） | GET |
| `/admin` | Q&A管理画面 | GET |

### API
| エンドポイント | 説明 | メソッド | パラメータ |
|---------------|------|---------|----------|
| `/api/generate` | AI回答生成 | POST | `{ query: string, tone: 'polite'\|'casual'\|'brief' }` |
| `/api/qa` | Q&A一覧取得 | GET | - |
| `/api/qa` | Q&A新規登録 | POST | `{ category, question, answer, keywords?, priority?, is_active? }` |
| `/api/qa/:id` | Q&A更新 | PUT | `{ category, question, answer, keywords?, priority?, is_active? }` |
| `/api/qa/:id` | Q&A削除（論理削除） | DELETE | - |

## まだ実装されていない機能

### 🔜 Vectorize統合（ベクトル検索）
- 現在はキーワード検索でフォールバック対応
- 本番デプロイ時にCloudflare Vectorizeを使用した類似検索を実装予定
- OpenAI text-embedding-3-small（1536次元）で埋め込みベクトル生成

### 🔜 Web取り込み機能
- 指定したWebサイトからQ&Aソースを自動取得
- スケジュール自動更新
- Web抜粋の根拠表示

### 🔜 本番デプロイ
- Cloudflare Pagesへのデプロイ
- 環境変数（OPENAI_API_KEY）のシークレット設定
- 本番D1データベースの作成とマイグレーション
- Vectorizeインデックスの作成

## データアーキテクチャ

### データモデル

#### qa_items（Q&Aアイテム）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| category | TEXT | カテゴリ（予約方法、料金等） |
| question | TEXT | 質問 |
| answer | TEXT | 回答 |
| keywords | TEXT | 検索用キーワード（カンマ区切り） |
| priority | INTEGER | 優先度（1=高、2=中、3=低） |
| is_active | INTEGER | 有効フラグ（1=有効、0=無効） |
| last_updated | DATETIME | 最終更新日時 |
| created_at | DATETIME | 作成日時 |

#### web_sources（Webソース）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | 主キー |
| url | TEXT | URL（ユニーク） |
| title | TEXT | タイトル |
| content | TEXT | コンテンツ |
| last_crawled | DATETIME | 最終クロール日時 |
| created_at | DATETIME | 作成日時 |

### ストレージサービス

- **Cloudflare D1**: SQLiteベースのグローバル分散データベース
  - Q&Aアイテムの保存
  - Webソース情報の保存
  - ローカル開発: `.wrangler/state/v3/d1`に自動作成

- **Cloudflare Vectorize**: ベクトル検索エンジン
  - OpenAI埋め込みベクトル（1536次元）の保存
  - コサイン類似度による検索
  - 本番デプロイ時に作成予定

- **OpenAI API**:
  - `text-embedding-3-small`: 埋め込みベクトル生成
  - `gpt-4o-mini`: 回答生成

### データフロー

1. **Q&A登録時**:
   ```
   フォーム入力 → D1に保存 → OpenAIで埋め込み生成 → Vectorizeに保存
   ```

2. **回答生成時**:
   ```
   問い合わせ入力 → OpenAIで埋め込み生成 → Vectorizeで類似検索 
   → D1から詳細取得 → 信頼度判定 → OpenAIで回答生成 → 根拠と共に表示
   ```

3. **フォールバック（Vectorize未対応時）**:
   ```
   問い合わせ入力 → D1でキーワード検索（LIKE検索） → 信頼度判定 
   → OpenAIで回答生成 → 根拠と共に表示
   ```

## 使い方

### スタッフ向け使い方

1. **回答生成画面（`/`）にアクセス**
2. **問い合わせ内容を入力または貼り付け**
3. **回答スタイルを選択**（通常は「丁寧（推奨）」）
4. **「AIで回答生成」ボタンをクリック**
5. **生成された回答を確認**:
   - 信頼度バッジを確認（A/B/C）
   - エスカレーション注意がある場合は従う
   - 根拠情報で内容の正確性を確認
6. **「コピー」ボタンで回答をコピー**
7. **外部のDM/メールに貼り付けて使用**

### 管理者向けQ&A管理

1. **Q&A管理画面（`/admin`）にアクセス**
2. **「新規追加」ボタンでQ&Aを登録**:
   - カテゴリを選択
   - 質問と回答を入力
   - 検索用キーワードを入力（カンマ区切り）
   - 優先度を設定
3. **既存Q&Aの編集**: 編集アイコンをクリック
4. **Q&Aの削除**: ゴミ箱アイコンをクリック（論理削除）

## 登録済みQ&Aカテゴリ

- 予約方法
- 所要時間
- 対象年齢
- 料金・七五三
- 料金・スマッシュケーキ
- 料金・ミルクバス
- キャンセル
- 日程変更
- 納品
- レタッチ
- 駐車場
- 持ち物
- 家族撮影
- 衣装
- 非対応（お食い初め等）

## 推奨される次のステップ

1. **Q&Aデータの充実**:
   - 実際の問い合わせ履歴から追加のQ&Aを登録
   - カテゴリの追加・調整
   - キーワードの最適化

2. **本番環境へのデプロイ**:
   - Cloudflare APIキーの設定
   - Vectorizeインデックスの作成
   - 本番D1データベースのマイグレーション
   - 環境変数（OPENAI_API_KEY）のシークレット登録
   - Cloudflare Pagesへのデプロイ

3. **運用とフィードバック**:
   - スタッフによる実際の使用テスト
   - 回答品質のフィードバック収集
   - 信頼度判定の閾値調整

4. **機能拡張**:
   - Web取り込み機能の実装
   - 回答履歴の保存機能
   - Q&A使用頻度の分析

5. **UIの改善**:
   - モバイル対応の最適化
   - ダークモード対応
   - アクセシビリティ向上

## デプロイ

### ローカル開発
```bash
# データベースマイグレーション
npm run db:migrate:local

# サンプルデータ投入
npx wrangler d1 execute macaroni-qa-db --local --file=./seed.sql

# ビルド
npm run build

# 開発サーバー起動
pm2 start ecosystem.config.cjs

# ログ確認
pm2 logs --nostream
```

### 本番デプロイ（未実施）
```bash
# Cloudflare APIキー設定
# → Deploy タブから設定

# Vectorizeインデックス作成
npx wrangler vectorize create macaroni-qa-index --dimensions=1536 --metric=cosine

# D1データベース作成
npx wrangler d1 create macaroni-qa-db

# wrangler.jsonc のdatabase_idを更新

# マイグレーション
npm run db:migrate:prod

# 環境変数（シークレット）設定
npx wrangler pages secret put OPENAI_API_KEY --project-name macaroni-qa-tool

# デプロイ
npm run deploy:prod
```

## 技術スタック

- **フロントエンド**: 
  - HTML + TailwindCSS + Vanilla JavaScript
  - Axios（HTTPクライアント）
  - Font Awesome（アイコン）

- **バックエンド**: 
  - Hono（軽量Webフレームワーク）
  - TypeScript
  - Cloudflare Workers/Pages

- **データベース**: 
  - Cloudflare D1（SQLite）
  - Cloudflare Vectorize（ベクトル検索）

- **AI**: 
  - OpenAI API（GPT-4o-mini、text-embedding-3-small）

- **開発ツール**: 
  - Vite（ビルドツール）
  - Wrangler（Cloudflare CLI）
  - PM2（プロセス管理）

## プロジェクト構造

```
webapp/
├── src/
│   ├── index.tsx          # メインアプリケーション（API + HTML）
│   ├── openai.ts          # OpenAI API統合
│   └── types.ts           # TypeScript型定義
├── public/
│   └── static/
│       ├── app.js         # 回答生成画面のJS
│       └── admin.js       # Q&A管理画面のJS
├── migrations/
│   └── 0001_initial_schema.sql  # DBスキーマ
├── .dev.vars              # ローカル環境変数（APIキー）
├── .gitignore             # Git除外設定
├── ecosystem.config.cjs   # PM2設定
├── wrangler.jsonc         # Cloudflare設定
├── package.json           # 依存関係とスクリプト
├── seed.sql               # サンプルデータ
└── README.md              # このファイル
```

## ステータス

- **開発環境**: ✅ 稼働中
- **本番環境**: ❌ 未デプロイ
- **最終更新**: 2025-10-19

---

**マカロニスタジオ Q&A回答ツール** - スタッフの業務効率化をAIでサポート
