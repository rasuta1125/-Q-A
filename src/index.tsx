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

/**
 * Q&A一括インポート
 */
app.post('/api/qa/bulk-import', async (c) => {
  const { DB, VECTORIZE, OPENAI_API_KEY } = c.env;
  const { items } = await c.req.json();

  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'インポートするデータがありません' }, 400);
  }

  let successCount = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      // 必須項目のチェック
      if (!item.category || !item.question || !item.answer) {
        errors.push(`スキップ: 必須項目が不足しています (質問: ${item.question || '未設定'})`);
        continue;
      }

      // D1にQ&Aを保存
      const result = await DB.prepare(
        `INSERT INTO qa_items (category, question, answer, keywords, priority, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        item.category,
        item.question,
        item.answer,
        item.keywords || '',
        item.priority || 2,  // デフォルト: 中
        item.is_active !== undefined ? item.is_active : 1
      ).run();

      const qaId = result.meta.last_row_id as number;

      // 埋め込みベクトルを生成してVectorizeに保存
      try {
        const embeddingText = `${item.category} ${item.question} ${item.answer} ${item.keywords || ''}`;
        const embedding = await generateEmbedding(embeddingText, OPENAI_API_KEY);

        await VECTORIZE.upsert([
          {
            id: `qa_${qaId}`,
            values: embedding,
            metadata: {
              type: 'qa',
              qa_id: qaId,
              category: item.category,
            },
          },
        ]);
      } catch (error) {
        console.error('Vectorize upsert error for bulk import:', error);
        // Vectorizeのエラーはログのみで処理続行
      }

      successCount++;
    } catch (error: any) {
      errors.push(`エラー: ${error.message} (質問: ${item.question || '未設定'})`);
      console.error('Bulk import item error:', error);
    }
  }

  return c.json({
    inserted: successCount,
    total: items.length,
    errors: errors.length > 0 ? errors : undefined,
  });
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

/**
 * 選択したWebソースのみを使って回答生成
 */
app.post('/api/generate-from-web', async (c) => {
  try {
    const { query, tone = 'polite', web_source_ids } = await c.req.json();
    const { env } = c;

    if (!query || !web_source_ids || !Array.isArray(web_source_ids) || web_source_ids.length === 0) {
      return c.json({ error: '質問とWebソースIDが必要です' }, 400);
    }

    const OPENAI_API_KEY = env.OPENAI_API_KEY || '';

    // 1. 選択されたWebソースのみを取得
    const placeholders = web_source_ids.map(() => '?').join(',');
    const webSourcesQuery = `
      SELECT id, url, title, content, last_crawled
      FROM web_sources
      WHERE id IN (${placeholders}) AND is_active = 1
    `;

    const webSourcesResult = await env.DB.prepare(webSourcesQuery).bind(...web_source_ids).all();
    const webSources = webSourcesResult.results as WebSource[];

    if (webSources.length === 0) {
      return c.json({ error: '選択されたWebソースが見つかりませんでした' }, 404);
    }

    // 2. 全てのWebソースを検索結果として使用（スコアは固定値）
    const searchResults: SearchResult[] = webSources.map(web => ({
      web_item: web,
      score: 0.75, // 選択されたソースなので信頼度を与える
      source_type: 'web' as const,
    }));

    // 3. 信頼度計算
    const scores = searchResults.map((r) => r.score);
    const confidence = calculateConfidence(scores);

    // 4. コンテキスト作成
    const context = searchResults
      .map((result, index) => {
        const webItem = result.web_item;
        return `【Web情報${index + 1}】
タイトル: ${webItem.title}
URL: ${webItem.url}
内容: ${webItem.content.substring(0, 1000)}`;
      })
      .join('\n\n');

    // 5. OpenAIで回答生成
    const answer = await generateAnswer(query, context, tone, OPENAI_API_KEY);

    // 6. ソース参照情報を整形
    const sources: SourceReference[] = searchResults.map((result) => {
      const webItem = result.web_item;
      return {
        type: 'web',
        title: webItem.title,
        excerpt: webItem.content.substring(0, 120) + '...',
        url: webItem.url,
        last_updated: webItem.last_crawled,
        score: result.score,
      };
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
    console.error('Generate from web error:', error);
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
                        <a href="/instagram" class="text-gray-700 hover:text-pink-500">
                            <i class="fab fa-instagram mr-2"></i>Instagram投稿
                        </a>
                        <a href="/blog" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-blog mr-2"></i>ブログ原稿
                        </a>
                        <a href="/staff-board" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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
                    <a href="/instagram" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fab fa-instagram mr-2"></i>Instagram投稿
                    </a>
                    <a href="/blog" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-blog mr-2"></i>ブログ原稿
                    </a>
                    <a href="/staff-board" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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

        <!-- Webソース選択モーダル -->
        <div id="webSourceModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 px-4">
            <div class="relative top-4 sm:top-20 mx-auto p-4 sm:p-6 border w-full max-w-3xl shadow-lg rounded-lg bg-white my-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg sm:text-xl font-bold text-gray-900">
                        <i class="fas fa-globe text-blue-500 mr-2"></i>
                        Webソースから追加情報を取得
                    </h3>
                    <button id="closeWebModal" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl sm:text-2xl"></i>
                    </button>
                </div>

                <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400">
                    <p class="text-xs sm:text-sm text-blue-700">
                        <i class="fas fa-info-circle mr-2"></i>
                        参照したいWebソースを選択してください。選択したソースの情報を使って回答を再生成します。
                    </p>
                </div>

                <div id="webSourceList" class="space-y-3 mb-6 max-h-96 overflow-y-auto">
                    <!-- Webソース一覧がここに表示されます -->
                </div>

                <div class="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                    <button 
                        id="cancelWebSearch"
                        class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition duration-200"
                    >
                        キャンセル
                    </button>
                    <button 
                        id="executeWebSearch"
                        class="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition duration-200"
                    >
                        <i class="fas fa-search mr-2"></i>この情報で再生成
                    </button>
                </div>
            </div>
        </div>

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
                        <a href="/instagram" class="text-gray-700 hover:text-pink-500">
                            <i class="fab fa-instagram mr-2"></i>Instagram投稿
                        </a>
                        <a href="/blog" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-blog mr-2"></i>ブログ原稿
                        </a>
                        <a href="/staff-board" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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
                    <a href="/instagram" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fab fa-instagram mr-2"></i>Instagram投稿
                    </a>
                    <a href="/blog" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-blog mr-2"></i>ブログ原稿
                    </a>
                    <a href="/staff-board" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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
                    <div class="flex flex-col sm:flex-row gap-2">
                        <button 
                            id="csvImportBtn"
                            class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                        >
                            <i class="fas fa-file-csv mr-2"></i>CSVインポート
                        </button>
                        <button 
                            id="bulkImportBtn"
                            class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                        >
                            <i class="fas fa-file-import mr-2"></i>テキスト一括
                        </button>
                        <button 
                            id="addBtn"
                            class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200 text-sm sm:text-base"
                        >
                            <i class="fas fa-plus mr-2"></i>新規追加
                        </button>
                    </div>
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

        <!-- 一括インポートモーダル -->
        <div id="bulkImportModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 px-4">
            <div class="relative top-4 sm:top-10 mx-auto p-4 sm:p-6 border w-full max-w-4xl shadow-lg rounded-lg bg-white my-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg sm:text-xl font-bold text-gray-900">
                        <i class="fas fa-file-import text-blue-500 mr-2"></i>
                        Q&A一括インポート
                    </h3>
                    <button id="closeBulkImport" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl sm:text-2xl"></i>
                    </button>
                </div>

                <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400">
                    <p class="text-xs sm:text-sm text-blue-700 mb-2">
                        <i class="fas fa-info-circle mr-2"></i>
                        以下の形式で貼り付けてください：
                    </p>
                    <pre class="text-xs bg-white p-2 rounded mt-2 overflow-x-auto">カテゴリ: 予約方法
質問: 予約はどこからできますか？
回答: ホームページの予約フォームからお願いします
---
カテゴリ: 料金
質問: 料金を教えてください
回答: 基本料金は○○円です</pre>
                </div>

                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        Q&Aデータを貼り付け
                    </label>
                    <textarea 
                        id="bulkImportText" 
                        rows="12" 
                        class="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-pink-500 font-mono text-sm"
                        placeholder="カテゴリ: 予約方法
質問: 予約はどこからできますか？
回答: ホームページの予約フォームからお願いします
---
カテゴリ: 料金
質問: 料金を教えてください
回答: 基本料金は○○円です"
                    ></textarea>
                </div>

                <div class="mb-4">
                    <button 
                        id="parseDataBtn"
                        class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                    >
                        <i class="fas fa-search mr-2"></i>データを解析してプレビュー
                    </button>
                </div>

                <div id="previewArea" class="hidden">
                    <h4 class="font-semibold text-gray-900 mb-3">
                        <i class="fas fa-eye mr-2"></i>プレビュー（<span id="previewCount">0</span>件）
                    </h4>
                    <div id="previewList" class="space-y-3 mb-4 max-h-96 overflow-y-auto bg-gray-50 p-4 rounded-lg">
                        <!-- プレビューがここに表示されます -->
                    </div>
                    
                    <div class="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                        <button 
                            id="cancelBulkImport"
                            class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition duration-200"
                        >
                            キャンセル
                        </button>
                        <button 
                            id="executeBulkImport"
                            class="px-6 py-2 bg-pink-500 hover:bg-pink-600 text-white font-bold rounded-lg transition duration-200"
                        >
                            <i class="fas fa-check mr-2"></i>この内容で一括登録
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- CSVインポートモーダル -->
        <div id="csvImportModal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 px-4">
            <div class="relative top-4 sm:top-10 mx-auto p-4 sm:p-6 border w-full max-w-6xl shadow-lg rounded-lg bg-white my-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg sm:text-xl font-bold text-gray-900">
                        <i class="fas fa-file-csv text-green-500 mr-2"></i>
                        CSVインポート（重複検出付き）
                    </h3>
                    <button id="closeCsvImport" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl sm:text-2xl"></i>
                    </button>
                </div>

                <!-- ステップ1: ファイル選択 -->
                <div id="csvStep1" class="mb-4">
                    <div class="mb-4 p-4 bg-green-50 border-l-4 border-green-400">
                        <p class="text-xs sm:text-sm text-green-700 mb-2">
                            <i class="fas fa-info-circle mr-2"></i>
                            CSV形式でQ&Aデータをインポートできます
                        </p>
                        <p class="text-xs text-green-600 mt-2">
                            <strong>CSV形式:</strong> カテゴリ,質問,回答,キーワード<br>
                            <strong>例:</strong> 料金,平日割引はありますか?,はい、平日は¥3,000割引です,平日割引,料金
                        </p>
                    </div>

                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">
                            <i class="fas fa-file-csv mr-2"></i>CSVファイルを選択（複数選択可）
                        </label>
                        <input 
                            type="file" 
                            id="csvFileInput" 
                            accept=".csv"
                            multiple
                            class="block w-full text-sm text-gray-500
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-lg file:border-0
                                file:text-sm file:font-semibold
                                file:bg-green-50 file:text-green-700
                                hover:file:bg-green-100"
                        />
                        <p class="mt-2 text-xs text-gray-500">
                            <i class="fas fa-info-circle mr-1"></i>
                            複数のLINE会話履歴CSVを一度に選択できます（最大20ファイル推奨）
                        </p>
                    </div>

                    <!-- 進捗表示エリア -->
                    <div id="csvProgress" class="mb-4 hidden">
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium text-blue-900">
                                    <i class="fas fa-spinner fa-spin mr-2"></i>
                                    ファイルを読み込み中...
                                </span>
                                <span class="text-sm text-blue-700" id="csvProgressText">0/0</span>
                            </div>
                            <div class="w-full bg-blue-200 rounded-full h-2">
                                <div id="csvProgressBar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                            </div>
                        </div>
                    </div>

                    <button 
                        id="parseCsvBtn"
                        class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                    >
                        <i class="fas fa-search mr-2"></i>CSVを読み込んで重複チェック
                    </button>
                </div>

                <!-- ステップ2: 重複検出結果と選抜 -->
                <div id="csvStep2" class="hidden">
                    <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400 flex items-center justify-between">
                        <p class="text-xs sm:text-sm text-blue-700">
                            <i class="fas fa-info-circle mr-2"></i>
                            <span id="duplicateCount">0</span>件の重複が検出されました。インポートするQ&Aを選択してください。
                        </p>
                        <div class="flex space-x-2">
                            <button 
                                onclick="selectAllItems()"
                                class="text-xs px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg transition"
                            >
                                <i class="fas fa-check-double mr-1"></i>すべて選択
                            </button>
                            <button 
                                onclick="deselectAllItems()"
                                class="text-xs px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition"
                            >
                                <i class="fas fa-times mr-1"></i>すべて解除
                            </button>
                        </div>
                    </div>

                    <!-- 重複グループ表示エリア -->
                    <div id="duplicateGroups" class="space-y-4 mb-4 max-h-96 overflow-y-auto">
                        <!-- 重複グループがここに表示されます -->
                    </div>

                    <!-- ユニークデータプレビュー -->
                    <div class="mb-4">
                        <div id="uniqueList" class="max-h-64 overflow-y-auto bg-gray-50 p-4 rounded-lg">
                            <!-- ユニークなQ&Aがここに表示されます -->
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                        <button 
                            id="cancelCsvImport"
                            class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg transition duration-200"
                        >
                            キャンセル
                        </button>
                        <button 
                            id="executeCsvImport"
                            class="px-6 py-2 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg transition duration-200"
                        >
                            <i class="fas fa-check mr-2"></i>選択した内容でインポート（<span id="finalCount">0</span>件）
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <!-- LINE CSV パーサーを先に読み込む -->
        <script src="/static/line-parser.js"></script>
        <!-- admin.jsは line-parser.js の後に読み込む -->
        <script>
          // line-parser.jsの読み込み確認
          window.addEventListener('DOMContentLoaded', function() {
            console.log('DOMContentLoaded - Checking parseLINECSV...');
            console.log('window.parseLINECSV exists:', typeof window.parseLINECSV);
            
            if (typeof window.parseLINECSV !== 'function') {
              console.error('⚠️ WARNING: parseLINECSV is not loaded!');
              console.error('Attempting to reload line-parser.js...');
              
              // 動的に再読み込みを試みる
              const script = document.createElement('script');
              script.src = '/static/line-parser.js';
              script.onload = function() {
                console.log('✅ line-parser.js reloaded successfully');
                console.log('parseLINECSV now available:', typeof window.parseLINECSV);
              };
              script.onerror = function() {
                console.error('❌ Failed to reload line-parser.js');
              };
              document.head.appendChild(script);
            } else {
              console.log('✅ parseLINECSV loaded successfully');
            }
          });
        </script>
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
                        <a href="/instagram" class="text-gray-700 hover:text-pink-500">
                            <i class="fab fa-instagram mr-2"></i>Instagram投稿
                        </a>
                        <a href="/blog" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-blog mr-2"></i>ブログ原稿
                        </a>
                        <a href="/staff-board" class="text-gray-700 hover:text-pink-500">
                            <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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
                    <a href="/instagram" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fab fa-instagram mr-2"></i>Instagram投稿
                    </a>
                    <a href="/blog" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-blog mr-2"></i>ブログ原稿
                    </a>
                    <a href="/staff-board" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
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
                        <a href="/instagram" class="text-gray-700 hover:text-pink-500">
                            <i class="fab fa-instagram mr-2"></i>Instagram投稿
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
                    <a href="/instagram" class="block px-3 py-2 rounded-md text-base text-gray-700 hover:bg-gray-50">
                        <i class="fab fa-instagram mr-2"></i>Instagram投稿
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
            
            .container {
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
                .container {
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
        <!-- ナビゲーションバー -->
        <nav style="background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-bottom: 1px solid #e5e7eb;">
            <div style="max-width: 1280px; margin: 0 auto; padding: 0 1rem;">
                <div style="display: flex; justify-content: space-between; height: 4rem; align-items: center;">
                    <div style="display: flex; align-items: center;">
                        <i class="fas fa-camera" style="color: #ec4899; font-size: 1.5rem; margin-right: 0.75rem;"></i>
                        <h1 style="font-size: 1.25rem; font-weight: bold; color: #111827;">マカロニスタジオ</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div id="desktopNav" style="display: none; align-items: center; gap: 1rem;">
                        <a href="/" style="color: #374151; text-decoration: none; font-weight: 500;">
                            <i class="fas fa-home" style="margin-right: 0.5rem;"></i>回答生成
                        </a>
                        <a href="/instagram" style="color: #ec4899; text-decoration: none; font-weight: 600;">
                            <i class="fab fa-instagram" style="margin-right: 0.5rem;"></i>Instagram投稿
                        </a>
                        <a href="/templates" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>定型文
                        </a>
                        <a href="/admin" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-cog" style="margin-right: 0.5rem;"></i>Q&A管理
                        </a>
                        <a href="/web-admin" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-globe" style="margin-right: 0.5rem;"></i>Web管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div id="mobileNavBtn" style="display: none;">
                        <button onclick="toggleMobileMenu()" style="color: #374151; background: none; border: none; cursor: pointer;">
                            <i class="fas fa-bars" style="font-size: 1.5rem;"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileNavMenu" style="display: none; border-top: 1px solid #e5e7eb; padding: 0.5rem;">
                <a href="/" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none; border-radius: 0.375rem;">
                    <i class="fas fa-home" style="margin-right: 0.5rem;"></i>回答生成
                </a>
                <a href="/instagram" style="display: block; padding: 0.75rem 1rem; color: #ec4899; text-decoration: none; font-weight: 600; background: #fce7f3; border-radius: 0.375rem;">
                    <i class="fab fa-instagram" style="margin-right: 0.5rem;"></i>Instagram投稿
                </a>
                <a href="/templates" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none; border-radius: 0.375rem;">
                    <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>定型文
                </a>
                <a href="/admin" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none; border-radius: 0.375rem;">
                    <i class="fas fa-cog" style="margin-right: 0.5rem;"></i>Q&A管理
                </a>
                <a href="/web-admin" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none; border-radius: 0.375rem;">
                    <i class="fas fa-globe" style="margin-right: 0.5rem;"></i>Web管理
                </a>
            </div>
        </nav>
        <script>
            // レスポンシブナビゲーション
            function updateNav() {
                const desktopNav = document.getElementById('desktopNav');
                const mobileNavBtn = document.getElementById('mobileNavBtn');
                if (window.innerWidth >= 768) {
                    desktopNav.style.display = 'flex';
                    mobileNavBtn.style.display = 'none';
                    document.getElementById('mobileNavMenu').style.display = 'none';
                } else {
                    desktopNav.style.display = 'none';
                    mobileNavBtn.style.display = 'block';
                }
            }
            function toggleMobileMenu() {
                const menu = document.getElementById('mobileNavMenu');
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            }
            updateNav();
            window.addEventListener('resize', updateNav);
        </script>
        
        <div class="container">
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
            
            .container {
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
                .container {
                    padding: 20px 15px;
                }
            }
        </style>
    </head>
    <body>
        <!-- ナビゲーションバー -->
        <nav style="background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-bottom: 1px solid #e5e7eb;">
            <div style="max-width: 1280px; margin: 0 auto; padding: 0 1rem;">
                <div style="display: flex; justify-content: space-between; height: 4rem; align-items: center;">
                    <div style="display: flex; align-items: center;">
                        <i class="fas fa-camera" style="color: #ec4899; font-size: 1.5rem; margin-right: 0.75rem;"></i>
                        <h1 style="font-size: 1.25rem; font-weight: bold; color: #111827;">マカロニスタジオ</h1>
                    </div>
                    <!-- デスクトップメニュー -->
                    <div id="desktopNav" style="display: none; align-items: center; gap: 1rem;">
                        <a href="/" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-home" style="margin-right: 0.5rem;"></i>回答生成
                        </a>
                        <a href="/instagram" style="color: #374151; text-decoration: none;">
                            <i class="fab fa-instagram" style="margin-right: 0.5rem;"></i>Instagram投稿
                        </a>
                        <a href="/blog" style="color: #3b82f6; text-decoration: none; font-weight: 600;">
                            <i class="fas fa-blog" style="margin-right: 0.5rem;"></i>ブログ原稿
                        </a>
                        <a href="/staff-board" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>スタッフ連絡板
                        </a>
                        <a href="/templates" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>定型文
                        </a>
                        <a href="/admin" style="color: #374151; text-decoration: none;">
                            <i class="fas fa-cog" style="margin-right: 0.5rem;"></i>Q&A管理
                        </a>
                    </div>
                    <!-- モバイルメニューボタン -->
                    <div id="mobileNavBtn" style="display: none;">
                        <button onclick="toggleMobileMenu()" style="color: #374151; background: none; border: none; cursor: pointer;">
                            <i class="fas fa-bars" style="font-size: 1.5rem;"></i>
                        </button>
                    </div>
                </div>
            </div>
            <!-- モバイルメニュー -->
            <div id="mobileNavMenu" style="display: none; border-top: 1px solid #e5e7eb; padding: 0.5rem;">
                <a href="/" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none;">
                    <i class="fas fa-home" style="margin-right: 0.5rem;"></i>回答生成
                </a>
                <a href="/instagram" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none;">
                    <i class="fab fa-instagram" style="margin-right: 0.5rem;"></i>Instagram投稿
                </a>
                <a href="/blog" style="display: block; padding: 0.75rem 1rem; color: #3b82f6; text-decoration: none; font-weight: 600; background: #dbeafe; border-radius: 0.375rem;">
                    <i class="fas fa-blog" style="margin-right: 0.5rem;"></i>ブログ原稿
                </a>
                <a href="/staff-board" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none;">
                    <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>スタッフ連絡板
                </a>
                <a href="/templates" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none;">
                    <i class="fas fa-clipboard-list" style="margin-right: 0.5rem;"></i>定型文
                </a>
                <a href="/admin" style="display: block; padding: 0.75rem 1rem; color: #374151; text-decoration: none;">
                    <i class="fas fa-cog" style="margin-right: 0.5rem;"></i>Q&A管理
                </a>
            </div>
        </nav>
        <script>
            function updateNav() {
                const desktopNav = document.getElementById('desktopNav');
                const mobileNavBtn = document.getElementById('mobileNavBtn');
                if (window.innerWidth >= 768) {
                    desktopNav.style.display = 'flex';
                    mobileNavBtn.style.display = 'none';
                    document.getElementById('mobileNavMenu').style.display = 'none';
                } else {
                    desktopNav.style.display = 'none';
                    mobileNavBtn.style.display = 'block';
                }
            }
            function toggleMobileMenu() {
                const menu = document.getElementById('mobileNavMenu');
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            }
            updateNav();
            window.addEventListener('resize', updateNav);
        </script>
        
        <div class="container">
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
                    <!-- 撮影メニュー選択 -->
                    <div>
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
        </style>
    </head>
    <body class="bg-gray-50">
        <!-- ヘッダー -->
        <header class="bg-white shadow-sm sticky top-0 z-50">
            <nav class="container mx-auto px-4 py-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-camera text-3xl" style="color: #FF69B4;"></i>
                        <h1 class="text-2xl font-bold" style="color: #FF69B4;">マカロニスタジオ</h1>
                    </div>
                    
                    <!-- デスクトップメニュー -->
                    <div class="hidden md:flex space-x-6">
                        <a href="/" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fas fa-comments mr-2"></i>回答生成
                        </a>
                        <a href="/templates" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fas fa-file-alt mr-2"></i>定型文
                        </a>
                        <a href="/instagram" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fab fa-instagram mr-2"></i>Instagram投稿
                        </a>
                        <a href="/blog" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fas fa-blog mr-2"></i>ブログ原稿
                        </a>
                        <a href="/staff-board" class="text-pink-500 font-semibold flex items-center">
                            <i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板
                        </a>
                        <a href="/admin" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fas fa-cog mr-2"></i>Q&A管理
                        </a>
                        <a href="/web-admin" class="text-gray-700 hover:text-pink-400 transition flex items-center">
                            <i class="fas fa-globe mr-2"></i>Web管理
                        </a>
                    </div>
                    
                    <!-- モバイルメニューボタン -->
                    <button id="mobileMenuBtn" class="md:hidden text-gray-700">
                        <i class="fas fa-bars text-2xl"></i>
                    </button>
                </div>
                
                <!-- モバイルメニュー -->
                <div id="mobileMenu" class="hidden md:hidden mt-4 space-y-2">
                    <a href="/" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fas fa-comments mr-2"></i>回答生成</a>
                    <a href="/templates" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fas fa-file-alt mr-2"></i>定型文</a>
                    <a href="/instagram" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fab fa-instagram mr-2"></i>Instagram投稿</a>
                    <a href="/blog" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fas fa-blog mr-2"></i>ブログ原稿</a>
                    <a href="/staff-board" class="block py-2 text-pink-500 font-semibold"><i class="fas fa-clipboard-list mr-2"></i>スタッフ連絡板</a>
                    <a href="/admin" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fas fa-cog mr-2"></i>Q&A管理</a>
                    <a href="/web-admin" class="block py-2 text-gray-700 hover:text-pink-400"><i class="fas fa-globe mr-2"></i>Web管理</a>
                </div>
            </nav>
        </header>

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
            // モバイルメニュートグル
            document.getElementById('mobileMenuBtn').addEventListener('click', function() {
                const menu = document.getElementById('mobileMenu');
                menu.classList.toggle('hidden');
            });
            
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
  const { OPENAI_API_KEY } = c.env;
  const { articleType, menu, title, keywords, mainPoints, tone } = await c.req.json();
  
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
  
  const menuData = MENU_DATA[menu];
  if (!menuData) {
    return c.json({ error: 'Invalid menu' }, 400);
  }
  
  // マカロニスタジオの強み
  const studioStrengths = `
【マカロニスタジオの強み】
・全データ納品：撮影した写真をすべてお渡し（100枚以上保証）
・衣装着放題：豊富な衣装から何着でも選べる
・家族写真込み：ご家族全員での記念撮影も含まれる
・プロの技術：子ども撮影に特化したカメラマンが対応
・リラックスできる空間：貸切スタジオで周りを気にせず撮影
・沖縄県那覇市：アクセス便利な立地
・リピーター割引：2回目以降はお得に撮影可能
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

【記事タイトル】
${title || `【那覇で人気】${menuData.name}って何？マカロニスタジオ完全ガイド`}

【撮影メニュー】
${menuData.name}：${menuData.description}

【SEOキーワード】
${keywords || menuData.name + ', フォトスタジオ, 沖縄, 那覇, 子ども写真, 記念撮影'}

【記事の要点】
${mainPoints || 'サービスの魅力とマカロニスタジオの特徴を紹介'}

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
    
  } else {
    // 撮影レポート
    prompt = `あなたは沖縄県那覇市の子ども専門フォトスタジオ「マカロニスタジオ」のブログライターです。
以下の内容でWix用の撮影レポート記事（プレーンテキスト）を作成してください。

【記事タイトル】
${title || `${menuData.name}撮影レポート`}

【撮影メニュー】
${menuData.name}

【撮影の様子・エピソード】
${mainPoints || '楽しく笑顔いっぱいの撮影でした'}

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
            content: 'あなたはプロのブログライターです。SEOを意識しつつ、読みやすく魅力的な記事を作成します。Wixにそのままコピペできるプレーンテキスト形式で出力してください。'
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
    const { staff_name, message_date, content, image_url } = await c.req.json();
    
    // バリデーション
    if (!staff_name || !message_date || !content) {
      return c.json({ error: 'スタッフ名、日付、内容は必須です' }, 400);
    }
    
    const result = await db.prepare(
      `INSERT INTO staff_messages (staff_name, message_date, content, image_url, is_completed)
       VALUES (?, ?, ?, ?, 0)`
    ).bind(staff_name, message_date, content, image_url || null).run();
    
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
    
    await db.prepare('DELETE FROM staff_messages WHERE id = ?').bind(id).run();
    
    return c.json({ 
      success: true,
      message: '連絡事項を削除しました'
    });
  } catch (error: any) {
    console.error('Failed to delete staff message:', error);
    return c.json({ error: 'Failed to delete message' }, 500);
  }
});

export default app;
