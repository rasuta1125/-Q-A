import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import type { Bindings, QAItem, SearchResult, GeneratedAnswer, SourceReference } from './types';
import { generateEmbedding, generateAnswer, calculateConfidence, getEscalationNote } from './openai';

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

    // 2. Vectorizeで類似検索（上位5件）
    let searchResults: SearchResult[] = [];
    try {
      const vectorResults = await VECTORIZE.query(queryEmbedding, {
        topK: 5,
        returnMetadata: true,
      });

      // 3. Q&Aアイテムの詳細を取得
      const qaIds = vectorResults.matches
        .filter((match) => match.score > 0.5) // 類似度が50%以上のみ
        .map((match) => match.metadata?.qa_id as number);

      if (qaIds.length > 0) {
        const placeholders = qaIds.map(() => '?').join(',');
        const { results } = await DB.prepare(
          `SELECT * FROM qa_items WHERE id IN (${placeholders}) AND is_active = 1`
        ).bind(...qaIds).all();

        // スコアとマージ
        searchResults = results.map((qa: any) => {
          const match = vectorResults.matches.find(
            (m) => m.metadata?.qa_id === qa.id
          );
          return {
            qa_item: qa as QAItem,
            score: match?.score || 0,
            source_type: 'qa' as const,
          };
        }).sort((a, b) => b.score - a.score);
      }
    } catch (error) {
      console.error('Vectorize search error:', error);
      // Vectorizeエラー時はフォールバック: 全件取得して簡易スコアリング
      const { results } = await DB.prepare(
        `SELECT * FROM qa_items 
         WHERE is_active = 1 
         ORDER BY priority ASC, id ASC`
      ).all();

      // 簡易スコアリング: より単純で確実なキーワードマッチング
      const queryLower = query.toLowerCase();
      
      searchResults = results
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
    }

    // 4. 信頼度計算
    const scores = searchResults.map((r) => r.score);
    const confidence = calculateConfidence(scores);

    // 5. 信頼度Cの場合は回答生成せず情報不足を返す
    if (confidence === 'C') {
      const sources: SourceReference[] = searchResults.slice(0, 3).map((result) => ({
        type: result.source_type,
        title: `${result.qa_item.category}: ${result.qa_item.question}`,
        excerpt: result.qa_item.answer.substring(0, 120) + '...',
        last_updated: result.qa_item.last_updated,
        score: result.score,
      }));

      return c.json({
        answer: '',
        sources,
        confidence,
        escalation_note: getEscalationNote(confidence),
        tone,
      });
    }

    // 6. コンテキスト作成（上位3件）
    const topResults = searchResults.slice(0, 3);
    const context = topResults
      .map((result, index) => {
        return `【参考情報${index + 1}】(信頼度: ${Math.round(result.score * 100)}%)
カテゴリ: ${result.qa_item.category}
質問: ${result.qa_item.question}
回答: ${result.qa_item.answer}`;
      })
      .join('\n\n');

    // 7. OpenAIで回答生成
    const answer = await generateAnswer(query, context, tone, OPENAI_API_KEY);

    // 8. ソース参照情報を整形
    const sources: SourceReference[] = topResults.map((result) => ({
      type: result.source_type,
      title: `${result.qa_item.category}: ${result.qa_item.question}`,
      excerpt: result.qa_item.answer.substring(0, 120) + '...',
      last_updated: result.qa_item.last_updated,
      score: result.score,
    }));

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
                        <i class="fas fa-camera text-pink-500 text-2xl mr-3"></i>
                        <h1 class="text-xl font-bold text-gray-900">マカロニスタジオ Q&A回答ツール</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/admin" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                    </div>
                </div>
            </div>
        </nav>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="bg-white rounded-lg shadow p-6 mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">
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
                        class="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                        placeholder="お客様からの問い合わせ内容をここに貼り付けてください..."
                    ></textarea>
                </div>

                <div class="mb-6">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        回答スタイル
                    </label>
                    <div class="flex space-x-4">
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="polite" checked class="mr-2">
                            <span>丁寧（推奨）</span>
                        </label>
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="casual" class="mr-2">
                            <span>カジュアル</span>
                        </label>
                        <label class="flex items-center">
                            <input type="radio" name="tone" value="brief" class="mr-2">
                            <span>短文（コピペ用）</span>
                        </label>
                    </div>
                </div>

                <button 
                    id="generateBtn"
                    class="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 px-6 rounded-lg transition duration-200"
                >
                    <i class="fas fa-magic mr-2"></i>AIで回答生成
                </button>
            </div>

            <div id="resultArea" class="hidden">
                <div class="bg-white rounded-lg shadow p-6 mb-6">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-2xl font-bold text-gray-900">
                            <i class="fas fa-check-circle text-green-500 mr-2"></i>
                            生成された回答
                        </h2>
                        <button 
                            id="copyBtn"
                            class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                        >
                            <i class="fas fa-copy mr-2"></i>コピー
                        </button>
                    </div>
                    
                    <div id="confidenceBadge" class="mb-4"></div>
                    <div id="escalationNote" class="mb-4"></div>
                    <div id="answerText" class="prose max-w-none bg-gray-50 p-4 rounded-lg whitespace-pre-wrap"></div>
                </div>

                <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="text-xl font-bold text-gray-900 mb-4">
                        <i class="fas fa-book text-blue-500 mr-2"></i>
                        参考情報（根拠）
                    </h3>
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
                        <i class="fas fa-camera text-pink-500 text-2xl mr-3"></i>
                        <h1 class="text-xl font-bold text-gray-900">マカロニスタジオ Q&A回答ツール</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <a href="/" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-home mr-2"></i>回答生成
                        </a>
                        <a href="/admin" class="text-pink-500 font-semibold">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                    </div>
                </div>
            </div>
        </nav>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div class="bg-white rounded-lg shadow p-6 mb-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold text-gray-900">
                        <i class="fas fa-list text-pink-500 mr-2"></i>
                        Q&A一覧
                    </h2>
                    <button 
                        id="addBtn"
                        class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
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
        <div id="modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div class="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-lg bg-white">
                <div class="flex justify-between items-center mb-4">
                    <h3 id="modalTitle" class="text-xl font-bold">Q&A追加</h3>
                    <button id="closeModal" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-2xl"></i>
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

export default app;
