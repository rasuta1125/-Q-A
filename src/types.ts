// Cloudflare Bindings型定義
export type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  OPENAI_API_KEY: string;
}

// Q&Aアイテム型
export interface QAItem {
  id?: number;
  category: string;
  question: string;
  answer: string;
  keywords?: string;
  priority?: number;
  is_active?: number;
  last_updated?: string;
  created_at?: string;
}

// 検索結果型
export interface SearchResult {
  qa_item: QAItem;
  score: number;
  source_type: 'qa' | 'web';
}

// 回答生成結果型
export interface GeneratedAnswer {
  answer: string;
  sources: SourceReference[];
  confidence: 'A' | 'B' | 'C';
  escalation_note?: string;
  tone: 'polite' | 'casual' | 'brief';
}

// ソース参照型
export interface SourceReference {
  type: 'qa' | 'web';
  title: string;
  excerpt: string;
  url?: string;
  last_updated?: string;
  score: number;
}

// OpenAI埋め込みレスポンス型
export interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// OpenAIチャット完了レスポンス型
export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
