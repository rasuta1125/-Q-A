import type { OpenAIEmbeddingResponse, OpenAIChatResponse } from './types';

/**
 * OpenAI APIを使用してテキストの埋め込みベクトルを生成
 */
export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data: OpenAIEmbeddingResponse = await response.json();
  return data.data[0].embedding;
}

/**
 * OpenAI APIを使用して回答を生成
 */
export async function generateAnswer(
  query: string,
  context: string,
  tone: 'polite' | 'casual' | 'brief',
  apiKey: string
): Promise<string> {
  const systemPrompts = {
    polite: `あなたはマカロニスタジオのカスタマーサポート担当です。以下のガイドラインに従って回答してください：

- やさしい敬語で「です・ます」調を使用
- 回答は箇条書きで整理し、読みやすく構成
- 注意点や次のアクションも含める
- 固い定型文（「承知致しました」等）は避ける
- 数値や日時は具体的に記載
- 絵文字は使用しない
- 情報が不足している場合は正直に伝える`,

    casual: `あなたはマカロニスタジオのフレンドリーなスタッフです。以下のガイドラインに従って回答してください：

- 親しみやすい「です・ます」調
- 適度にカジュアルな表現を使用
- 回答は簡潔に、要点をまとめる
- 絵文字は控えめに（😊程度）
- 数値や日時は具体的に記載`,

    brief: `あなたはマカロニスタジオのサポート担当です。コピペ用の簡潔な回答を作成してください：

- 最も重要な情報のみを記載
- 簡潔に2-3文で完結
- 余計な説明は省く
- 「です・ます」調
- 絵文字なし`,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompts[tone],
        },
        {
          role: 'user',
          content: `以下の情報を基に、お客様の問い合わせに回答してください。

【お客様の問い合わせ】
${query}

【参考情報】
${context}

上記の情報を基に、適切な回答を生成してください。情報が不足している場合は、確認が必要な旨を伝えてください。`,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data: OpenAIChatResponse = await response.json();
  return data.choices[0].message.content;
}

/**
 * 信頼度を判定
 */
export function calculateConfidence(scores: number[]): 'A' | 'B' | 'C' {
  if (scores.length === 0) return 'C';

  const topScore = scores[0];
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  // スコアリング基準
  if (topScore > 0.85 && avgScore > 0.75) {
    return 'A'; // 十分な根拠あり
  } else if (topScore > 0.70 && avgScore > 0.60) {
    return 'B'; // 要注意
  } else {
    return 'C'; // 情報不足
  }
}

/**
 * エスカレーション用のメモを生成
 */
export function getEscalationNote(confidence: 'A' | 'B' | 'C'): string | undefined {
  const notes = {
    A: undefined,
    B: '⚠️ 参考情報の信頼度が中程度です。念のため最新情報を社内で確認してから返信してください。',
    C: '❌ 十分な情報が見つかりませんでした。以下の点を確認してください：\n• 該当するQ&Aデータが登録されているか\n• 問い合わせ内容が対応可能な範囲か\n• 社内の担当者に直接確認が必要か',
  };

  return notes[confidence];
}
