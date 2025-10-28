# Cloudflare Pages デプロイ手順

## 🚀 初回デプロイ手順

### 1. GitHubリポジトリとの連携

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログイン
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. GitHubリポジトリ `rasuta1125/-Q-A` を選択
4. **Begin setup** をクリック

### 2. ビルド設定

以下の設定を入力：

```
Project name: macaroni-qa-tool
Production branch: main
Build command: npm run build
Build output directory: dist
Root directory: (空白のまま)
```

### 3. 環境変数の設定

**Environment variables** セクションで以下を追加：

```
OPENAI_API_KEY = your_openai_api_key_here
```

### 4. 初回デプロイ実行

- **Save and Deploy** をクリック
- ビルドが成功することを確認（D1/Vectorizeなしでも動作します）

---

## 📦 D1データベースのセットアップ（必須）

D1データベースがないと、アプリケーションは動作しません。以下の手順で設定してください。

### ステップ1: Cloudflare APIキーの取得

1. Cloudflare ダッシュボード → **My Profile** → **API Tokens**
2. **Create Token** → **Edit Cloudflare Workers** テンプレートを選択
3. 権限を確認：
   - Account / Cloudflare Pages: Edit
   - Account / D1: Edit
   - Zone / Workers Routes: Edit
4. **Continue to summary** → **Create Token**
5. トークンをコピーして安全に保存

### ステップ2: ローカル環境でD1データベースを作成

```bash
# Cloudflare API Tokenを環境変数にセット
export CLOUDFLARE_API_TOKEN=your_token_here

# D1データベースを作成
npx wrangler d1 create macaroni-qa-db
```

出力例：
```
✅ Successfully created DB 'macaroni-qa-db'!

Add the following to your wrangler.toml:

[[d1_databases]]
binding = "DB"
database_name = "macaroni-qa-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**`database_id` をコピーしておく！**

### ステップ3: wrangler.jsonc を更新

`wrangler.jsonc` を以下のように更新：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "macaroni-qa-tool",
  "compatibility_date": "2025-10-19",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "macaroni-qa-db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  // ← ここに実際のIDを入れる
    }
  ]
}
```

### ステップ4: マイグレーションを実行

```bash
# 本番D1データベースにマイグレーションを適用
npx wrangler d1 migrations apply macaroni-qa-db --remote
```

### ステップ5: 本番データベースにサンプルデータを投入（オプション）

```bash
# サンプルQ&Aデータを投入
npx wrangler d1 execute macaroni-qa-db --remote --file=./seed.sql
```

### ステップ6: Cloudflare Pagesでバインディングを設定

1. Cloudflare ダッシュボード → **Workers & Pages** → `macaroni-qa-tool`
2. **Settings** → **Functions** → **D1 database bindings**
3. **Add binding** をクリック：
   - Variable name: `DB`
   - D1 database: `macaroni-qa-db` を選択
4. **Save** をクリック

### ステップ7: GitHubにプッシュして再デプロイ

```bash
git add wrangler.jsonc
git commit -m "chore: Update D1 database_id for production"
git push origin main
```

Cloudflare Pagesが自動的に再デプロイを開始します。

---

## 🔍 Vectorize（ベクトル検索）のセットアップ（オプション）

Vectorizeがなくても動作しますが、検索精度を向上させるために推奨します。

### ステップ1: Vectorizeインデックスを作成

```bash
# Vectorizeインデックスを作成
npx wrangler vectorize create macaroni-qa-index \
  --dimensions=1536 \
  --metric=cosine
```

### ステップ2: wrangler.jsonc に追加

```jsonc
{
  // ... 既存の設定 ...
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "macaroni-qa-index"
    }
  ]
}
```

### ステップ3: Cloudflare Pagesでバインディングを設定

1. Cloudflare ダッシュボード → **Workers & Pages** → `macaroni-qa-tool`
2. **Settings** → **Functions** → **Vectorize bindings**
3. **Add binding** をクリック：
   - Variable name: `VECTORIZE`
   - Vectorize index: `macaroni-qa-index` を選択
4. **Save** をクリック

### ステップ4: GitHubにプッシュして再デプロイ

```bash
git add wrangler.jsonc
git commit -m "chore: Add Vectorize configuration"
git push origin main
```

---

## 🔐 環境変数の追加・更新

### Cloudflare Pagesダッシュボードから設定

1. **Workers & Pages** → `macaroni-qa-tool`
2. **Settings** → **Environment variables**
3. **Add variable** をクリック：
   - Variable name: `OPENAI_API_KEY`
   - Value: `your_openai_api_key_here`
   - Environment: **Production** と **Preview** の両方にチェック
4. **Save** をクリック

### Wrangler CLI から設定（代替方法）

```bash
# シークレット環境変数を設定
npx wrangler pages secret put OPENAI_API_KEY --project-name macaroni-qa-tool
# プロンプトでAPIキーを入力
```

---

## 📋 トラブルシューティング

### エラー: "Invalid database UUID (local-dev)"

**原因**: `wrangler.jsonc` に開発環境用の `"database_id": "local-dev"` が残っている

**解決策**:
1. 本番用D1データベースを作成
2. `database_id` を実際のUUIDに更新
3. GitHubにプッシュして再デプロイ

### エラー: "DB is not defined"

**原因**: Cloudflare PagesでD1バインディングが設定されていない

**解決策**:
1. Cloudflare ダッシュボード → **Settings** → **Functions** → **D1 database bindings**
2. `DB` バインディングを追加
3. 再デプロイ

### エラー: "OPENAI_API_KEY is not defined"

**原因**: 環境変数が設定されていない

**解決策**:
1. Cloudflare ダッシュボード → **Settings** → **Environment variables**
2. `OPENAI_API_KEY` を追加
3. 再デプロイ

### ビルドは成功するが、アクセス時にエラー

**原因**: D1データベースが初期化されていない

**解決策**:
```bash
# マイグレーションを実行
npx wrangler d1 migrations apply macaroni-qa-db --remote
```

---

## 🎯 デプロイ後の確認

1. **デプロイURL確認**:
   ```
   https://macaroni-qa-tool.pages.dev
   ```

2. **動作確認**:
   - トップページ (`/`) にアクセス
   - Q&A管理画面 (`/admin`) にアクセス
   - サンプルデータがあるか確認
   - 回答生成機能をテスト

3. **ログ確認**:
   - Cloudflare ダッシュボード → **Workers & Pages** → `macaroni-qa-tool`
   - **Logs** タブでリアルタイムログを確認

---

## 📝 チェックリスト

デプロイ前に以下を確認：

- [ ] GitHubリポジトリがCloudflare Pagesに連携されている
- [ ] ビルド設定が正しい（`npm run build`, `dist`）
- [ ] 環境変数 `OPENAI_API_KEY` が設定されている
- [ ] D1データベースが作成されている
- [ ] `wrangler.jsonc` の `database_id` が実際のUUIDになっている
- [ ] D1バインディングがCloudflare Pagesで設定されている
- [ ] マイグレーションが本番DBに適用されている
- [ ] （オプション）Vectorizeインデックスが作成されている
- [ ] （オプション）Vectorizeバインディングが設定されている

---

## 🔄 継続的デプロイ

GitHubにプッシュすると、Cloudflare Pagesが自動的にビルド・デプロイを実行します：

```bash
git add .
git commit -m "feat: 新機能追加"
git push origin main
```

自動デプロイの流れ：
1. GitHubにプッシュ
2. Cloudflare Pagesが変更を検知
3. 自動的に `npm run build` を実行
4. ビルド成功後、自動デプロイ
5. 数分で本番環境に反映

---

**マカロニスタジオ Q&A回答ツール** - 本番デプロイガイド
