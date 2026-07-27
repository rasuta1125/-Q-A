import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import type { Bindings, QAItem, SearchResult, GeneratedAnswer, SourceReference } from './types';
import { generateEmbedding, generateAnswer, calculateConfidence, getEscalationNote } from './openai';
import { scrapeWebPage } from './web-scraper';

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定
app.use('/api/*', cors());

// 静的ファイル配信
app.use('/static/*', serveStatic({ root: './public' }));

// ルートへのアクセスは /instagram にリダイレクト
app.get('/', (c) => c.redirect('/instagram', 301));

// ===== 共通ナビゲーション =====
function buildNav(activePage: string): string {
  const links = [
    { href: '/instagram',  icon: 'fab fa-instagram',      label: 'Instagram' },
    { href: '/blog',       icon: 'fas fa-blog',           label: 'ブログ' },
    { href: '/staff-board',icon: 'fas fa-clipboard-list', label: '連絡板' },
    { href: '/attendance', icon: 'fas fa-user-clock',     label: '出勤管理' },

  ];
  const desktopLinks = links.map(l => {
    const active = l.href === activePage;
    const cls = active ? 'text-pink-500 font-bold' : 'text-gray-700 hover:text-pink-500';
    return `<a href="${l.href}" class="${cls}"><i class="${l.icon} mr-1"></i>${l.label}</a>`;
  }).join('\n        ');
  const mobileLinks = links.map(l => {
    const active = l.href === activePage;
    const cls = active
      ? 'block px-3 py-2 rounded-md text-base text-pink-500 font-bold bg-pink-50'
      : 'block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50';
    return `<a href="${l.href}" class="${cls}"><i class="${l.icon} mr-2"></i>${l.label}</a>`;
  }).join('\n        ');

  return `
<nav class="bg-white shadow-sm border-b fixed top-0 left-0 right-0 z-50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex justify-between h-16">
      <div class="flex items-center">
        <i class="fas fa-camera text-pink-500 text-xl mr-2"></i>
        <span class="text-base sm:text-xl font-bold text-gray-900">マカロニスタジオ</span>
      </div>
      <div class="hidden md:flex items-center space-x-4">
        ${desktopLinks}
      </div>
      <div class="md:hidden flex items-center">
        <button id="mobileMenuBtn" class="text-gray-700 hover:text-pink-500">
          <i class="fas fa-bars text-2xl"></i>
        </button>
      </div>
    </div>
  </div>
  <div id="mobileMenu" class="hidden md:hidden border-t border-gray-200">
    <div class="px-2 pt-2 pb-3 space-y-1">
      ${mobileLinks}
    </div>
  </div>
</nav>
<script>
  document.getElementById('mobileMenuBtn').addEventListener('click', function() {
    document.getElementById('mobileMenu').classList.toggle('hidden');
  });
</script>`
}

/**
 * スタッフ一覧取得
 */
app.get('/api/attendance/staff', async (c) => {
  const { DB } = c.env;
  try {
    const { results } = await DB.prepare(
      'SELECT * FROM staff_members WHERE is_active = 1 ORDER BY display_order ASC, id ASC'
    ).all();
    return c.json(results);
  } catch (error) {
    // staff_membersテーブルがない場合はデフォルト返す
    return c.json([
      { id: 1, name: '坂口', display_order: 1 },
      { id: 2, name: '小百合', display_order: 2 },
    ]);
  }
});

/**
 * スタッフ追加
 */
app.post('/api/attendance/staff', async (c) => {
  const { DB } = c.env;
  const { name, display_order } = await c.req.json();
  if (!name) return c.json({ error: 'スタッフ名は必須です' }, 400);

  try {
    // 既存スタッフ確認（論理削除済みなら復活、有効なら409）
    const existing = await DB.prepare(
      'SELECT id, is_active FROM staff_members WHERE name = ?'
    ).bind(name).first() as any;

    if (existing) {
      if (existing.is_active === 1) {
        return c.json({ error: `「${name}」は既に登録されています` }, 409);
      }
      // 論理削除済み → 復活
      await DB.prepare(
        'UPDATE staff_members SET is_active = 1, display_order = ? WHERE id = ?'
      ).bind(display_order || 99, existing.id).run();
      return c.json({ id: existing.id, name, display_order: display_order || 99, reactivated: true });
    }

    const result = await DB.prepare(
      'INSERT INTO staff_members (name, display_order) VALUES (?, ?)'
    ).bind(name, display_order || 99).run();

    return c.json({ id: result.meta.last_row_id, name, display_order: display_order || 99 });
  } catch (e: any) {
    return c.json({ error: e.message || '追加に失敗しました' }, 500);
  }
});

/**
 * スタッフ削除
 */
app.delete('/api/attendance/staff/:id', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));
  await DB.prepare('UPDATE staff_members SET is_active = 0 WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

/**
 * 出勤記録一覧取得（月別）
 */
app.get('/api/attendance', async (c) => {
  const { DB } = c.env;
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const staff_name = c.req.query('staff_name');

  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const endDate = `${year}-${monthStr}-31`;

  let query = 'SELECT * FROM attendance WHERE work_date BETWEEN ? AND ?';
  const params: any[] = [startDate, endDate];

  if (staff_name) {
    query += ' AND staff_name = ?';
    params.push(staff_name);
  }
  query += ' ORDER BY work_date ASC, staff_name ASC';

  const { results } = await DB.prepare(query).bind(...params).all();
  return c.json(results);
});

/**
 * 出勤記録登録・更新（Upsert）
 */
app.post('/api/attendance', async (c) => {
  const { DB } = c.env;
  const data = await c.req.json();
  const { staff_name, work_date, clock_in, clock_out, break_minutes, notes, status } = data;

  if (!staff_name || !work_date) {
    return c.json({ error: 'スタッフ名と勤務日は必須です' }, 400);
  }

  // 実労働時間を計算
  let work_minutes: number | null = null;
  if (clock_in && clock_out) {
    const [inH, inM] = clock_in.split(':').map(Number);
    const [outH, outM] = clock_out.split(':').map(Number);
    const totalIn = inH * 60 + inM;
    const totalOut = outH * 60 + outM;
    work_minutes = totalOut - totalIn - (break_minutes || 0);
    if (work_minutes < 0) work_minutes = 0;
  }

  const result = await DB.prepare(
    `INSERT INTO attendance (staff_name, work_date, clock_in, clock_out, break_minutes, work_minutes, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(staff_name, work_date) DO UPDATE SET
       clock_in = excluded.clock_in,
       clock_out = excluded.clock_out,
       break_minutes = excluded.break_minutes,
       work_minutes = excluded.work_minutes,
       notes = excluded.notes,
       status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    staff_name,
    work_date,
    clock_in || null,
    clock_out || null,
    break_minutes || 0,
    work_minutes,
    notes || null,
    status || 'present'
  ).run();

  return c.json({ id: result.meta.last_row_id, staff_name, work_date, clock_in, clock_out, break_minutes, work_minutes, notes, status });
});

/**
 * 出勤記録削除
 */
app.delete('/api/attendance/:id', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));
  await DB.prepare('DELETE FROM attendance WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

/**
 * 月次集計取得
 */
app.get('/api/attendance/summary', async (c) => {
  const { DB } = c.env;
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');

  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const endDate = `${year}-${monthStr}-31`;

  const { results } = await DB.prepare(
    `SELECT 
       staff_name,
       COUNT(*) as total_days,
       SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days,
       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days,
       SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_days,
       SUM(work_minutes) as total_work_minutes
     FROM attendance
     WHERE work_date BETWEEN ? AND ?
     GROUP BY staff_name
     ORDER BY staff_name`
  ).bind(startDate, endDate).all();

  return c.json(results);
});

// =====================================
// シフト希望メモ API
// =====================================

/** 希望メモ一覧取得（年月指定） */
app.get('/api/attendance/wishes', async (c) => {
  const { DB } = c.env;
  const ym = c.req.query('year_month') || '';
  if (!ym) return c.json({ error: 'year_month is required' }, 400);
  try {
    const { results } = await DB.prepare(
      'SELECT * FROM shift_wishes WHERE year_month = ? ORDER BY wish_date ASC, staff_name ASC'
    ).bind(ym).all();
    return c.json(results);
  } catch {
    return c.json([]);
  }
});

/** 希望メモ追加・更新（同スタッフ×同日はUPSERT） */
app.post('/api/attendance/wishes', async (c) => {
  const { DB } = c.env;
  try {
    const { staff_name, year_month, wish_date, wish_type, note } = await c.req.json();
    if (!staff_name || !year_month || !wish_date) {
      return c.json({ error: 'staff_name / year_month / wish_date は必須です' }, 400);
    }
    const result = await DB.prepare(`
      INSERT INTO shift_wishes (staff_name, year_month, wish_date, wish_type, note, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(staff_name, wish_date) DO UPDATE SET
        wish_type  = excluded.wish_type,
        note       = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `).bind(staff_name, year_month, wish_date, wish_type || 'note', note || '').run();
    return c.json({ id: result.meta.last_row_id, staff_name, wish_date, wish_type, note });
  } catch (e: any) {
    // UNIQUE制約がまだない場合はINSERT
    try {
      const { staff_name, year_month, wish_date, wish_type, note } = await c.req.json().catch(() => ({})) as any;
      const result = await DB.prepare(
        'INSERT INTO shift_wishes (staff_name, year_month, wish_date, wish_type, note) VALUES (?, ?, ?, ?, ?)'
      ).bind(staff_name, year_month, wish_date, wish_type || 'note', note || '').run();
      return c.json({ id: result.meta.last_row_id });
    } catch (e2: any) {
      return c.json({ error: e2.message }, 500);
    }
  }
});

/** 希望メモ削除 */
app.delete('/api/attendance/wishes/:id', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));
  try {
    await DB.prepare('DELETE FROM shift_wishes WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/**
 * Instagram投稿文生成ページ
 */
app.get('/instagram', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Instagram投稿文作成 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            body {
                background: linear-gradient(135deg, #FFF8DC 0%, #FFE4E1 100%);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .insta-container {
                max-width: 900px;
                margin: 0 auto;
                padding: 40px 20px;
            }
            
            .menu-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 20px;
                border: 3px solid #FFB6C1;
                border-radius: 15px;
                background: white;
                cursor: pointer;
                transition: all 0.3s;
            }
            
            .menu-btn:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(255, 105, 180, 0.3);
                border-color: #FF69B4;
            }
            
            .menu-btn.active {
                background: linear-gradient(135deg, #FF69B4, #FFB6C1);
                border-color: #FF1493;
                color: white;
            }
            
            .menu-emoji {
                font-size: 2.5rem;
            }
            
            .menu-name {
                font-weight: 600;
                font-size: 0.95rem;
            }
            
            .generate-btn {
                background: linear-gradient(135deg, #32CD32, #00CED1);
                color: white;
                font-weight: bold;
                padding: 16px 32px;
                border-radius: 12px;
                border: none;
                cursor: pointer;
                transition: all 0.3s;
                font-size: 1.1rem;
            }
            
            .generate-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 10px 25px rgba(50, 205, 50, 0.4);
            }
            
            .generate-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .result-card {
                background: white;
                border-radius: 20px;
                padding: 30px;
                margin-bottom: 30px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            }
            
            .post-text {
                white-space: pre-wrap;
                font-family: inherit;
                line-height: 1.8;
                color: #333;
                background: #FFF8DC;
                padding: 20px;
                border-radius: 12px;
                border-left: 4px solid #FF69B4;
            }
            
            .copy-btn {
                background: #FF69B4;
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                border: none;
                cursor: pointer;
                transition: all 0.3s;
                font-weight: 600;
                width: 100%;
                margin-top: 15px;
            }
            
            .copy-btn:hover {
                background: #FF1493;
                transform: scale(1.02);
            }
            
            .copy-btn.copied {
                background: #32CD32;
            }
            
            .copy-btn-small {
                background: #FFA07A;
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-size: 0.85rem;
                transition: all 0.3s;
            }
            
            .copy-btn-small:hover {
                background: #FF8C69;
            }
            
            .hidden {
                display: none !important;
            }
            
            .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #FF69B4;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin: 0 auto;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .hashtag-section {
                margin-top: 20px;
                padding-top: 20px;
                border-top: 2px dashed #FFB6C1;
            }
            
            .hashtags {
                color: #0095f6;
                line-height: 1.8;
                font-size: 0.9rem;
            }
            
            @media (max-width: 768px) {
                .insta-container {
                    padding: 20px 15px;
                }
                
                .menu-emoji {
                    font-size: 2rem;
                }
                
                .menu-name {
                    font-size: 0.85rem;
                }
            }
        </style>
    </head>
    <body>
        ${buildNav('/instagram')}
        
        <div class="insta-container pt-20">
            <!-- ヘッダー -->
            <div class="text-center mb-12">
                <h1 class="text-4xl md:text-5xl font-bold mb-4" style="color: #FF69B4;">
                    <i class="fab fa-instagram mr-3"></i>
                    Instagram投稿文作成
                </h1>
                <p class="text-lg text-gray-700">
                    マカロニスタジオの投稿スタイルで、AIが3パターン自動生成します✨
                </p>
            </div>
            
            <!-- メニュー選択 -->
            <div class="bg-white rounded-2xl p-8 shadow-lg mb-8">
                <h2 class="text-2xl font-bold mb-6 text-center" style="color: #FF69B4;">
                    <i class="fas fa-camera mr-2"></i>撮影メニューを選択
                </h2>
                <div id="menuGrid" class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <!-- メニューボタンがここに表示されます -->
                </div>
            </div>
            
            <!-- 入力フォーム -->
            <div id="inputSection" class="hidden bg-white rounded-2xl p-8 shadow-lg mb-8">
                <h2 class="text-2xl font-bold mb-6" style="color: #FF69B4;">
                    <i class="fas fa-pen mr-2"></i>撮影情報を入力
                </h2>
                
                <div class="space-y-6">
                    <!-- 撮影の様子 -->
                    <div>
                        <label class="block text-lg font-semibold mb-2 text-gray-800">
                            📝 撮影の様子や特徴（簡単なメモでOK）
                        </label>
                        <textarea 
                            id="description" 
                            rows="4"
                            placeholder="例: 元気いっぱいの男の子、パパと一緒に撮影、ピンクのドレス姿など"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none"
                        ></textarea>
                        <p class="text-sm text-gray-500 mt-1">※空欄でも生成できます</p>
                    </div>
                    
                    <!-- 雰囲気 -->
                    <div>
                        <label class="block text-lg font-semibold mb-3 text-gray-800">
                            🎨 雰囲気（複数選択可）
                        </label>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" name="mood" value="元気" class="w-5 h-5 text-pink-500 rounded">
                                <span>元気</span>
                            </label>
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" name="mood" value="かわいい" class="w-5 h-5 text-pink-500 rounded">
                                <span>かわいい</span>
                            </label>
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" name="mood" value="ほんわか" class="w-5 h-5 text-pink-500 rounded">
                                <span>ほんわか</span>
                            </label>
                            <label class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" name="mood" value="感動的" class="w-5 h-5 text-pink-500 rounded">
                                <span>感動的</span>
                            </label>
                        </div>
                    </div>
                    
                    <!-- 特別なポイント -->
                    <div>
                        <label class="block text-lg font-semibold mb-2 text-gray-800">
                            ✨ 特別なポイント（あれば）
                        </label>
                        <input 
                            type="text" 
                            id="specialPoint"
                            placeholder="例: 限定カラー、初めての笑顔、兄弟での撮影など"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none"
                        />
                    </div>
                    
                    <!-- 生成ボタン -->
                    <div class="text-center pt-4">
                        <button id="generateBtn" class="generate-btn">
                            <i class="fas fa-magic mr-2"></i>投稿文を生成する
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- ローディング -->
            <div id="loadingSection" class="hidden bg-white rounded-2xl p-12 shadow-lg mb-8 text-center">
                <div class="spinner mb-6"></div>
                <h3 class="text-2xl font-bold mb-2" style="color: #FF69B4;">
                    AIが投稿文を作成中です...
                </h3>
                <p class="text-gray-600">少々お待ちください</p>
            </div>
            
            <!-- 結果表示 -->
            <div id="resultsSection" class="hidden">
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-bold mb-2" style="color: #FF69B4;">
                        <i class="fas fa-check-circle mr-2"></i>生成完了！
                    </h2>
                    <p class="text-gray-700">お好みのパターンをコピーしてInstagramに投稿してください</p>
                </div>
                
                <div id="resultsContainer">
                    <!-- 結果がここに表示されます -->
                </div>
                
                <div class="text-center mt-8">
                    <button id="resetBtn" class="px-8 py-4 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold">
                        <i class="fas fa-redo mr-2"></i>別の投稿文を作成する
                    </button>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/instagram.js"></script>
    </body>
    </html>
  `);
});

/**
 * ブログ原稿生成ページ
 */
app.get('/blog', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ブログ原稿作成 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            body {
                background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .blog-container {
                max-width: 1000px;
                margin: 0 auto;
                padding: 40px 20px;
            }
            
            .article-type-btn {
                padding: 20px;
                border: 3px solid #3b82f6;
                border-radius: 15px;
                background: white;
                cursor: pointer;
                transition: all 0.3s;
                text-align: center;
            }
            
            .article-type-btn:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(59, 130, 246, 0.3);
            }
            
            .article-type-btn.active {
                background: linear-gradient(135deg, #3b82f6, #60a5fa);
                border-color: #2563eb;
                color: white;
            }
            
            .menu-btn {
                padding: 15px;
                border: 2px solid #06b6d4;
                border-radius: 12px;
                background: white;
                cursor: pointer;
                transition: all 0.3s;
                text-align: center;
            }
            
            .menu-btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 8px 20px rgba(6, 182, 212, 0.3);
            }
            
            .menu-btn.active {
                background: #06b6d4;
                color: white;
            }
            
            .generate-btn {
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                font-weight: bold;
                padding: 16px 32px;
                border-radius: 12px;
                border: none;
                cursor: pointer;
                transition: all 0.3s;
                font-size: 1.1rem;
            }
            
            .generate-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);
            }
            
            .result-card {
                background: white;
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            }
            
            .article-preview {
                white-space: pre-wrap;
                font-family: inherit;
                line-height: 1.8;
                color: #333;
                background: #f8fafc;
                padding: 25px;
                border-radius: 12px;
                border-left: 4px solid #3b82f6;
                max-height: 600px;
                overflow-y: auto;
            }
            
            .copy-btn {
                background: #3b82f6;
                color: white;
                padding: 14px 28px;
                border-radius: 8px;
                border: none;
                cursor: pointer;
                transition: all 0.3s;
                font-weight: 600;
                width: 100%;
                font-size: 1.1rem;
            }
            
            .copy-btn:hover {
                background: #2563eb;
                transform: scale(1.02);
            }
            
            .copy-btn.copied {
                background: #10b981;
            }
            
            .hidden {
                display: none !important;
            }
            
            .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3b82f6;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin: 0 auto;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            @media (max-width: 768px) {
                .blog-container {
                    padding: 20px 15px;
                }
            }
        </style>
    </head>
    <body>
        ${buildNav('/blog')}
        
        <div class="blog-container pt-20">
            <!-- ヘッダー -->
            <div class="text-center mb-12">
                <h1 class="text-4xl md:text-5xl font-bold mb-4" style="color: #3b82f6;">
                    <i class="fas fa-blog mr-3"></i>
                    ブログ原稿作成
                </h1>
                <p class="text-lg text-gray-700">
                    Wixにそのままコピペできる！AIがブログ原稿を自動生成✨
                </p>
            </div>
            
            <!-- 記事タイプ選択 -->
            <div class="bg-white rounded-2xl p-8 shadow-lg mb-8">
                <h2 class="text-2xl font-bold mb-6 text-center" style="color: #3b82f6;">
                    <i class="fas fa-file-alt mr-2"></i>記事タイプを選択
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <button class="article-type-btn" data-type="introduction" onclick="selectArticleType('introduction')">
                        <div class="text-4xl mb-3">📖</div>
                        <div class="text-xl font-bold mb-2">紹介記事</div>
                        <div class="text-sm text-gray-600">サービス説明・SEO記事</div>
                        <div class="text-xs mt-2 text-gray-500">例: ミルクバスとは？</div>
                    </button>
                    <button class="article-type-btn" data-type="report" onclick="selectArticleType('report')">
                        <div class="text-4xl mb-3">📝</div>
                        <div class="text-xl font-bold mb-2">撮影レポート</div>
                        <div class="text-sm text-gray-600">撮影の様子・お客様の声</div>
                        <div class="text-xs mt-2 text-gray-500">例: 〇〇ちゃんの100日記念</div>
                    </button>
                </div>
            </div>
            
            <!-- 入力フォーム -->
            <div id="inputSection" class="hidden bg-white rounded-2xl p-8 shadow-lg mb-8">
                <h2 class="text-2xl font-bold mb-6" style="color: #3b82f6;">
                    <i class="fas fa-edit mr-2"></i>記事情報を入力
                </h2>
                
                <div class="space-y-6">
                    <!-- 記事タイプ選択 -->
                    <div>
                        <label class="block text-lg font-semibold mb-3 text-gray-800">
                            📄 記事タイプ
                        </label>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label class="flex items-center space-x-2 p-4 border-2 rounded-lg cursor-pointer hover:bg-blue-50">
                                <input type="radio" name="articleType" value="menu" checked class="w-5 h-5 text-blue-500" onchange="toggleMenuSelection()">
                                <div>
                                    <span class="font-semibold block">撮影メニュー紹介</span>
                                    <span class="text-sm text-gray-600">七五三、ミルクバス等</span>
                                </div>
                            </label>
                            <label class="flex items-center space-x-2 p-4 border-2 rounded-lg cursor-pointer hover:bg-blue-50">
                                <input type="radio" name="articleType" value="free" class="w-5 h-5 text-blue-500" onchange="toggleMenuSelection()">
                                <div>
                                    <span class="font-semibold block">自由記事・お知らせ</span>
                                    <span class="text-sm text-gray-600">新サービス、背景紙追加等</span>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <!-- 撮影メニュー選択 -->
                    <div id="menuSelectionSection">
                        <label class="block text-lg font-semibold mb-3 text-gray-800">
                            📸 撮影メニュー
                        </label>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3" id="menuGrid">
                            <!-- メニューボタンがここに表示されます -->
                        </div>
                    </div>
                    
                    <!-- タイトル -->
                    <div>
                        <label class="block text-lg font-semibold mb-2 text-gray-800">
                            📌 記事タイトル（オプション）
                        </label>
                        <input 
                            type="text" 
                            id="title"
                            placeholder="空欄の場合は自動生成されます"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-400 focus:outline-none"
                        />
                        <p class="text-sm text-gray-500 mt-1">※空欄でOK！AIが自動で作成します</p>
                    </div>
                    
                    <!-- キーワード -->
                    <div id="keywordsField">
                        <label class="block text-lg font-semibold mb-2 text-gray-800">
                            🔍 SEOキーワード（オプション）
                        </label>
                        <input 
                            type="text" 
                            id="keywords"
                            placeholder="例: ミルクバス, フォトスタジオ, 沖縄"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-400 focus:outline-none"
                        />
                    </div>
                    
                    <!-- 記事の要点 -->
                    <div>
                        <label class="block text-lg font-semibold mb-2 text-gray-800">
                            <span id="mainPointsLabel">📝 記事の要点・特徴</span>
                        </label>
                        <textarea 
                            id="mainPoints" 
                            rows="5"
                            placeholder="例: サービスの魅力、お客様の反応、撮影エピソードなど"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-400 focus:outline-none"
                        ></textarea>
                        <p class="text-sm text-gray-500 mt-1">※簡単なメモでOK！AIが文章化します</p>
                    </div>
                    
                    <!-- トーン -->
                    <div>
                        <label class="block text-lg font-semibold mb-3 text-gray-800">
                            🎨 文章のトーン
                        </label>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <label class="flex items-center space-x-2 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50">
                                <input type="radio" name="tone" value="professional" checked class="w-5 h-5 text-blue-500">
                                <span class="font-medium">プロフェッショナル</span>
                            </label>
                            <label class="flex items-center space-x-2 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50">
                                <input type="radio" name="tone" value="friendly" class="w-5 h-5 text-blue-500">
                                <span class="font-medium">親しみやすい</span>
                            </label>
                            <label class="flex items-center space-x-2 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50">
                                <input type="radio" name="tone" value="casual" class="w-5 h-5 text-blue-500">
                                <span class="font-medium">カジュアル</span>
                            </label>
                        </div>
                    </div>
                    
                    <!-- 生成ボタン -->
                    <div class="text-center pt-4">
                        <button id="generateBtn" class="generate-btn">
                            <i class="fas fa-magic mr-2"></i>ブログ原稿を生成する
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- ローディング -->
            <div id="loadingSection" class="hidden bg-white rounded-2xl p-12 shadow-lg mb-8 text-center">
                <div class="spinner mb-6"></div>
                <h3 class="text-2xl font-bold mb-2" style="color: #3b82f6;">
                    AIがブログ原稿を作成中です...
                </h3>
                <p class="text-gray-600">少々お待ちください</p>
            </div>
            
            <!-- 結果表示 -->
            <div id="resultsSection" class="hidden">
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-bold mb-2" style="color: #3b82f6;">
                        <i class="fas fa-check-circle mr-2"></i>生成完了！
                    </h2>
                    <p class="text-gray-700">Wixエディタにそのままコピー＆ペーストできます</p>
                </div>
                
                <div class="result-card">
                    <div class="mb-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-2xl font-bold" style="color: #3b82f6;">
                                <i class="fas fa-file-alt mr-2"></i>ブログ原稿
                            </h3>
                            <div class="flex items-center gap-4">
                                <button id="editToggleBtn" onclick="toggleEditMode()" class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-semibold text-sm">
                                    <i class="fas fa-edit mr-1"></i>編集
                                </button>
                                <span id="wordCount" class="text-lg font-semibold text-gray-600"></span>
                            </div>
                        </div>
                        
                        <!-- プレビューモード -->
                        <div id="articlePreview" class="article-preview"></div>
                        
                        <!-- 編集モード -->
                        <textarea 
                            id="articleEditor" 
                            class="hidden w-full article-preview border-2 border-blue-300 focus:border-blue-500 focus:outline-none"
                            rows="20"
                            style="resize: vertical; font-family: inherit;"
                        ></textarea>
                        <p id="editHint" class="hidden text-sm text-gray-500 mt-2">
                            💡 編集後、「プレビュー」で確認してから「原稿をコピー」してください
                        </p>
                    </div>
                    
                    <button class="copy-btn" onclick="copyArticle()">
                        <i class="fas fa-copy mr-2"></i>原稿をコピー
                    </button>
                    
                    <div class="text-center mt-6">
                        <button onclick="resetForm()" class="px-8 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold">
                            <i class="fas fa-redo mr-2"></i>別の原稿を作成する
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // 記事タイプによってメニュー選択の表示/非表示を切り替え
            function toggleMenuSelection() {
                const articleType = document.querySelector('input[name="articleType"]:checked').value;
                const menuSection = document.getElementById('menuSelectionSection');
                const mainPointsLabel = document.getElementById('mainPointsLabel');
                
                if (articleType === 'free') {
                    menuSection.style.display = 'none';
                    mainPointsLabel.textContent = '📝 記事の内容・伝えたいこと';
                } else {
                    menuSection.style.display = 'block';
                    mainPointsLabel.textContent = '📝 記事の要点・特徴';
                }
            }
        </script>
        <script src="/static/blog.js"></script>
    </body>
    </html>
  `);
});

// =====================================
// スタッフ連絡掲示板ページ
// =====================================
app.get('/staff-board', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>スタッフ連絡掲示板 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            .message-card {
                transition: all 0.3s ease;
                border-left: 4px solid #FFB6C1;
            }
            .message-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(255, 182, 193, 0.3);
            }
            .message-card.completed {
                border-left-color: #9CA3AF;
                opacity: 0.7;
            }
            .filter-btn.active {
                background: linear-gradient(135deg, #FF69B4 0%, #FFB6C1 100%);
                color: white;
            }
            .staff-tab {
                transition: all 0.2s ease;
            }
            .staff-tab.selected {
                background: linear-gradient(135deg, #FF69B4 0%, #FFB6C1 100%);
                color: white;
                border-color: #FF69B4;
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(255, 105, 180, 0.3);
            }
            .staff-tab:hover {
                transform: translateY(-1px);
            }
            .to-staff-btn.selected {
                background: linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%);
                color: white;
                border-color: #3B82F6;
                box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
            }
            .to-staff-btn:hover {
                transform: translateY(-1px);
            }
        </style>
    </head>
    <body class="bg-gray-50">
        ${buildNav('/staff-board')}

        <!-- メインコンテンツ -->
        <div class="container mx-auto px-4 py-8 max-w-5xl">
            <div class="mb-8">
                <h2 class="text-3xl font-bold mb-2" style="color: #FF69B4;">
                    <i class="fas fa-clipboard-list mr-3"></i>スタッフ連絡掲示板
                </h2>
                <p class="text-gray-600">スタッフ間の連絡事項を管理します</p>
            </div>

            <!-- 新規連絡事項フォーム -->
            <div class="bg-white rounded-2xl shadow-lg p-6 mb-8">
                <h3 class="text-xl font-bold mb-4 flex items-center" style="color: #3b82f6;">
                    <i class="fas fa-plus-circle mr-2"></i>新規連絡事項を追加
                </h3>
                
                <form id="addMessageForm" class="space-y-4">
                    <!-- スタッフ名タブ -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-3">
                            スタッフ名を選択 <span class="text-red-500">*</span>
                        </label>
                        <input type="hidden" id="staffName" required />
                        <div class="grid grid-cols-3 md:grid-cols-6 gap-2">
                            <button type="button" onclick="selectStaff('坂口')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="坂口">
                                坂口
                            </button>
                            <button type="button" onclick="selectStaff('小百合')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="小百合">
                                小百合
                            </button>
                            <button type="button" onclick="selectStaff('史弥')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="史弥">
                                史弥
                            </button>
                            <button type="button" onclick="selectStaff('秋吉')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="秋吉">
                                秋吉
                            </button>
                            <button type="button" onclick="selectStaff('響')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="響">
                                響
                            </button>
                            <button type="button" onclick="selectStaff('みれい')" class="staff-tab px-4 py-3 rounded-lg border-2 border-gray-300 hover:border-pink-400 transition font-semibold text-sm" data-staff="みれい">
                                みれい
                            </button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 gap-4">
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-2">
                                日付 <span class="text-red-500">*</span>
                            </label>
                            <input 
                                type="date" 
                                id="messageDate" 
                                required
                                class="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none"
                            />
                        </div>
                    </div>
                    
                    <!-- TO（宛先）選択 -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-3">
                            📩 TO（宛先） <span class="text-gray-500 text-xs">(任意 - 複数選択可)</span>
                        </label>
                        <div class="grid grid-cols-3 md:grid-cols-4 gap-2" id="toStaffGrid">
                            <button type="button" onclick="toggleToStaff('全員')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="全員">
                                👥 全員
                            </button>
                            <button type="button" onclick="toggleToStaff('坂口')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="坂口">
                                坂口
                            </button>
                            <button type="button" onclick="toggleToStaff('小百合')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="小百合">
                                小百合
                            </button>
                            <button type="button" onclick="toggleToStaff('史弥')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="史弥">
                                史弥
                            </button>
                            <button type="button" onclick="toggleToStaff('秋吉')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="秋吉">
                                秋吉
                            </button>
                            <button type="button" onclick="toggleToStaff('響')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="響">
                                響
                            </button>
                            <button type="button" onclick="toggleToStaff('みれい')" class="to-staff-btn px-3 py-2 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition text-sm" data-to="みれい">
                                みれい
                            </button>
                        </div>
                        <input type="hidden" id="toStaff" value="" />
                        <p class="text-xs text-gray-500 mt-2">💡 宛先を指定するとLINE通知が送信されます</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            連絡内容 <span class="text-red-500">*</span>
                        </label>
                        <textarea 
                            id="messageContent" 
                            required
                            rows="4"
                            placeholder="連絡事項を入力してください"
                            class="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none resize-vertical"
                        ></textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            画像 <span class="text-gray-500 text-xs">(任意)</span>
                        </label>
                        
                        <!-- ファイルアップロード -->
                        <input 
                            type="file" 
                            id="messageImage" 
                            accept="image/*"
                            class="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none"
                        />
                        <p class="text-xs text-gray-500 mt-1">📷 画像を選択（JPG, PNG, GIF対応、最大10MB）</p>
                        <div id="imagePreview" class="mt-2 hidden">
                            <img id="previewImg" class="max-w-xs rounded-lg shadow-md" />
                        </div>
                    </div>
                    
                    <button 
                        type="submit"
                        class="w-full py-3 text-white font-bold rounded-lg transition"
                        style="background: linear-gradient(135deg, #FF69B4 0%, #FFB6C1 100%);"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(255, 105, 180, 0.4)'"
                        onmouseout="this.style.transform=''; this.style.boxShadow=''"
                    >
                        <i class="fas fa-paper-plane mr-2"></i>連絡事項を追加
                    </button>
                </form>
            </div>

            <!-- フィルターボタン -->
            <div class="flex flex-wrap gap-3 mb-6">
                <button onclick="filterMessages('all')" class="filter-btn active px-6 py-2 rounded-full font-semibold transition border-2 border-pink-300">
                    <i class="fas fa-list mr-2"></i>すべて
                </button>
                <button onclick="filterMessages('pending')" class="filter-btn px-6 py-2 rounded-full font-semibold transition border-2 border-pink-300">
                    <i class="fas fa-clock mr-2"></i>未対応
                </button>
                <button onclick="filterMessages('completed')" class="filter-btn px-6 py-2 rounded-full font-semibold transition border-2 border-pink-300">
                    <i class="fas fa-check-circle mr-2"></i>対応済み
                </button>
            </div>

            <!-- 連絡事項リスト -->
            <div id="messagesList" class="space-y-4">
                <!-- ここに連絡事項が表示されます -->
            </div>

            <!-- ローディング表示 -->
            <div id="loading" class="hidden text-center py-8">
                <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-pink-400 border-t-transparent"></div>
                <p class="mt-4 text-gray-600">読み込み中...</p>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/staff-board.js"></script>
        
        <script>
            // 日付フィールドに今日の日付を設定
            document.getElementById('messageDate').valueAsDate = new Date();
        </script>
    </body>
    </html>
  `);
});

/**
 * Instagram投稿文生成API
 */
app.post('/api/instagram/generate', async (c) => {
  const { OPENAI_API_KEY } = c.env;
  const { menu, description, moods, specialPoint } = await c.req.json();
  
  // メニューデータ
  const MENU_DATA: Record<string, any> = {
    '100day': {
      name: '100日フォト',
      emoji: '👶',
      title: '𝟏𝟎𝟎 𝐝𝐚𝐲𝐬 𝐩𝐡𝐨𝐭𝐨',
      services: ['家族写真込み', '兄弟写真込み', '全データ納品（100枚保証）', 'お衣装着放題'],
      hashtags: '#100日 #100日フォト #赤ちゃん #ベビーフォト #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
    },
    'birthday': {
      name: 'バースデーフォト',
      emoji: '🎂',
      title: '𝟏𝐬𝐭 𝐛𝐢𝐫𝐭𝐡𝐝𝐚𝐲',
      services: ['家族写真込み', '兄弟写真込み', '全データ納品', '衣装着放題', 'リピーター割有り'],
      hashtags: '#1歳 #お誕生日 #1stbirthday #バースデーフォト #誕生日 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
    },
    'shichigosan': {
      name: '七五三',
      emoji: '👘',
      title: '𝟕𝟓𝟑 𝐩𝐡𝐨𝐭𝐨',
      services: ['ヘアメイク付き', '和装1着 洋装1着', '家族写真込み', '兄弟写真込み', 'お衣装着放題', 'リピーター割有り'],
      hashtags: '#七五三 #753 #七五三撮影 #家族写真 #記念撮影 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
    },
    'milkbath': {
      name: 'ミルクバス',
      emoji: '🫧',
      title: '𝐦𝐢𝐥𝐤 𝐛𝐚𝐭𝐡',
      services: ['バスローブ姿', 'ドレス姿', '私服姿も可能', '家族写真込み', '全データお渡し（100枚保証）', 'お衣装着放題'],
      hashtags: '#ミルクバス #沐浴 #ベビーフォト #ハーフバースデー #赤ちゃん #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ'
    },
    'halfbirthday': {
      name: 'ハーフバースデー',
      emoji: '⭐',
      title: '𝐡𝐚𝐥𝐟 𝐛𝐢𝐫𝐭𝐡𝐝𝐚𝐲',
      services: ['家族写真込み', '兄弟写真込み', '全データ納品（100枚保証）', 'お衣装着放題'],
      hashtags: '#ハーフバースデー #生後6ヶ月 #ベビーフォト #halfbirthday #6ヶ月 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ'
    },
    'family': {
      name: 'ファミリーフォト',
      emoji: '👨‍👩‍👧',
      title: '𝐟𝐚𝐦𝐢𝐥𝐲 𝐩𝐡𝐨𝐭𝐨',
      services: ['家族写真込み', '兄弟写真込み', 'お衣装着放題', '全データ納品（100枚保証）'],
      hashtags: '#家族写真 #familyphoto #familytime #家族時間 #ファミリーフォト #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄イベント'
    },
    'smashcake': {
      name: 'スマッシュケーキ',
      emoji: '🎂',
      title: '𝐬𝐦𝐚𝐬𝐡 𝐜𝐚𝐤𝐞',
      services: ['合成着色料不使用（お野菜パウダー使用）', '純正クリーム', '国産小麦粉使用（福岡産）', 'アレルギー除去対応', '3日前までのご予約', '家族写真込み', '兄弟写真込み', 'フォトフレーム付き'],
      hashtags: '#スマッシュケーキ #smashcake #1歳 #1stbirthday #誕生日 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ'
    },
    'ryuso': {
      name: '琉装撮影',
      emoji: '🌺',
      title: '-OKINAWA- 琉装',
      services: ['沖縄伝統琉装', '100日〜6ヶ月サイズ対応', '家族写真込み', '全データお渡し', 'フォトフレーム付き', '貸切スタジオ'],
      hashtags: '#琉装 #琉装撮影 #沖縄 #伝統 #ベビーフォト #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ'
    }
  };
  
  const menuData = MENU_DATA[menu];
  if (!menuData) {
    return c.json({ error: 'Invalid menu' }, 400);
  }
  
  // サービス内容を整形
  const servicesList = menuData.services.map((s: string) => `◻︎${s}`).join('\n');
  
  // 過去投稿のサンプル（文体の学習用）
  const styleSamples = `
【過去の投稿サンプル】

サンプル1:
〻
𝐦𝐢𝐥𝐤 𝐛𝐚𝐭𝐡 𝐭𝐢𝐦𝐞
🌼🌼🌼

夢中な姿から不思議そうな顔を色んな角度で📷
全部が可愛くて愛おしいね

◻︎家族写真込み
◻︎兄弟写真込み
◻︎全データお渡し（100枚保証）
◻︎お衣装着放題

〈ご予約方法〉
ＨＰまたはDM💌
または公式LINEまで（🔍マカロニスタジオ）

サンプル2:
〻
ママと僕

笑顔120％で、見ているこちらも自然と笑顔になってしまう瞬間🫶🏻

最初は1人での撮影が少し苦手だったけれど、後半は慣れてたくさん遊んでくれて一安心🤣
こんな素敵な笑顔に出会えて、心温まる撮影時間になりました🫶🏻

小さな当店までお越しいただき、誠にありがとうございます✨

サンプル3:
〻
𝐟𝐚𝐦𝐢𝐥𝐲 𝐩𝐡𝐨𝐭𝐨

ドキドキしながら始まった家族写真。
枚数を重ねるごとに、少しずつ笑顔や自然体が出てくる姿も、大切な瞬間です🫧
少し緊張している姿も、頑張っている証で、とても愛おしいもの。

全データ納品の良さは、こうした一瞬一瞬の違いを見つけ、家族みんなでゆっくり振り返りながら、温かい気持ちを共有できることだと思います🙂‍↕️🤍
`;
  
  // プロンプト生成
  const prompt = `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」のInstagram投稿担当者です。
過去の投稿スタイルを参考に、新しい投稿文を3パターン作成してください。

【撮影メニュー】
${menuData.name} ${menuData.emoji}

【撮影の様子】
${description}

【雰囲気】
${moods.join('、')}

【特別なポイント】
${specialPoint}

${styleSamples}

【投稿スタイルの特徴】
1. 文頭に「〻」を必ず付ける
2. タイトルに特殊フォントを使用（例: ${menuData.title}）
3. 絵文字を適度に使用（🫶🏻、🌼、✨、🫧、💛など）
4. 改行を効果的に使い読みやすく
5. 温かく丁寧な語り口
6. 撮影体験や子どもの様子を具体的に描写
7. お客様への感謝の気持ちを表現
8. 150-300文字程度

【サービス内容（必ず含める）】
${servicesList}

【予約方法（必ず含める）】
〈ご予約方法〉
ＨＰまたはDM💌
または公式LINEまで（🔍マカロニスタジオ）

【出力形式】
以下の形式で3パターン出力してください。各パターンは「---パターンX---」で区切ってください：

---パターン1---
[投稿文]

---パターン2---
[投稿文]

---パターン3---
[投稿文]`;

  try {
    // OpenAI API呼び出し
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'あなたはプロのSNSコンテンツライターです。温かく優しい文体で、子どもたちや家族の素敵な瞬間を伝える投稿文を作成します。過去の投稿サンプルの文体・構成・雰囲気を忠実に再現してください。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 1500
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.statusText} - ${errorData}`);
    }
    
    const data = await response.json();
    const generatedText = data.choices[0].message.content;
    
    // 3パターンに分割
    const patterns = generatedText.split(/---パターン\d---/).filter((p: string) => p.trim());
    
    const results = patterns.slice(0, 3).map((text: string) => ({
      text: text.trim(),
      hashtags: menuData.hashtags
    }));
    
    // 3パターン未満の場合はエラー
    if (results.length < 3) {
      throw new Error('Failed to generate 3 patterns');
    }
    
    return c.json({
      patterns: results
    });
    
  } catch (error: any) {
    console.error('Instagram generation error:', error);
    return c.json({ error: error.message || 'Generation failed' }, 500);
  }
});

/**
 * ブログ記事生成API
 */
app.post('/api/blog/generate', async (c) => {
  const OPENAI_API_KEY = c.env.OPENAI_API_KEY || (c as any).env?.OPENAI_API_KEY;
  console.log('[blog/generate] OPENAI_API_KEY exists:', !!OPENAI_API_KEY, '| length:', OPENAI_API_KEY?.length);
  const body = await c.req.json();
  const { menu, title, keywords, mainPoints, tone } = body;
  // articleType が未送信・null・undefined の場合も安全に処理
  const articleType: string = body.articleType || 'free';

  console.log('[blog/generate] articleType:', articleType, '| menu:', menu, '| title:', title);
  
  // メニューデータ
  const MENU_DATA: Record<string, any> = {
    '100day': {
      name: '100日フォト',
      description: '生後100日を記念する大切な節目の撮影',
      features: [
        '家族全員での記念撮影',
        '兄弟姉妹も一緒に撮影可能',
        '100枚以上の全データ納品',
        '豊富な衣装から選び放題'
      ]
    },
    'birthday': {
      name: 'バースデーフォト',
      description: '1歳の誕生日を祝う特別な記念撮影',
      features: [
        '家族写真込みのプラン',
        '成長記録として残せる',
        '全データ納品で思い出を保存',
        'リピーター割引あり'
      ]
    },
    'shichigosan': {
      name: '七五三',
      description: '伝統的な七五三の記念撮影',
      features: [
        'プロのヘアメイク付き',
        '和装・洋装の両方で撮影',
        '家族全員での記念写真',
        '豊富な衣装ラインナップ'
      ]
    },
    'milkbath': {
      name: 'ミルクバス',
      description: '幻想的で可愛らしいミルクバス撮影',
      features: [
        'バスローブ姿も撮影可能',
        'ドレス姿での撮影込み',
        '私服での撮影もOK',
        '100枚以上の全データ納品'
      ]
    },
    'halfbirthday': {
      name: 'ハーフバースデー',
      description: '生後6ヶ月の成長を記念する撮影',
      features: [
        '家族写真込み',
        '寝返りやお座りの姿を記録',
        '全データ納品（100枚保証）',
        '豊富な衣装で変身'
      ]
    },
    'family': {
      name: 'ファミリーフォト',
      description: '家族の絆を形に残す記念撮影',
      features: [
        '家族全員での撮影',
        '兄弟姉妹の個別撮影も',
        '自然な表情を引き出す撮影',
        '全データ納品で思い出を共有'
      ]
    },
    'smashcake': {
      name: 'スマッシュケーキ',
      description: '1歳のバースデーに人気のスマッシュケーキ撮影',
      features: [
        '合成着色料不使用の安心ケーキ',
        '純正クリーム使用',
        'アレルギー除去対応可能',
        '家族写真とフォトフレーム付き'
      ]
    },
    'ryuso': {
      name: '琉装撮影',
      description: '沖縄伝統の琉装での記念撮影',
      features: [
        '本格的な沖縄伝統衣装',
        '100日〜6ヶ月サイズ対応',
        '家族写真込み',
        '貸切スタジオで安心撮影'
      ]
    }
  };
  
  const menuData = menu ? MENU_DATA[menu] : null;
  
  // メニュー記事タイプの場合はメニューデータが必須
  if (articleType === 'menu' && !menuData) {
    return c.json({ error: 'Invalid menu' }, 400);
  }
  
  // マカロニスタジオ 完全スタジオ情報
  const studioStrengths = `
【スタジオ基本情報】
店名：マカロニスタジオ
所在地：沖縄県那覇市
コンセプト：「一生に一度の大切な瞬間を、最高の形で残す」こども専門写真スタジオ

【2店舗】
・マカロニスタジオ（寄宮店）：那覇市寄宮2-6-10
  特徴：明るく・やさしい色味。背景紙はピンク・イエロー・白。
・マカロニスタジオAtelier：那覇市真地343
  特徴：落ち着いた色味。ベージュ・造花ブース・モルタル壁。
※料金・プランは両店舗共通
※リピーター割引：¥2,000 OFF（店舗またぎでも適用）

【スタジオの特徴】
・完全貸切制（1枠1組限定）
・全データお渡し（100枚保証）
・衣装着放題
・背景バリエーション豊富
・体験型撮影（スマッシュケーキ・ミルクバス）

【撮影メニューと料金】

■ 100日記念
・データプラン：¥26,000
・アルバムプラン：¥35,000
・一面台紙：¥37,800

■ ハーフバースデー
・平日限定プラン：¥16,000（撮影内容異なる）
・データプラン：¥26,000
・アルバムプラン：¥35,000
・一面台紙：¥37,800

■ 1歳バースデー
・データプラン：¥26,000
・アルバムプラン：¥35,000
・一面台紙：¥37,800

■ 2歳バースデー
・平日限定プラン：¥12,000（60分・データ30枚・撮影内容異なる・リピーター割不可）
・通常プラン：¥26,000（90分・全データ・衣装着放題・背景5ブースから2つ）

■ 七五三（3歳・5歳）※料金共通
・データプラン：¥28,500
・アルバムプラン：¥37,500
・一面台紙：¥40,300
※ヘアメイク込み

■ 七五三（7歳）※衣装レンタルあり
・データプラン：¥37,500
・アルバムプラン：¥46,500
・一面台紙：¥49,300
※ヘアメイク込み・和装1着+洋装1着

■ 七五三 兄弟追加
・両方ソロ+和装洋装：プラン代+¥13,500
・2人目洋装のみ：プラン代+¥6,000
・兄弟撮影のみ（ソロ・衣装なし）：追加料金なし

【アドオンメニュー】

■ スマッシュケーキ（プランへの追加）
・料金：+¥12,000
・カラー：ホワイト／グリーン／ピンク
・オプション：数字クッキー+¥300、ネームクッキープレート+¥300
・持ち込み不可
・対象：1歳バースデー等

■ ミルクバス（プランへの追加）
・お湯あり：+¥8,500
・お湯なし（ワタで代用）：+¥6,500
・対象：6ヶ月〜1歳
・オプション：生花+¥500、フルーツ+¥500
・バスローブ無料（1歳はサイズの関係で着用不可）
・グッズ：フォトフレーム1個付き

■ 琉装撮影（プランへの追加）
・料金：+¥1,500
・対象：100日〜ハーフバースデー

【行っていないこと（記事に含めないこと）】
・ロケーションフォト（屋外撮影）
・大人数での集合撮影
・お食い初め
・短時間・格安の流れ作業撮影

【予約方法】
・Instagram DM
・公式LINE
・ホームページ
`;
  
  // 記事タイプ別のプロンプト
  let prompt = '';
  
  if (articleType === 'introduction') {
    // 紹介記事
    prompt = `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」のブログライターです。
以下の内容で、Wixにそのままコピペできるブログ記事原稿（プレーンテキスト）を作成してください。

【参考記事のスタイル】
- タイトル例: 「【那覇で人気】スマッシュケーキ撮影って何？1歳バースデーフォト完全ガイド」
- SEOを意識した長めのタイトル（地域名＋キーワード）
- 読者の疑問に答える構成
- 具体的な情報（料金、サービス内容、予約方法）
- Q&A形式のセクションを含む
- 箇条書きで情報を整理
- 親しみやすく読みやすい文体

【最重要：必ずこのタイトルと要点を記事の軸にすること。テンプレ的な構成にせず、タイトルや要点に沿った独自の内容で書くこと】

【記事タイトル（このタイトルそのままで書く）】
${title || `【那覇で人気】${menuData.name}って何？マカロニスタジオ完全ガイド`}

【記事で伝えたい要点・特徴（この内容を中心に展開すること）】
${mainPoints || 'サービスの魅力とマカロニスタジオの特徴を紹介'}

【撮影メニュー】
${menuData.name}：${menuData.description}

【SEOキーワード】
${keywords || menuData.name + ', フォトスタジオ, 沖縄, 那覇, 子ども写真, 記念撮影'}

【マカロニスタジオのサービス特徴】
${menuData.features.map((f: string) => `・${f}`).join('\n')}

${studioStrengths}

【トーン】
${tone || 'friendly'}（professional=プロフェッショナル、friendly=親しみやすい、casual=カジュアル）

【記事構成】
1. タイトル（SEOを意識）
   - 地域名（那覇・沖縄）を含む
   - 疑問形または完全ガイド形式
   
2. 導入（100-150文字）
   - 読者の疑問や悩みに共感
   - 記事で解決できることを提示
   
3. ${menuData.name}とは？（250-350文字）
   - サービスの概要
   - どんな撮影なのか具体的に
   - なぜ人気なのか
   - 適した年齢や時期
   
4. マカロニスタジオの${menuData.name}の特徴（400-500文字）
   - 当スタジオならではの強み（箇条書き）
   - 他店との違い
   - お客様の声や実績
   
5. よくある質問（Q&A形式）（300-400文字）
   Q. 料金はいくらですか？
   A. [回答]
   
   Q. 何が含まれていますか？
   A. [回答]
   
   Q. 予約方法は？
   A. [回答]
   
6. まとめ・ご予約方法（150-200文字）
   - 記事の要点をまとめ
   - 予約を促すメッセージ
   - 連絡先情報

【出力形式】
Wixにそのままコピペできるプレーンテキスト形式。
見出しは「■」または「【】」で始め、段落は空行で区切る。

■ ${title || `【那覇で人気】${menuData.name}って何？マカロニスタジオ完全ガイド`}

[導入文 - 読者の疑問に共感]

■ ${menuData.name}とは？

[サービスの概要と人気の理由]

■ マカロニスタジオの${menuData.name}、ここがすごい！

・特徴1
・特徴2
・特徴3

[詳細説明]

■ よくある質問

Q. [質問1]
A. [回答1]

Q. [質問2]
A. [回答2]

Q. [質問3]
A. [回答3]

■ まとめ・ご予約方法

[まとめ]

ご予約はホームページのお問い合わせフォーム、DM、または公式LINEから承っております。
【マカロニスタジオ】で検索してください！

【注意事項】
- HTMLタグは使わない
- 読みやすい段落構成
- 箇条書きを効果的に使う
- 具体的な数字や詳細を含める
- SEOキーワードを自然に配置
- 文字数は合計1000-1500文字程度
- 親しみやすく温かい語り口`;
    
  } else if (articleType === 'story') {
    // 撮影レポート
    prompt = `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」のブログライターです。
以下の内容でWix用の撮影レポート記事（プレーンテキスト）を作成してください。

【最重要：以下のタイトルとエピソードを必ず記事の軸にすること。テンプレ的な内容にせず、入力された具体的なエピソードを活かして書くこと】

【記事タイトル（このタイトルそのままで書く）】
${title || `${menuData.name}撮影レポート`}

【撮影の様子・エピソード（この内容を必ず中心に展開すること）】
${mainPoints || '楽しく笑顔いっぱいの撮影でした'}

【撮影メニュー】
${menuData.name}

【トーン】
${tone || 'friendly'}（professional=プロフェッショナル、friendly=親しみやすい、casual=カジュアル）

【記事構成】
1. 導入（80-100文字）
   - 撮影の紹介
   
2. 撮影の様子（300-400文字）
   - お子様の様子
   - 撮影中のエピソード
   - 印象的なシーン
   
3. 撮影のポイント（200-250文字）
   - 今回の撮影で工夫した点
   - おすすめの撮り方
   
4. スタッフより（150-200文字）
   - スタッフからの感想
   - お客様へのメッセージ

【出力形式】
Wixにそのままコピペできるプレーンテキスト形式で出力してください。
見出しは「■」で始め、段落は空行で区切ってください。

■ ${title || `${menuData.name}撮影レポート`}

[導入文]

■ 撮影の様子

[本文]

■ 撮影のポイント

[本文]

■ スタッフより

[本文]

【注意事項】
- HTMLタグは使わない
- 具体的で臨場感のある表現
- 文字数は合計600-900文字程度
- 温かく親しみやすい語り口
- 絵文字は使わない（Wix用）`;
  } else if (articleType === 'free') {
    // 自由記事・お知らせ系
    prompt = `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」のブログライターです。
以下の内容で、Wixにそのままコピペできるブログ記事原稿（プレーンテキスト）を作成してください。

【最重要：以下のタイトルと内容を必ず記事の軸にすること。タイトルに書かれた内容（背景紙・新サービス・イベント等）を中心に展開し、テンプレ的な構成にしないこと】

【記事タイトル（このタイトルそのままで書く）】
${title || '自動生成してください'}

【記事の内容・伝えたいこと（この内容を必ず記事に反映すること）】
${mainPoints}

${studioStrengths}

【トーン】
${tone || 'friendly'}（professional=プロフェッショナル、friendly=親しみやすい、casual=カジュアル）

【記事構成】
1. タイトル（キャッチーで魅力的に）
   - 新情報を強調
   - 読者の興味を引くフレーズ
   
2. 導入（100-150文字）
   - お知らせの概要
   - 何が新しいのか、なぜ嬉しいのか
   
3. 詳細説明（400-600文字）
   - 具体的な内容
   - 写真があれば説明
   - 利用シーンや活用方法
   - お客様へのメリット
   
4. まとめ・ご案内（100-150文字）
   - ご来店の呼びかけ
   - 予約方法やお問い合わせ先

【出力形式】
Wixにそのままコピペできるプレーンテキスト形式。
見出しは「■」または「【】」で始め、段落は空行で区切る。
親しみやすく、明るいトーンで書いてください。

■ ${title || '[自動生成タイトル]'}

[導入文 - お知らせ内容の概要と嬉しさを表現]

■ [メインセクション見出し]

[詳細説明 - 具体的な内容、活用方法、お客様へのメリット]

■ まとめ

[ご来店の呼びかけと連絡先情報]

【注意事項】
- 文字数は合計600-900文字程度
- 温かく親しみやすい語り口
- 新しさや嬉しさを伝える表現
- 絵文字は使わない（Wix用）`;
  }

  // プロンプトが空の場合はエラーを返す
  if (!prompt) {
    console.error('[blog/generate] prompt is empty. articleType:', articleType);
    return c.json({ error: `不明な記事タイプです: ${articleType}` }, 400);
  }
  
  try {
    // OpenAI API呼び出し
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」の専属ブログライターです。
SEOを意識しつつ、読みやすく魅力的な記事を作成します。Wixにそのままコピペできるプレーンテキスト形式で出力してください。

${studioStrengths}

【記事作成ルール】
1. 上記の料金・店舗情報・サービス内容は必ず正確に記載すること
2. 上記に記載のないサービス・料金は存在しないものとして扱い、絶対に記載しない
3. 憶測や推測でスタジオ情報を補完しない
4. 「行っていないこと」に該当する内容（ロケーションフォト・お食い初め等）は記事に含めない
5. 記事の最後には必ず以下の予約方法を記載する：
   「ご予約はInstagram DM・公式LINE・ホームページからお気軽にどうぞ！」`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API error: ${response.statusText} - ${errorData}`);
    }
    
    const data = await response.json();
    const article = data.choices[0].message.content;
    
    return c.json({
      article: article,
      wordCount: article.length
    });
    
  } catch (error: any) {
    console.error('Blog generation error:', error);
    return c.json({ error: error.message || 'Generation failed' }, 500);
  }
});

// =====================================
// スタッフ連絡掲示板 API
// =====================================

// スタッフ連絡一覧取得
app.get('/api/staff-messages', async (c) => {
  try {
    const db = c.env.DB;
    const { status } = c.req.query();
    
    let query = 'SELECT * FROM staff_messages';
    let params: any[] = [];
    
    // ステータスフィルター（未対応/対応済み）
    if (status === 'pending') {
      query += ' WHERE is_completed = 0';
    } else if (status === 'completed') {
      query += ' WHERE is_completed = 1';
    }
    
    query += ' ORDER BY message_date DESC, created_at DESC';
    
    const result = await db.prepare(query).bind(...params).all();
    return c.json({ messages: result.results || [] });
  } catch (error: any) {
    console.error('Failed to fetch staff messages:', error);
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});

// 画像アップロード
app.post('/api/upload-image', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('image') as File;
    
    if (!file) {
      return c.json({ error: '画像ファイルが必要です' }, 400);
    }
    
    // ファイルサイズチェック (10MB制限)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      return c.json({ error: '画像ファイルは10MB以下にしてください' }, 400);
    }
    
    // ファイル名生成（重複を避けるためタイムスタンプ＋ランダム値を使用）
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split('.').pop() || 'jpg';
    const fileName = `staff-${timestamp}-${randomStr}.${extension}`;
    
    // R2バケットに保存
    const arrayBuffer = await file.arrayBuffer();
    await c.env.IMAGES.put(fileName, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });
    
    // 公開URLを返す（本番環境ではR2のカスタムドメインを使用）
    const imageUrl = `/api/images/${fileName}`;
    
    return c.json({ 
      success: true,
      imageUrl: imageUrl,
      message: '画像をアップロードしました'
    });
  } catch (error: any) {
    console.error('Failed to upload image:', error);
    return c.json({ error: '画像のアップロードに失敗しました' }, 500);
  }
});

// 画像取得
app.get('/api/images/:fileName', async (c) => {
  try {
    const fileName = c.req.param('fileName');
    const object = await c.env.IMAGES.get(fileName);
    
    if (!object) {
      return c.json({ error: '画像が見つかりません' }, 404);
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1年間キャッシュ
    
    return new Response(object.body, {
      headers,
    });
  } catch (error: any) {
    console.error('Failed to get image:', error);
    return c.json({ error: '画像の取得に失敗しました' }, 500);
  }
});

// 新規連絡事項を追加
app.post('/api/staff-messages', async (c) => {
  try {
    const db = c.env.DB;
    const { staff_name, message_date, content, image_url, to_staff } = await c.req.json();
    
    // バリデーション
    if (!staff_name || !message_date || !content) {
      return c.json({ error: 'スタッフ名、日付、内容は必須です' }, 400);
    }
    
    const result = await db.prepare(
      `INSERT INTO staff_messages (staff_name, message_date, content, image_url, to_staff, is_completed)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).bind(staff_name, message_date, content, image_url || null, to_staff || null).run();
    
    // LINE通知を送信（TOが指定されている場合）
    if (to_staff && c.env.LINE_NOTIFY_TOKEN) {
      try {
        const toList = to_staff.split(',').join('、');
        const messageText = `【スタッフ連絡板】
📩 TO: ${toList}
👤 差出人: ${staff_name}
📅 日付: ${message_date}
📝 内容:
${content}

🔗 https://56928817.maca-7i4.pages.dev/staff-board`;

        await fetch('https://notify-api.line.me/api/notify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${c.env.LINE_NOTIFY_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `message=${encodeURIComponent(messageText)}`,
        });
      } catch (lineError) {
        console.error('LINE通知の送信に失敗:', lineError);
        // LINE通知失敗はエラーとせず、メッセージ保存は成功とする
      }
    }
    
    return c.json({ 
      success: true, 
      id: result.meta.last_row_id,
      message: '連絡事項を追加しました'
    });
  } catch (error: any) {
    console.error('Failed to add staff message:', error);
    return c.json({ error: 'Failed to add message' }, 500);
  }
});

// 対応済みステータスを更新
app.put('/api/staff-messages/:id', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await c.req.json();
    
    // ステータス更新のみの場合
    if (body.is_completed !== undefined && !body.content && !body.image_url) {
      const completed_at = body.is_completed ? new Date().toISOString() : null;
      
      await db.prepare(
        `UPDATE staff_messages 
         SET is_completed = ?, 
             completed_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(body.is_completed, completed_at, id).run();
      
      return c.json({ 
        success: true,
        message: body.is_completed ? '対応済みにしました' : '未対応に戻しました'
      });
    }
    
    // メモ内容や画像の更新
    const { content, image_url } = body;
    
    if (content !== undefined || image_url !== undefined) {
      let updateQuery = 'UPDATE staff_messages SET updated_at = CURRENT_TIMESTAMP';
      const params: any[] = [];
      
      if (content !== undefined) {
        updateQuery += ', content = ?';
        params.push(content);
      }
      
      if (image_url !== undefined) {
        updateQuery += ', image_url = ?';
        params.push(image_url);
      }
      
      updateQuery += ' WHERE id = ?';
      params.push(id);
      
      await db.prepare(updateQuery).bind(...params).run();
      
      return c.json({ 
        success: true,
        message: 'メモを更新しました'
      });
    }
    
    return c.json({ error: '更新する内容がありません' }, 400);
  } catch (error: any) {
    console.error('Failed to update staff message:', error);
    return c.json({ error: 'Failed to update message' }, 500);
  }
});

// 連絡事項を削除
app.delete('/api/staff-messages/:id', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    
    // 削除前に画像URLを取得
    const message = await db.prepare(
      'SELECT image_url FROM staff_messages WHERE id = ?'
    ).bind(id).first();
    
    // メッセージを削除
    await db.prepare('DELETE FROM staff_messages WHERE id = ?').bind(id).run();
    
    // R2の画像も削除（image_urlが存在し、/api/images/で始まる場合）
    if (message && message.image_url && typeof message.image_url === 'string') {
      const imageUrl = message.image_url as string;
      if (imageUrl.startsWith('/api/images/')) {
        const fileName = imageUrl.replace('/api/images/', '');
        try {
          await c.env.IMAGES.delete(fileName);
          console.log(`Deleted image from R2: ${fileName}`);
        } catch (imageError) {
          console.error('Failed to delete image from R2:', imageError);
          // 画像削除に失敗してもメッセージ削除は成功とする
        }
      }
    }
    
    return c.json({ 
      success: true,
      message: '連絡事項を削除しました'
    });
  } catch (error: any) {
    console.error('Failed to delete staff message:', error);
    return c.json({ error: 'Failed to delete message' }, 500);
  }
});

// LINE Webhook エンドポイント
app.post('/webhook/line', async (c) => {
  try {
    const body = await c.req.json();
    console.log('LINE Webhook received:', JSON.stringify(body, null, 2));
    
    // イベントの処理
    const events = body.events || [];
    
    for (const event of events) {
      // フォローイベント（友だち追加）の場合
      if (event.type === 'follow') {
        const userId = event.source.userId;
        console.log('New friend added:', userId);
        
        // ウェルカムメッセージを送信
        const replyToken = event.replyToken;
        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: replyToken,
            messages: [{
              type: 'text',
              text: 'マカロニスタジオ スタッフ連絡板へようこそ！\n\nあなたのユーザーIDは以下です：\n' + userId + '\n\nこのIDを管理者に伝えてください。'
            }]
          })
        });
      }
      
      // メッセージイベントの場合
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const messageText = event.message.text;
        
        // 「ID」というメッセージが来たらユーザーIDを返信
        if (messageText === 'ID' || messageText === 'id') {
          const replyToken = event.replyToken;
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              replyToken: replyToken,
              messages: [{
                type: 'text',
                text: 'あなたのユーザーIDは以下です：\n' + userId
              }]
            })
          });
        }
      }
    }
    
    return c.json({ success: true });
  } catch (error: any) {
    console.error('LINE Webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

/**
 * 出勤管理ページ
 */
app.get('/attendance', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>出勤管理 | マカロニスタジオ</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .status-present  { background:#dcfce7; color:#166534; }
    .status-absent   { background:#fee2e2; color:#991b1b; }
    .status-late     { background:#fef9c3; color:#854d0e; }
    .status-half_day { background:#dbeafe; color:#1e40af; }
    .status-holiday  { background:#f3f4f6; color:#6b7280; }
    .table-cell { padding:5px 6px; border:1px solid #e5e7eb; text-align:center; font-size:12px; }
    .table-head { background:#fdf2f8; font-weight:600; font-size:11px; }
    .today-col { background:#fff7ed !important; }
    /* モーダル */
    .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px; }
    .modal-box { background:#fff;border-radius:12px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden; }
    .modal-header { background:linear-gradient(135deg,#ec4899,#f97316);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center; }
    .modal-body { padding:18px; }
    .form-label { display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px; }
    .form-input { width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:14px;outline:none;transition:.2s; }
    .form-input:focus { border-color:#ec4899;box-shadow:0 0 0 3px rgba(236,72,153,.12); }
    /* 出勤表セル */
    .att-cell { min-width:72px;padding:4px;border:1px solid #e5e7eb;cursor:pointer;transition:.15s;vertical-align:top; }
    .att-cell:hover { background:#fdf2f8; }
    .att-cell.today { background:#fff7ed; }
    .att-cell.weekend { background:#f9fafb; }
    .att-cell .time-text { font-size:10px;color:#6b7280;line-height:1.3; }
    .att-name-cell { min-width:72px;background:#f9fafb;font-weight:600;font-size:13px;padding:8px 6px;border:1px solid #e5e7eb;white-space:nowrap;position:sticky;left:0;z-index:1; }
    .att-head-cell { background:#fdf2f8;font-size:11px;font-weight:700;padding:6px 4px;border:1px solid #e5e7eb;text-align:center; }
  </style>
</head>
<body class="bg-gray-50">

${buildNav('/attendance')}

<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pt-20">

  <!-- ヘッダー＆タブドロップダウン -->
  <div class="flex items-center justify-between mb-4 gap-3">
    <div>
      <h2 class="text-2xl font-bold text-gray-900"><i class="fas fa-user-clock text-pink-500 mr-2"></i>出勤管理</h2>
      <p class="text-sm text-gray-500 mt-0.5">セルをクリックして直接入力できます</p>
    </div>
    <!-- タブドロップダウン -->
    <div class="relative" id="tab-dropdown-wrap">
      <button id="tab-dropdown-btn" onclick="toggleTabMenu()"
        class="flex items-center gap-2 px-4 py-2.5 bg-pink-500 hover:bg-pink-600 text-white font-semibold text-sm rounded-xl shadow transition select-none">
        <span id="tab-current-icon"><i class="fas fa-table"></i></span>
        <span id="tab-current-label">出勤表</span>
        <i class="fas fa-chevron-down text-xs ml-1 transition-transform duration-200" id="tab-chevron"></i>
      </button>
      <!-- ドロップダウンメニュー -->
      <div id="tab-menu"
        class="hidden absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50"
        style="animation:fadeDown .15s ease">
        <button onclick="showTab('table')" data-tab="table"
          class="tab-menu-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-pink-50 hover:text-pink-600 transition">
          <i class="fas fa-table w-4 text-center"></i>出勤表
        </button>
        <button onclick="showTab('record')" data-tab="record"
          class="tab-menu-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-pink-50 hover:text-pink-600 transition">
          <i class="fas fa-list w-4 text-center"></i>記録一覧
        </button>
        <button onclick="showTab('summary')" data-tab="summary"
          class="tab-menu-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-pink-50 hover:text-pink-600 transition">
          <i class="fas fa-chart-bar w-4 text-center"></i>月次集計
        </button>
        <button onclick="showTab('staff')" data-tab="staff"
          class="tab-menu-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-pink-50 hover:text-pink-600 transition">
          <i class="fas fa-users w-4 text-center"></i>従業員管理
        </button>
        <button onclick="showTab('wishes')" data-tab="wishes"
          class="tab-menu-item w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left hover:bg-pink-50 hover:text-pink-600 transition">
          <i class="fas fa-calendar-heart w-4 text-center"></i>希望メモ
        </button>
      </div>
    </div>
  </div>
  <style>
    @keyframes fadeDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
    .tab-menu-item.active { background:#fdf2f8; color:#ec4899; font-weight:700; }
  </style>

  <!-- 月選択バー -->
  <div class="bg-white rounded-lg shadow p-3 mb-4 flex flex-wrap items-center gap-3">
    <label class="text-sm font-medium text-gray-700">表示月：</label>
    <select id="yearSel" class="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-pink-500 focus:border-pink-500"></select>
    <span class="text-gray-500 text-sm">年</span>
    <select id="monthSel" class="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-pink-500 focus:border-pink-500">
      <option value="01">1月</option><option value="02">2月</option><option value="03">3月</option>
      <option value="04">4月</option><option value="05">5月</option><option value="06">6月</option>
      <option value="07">7月</option><option value="08">8月</option><option value="09">9月</option>
      <option value="10">10月</option><option value="11">11月</option><option value="12">12月</option>
    </select>
    <span class="text-gray-500 text-sm">月</span>
    <button onclick="loadAll()" class="bg-pink-500 text-white px-4 py-1.5 rounded text-sm font-semibold hover:bg-pink-600 transition">
      <i class="fas fa-sync mr-1"></i>更新
    </button>
    <div class="ml-auto flex gap-2 text-xs flex-wrap">
      <span class="px-2 py-1 rounded status-present">出勤</span>
      <span class="px-2 py-1 rounded status-absent">欠勤</span>
      <span class="px-2 py-1 rounded status-late">遅刻</span>
      <span class="px-2 py-1 rounded status-half_day">半休</span>
      <span class="px-2 py-1 rounded status-holiday">休日</span>
    </div>
  </div>

  <!-- ===== 出勤表タブ ===== -->
  <div id="panel-table" class="tab-panel">
    <div class="bg-white rounded-lg shadow">
      <div class="p-4 border-b flex items-center justify-between">
        <h3 class="font-bold text-gray-800"><i class="fas fa-table text-pink-500 mr-2"></i>出勤表 — セルをクリックして入力</h3>
        <span class="text-xs text-gray-400"><i class="fas fa-info-circle mr-1"></i>空白セルをクリックで新規入力、記録済みセルは編集</span>
      </div>
      <div class="overflow-x-auto p-2">
        <table id="attendance-table" class="border-collapse" style="min-width:600px"></table>
      </div>
    </div>
  </div>

  <!-- ===== 記録一覧タブ ===== -->
  <div id="panel-record" class="tab-panel hidden">
    <div class="bg-white rounded-lg shadow p-5">
      <h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-list text-pink-500 mr-2"></i>今月の記録一覧</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-pink-50">
              <th class="table-cell">日付</th>
              <th class="table-cell">スタッフ</th>
              <th class="table-cell">ステータス</th>
              <th class="table-cell">出勤</th>
              <th class="table-cell">退勤</th>
              <th class="table-cell">休憩</th>
              <th class="table-cell">実働</th>
              <th class="table-cell">備考</th>
              <th class="table-cell">操作</th>
            </tr>
          </thead>
          <tbody id="record-list"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ===== 月次集計タブ ===== -->
  <div id="panel-summary" class="tab-panel hidden">
    <div class="bg-white rounded-lg shadow p-5">
      <h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-chart-bar text-pink-500 mr-2"></i>月次集計</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-pink-50">
              <th class="table-cell">スタッフ</th>
              <th class="table-cell">出勤日数</th>
              <th class="table-cell">欠勤日数</th>
              <th class="table-cell">遅刻日数</th>
              <th class="table-cell">半休日数</th>
              <th class="table-cell">総実働時間</th>
            </tr>
          </thead>
          <tbody id="summary-body"></tbody>
        </table>
      </div>
      <div id="summary-empty" class="text-center text-gray-400 py-8 hidden">
        <i class="fas fa-inbox text-4xl mb-2 block"></i>データがありません
      </div>
    </div>
  </div>

  <!-- ===== 従業員管理タブ ===== -->
  <div id="panel-staff" class="tab-panel hidden">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- 従業員追加 -->
      <div class="bg-white rounded-lg shadow p-5">
        <h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-user-plus text-pink-500 mr-2"></i>従業員を追加</h3>
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">名前 <span class="text-red-500">*</span></label>
          <input type="text" id="new-staff-name" placeholder="例：田中" maxlength="20"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">表示順（数字が小さいほど先頭）</label>
          <input type="number" id="new-staff-order" value="10" min="1" max="99"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
        </div>
        <button onclick="addStaff()" class="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-2.5 rounded-lg text-sm transition">
          <i class="fas fa-plus mr-2"></i>追加する
        </button>
        <div id="staff-add-msg" class="mt-3 text-sm hidden"></div>
      </div>

      <!-- 従業員一覧 -->
      <div class="bg-white rounded-lg shadow p-5">
        <h3 class="text-lg font-bold text-gray-800 mb-4"><i class="fas fa-users text-pink-500 mr-2"></i>従業員一覧</h3>
        <div id="staff-list-panel" class="space-y-2"></div>
        <p class="text-xs text-gray-400 mt-3"><i class="fas fa-info-circle mr-1"></i>削除しても過去の記録は保持されます</p>
      </div>
    </div>
  </div>

  <!-- ===== 希望メモ パネル ===== -->
  <div id="panel-wishes" class="tab-panel hidden">

    <!-- 入力フォーム -->
    <div class="bg-white rounded-lg shadow p-5 mb-4">
      <h3 class="text-lg font-bold text-gray-800 mb-4">
        <i class="fas fa-calendar-heart text-pink-500 mr-2"></i>希望メモを追加
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <!-- スタッフ選択 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">スタッフ <span class="text-red-500">*</span></label>
          <select id="wish-staff" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
            <option value="">選択してください</option>
          </select>
        </div>
        <!-- 日付 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">日付 <span class="text-red-500">*</span></label>
          <input type="date" id="wish-date"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
        </div>
        <!-- 種別 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">種別</label>
          <select id="wish-type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
            <option value="work">🟢 出勤希望</option>
            <option value="off">🔴 休み希望</option>
            <option value="note">📝 メモ</option>
          </select>
        </div>
        <!-- メモ -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">メモ（任意）</label>
          <input type="text" id="wish-note" placeholder="例：午後から可" maxlength="100"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-pink-500 focus:border-pink-500">
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="saveWish()"
          class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-6 rounded-lg text-sm transition">
          <i class="fas fa-plus mr-1"></i>追加・更新
        </button>
        <div id="wish-msg" class="text-sm hidden"></div>
      </div>
    </div>

    <!-- 希望一覧 -->
    <div class="bg-white rounded-lg shadow p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-gray-800">
          <i class="fas fa-list text-pink-500 mr-2"></i>希望一覧
          <span id="wishes-month-label" class="text-sm font-normal text-gray-500 ml-2"></span>
        </h3>
        <div class="flex gap-3 text-xs">
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold">🟢 出勤希望</span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 font-semibold">🔴 休み希望</span>
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-semibold">📝 メモ</span>
        </div>
      </div>
      <div id="wishes-list" class="space-y-2">
        <p class="text-sm text-gray-400 text-center py-6"><i class="fas fa-inbox mr-2"></i>希望メモがありません</p>
      </div>
    </div>

  </div>

</main>

<!-- ===== 出退勤入力モーダル ===== -->
<div id="modal-overlay" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-header">
      <div>
        <div class="text-xs opacity-80 mb-0.5" id="modal-subtitle"></div>
        <div class="font-bold text-lg" id="modal-title"></div>
      </div>
      <button onclick="closeModal()" class="text-white opacity-80 hover:opacity-100 text-xl leading-none">&times;</button>
    </div>
    <div class="modal-body">
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="form-label">ステータス</label>
          <select id="m-status" class="form-input">
            <option value="present">✅ 出勤</option>
            <option value="absent">❌ 欠勤</option>
            <option value="late">⚠️ 遅刻</option>
            <option value="half_day">🔵 半休</option>
            <option value="holiday">🔘 休日</option>
          </select>
        </div>
        <div>
          <label class="form-label">休憩時間（分）</label>
          <input type="number" id="m-break" min="0" max="480" step="15" value="60" class="form-input">
        </div>
        <div>
          <label class="form-label">出勤時刻</label>
          <input type="time" id="m-clock-in" class="form-input">
        </div>
        <div>
          <label class="form-label">退勤時刻</label>
          <input type="time" id="m-clock-out" class="form-input">
        </div>
      </div>
      <!-- 実働時間プレビュー -->
      <div id="work-preview" class="bg-pink-50 rounded-lg px-3 py-2 text-sm text-pink-700 font-semibold mb-3 hidden">
        <i class="fas fa-clock mr-1"></i>実働時間：<span id="work-preview-text"></span>
      </div>
      <div class="mb-4">
        <label class="form-label">備考</label>
        <input type="text" id="m-notes" placeholder="メモ（任意）" maxlength="100" class="form-input">
      </div>
      <div class="flex gap-2">
        <button onclick="saveModal()" class="flex-1 bg-pink-500 hover:bg-pink-600 text-white font-bold py-2.5 rounded-lg text-sm transition">
          <i class="fas fa-save mr-1"></i>保存
        </button>
        <button onclick="deleteModal()" id="modal-delete-btn" class="bg-red-100 hover:bg-red-200 text-red-600 font-bold py-2.5 px-4 rounded-lg text-sm transition hidden">
          <i class="fas fa-trash mr-1"></i>削除
        </button>
        <button onclick="closeModal()" class="bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold py-2.5 px-4 rounded-lg text-sm transition">
          キャンセル
        </button>
      </div>
      <div id="modal-msg" class="mt-2 text-sm hidden"></div>
    </div>
  </div>
</div>

<script>
// ===== 状態管理 =====
let staffList = [];
let attendanceData = [];
let currentYear, currentMonth;
let modalContext = { staffName: '', date: '', recordId: null };

// ===== 初期化 =====
(function init() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = String(now.getMonth() + 1).padStart(2, '0');

  const ySel = document.getElementById('yearSel');
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    ySel.appendChild(opt);
  }
  document.getElementById('monthSel').value = currentMonth;

  // 出勤時刻が変わったらリアルタイム計算
  ['m-clock-in','m-clock-out','m-break'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateWorkPreview);
  });

  loadStaff().then(() => loadAll());
})();

// ===== タブ定義 =====
const TAB_META = {
  table:   { icon: 'fas fa-table',          label: '出勤表' },
  record:  { icon: 'fas fa-list',           label: '記録一覧' },
  summary: { icon: 'fas fa-chart-bar',      label: '月次集計' },
  staff:   { icon: 'fas fa-users',          label: '従業員管理' },
  wishes:  { icon: 'fas fa-calendar-heart', label: '希望メモ' },
};

// ===== タブドロップダウン開閉 =====
function toggleTabMenu() {
  const menu = document.getElementById('tab-menu');
  const chevron = document.getElementById('tab-chevron');
  const isHidden = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !isHidden);
  chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
}
// 外クリックで閉じる
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('tab-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('tab-menu').classList.add('hidden');
    document.getElementById('tab-chevron').style.transform = '';
  }
});

// ===== タブ切替 =====
function showTab(tab) {
  ['table','record','summary','staff','wishes'].forEach(t => {
    document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
    // メニューアイテムのアクティブ表示
    const item = document.querySelector(\`.tab-menu-item[data-tab="\${t}"]\`);
    if (item) item.classList.toggle('active', t === tab);
  });
  // 希望メモタブに切り替えたとき一覧を更新
  if (tab === 'wishes') loadWishes();

  // ボタンラベル更新
  const meta = TAB_META[tab];
  document.getElementById('tab-current-icon').innerHTML = \`<i class="\${meta.icon}"></i>\`;
  document.getElementById('tab-current-label').textContent = meta.label;

  // メニューを閉じる
  document.getElementById('tab-menu').classList.add('hidden');
  document.getElementById('tab-chevron').style.transform = '';
}

// ===== スタッフ読み込み =====
async function loadStaff() {
  const res = await fetch('/api/attendance/staff');
  staffList = (await res.json()).filter(s => s.name !== '全員');
  renderStaffList();
  populateWishStaff();
}

// ===== データ全読み込み =====
async function loadAll() {
  const year = document.getElementById('yearSel').value;
  const month = document.getElementById('monthSel').value;
  currentYear = year; currentMonth = month;
  const res = await fetch(\`/api/attendance?year=\${year}&month=\${month}\`);
  attendanceData = await res.json();
  renderAttendanceTable();
  renderRecordList();
  renderSummary();
}

// ===== ステータス表示 =====
const STATUS_LABEL = { present:'出勤', absent:'欠勤', late:'遅刻', half_day:'半休', holiday:'休日' };
const STATUS_ICON  = { present:'✅', absent:'❌', late:'⚠️', half_day:'🔵', holiday:'🔘' };
function statusLabel(s){ return STATUS_LABEL[s] || s; }
function statusClass(s){ return 'status-' + (s || 'present'); }

// ===== 実働時間フォーマット =====
function fmtMinutes(m) {
  if (!m && m !== 0) return '-';
  const h = Math.floor(m / 60), min = m % 60;
  return h + 'h' + (min > 0 ? min + 'm' : '');
}
function calcWorkMinutes(inVal, outVal, breakMin) {
  if (!inVal || !outVal) return null;
  const [ih, im] = inVal.split(':').map(Number);
  const [oh, om] = outVal.split(':').map(Number);
  const w = (oh * 60 + om) - (ih * 60 + im) - (breakMin || 0);
  return w > 0 ? w : 0;
}

// ===== リアルタイム実働プレビュー =====
function updateWorkPreview() {
  const ci = document.getElementById('m-clock-in').value;
  const co = document.getElementById('m-clock-out').value;
  const br = parseInt(document.getElementById('m-break').value) || 0;
  const w = calcWorkMinutes(ci, co, br);
  const el = document.getElementById('work-preview');
  if (w !== null) {
    document.getElementById('work-preview-text').textContent = fmtMinutes(w);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ===== 出勤表レンダリング =====
function renderAttendanceTable() {
  const table = document.getElementById('attendance-table');
  const year = parseInt(currentYear), month = parseInt(currentMonth);
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().split('T')[0];
  const dayNames = ['日','月','火','水','木','金','土'];

  const allStaff = staffList.map(s => s.name);
  const staffInData = [...new Set(attendanceData.map(r => r.staff_name))];
  const merged = [...new Set([...allStaff, ...staffInData])];

  if (!merged.length) {
    table.innerHTML = '<tr><td class="att-head-cell text-gray-400 py-8" colspan="33">従業員管理タブからスタッフを追加してください</td></tr>';
    return;
  }

  const recordMap = {};
  attendanceData.forEach(r => {
    if (!recordMap[r.work_date]) recordMap[r.work_date] = {};
    recordMap[r.work_date][r.staff_name] = r;
  });

  // ヘッダー（日付・曜日）
  let html = '<thead><tr>';
  html += '<th class="att-name-cell att-head-cell" style="min-width:80px;position:sticky;left:0;z-index:2;background:#fdf2f8">スタッフ</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const dow = new Date(ds).getDay();
    const isToday = ds === today;
    const col = dow === 0 ? '#fef2f2' : dow === 6 ? '#eff6ff' : isToday ? '#fff7ed' : '#fdf2f8';
    const tc  = dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#374151';
    html += \`<th class="att-head-cell" style="min-width:72px;background:\${col};color:\${tc}">
      <div style="font-size:13px;font-weight:700">\${d}</div>
      <div style="font-size:10px">\${dayNames[dow]}</div>
    </th>\`;
  }
  html += '</tr></thead><tbody>';

  // スタッフ行
  merged.forEach(name => {
    html += \`<tr><td class="att-name-cell">\${name}</td>\`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      const rec = recordMap[ds]?.[name];
      const dow = new Date(ds).getDay();
      const isToday = ds === today;
      let bg = isToday ? '#fff7ed' : (dow === 0 || dow === 6 ? '#f9fafb' : '#ffffff');

      if (rec && rec.status) {
        const inT  = rec.clock_in  ? rec.clock_in.substring(0,5)  : '';
        const outT = rec.clock_out ? rec.clock_out.substring(0,5) : '';
        const wm   = rec.work_minutes ? fmtMinutes(rec.work_minutes) : '';
        let statusBg = '';
        if (rec.status === 'present' || rec.status === 'late') statusBg = '#f0fdf4';
        if (rec.status === 'absent')   statusBg = '#fef2f2';
        if (rec.status === 'half_day') statusBg = '#eff6ff';
        if (rec.status === 'holiday')  statusBg = '#f3f4f6';
        html += \`<td class="att-cell" style="background:\${isToday?'#fff7ed':statusBg}" 
          onclick="openModal('\${name}','\${ds}')" title="クリックして編集">
          <div style="text-align:center">
            <span style="font-size:11px;font-weight:700;padding:1px 5px;border-radius:4px" class="\${statusClass(rec.status)}">\${statusLabel(rec.status)}</span>
          </div>
          \${inT  ? '<div class="time-text" style="margin-top:2px">🕐 ' + inT  + '</div>' : ''}
          \${outT ? '<div class="time-text">🕕 ' + outT + '</div>' : ''}
          \${wm   ? '<div class="time-text" style="color:#ec4899;font-weight:600">⏱ ' + wm + '</div>' : ''}
        </td>\`;
      } else {
        html += \`<td class="att-cell" style="background:\${bg};color:#d1d5db;font-size:18px;text-align:center;vertical-align:middle"
          onclick="openModal('\${name}','\${ds}')" title="クリックして入力">+</td>\`;
      }
    }
    html += '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;
}

// ===== 記録一覧レンダリング =====
function renderRecordList() {
  const tbody = document.getElementById('record-list');
  if (!attendanceData.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-cell text-center text-gray-400 py-6">記録がありません</td></tr>';
    return;
  }
  tbody.innerHTML = [...attendanceData].reverse().map(r => \`
    <tr class="hover:bg-gray-50">
      <td class="table-cell">\${r.work_date}</td>
      <td class="table-cell font-medium">\${r.staff_name}</td>
      <td class="table-cell"><span class="px-2 py-0.5 rounded text-xs \${statusClass(r.status)}">\${statusLabel(r.status)}</span></td>
      <td class="table-cell">\${r.clock_in ? r.clock_in.substring(0,5) : '-'}</td>
      <td class="table-cell">\${r.clock_out ? r.clock_out.substring(0,5) : '-'}</td>
      <td class="table-cell">\${r.break_minutes || 0}分</td>
      <td class="table-cell font-semibold text-pink-600">\${fmtMinutes(r.work_minutes)}</td>
      <td class="table-cell text-left max-w-xs truncate">\${r.notes || ''}</td>
      <td class="table-cell">
        <button onclick="openModal('\${r.staff_name}','\${r.work_date}')"
          class="text-blue-500 hover:text-blue-700 mr-2 text-xs"><i class="fas fa-edit"></i></button>
        <button onclick="deleteRecord(\${r.id})"
          class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  \`).join('');
}

// ===== 月次集計レンダリング =====
async function renderSummary() {
  const year = document.getElementById('yearSel').value;
  const month = document.getElementById('monthSel').value;
  const res = await fetch(\`/api/attendance/summary?year=\${year}&month=\${month}\`);
  const data = await res.json();
  const tbody = document.getElementById('summary-body');
  const empty = document.getElementById('summary-empty');
  if (!data.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = data.map(r => \`
    <tr class="hover:bg-gray-50">
      <td class="table-cell font-bold">\${r.staff_name}</td>
      <td class="table-cell text-green-700 font-semibold">\${r.present_days || 0} 日</td>
      <td class="table-cell text-red-600">\${r.absent_days || 0} 日</td>
      <td class="table-cell text-yellow-700">\${r.late_days || 0} 日</td>
      <td class="table-cell text-blue-700">\${r.half_days || 0} 日</td>
      <td class="table-cell font-bold text-pink-600">\${fmtMinutes(r.total_work_minutes)}</td>
    </tr>
  \`).join('');
}

// ===== 従業員リストレンダリング =====
function renderStaffList() {
  const el = document.getElementById('staff-list-panel');
  if (!staffList.length) {
    el.innerHTML = '<p class="text-gray-400 text-sm text-center py-4">従業員が登録されていません</p>';
    return;
  }
  el.innerHTML = staffList.map(s => \`
    <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200">
      <div class="flex items-center gap-3">
        <span class="text-xl">👤</span>
        <div>
          <div class="font-semibold text-gray-800">\${s.name}</div>
          <div class="text-xs text-gray-400">表示順: \${s.display_order}</div>
        </div>
      </div>
      <button onclick="deleteStaff(\${s.id}, '\${s.name}')"
        class="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5 text-sm transition">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  \`).join('');
}

// ===== モーダルを開く =====
function openModal(staffName, date) {
  const rec = attendanceData.find(r => r.staff_name === staffName && r.work_date === date);
  modalContext = { staffName, date, recordId: rec?.id || null };

  // ヘッダー設定
  document.getElementById('modal-subtitle').textContent = staffName;
  const d = new Date(date + 'T00:00:00');
  const dayNames = ['日','月','火','水','木','金','土'];
  document.getElementById('modal-title').textContent =
    \`\${date} (\${dayNames[d.getDay()]})\`;

  // 値セット
  document.getElementById('m-status').value    = rec?.status      || 'present';
  document.getElementById('m-clock-in').value  = rec?.clock_in    ? rec.clock_in.substring(0,5)  : '';
  document.getElementById('m-clock-out').value = rec?.clock_out   ? rec.clock_out.substring(0,5) : '';
  document.getElementById('m-break').value     = rec?.break_minutes ?? 60;
  document.getElementById('m-notes').value     = rec?.notes       || '';

  // 削除ボタン表示制御
  document.getElementById('modal-delete-btn').classList.toggle('hidden', !rec?.id);
  document.getElementById('modal-msg').classList.add('hidden');

  updateWorkPreview();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('m-clock-in').focus();
}

// ===== モーダルを閉じる =====
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
// オーバーレイクリックで閉じる
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ===== モーダルから保存 =====
async function saveModal() {
  const { staffName, date } = modalContext;
  const status   = document.getElementById('m-status').value;
  const clockIn  = document.getElementById('m-clock-in').value  || null;
  const clockOut = document.getElementById('m-clock-out').value || null;
  const breakMin = parseInt(document.getElementById('m-break').value) || 0;
  const notes    = document.getElementById('m-notes').value;

  const body = { staff_name: staffName, work_date: date, status, clock_in: clockIn, clock_out: clockOut, break_minutes: breakMin, notes };
  const res = await fetch('/api/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    closeModal();
    await loadAll();
  } else {
    showModalMsg('保存に失敗しました', 'error');
  }
}

// ===== モーダルから削除 =====
async function deleteModal() {
  if (!modalContext.recordId) return;
  if (!confirm('この記録を削除しますか？')) return;
  await fetch(\`/api/attendance/\${modalContext.recordId}\`, { method: 'DELETE' });
  closeModal();
  await loadAll();
}

// ===== 記録削除（一覧から） =====
async function deleteRecord(id) {
  if (!confirm('この記録を削除しますか？')) return;
  await fetch(\`/api/attendance/\${id}\`, { method: 'DELETE' });
  await loadAll();
}

// ===== 従業員追加 =====
async function addStaff() {
  const name = document.getElementById('new-staff-name').value.trim();
  const order = parseInt(document.getElementById('new-staff-order').value) || 10;
  if (!name) {
    showStaffMsg('名前を入力してください', 'error');
    return;
  }
  if (staffList.some(s => s.name === name)) {
    showStaffMsg('同じ名前の従業員が既に存在します', 'error');
    return;
  }
  const res = await fetch('/api/attendance/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, display_order: order })
  });
  if (res.ok) {
    document.getElementById('new-staff-name').value = '';
    document.getElementById('new-staff-order').value = '10';
    showStaffMsg(\`「\${name}」を追加しました\`, 'success');
    await loadStaff();
    renderAttendanceTable();
  } else {
    const errData = await res.json().catch(() => ({}));
    showStaffMsg(errData.error || '追加に失敗しました', 'error');
  }
}

// ===== 従業員削除 =====
async function deleteStaff(id, name) {
  if (!confirm(\`「\${name}」を削除しますか？\\n過去の出勤記録は保持されます。\`)) return;
  const res = await fetch(\`/api/attendance/staff/\${id}\`, { method: 'DELETE' });
  if (res.ok) {
    showStaffMsg(\`「\${name}」を削除しました\`, 'success');
    await loadStaff();
    renderAttendanceTable();
  }
}

// ===== メッセージ表示 =====
function showModalMsg(text, type) {
  const el = document.getElementById('modal-msg');
  el.textContent = text;
  el.className = 'mt-2 text-sm px-3 py-1.5 rounded ' + (type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700');
  el.classList.remove('hidden');
}
function showStaffMsg(text, type) {
  const el = document.getElementById('staff-add-msg');
  el.textContent = text;
  el.className = 'mt-3 text-sm px-3 py-1.5 rounded ' + (type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// Escキーでモーダルを閉じる
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ===== 希望メモ =====
let wishesData = [];

/** スタッフセレクタを希望メモフォームに反映 */
function populateWishStaff() {
  const sel = document.getElementById('wish-staff');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">選択してください</option>';
  staffList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = s.name;
    if (s.name === prev) opt.selected = true;
    sel.appendChild(opt);
  });
}

/** 希望メモ一覧を読み込む */
async function loadWishes() {
  const year  = document.getElementById('yearSel').value;
  const month = document.getElementById('monthSel').value;
  const ym    = year + '-' + month;
  document.getElementById('wishes-month-label').textContent = year + '年' + parseInt(month) + '月';
  populateWishStaff();
  // 日付デフォルト：現在月の1日
  const dateSel = document.getElementById('wish-date');
  if (dateSel && !dateSel.value) dateSel.value = ym + '-01';
  try {
    const res = await fetch('/api/attendance/wishes?year_month=' + ym);
    wishesData = await res.json();
  } catch { wishesData = []; }
  renderWishes();
}

/** WISH_TYPE の表示設定 */
const WISH_BADGE = {
  work: { emoji:'🟢', label:'出勤希望', cls:'bg-green-100 text-green-700' },
  off:  { emoji:'🔴', label:'休み希望', cls:'bg-red-100  text-red-700'   },
  note: { emoji:'📝', label:'メモ',     cls:'bg-gray-100 text-gray-600'  },
};

/** 希望メモ一覧を描画（日付グループ） */
function renderWishes() {
  const container = document.getElementById('wishes-list');
  if (!wishesData.length) {
    container.innerHTML = '<p class="text-sm text-gray-400 text-center py-6"><i class="fas fa-inbox mr-2"></i>希望メモがありません</p>';
    return;
  }

  // 日付でグループ化
  const byDate = {};
  wishesData.forEach(w => {
    if (!byDate[w.wish_date]) byDate[w.wish_date] = [];
    byDate[w.wish_date].push(w);
  });

  const html = Object.keys(byDate).sort().map(date => {
    const dateObj = new Date(date + 'T00:00:00');
    const dow = ['日','月','火','水','木','金','土'][dateObj.getDay()];
    const dowColor = dateObj.getDay() === 0 ? 'text-red-500' : dateObj.getDay() === 6 ? 'text-blue-500' : 'text-gray-500';
    const rows = byDate[date].map(w => {
      const b = WISH_BADGE[w.wish_type] || WISH_BADGE.note;
      const noteText = w.note ? \`<span class="text-xs text-gray-500 ml-2">– \${escHtml(w.note)}</span>\` : '';
      return \`
        <div class="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-semibold text-gray-700 min-w-[4em]">\${escHtml(w.staff_name)}</span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full \${b.cls}">\${b.emoji} \${b.label}</span>
            \${noteText}
          </div>
          <button onclick="deleteWish(\${w.id})"
            class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs px-2 py-0.5 rounded transition">
            <i class="fas fa-trash"></i>
          </button>
        </div>\`;
    }).join('');

    return \`
      <div class="border border-gray-100 rounded-xl overflow-hidden mb-2">
        <div class="bg-gray-50 px-4 py-2 flex items-center gap-2">
          <span class="font-bold text-gray-700 text-sm">\${date.slice(5)} <span class="\${dowColor} font-semibold">(\${dow})</span></span>
          <span class="text-xs text-gray-400">\${byDate[date].length}件</span>
        </div>
        <div class="px-3 py-1 divide-y divide-gray-50">\${rows}</div>
      </div>\`;
  }).join('');

  container.innerHTML = html;
}

/** 希望メモ保存（追加 or 更新） */
async function saveWish() {
  const staff_name = document.getElementById('wish-staff').value;
  const wish_date  = document.getElementById('wish-date').value;
  const wish_type  = document.getElementById('wish-type').value;
  const note       = document.getElementById('wish-note').value.trim();

  if (!staff_name || !wish_date) {
    showWishMsg('スタッフと日付を選択してください', 'error');
    return;
  }

  const year  = document.getElementById('yearSel').value;
  const month = document.getElementById('monthSel').value;
  const year_month = year + '-' + month;

  const res = await fetch('/api/attendance/wishes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staff_name, year_month, wish_date, wish_type, note })
  });

  if (res.ok) {
    showWishMsg('保存しました ✓', 'success');
    document.getElementById('wish-note').value = '';
    await loadWishes();
  } else {
    const err = await res.json().catch(() => ({}));
    showWishMsg(err.error || '保存に失敗しました', 'error');
  }
}

/** 希望メモ削除 */
async function deleteWish(id) {
  if (!confirm('この希望メモを削除しますか？')) return;
  const res = await fetch('/api/attendance/wishes/' + id, { method: 'DELETE' });
  if (res.ok) await loadWishes();
}

/** 希望メモ用メッセージ表示 */
function showWishMsg(text, type) {
  const el = document.getElementById('wish-msg');
  el.textContent = text;
  el.className = 'text-sm px-3 py-1.5 rounded ' + (type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

/** XSS対策エスケープ */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>

</body>
</html>`);
});

export default app;
