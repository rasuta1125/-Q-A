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

// ===== API Routes =====

/**
 * Q&A一覧取得
 */
app.get('/api/qa', async (c) => {
  const { DB } = c.env;
  const { results } = await DB.prepare(
    'SELECT * FROM qa_items WHERE is_active = 1 ORDER BY priority ASC, id DESC'
  ).all();
  return c.json(results);
});

/**
 * Q&A新規登録
 */
app.post('/api/qa', async (c) => {
  const { DB, VECTORIZE, OPENAI_API_KEY } = c.env;
  const data: QAItem = await c.req.json();

  // D1にQ&Aを保存
  const result = await DB.prepare(
    `INSERT INTO qa_items (category, question, answer, keywords, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    data.category,
    data.question,
    data.answer,
    data.keywords || '',
    data.priority || 1,
    data.is_active !== undefined ? data.is_active : 1
  ).run();

  const qaId = result.meta.last_row_id as number;

  // 埋め込みベクトルを生成してVectorizeに保存
  try {
    const embeddingText = `${data.category} ${data.question} ${data.answer} ${data.keywords || ''}`;
    const embedding = await generateEmbedding(embeddingText, OPENAI_API_KEY);

    await VECTORIZE.upsert([
      {
        id: `qa_${qaId}`,
        values: embedding,
        metadata: {
          type: 'qa',
          qa_id: qaId,
          category: data.category,
        },
      },
    ]);
  } catch (error) {
    console.error('Vectorize upsert error:', error);
    // Vectorizeのエラーはログのみで処理続行
  }

  return c.json({ id: qaId, ...data });
});

/**
 * Q&A更新
 */
app.put('/api/qa/:id', async (c) => {
  const { DB, VECTORIZE, OPENAI_API_KEY } = c.env;
  const id = parseInt(c.req.param('id'));
  const data: QAItem = await c.req.json();

  // D1を更新
  await DB.prepare(
    `UPDATE qa_items 
     SET category = ?, question = ?, answer = ?, keywords = ?, 
         priority = ?, is_active = ?, last_updated = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    data.category,
    data.question,
    data.answer,
    data.keywords || '',
    data.priority || 1,
    data.is_active !== undefined ? data.is_active : 1,
    id
  ).run();

  // Vectorizeを更新
  try {
    const embeddingText = `${data.category} ${data.question} ${data.answer} ${data.keywords || ''}`;
    const embedding = await generateEmbedding(embeddingText, OPENAI_API_KEY);

    await VECTORIZE.upsert([
      {
        id: `qa_${id}`,
        values: embedding,
        metadata: {
          type: 'qa',
          qa_id: id,
          category: data.category,
        },
      },
    ]);
  } catch (error) {
    console.error('Vectorize upsert error:', error);
  }

  return c.json({ id, ...data });
});

/**
 * Q&A削除
 */
app.delete('/api/qa/:id', async (c) => {
  const { DB, VECTORIZE } = c.env;
  const id = parseInt(c.req.param('id'));

  // 論理削除
  await DB.prepare('UPDATE qa_items SET is_active = 0 WHERE id = ?').bind(id).run();

  // Vectorizeからも削除
  try {
    await VECTORIZE.deleteByIds([`qa_${id}`]);
  } catch (error) {
    console.error('Vectorize delete error:', error);
  }

  return c.json({ success: true });
});

// ===== Web Source API Routes =====

/**
 * Webソース一覧取得
 */
app.get('/api/web', async (c) => {
  const { DB } = c.env;
  const { results } = await DB.prepare(
    'SELECT * FROM web_sources ORDER BY last_crawled DESC'
  ).all();
  return c.json(results);
});

/**
 * Webソース新規登録（クロール実行）
 */
app.post('/api/web', async (c) => {
  const { DB, VECTORIZE, OPENAI_API_KEY } = c.env;
  const { url } = await c.req.json();

  if (!url || !url.startsWith('http')) {
    return c.json({ error: '有効なURLを入力してください' }, 400);
  }

  try {
    // Webページをクロール
    const { title, content } = await scrapeWebPage(url);

    // D1にWebソースを保存
    const result = await DB.prepare(
      `INSERT INTO web_sources (url, title, content, last_crawled)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(url) DO UPDATE SET 
         title = excluded.title,
         content = excluded.content,
         last_crawled = CURRENT_TIMESTAMP`
    ).bind(url, title, content).run();

    const webId = result.meta.last_row_id as number || 
      (await DB.prepare('SELECT id FROM web_sources WHERE url = ?').bind(url).first<any>())?.id;

    // 埋め込みベクトルを生成してVectorizeに保存
    try {
      const embeddingText = `${title} ${content}`;
      const embedding = await generateEmbedding(embeddingText, OPENAI_API_KEY);

      await VECTORIZE.upsert([
        {
          id: `web_${webId}`,
          values: embedding,
          metadata: {
            type: 'web',
            web_id: webId,
            url: url,
          },
        },
      ]);
    } catch (error) {
      console.error('Vectorize upsert error:', error);
    }

    return c.json({ id: webId, url, title, content: content.substring(0, 200) + '...' });
  } catch (error: any) {
    console.error('Web scraping error:', error);
    return c.json({ error: `Webページの取得に失敗しました: ${error.message}` }, 500);
  }
});

/**
 * Webソース削除
 */
app.delete('/api/web/:id', async (c) => {
  const { DB, VECTORIZE } = c.env;
  const id = parseInt(c.req.param('id'));

  await DB.prepare('DELETE FROM web_sources WHERE id = ?').bind(id).run();

  // Vectorizeからも削除
  try {
    await VECTORIZE.deleteByIds([`web_${id}`]);
  } catch (error) {
    console.error('Vectorize delete error:', error);
  }

  return c.json({ success: true });
});

// ===== Template API Routes =====

/**
 * テンプレート一覧取得
 */
app.get('/api/templates', async (c) => {
  const { DB } = c.env;
  const { results } = await DB.prepare(
    'SELECT * FROM templates WHERE is_active = 1 ORDER BY usage_count DESC, id DESC'
  ).all();
  return c.json(results);
});

/**
 * テンプレート新規登録
 */
app.post('/api/templates', async (c) => {
  const { DB } = c.env;
  const { title, content, category } = await c.req.json();

  const result = await DB.prepare(
    `INSERT INTO templates (title, content, category)
     VALUES (?, ?, ?)`
  ).bind(title, content, category || null).run();

  return c.json({ id: result.meta.last_row_id, title, content, category });
});

/**
 * テンプレート更新
 */
app.put('/api/templates/:id', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));
  const { title, content, category } = await c.req.json();

  await DB.prepare(
    `UPDATE templates 
     SET title = ?, content = ?, category = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(title, content, category || null, id).run();

  return c.json({ id, title, content, category });
});

/**
 * テンプレート削除
 */
app.delete('/api/templates/:id', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));

  await DB.prepare('UPDATE templates SET is_active = 0 WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

/**
 * テンプレート使用（使用回数カウント）
 */
app.post('/api/templates/:id/use', async (c) => {
  const { DB } = c.env;
  const id = parseInt(c.req.param('id'));

  await DB.prepare(
    `UPDATE templates 
     SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(id).run();

  return c.json({ success: true });
});

/**
 * 回答生成（RAG）
 */
app.post('/api/generate', async (c) => {
  const { DB, VECTORIZE, OPENAI_API_KEY } = c.env;
  const { query, tone = 'polite' } = await c.req.json();

  if (!query || query.trim() === '') {
    return c.json({ error: '問い合わせ内容を入力してください' }, 400);
  }

  try {
    // 1. クエリの埋め込みベクトルを生成
    const queryEmbedding = await generateEmbedding(query, OPENAI_API_KEY);

    // 2. まずQ&Aから検索（優先）
    let qaResults: SearchResult[] = [];
    let webResults: SearchResult[] = [];
    // 3. Q&Aデータから検索（Vectorize or フォールバック）
    try {
      const vectorResults = await VECTORIZE.query(queryEmbedding, {
        topK: 10,
        returnMetadata: true,
      });

      // Q&AとWebを分離
      const qaMatches = vectorResults.matches.filter(m => m.metadata?.type === 'qa');
      const webMatches = vectorResults.matches.filter(m => m.metadata?.type === 'web');

      // Q&Aアイテムの詳細を取得
      const qaIds = qaMatches
        .filter((match) => match.score > 0.5)
        .map((match) => match.metadata?.qa_id as number);

      if (qaIds.length > 0) {
        const placeholders = qaIds.map(() => '?').join(',');
        const { results } = await DB.prepare(
          `SELECT * FROM qa_items WHERE id IN (${placeholders}) AND is_active = 1`
        ).bind(...qaIds).all();

        qaResults = results.map((qa: any) => {
          const match = qaMatches.find((m) => m.metadata?.qa_id === qa.id);
          return {
            qa_item: qa as QAItem,
            score: match?.score || 0,
            source_type: 'qa' as const,
          };
        }).sort((a, b) => b.score - a.score);
      }

      // Webソースの詳細を取得
      const webIds = webMatches
        .filter((match) => match.score > 0.5)
        .map((match) => match.metadata?.web_id as number);

      if (webIds.length > 0) {
        const placeholders = webIds.map(() => '?').join(',');
        const { results } = await DB.prepare(
          `SELECT * FROM web_sources WHERE id IN (${placeholders})`
        ).bind(...webIds).all();

        webResults = results.map((web: any) => {
          const match = webMatches.find((m) => m.metadata?.web_id === web.id);
          return {
            web_item: web,
            score: match?.score || 0,
            source_type: 'web' as const,
          };
        }).sort((a, b) => b.score - a.score);
      }
    } catch (error) {
      console.error('Vectorize search error:', error);
      // Vectorizeエラー時はフォールバック: Q&Aから全件取得して簡易スコアリング
      const { results: qaData } = await DB.prepare(
        `SELECT * FROM qa_items 
         WHERE is_active = 1 
         ORDER BY priority ASC, id ASC`
      ).all();

      // 簡易スコアリング: より単純で確実なキーワードマッチング
      const queryLower = query.toLowerCase();
      
      qaResults = qaData
        .map((qa: any) => {
          const questionLower = qa.question.toLowerCase();
          const answerLower = qa.answer.toLowerCase();
          const keywordsLower = (qa.keywords || '').toLowerCase();
          
          let score = 0;
          
          // キーワードリストでマッチング
          const keywords = keywordsLower.split(',').map(k => k.trim());
          for (const keyword of keywords) {
            if (keyword.length > 0 && queryLower.includes(keyword)) {
              score = Math.max(score, 0.9);
              break;
            }
          }
          
          // 質問文に部分一致
          if (questionLower.includes(queryLower)) {
            score = Math.max(score, 0.95);
          } else {
            // クエリの主要単語でマッチング（2文字以上）
            const queryChars = Array.from(queryLower).filter(c => c.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\w]/));
            let matchedChars = 0;
            for (let i = 0; i < queryChars.length - 1; i++) {
              const bigram = queryChars[i] + queryChars[i + 1];
              if (questionLower.includes(bigram)) {
                matchedChars += 2;
              }
            }
            if (matchedChars > 2) {
              score = Math.max(score, 0.7 + (matchedChars / queryChars.length) * 0.2);
            }
          }
          
          // 回答文に部分一致
          if (score < 0.7 && answerLower.includes(queryLower)) {
            score = Math.max(score, 0.75);
          }
          
          // 最低スコア
          if (score === 0) {
            score = 0.3;
          }
          
          return {
            qa_item: qa as QAItem,
            score: Math.min(0.95, score),
            source_type: 'qa' as const,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Webソースもフォールバック検索
      const { results: webData } = await DB.prepare(
        `SELECT * FROM web_sources ORDER BY last_crawled DESC`
      ).all();

      webResults = webData
        .map((web: any) => {
          const titleLower = (web.title || '').toLowerCase();
          const contentLower = (web.content || '').toLowerCase();

          let score = 0;

          // タイトルに含まれる
          if (titleLower.includes(queryLower)) {
            score = Math.max(score, 0.8);
          }

          // コンテンツに含まれる
          if (contentLower.includes(queryLower)) {
            score = Math.max(score, 0.7);
          }

          // bigram マッチング
          if (score < 0.7) {
            const queryChars = Array.from(queryLower).filter(c => c.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\w]/));
            let matchedChars = 0;
            for (let i = 0; i < queryChars.length - 1; i++) {
              const bigram = queryChars[i] + queryChars[i + 1];
              if (titleLower.includes(bigram) || contentLower.includes(bigram)) {
                matchedChars += 2;
              }
            }
            if (matchedChars > 2) {
              score = Math.max(score, 0.5 + (matchedChars / queryChars.length) * 0.2);
            }
          }

          if (score === 0) {
            score = 0.3;
          }

          return {
            web_item: web,
            score: Math.min(0.85, score),
            source_type: 'web' as const,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    }

    // 4. Q&A優先、不足時はWebで補完
    let searchResults: SearchResult[] = [];
    const topQAResults = qaResults.slice(0, 3);

    // Q&Aの最高スコアが0.7以上なら、Q&Aのみを使用
    if (topQAResults.length > 0 && topQAResults[0].score >= 0.7) {
      searchResults = topQAResults;
    } 
    // Q&Aが不十分な場合、Webソースも追加
    else if (topQAResults.length > 0) {
      searchResults = [...topQAResults, ...webResults.slice(0, 2)];
    }
    // Q&Aが見つからない場合、Webソースのみ
    else {
      searchResults = webResults.slice(0, 3);
    }

    // 5. 信頼度計算
    const scores = searchResults.map((r) => r.score);
    const confidence = calculateConfidence(scores);

    // 6. 信頼度Cの場合は回答生成せず情報不足を返す
    if (confidence === 'C') {
      const sources: SourceReference[] = searchResults.slice(0, 3).map((result) => {
        if (result.source_type === 'qa') {
          return {
            type: 'qa',
            title: `${result.qa_item.category}: ${result.qa_item.question}`,
            excerpt: result.qa_item.answer.substring(0, 120) + '...',
            last_updated: result.qa_item.last_updated,
            score: result.score,
          };
        } else {
          const webItem = (result as any).web_item;
          return {
            type: 'web',
            title: webItem.title,
            excerpt: webItem.content.substring(0, 120) + '...',
            url: webItem.url,
            last_updated: webItem.last_crawled,
            score: result.score,
          };
        }
      });

      return c.json({
        answer: '',
        sources,
        confidence,
        escalation_note: getEscalationNote(confidence),
        tone,
      });
    }

    // 7. コンテキスト作成（上位3件）
    const topResults = searchResults.slice(0, 3);
    const context = topResults
      .map((result, index) => {
        if (result.source_type === 'qa') {
          return `【Q&A情報${index + 1}】(類似度: ${Math.round(result.score * 100)}%)
カテゴリ: ${result.qa_item.category}
質問: ${result.qa_item.question}
回答: ${result.qa_item.answer}`;
        } else {
          const webItem = (result as any).web_item;
          return `【Web情報${index + 1}】(類似度: ${Math.round(result.score * 100)}%)
タイトル: ${webItem.title}
URL: ${webItem.url}
内容抜粋: ${webItem.content.substring(0, 500)}`;
        }
      })
      .join('\n\n');

    // 8. OpenAIで回答生成
    const answer = await generateAnswer(query, context, tone, OPENAI_API_KEY);

    // 9. ソース参照情報を整形
    const sources: SourceReference[] = topResults.map((result) => {
      if (result.source_type === 'qa') {
        return {
          type: 'qa',
          title: `${result.qa_item.category}: ${result.qa_item.question}`,
          excerpt: result.qa_item.answer.substring(0, 120) + '...',
          last_updated: result.qa_item.last_updated,
          score: result.score,
        };
      } else {
        const webItem = (result as any).web_item;
        return {
          type: 'web',
          title: webItem.title,
          excerpt: webItem.content.substring(0, 120) + '...',
          url: webItem.url,
          last_updated: webItem.last_crawled,
          score: result.score,
        };
      }
    });

    const response: GeneratedAnswer = {
      answer,
      sources,
      confidence,
      escalation_note: getEscalationNote(confidence),
      tone,
    };

    return c.json(response);
  } catch (error: any) {
    console.error('Generate error:', error);
    return c.json({ error: `エラーが発生しました: ${error.message}` }, 500);
  }
});

// ===== Frontend Routes =====

/**
 * トップページ（回答生成画面）
 */
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>マカロニスタジオ Q&A回答ツール</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <nav class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex items-center">
                        <i class="fas fa-camera text-pink-500 text-xl sm:text-2xl mr-2 sm:mr-3"></i>
                        <h1 class="text-base sm:text-xl font-bold text-gray-900">マカロニスタジオ Q&A</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div class="hidden md:flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500 font-semibold">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/templates" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>定型文
                        </a>
                        <a href="/admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                        <a href="/web-admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-globe mr-2"></i>Web管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div class="md:hidden flex items-center">
                        <button id="mobileMenuBtn" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-bars text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileMenu" class="hidden md:hidden border-t border-gray-200">
                <div class="px-2 pt-2 pb-3 space-y-1">
                    <a href="/" class="block px-3 py-2 rounded-md text-base font-semibold text-pink-500 bg-pink-50">
                        <i class="fas fa-home mr-2"></i>回答生成
                    </a>
                    <a href="/templates" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>定型文
                    </a>
                    <a href="/admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-cog mr-2"></i>Q&A管理
                    </a>
                    <a href="/web-admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-globe mr-2"></i>Web管理
                    </a>
                </div>
            </div>
        </nav>
        <script>
            document.getElementById('mobileMenuBtn').addEventListener('click', () => {
                const menu = document.getElementById('mobileMenu');
                menu.classList.toggle('hidden');
            });
        </script>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
            <div class="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                <h2 class="text-xl sm:text-2xl font-bold text-gray-900 mb-4">
                    <i class="fas fa-comments text-pink-500 mr-2"></i>
                    問い合わせ内容入力
                </h2>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        問い合わせ内容
                    </label>
                    <textarea 
                        id="queryInput" 
                        rows="6" 
                        class="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base"
                        placeholder="お客様からの問い合わせ内容をここに貼り付けてください..."
                    ></textarea>
                </div>

                <div class="mb-6">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        回答スタイル
                    </label>
                    <div class="flex flex-col sm:flex-row sm:space-x-4 space-y-2 sm:space-y-0">
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="polite" checked class="mr-2">
                            <span class="text-sm sm:text-base">丁寧（推奨）</span>
                        </label>
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="casual" class="mr-2">
                            <span class="text-sm sm:text-base">カジュアル</span>
                        </label>
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="brief" class="mr-2">
                            <span class="text-sm sm:text-base">短文（コピペ用）</span>
                        </label>
                    </div>
                </div>

                <button 
                    id="generateBtn"
                    class="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 px-6 rounded-lg transition duration-200 text-sm sm:text-base"
                >
                    <i class="fas fa-magic mr-2"></i>AIで回答生成
                </button>
            </div>

            <div id="resultArea" class="hidden">
                <div class="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 space-y-2 sm:space-y-0">
                        <h2 class="text-xl sm:text-2xl font-bold text-gray-900">
                            <i class="fas fa-check-circle text-green-500 mr-2"></i>
                            生成された回答
                        </h2>
                        <button 
                            id="copyBtn"
                            class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                        >
                            <i class="fas fa-copy mr-2"></i>コピー
                        </button>
                    </div>
                    
                    <div id="confidenceBadge" class="mb-4"></div>
                    <div id="escalationNote" class="mb-4"></div>
                    <div id="answerText" class="prose max-w-none bg-gray-50 p-4 rounded-lg whitespace-pre-wrap"></div>
                    
                    <div class="mt-4 p-4 bg-blue-50 border-l-4 border-blue-400">
                        <p class="text-sm text-blue-700 mb-2">
                            <i class="fas fa-info-circle mr-2"></i>
                            思った回答が得られませんでしたか？
                        </p>
                        <button 
                            id="webSearchBtn"
                            class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                        >
                            <i class="fas fa-globe mr-2"></i>Webで追加検索
                        </button>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-gray-900">
                            <i class="fas fa-book text-blue-500 mr-2"></i>
                            参考情報（根拠）
                        </h3>
                        <a href="/templates" class="text-pink-500 hover:text-pink-600 font-semibold">
                            <i class="fas fa-clipboard-list mr-2"></i>定型文を見る
                        </a>
                    </div>
                    <div id="sourcesArea" class="space-y-4"></div>
                </div>
            </div>

            <div id="loadingArea" class="hidden text-center py-12">
                <i class="fas fa-spinner fa-spin text-4xl text-pink-500 mb-4"></i>
                <p class="text-gray-600">AIが回答を生成中です...</p>
            </div>
        </main>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `);
});

/**
 * 管理画面
 */
app.get('/admin', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Q&A管理 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <nav class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex items-center">
                        <i class="fas fa-camera text-pink-500 text-xl sm:text-2xl mr-2 sm:mr-3"></i>
                        <h1 class="text-base sm:text-xl font-bold text-gray-900">マカロニスタジオ Q&A</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div class="hidden md:flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/templates" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>定型文
                        </a>
                        <a href="/admin" class="text-pink-500 font-semibold">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                        <a href="/web-admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-globe mr-2"></i>Web管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div class="md:hidden flex items-center">
                        <button id="mobileMenuBtn" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-bars text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileMenu" class="hidden md:hidden border-t border-gray-200">
                <div class="px-2 pt-2 pb-3 space-y-1">
                    <a href="/" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-home mr-2"></i>回答生成
                    </a>
                    <a href="/templates" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>定型文
                    </a>
                    <a href="/admin" class="block px-3 py-2 rounded-md text-base font-semibold text-pink-500 bg-pink-50">
                        <i class="fas fa-cog mr-2"></i>Q&A管理
                    </a>
                    <a href="/web-admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-globe mr-2"></i>Web管理
                    </a>
                </div>
            </div>
        </nav>
        <script>
            document.getElementById('mobileMenuBtn').addEventListener('click', () => {
                const menu = document.getElementById('mobileMenu');
                menu.classList.toggle('hidden');
            });
        </script>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
            <div class="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 space-y-2 sm:space-y-0">
                    <h2 class="text-xl sm:text-2xl font-bold text-gray-900">
                        <i class="fas fa-list text-pink-500 mr-2"></i>
                        Q&A一覧
                    </h2>
                    <button 
                        id="addBtn"
                        class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                    >
                        <i class="fas fa-plus mr-2"></i>新規追加
                    </button>
                </div>

                <div id="qaList" class="space-y-4">
                    <!-- Q&Aアイテムがここに表示されます -->
                </div>
            </div>
        </main>

        <!-- 追加/編集モーダル -->
        <div id="modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 px-4">
            <div class="relative top-4 sm:top-20 mx-auto p-4 sm:p-5 border w-full max-w-2xl shadow-lg rounded-lg bg-white my-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="modalTitle" class="text-lg sm:text-xl font-bold">Q&A追加</h3>
                    <button id="closeModal" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl sm:text-2xl"></i>
                    </button>
                </div>

                <form id="qaForm" class="space-y-4">
                    <input type="hidden" id="qaId">
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            カテゴリ <span class="text-red-500">*</span>
                        </label>
                        <select id="category" required class="w-full border border-gray-300 rounded-lg p-2">
                            <option value="">選択してください</option>
                            <option value="予約方法">予約方法</option>
                            <option value="所要時間">所要時間</option>
                            <option value="対象年齢">対象年齢</option>
                            <option value="料金・七五三">料金・七五三</option>
                            <option value="料金・スマッシュケーキ">料金・スマッシュケーキ</option>
                            <option value="料金・ミルクバス">料金・ミルクバス</option>
                            <option value="キャンセル">キャンセル</option>
                            <option value="日程変更">日程変更</option>
                            <option value="納品">納品</option>
                            <option value="レタッチ">レタッチ</option>
                            <option value="駐車場">駐車場</option>
                            <option value="持ち物">持ち物</option>
                            <option value="家族撮影">家族撮影</option>
                            <option value="衣装">衣装</option>
                            <option value="非対応">非対応</option>
                            <option value="その他">その他</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            質問 <span class="text-red-500">*</span>
                        </label>
                        <input 
                            type="text" 
                            id="question" 
                            required 
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="例: 予約はどこからできますか？"
                        >
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            回答 <span class="text-red-500">*</span>
                        </label>
                        <textarea 
                            id="answer" 
                            required 
                            rows="5"
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="例: ご予約はInstagramのDM、公式LINE、またはホームページのお問い合わせフォームから承っております。"
                        ></textarea>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            検索用キーワード（カンマ区切り）
                        </label>
                        <input 
                            type="text" 
                            id="keywords" 
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="例: 予約,Instagram,LINE,ホームページ"
                        >
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            優先度
                        </label>
                        <select id="priority" class="w-full border border-gray-300 rounded-lg p-2">
                            <option value="1">高</option>
                            <option value="2">中</option>
                            <option value="3">低</option>
                        </select>
                    </div>

                    <div class="flex items-center">
                        <input type="checkbox" id="isActive" checked class="mr-2">
                        <label for="isActive" class="text-sm font-medium text-gray-700">有効</label>
                    </div>

                    <div class="flex justify-end space-x-3 pt-4">
                        <button 
                            type="button" 
                            id="cancelBtn"
                            class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg"
                        >
                            キャンセル
                        </button>
                        <button 
                            type="submit"
                            class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg"
                        >
                            保存
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/admin.js"></script>
    </body>
    </html>
  `);
});

/**
 * Web管理画面
 */
app.get('/web-admin', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Web管理 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <nav class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex items-center">
                        <i class="fas fa-camera text-pink-500 text-xl sm:text-2xl mr-2 sm:mr-3"></i>
                        <h1 class="text-base sm:text-xl font-bold text-gray-900">マカロニスタジオ Q&A</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div class="hidden md:flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/templates" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>定型文
                        </a>
                        <a href="/admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                        <a href="/web-admin" class="text-pink-500 font-semibold">
                            <i class="fas fa-globe mr-2"></i>Web管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div class="md:hidden flex items-center">
                        <button id="mobileMenuBtn" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-bars text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileMenu" class="hidden md:hidden border-t border-gray-200">
                <div class="px-2 pt-2 pb-3 space-y-1">
                    <a href="/" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-home mr-2"></i>回答生成
                    </a>
                    <a href="/templates" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>定型文
                    </a>
                    <a href="/admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-cog mr-2"></i>Q&A管理
                    </a>
                    <a href="/web-admin" class="block px-3 py-2 rounded-md text-base font-semibold text-pink-500 bg-pink-50">
                        <i class="fas fa-globe mr-2"></i>Web管理
                    </a>
                </div>
            </div>
        </nav>
        <script>
            document.getElementById('mobileMenuBtn').addEventListener('click', () => {
                const menu = document.getElementById('mobileMenu');
                menu.classList.toggle('hidden');
            });
        </script>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
            <div class="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                <h2 class="text-xl sm:text-2xl font-bold text-gray-900 mb-4">
                    <i class="fas fa-globe text-pink-500 mr-2"></i>
                    Webソース管理
                </h2>
                
                <div class="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400">
                    <p class="text-xs sm:text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        参照したいWebページのURLを登録すると、内容を自動的に取り込んでQ&A回答の参考情報として使用します。
                    </p>
                </div>

                <div class="flex flex-col sm:flex-row gap-2 mb-6">
                    <input 
                        type="url" 
                        id="urlInput" 
                        placeholder="https://example.com" 
                        class="flex-1 border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-pink-500 text-sm sm:text-base"
                    />
                    <button 
                        id="addBtn"
                        class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 px-6 rounded-lg transition duration-200 text-sm sm:text-base"
                    >
                        <i class="fas fa-plus mr-2"></i>追加
                    </button>
                </div>

                <div id="loadingArea" class="hidden text-center py-4">
                    <i class="fas fa-spinner fa-spin text-2xl text-pink-500 mb-2"></i>
                    <p class="text-gray-600">Webページを取得中...</p>
                </div>

                <div id="webList" class="space-y-4">
                    <!-- Webソースがここに表示されます -->
                </div>
            </div>
        </main>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/web-admin.js"></script>
    </body>
    </html>
  `);
});

/**
 * テンプレート管理画面
 */
app.get('/templates', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>定型文管理 - マカロニスタジオ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <nav class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex items-center">
                        <i class="fas fa-camera text-pink-500 text-xl sm:text-2xl mr-2 sm:mr-3"></i>
                        <h1 class="text-base sm:text-xl font-bold text-gray-900">マカロニスタジオ Q&A</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div class="hidden md:flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/templates" class="text-pink-500 font-semibold">
                            <i class="fas fa-clipboard-list mr-2"></i>定型文
                        </a>
                        <a href="/admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                        <a href="/web-admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-globe mr-2"></i>Web管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div class="md:hidden flex items-center">
                        <button id="mobileMenuBtn" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-bars text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileMenu" class="hidden md:hidden border-t border-gray-200">
                <div class="px-2 pt-2 pb-3 space-y-1">
                    <a href="/" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-home mr-2"></i>回答生成
                    </a>
                    <a href="/templates" class="block px-3 py-2 rounded-md text-base font-semibold text-pink-500 bg-pink-50">
                        <i class="fas fa-clipboard-list mr-2"></i>定型文
                    </a>
                    <a href="/admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-cog mr-2"></i>Q&A管理
                    </a>
                    <a href="/web-admin" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-globe mr-2"></i>Web管理
                    </a>
                </div>
            </div>
        </nav>
        <script>
            document.getElementById('mobileMenuBtn').addEventListener('click', () => {
                const menu = document.getElementById('mobileMenu');
                menu.classList.toggle('hidden');
            });
        </script>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
            <div class="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 space-y-2 sm:space-y-0">
                    <h2 class="text-xl sm:text-2xl font-bold text-gray-900">
                        <i class="fas fa-clipboard-list text-pink-500 mr-2"></i>
                        よく使う返信テンプレート
                    </h2>
                    <button 
                        id="addBtn"
                        class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                    >
                        <i class="fas fa-plus mr-2"></i>新規追加
                    </button>
                </div>

                <div class="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400">
                    <p class="text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        頻繁に使う返信内容をテンプレートとして登録しておくと、ワンクリックでコピーできます。
                    </p>
                </div>

                <!-- 検索フィルター -->
                <div class="mb-6">
                    <div class="relative">
                        <input 
                            type="text" 
                            id="searchInput" 
                            placeholder="タイトル、カテゴリ、本文で検索..." 
                            class="w-full px-4 py-3 pl-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        >
                        <i class="fas fa-search absolute left-4 top-4 text-gray-400"></i>
                    </div>
                </div>

                <div id="templateList" class="space-y-4">
                    <!-- テンプレートがここに表示されます -->
                </div>
            </div>
        </main>

        <!-- 追加/編集モーダル -->
        <div id="modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 px-4">
            <div class="relative top-4 sm:top-20 mx-auto p-4 sm:p-5 border w-full max-w-2xl shadow-lg rounded-lg bg-white my-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="modalTitle" class="text-lg sm:text-xl font-bold">テンプレート追加</h3>
                    <button id="closeModal" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl sm:text-2xl"></i>
                    </button>
                </div>

                <form id="templateForm" class="space-y-4">
                    <input type="hidden" id="templateId">
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            タイトル <span class="text-red-500">*</span>
                        </label>
                        <input 
                            type="text" 
                            id="title" 
                            required 
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="例: 営業時間のご案内"
                        >
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            カテゴリ（任意）
                        </label>
                        <input 
                            type="text" 
                            id="category" 
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="例: 営業時間、料金、予約"
                        >
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            返信内容 <span class="text-red-500">*</span>
                        </label>
                        <textarea 
                            id="content" 
                            required 
                            rows="10"
                            class="w-full border border-gray-300 rounded-lg p-2"
                            placeholder="お客様への返信内容をここに入力してください..."
                        ></textarea>
                    </div>

                    <div class="flex justify-end space-x-3 pt-4">
                        <button 
                            type="button" 
                            id="cancelBtn"
                            class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg"
                        >
                            キャンセル
                        </button>
                        <button 
                            type="submit"
                            class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg"
                        >
                            保存
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/templates.js"></script>
    </body>
    </html>
  `);
});

export default app;
