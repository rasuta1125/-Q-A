// LINE Official Account エクスポートデータ専用パーサー

console.log('line-parser.js loading...');

/**
 * LINE CSVデータからQ&Aを抽出
 * @param {string} csvText - CSVテキスト
 * @returns {Array} - 抽出されたQ&A配列
 */
window.parseLINECSV = function parseLINECSV(csvText) {
  console.log('parseLINECSV called, csvText length:', csvText.length);
  
  // Windows改行コード（\r\n）を統一
  const normalizedText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.split('\n');
  
  console.log('Total lines:', lines.length);
  
  const messages = [];
  let currentMessage = null;
  let inMultilineField = false;
  let fieldBuffer = '';
  
  // ヘッダー行を探す
  let dataStartIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('送信者タイプ,送信者名,送信日,送信時刻,内容')) {
      dataStartIndex = i + 1;
      break;
    }
  }
  
  // メッセージデータを解析
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    
    if (!line.trim()) continue;
    
    // 複数行フィールドの処理
    if (inMultilineField) {
      fieldBuffer += '\n' + line;
      
      // クォートが閉じられたか確認
      if (line.includes('"') && !line.endsWith(',')) {
        const parts = parseLINECSVLine(fieldBuffer);
        if (parts.length >= 5) {
          messages.push({
            senderType: parts[0],
            senderName: parts[1],
            date: parts[2],
            time: parts[3],
            content: parts[4].replace(/\r/g, '')
          });
        }
        inMultilineField = false;
        fieldBuffer = '';
      }
    } else {
      // 新しい行の開始
      if (line.startsWith('"') || line.match(/^(Account|User),/)) {
        fieldBuffer = line;
        
        // クォートで囲まれたフィールドがあるか
        const quoteCount = (line.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
          // 奇数個のクォート = 複数行フィールド
          inMultilineField = true;
        } else {
          // 完結した行
          const parts = parseLINECSVLine(line);
          if (parts.length >= 5) {
            messages.push({
              senderType: parts[0],
              senderName: parts[1],
              date: parts[2],
              time: parts[3],
              content: parts[4].replace(/\r/g, '')
            });
          }
        }
      }
    }
  }
  
  console.log('Parsed messages:', messages.length);
  
  // Q&Aペアを抽出
  const qaItems = extractQAPairs(messages);
  
  console.log('Extracted QA items:', qaItems.length);
  
  return qaItems;
}

/**
 * LINE CSV行をパース
 */
function parseLINECSVLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // エスケープされたクォート
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  parts.push(current);
  return parts;
}

/**
 * メッセージリストからQ&Aペアを抽出
 */
function extractQAPairs(messages) {
  console.log('extractQAPairs called, messages:', messages.length);
  
  const qaItems = [];
  const systemMessages = new Set([
    '写真を送信しました',
    'スタンプを送信しました',
    '動画を送信しました',
    'ボイスメッセージを送信しました'
  ]);
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // システムメッセージをスキップ
    if (systemMessages.has(msg.content.trim())) continue;
    
    // 個人名を含むメッセージをスキップ（プライバシー保護）
    if (isPrivateMessage(msg.content)) continue;
    
    // 予約フォームや営業メッセージをスキップ
    if (isFormOrPromotion(msg.content)) continue;
    
    // Account（店側）のメッセージから有用な情報を抽出
    if (msg.senderType === 'Account' || msg.senderName === '応答メッセージ') {
      // Q&A形式のコンテンツを抽出
      const embeddedQAs = extractEmbeddedQA(msg.content);
      qaItems.push(...embeddedQAs);
    }
    
    // User（顧客）とAccount（店側）のペアを探す
    if (msg.senderType === 'User' && i + 1 < messages.length) {
      const nextMsg = messages[i + 1];
      
      if ((nextMsg.senderType === 'Account' || nextMsg.senderName === '応答メッセージ') &&
          !systemMessages.has(nextMsg.content.trim()) &&
          !isFormOrPromotion(nextMsg.content)) {
        
        // 有効なQ&Aペア
        const question = cleanText(msg.content);
        const answer = cleanText(nextMsg.content);
        
        if (question.length > 5 && answer.length > 10) {
          qaItems.push({
            category: categorizeQuestion(question),
            question: question,
            answer: answer,
            keywords: extractKeywords(question, answer),
            priority: 2,
            is_active: 1,
            source: 'LINE'
          });
        }
      }
    }
  }
  
  console.log('Final QA items count:', qaItems.length);
  console.log('Sample QA items:', qaItems.slice(0, 3));
  
  return qaItems;
}

/**
 * 埋め込まれたQ&Aを抽出（よくある質問など）
 */
function extractEmbeddedQA(content) {
  const qaItems = [];
  const lines = content.split('\n');
  
  let currentQ = null;
  let currentA = null;
  
  console.log('extractEmbeddedQA: processing', lines.length, 'lines');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Q.で始まる行
    if (trimmed.match(/^Q[.．:：]\s*/)) {
      if (currentQ && currentA) {
        // 前のQ&Aを保存
        qaItems.push({
          category: categorizeQuestion(currentQ),
          question: currentQ,
          answer: currentA,
          keywords: extractKeywords(currentQ, currentA),
          priority: 1, // 埋め込みQ&Aは優先度高
          is_active: 1,
          source: 'LINE (FAQ)'
        });
      }
      currentQ = trimmed.replace(/^Q[.．:：]\s*/, '');
      currentA = null;
    }
    // A.で始まる行
    else if (trimmed.match(/^A[.．:：]\s*/)) {
      currentA = trimmed.replace(/^A[.．:：]\s*/, '');
    }
    // 継続行
    else if (currentA && trimmed && !trimmed.match(/^[QA][.．:：]/)) {
      currentA += '\n' + trimmed;
    }
  }
  
  // 最後のQ&A
  if (currentQ && currentA) {
    qaItems.push({
      category: categorizeQuestion(currentQ),
      question: currentQ,
      answer: currentA,
      keywords: extractKeywords(currentQ, currentA),
      priority: 1,
      is_active: 1,
      source: 'LINE (FAQ)'
    });
  }
  
  console.log('extractEmbeddedQA: found', qaItems.length, 'QA items');
  
  return qaItems;
}

/**
 * プライベートメッセージかどうか判定
 */
function isPrivateMessage(content) {
  // 個人名パターン（さん、様）
  if (content.match(/^[ぁ-んァ-ヶ一-龥]{2,10}(さん|様)/)) return true;
  
  // 電話番号
  if (content.match(/\d{2,4}-\d{2,4}-\d{4}/)) return true;
  
  // メールアドレス
  if (content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) return true;
  
  return false;
}

/**
 * フォームや営業メッセージかどうか判定
 */
function isFormOrPromotion(content) {
  const patterns = [
    /お子様の名前:/,
    /生年月日:/,
    /撮影希望日:/,
    /電話:/,
    /ご予約の際は/,
    /企画を担当/,
    /広告代理店/,
    /掲載料金/,
    /InRed/,
    /雑誌/
  ];
  
  return patterns.some(pattern => pattern.test(content));
}

/**
 * テキストをクリーンアップ
 */
function cleanText(text) {
  return text
    .replace(/\(.*?\)/g, '') // 絵文字コード除去
    .replace(/[😀-🙏🌀-🗿]/g, '') // 絵文字除去
    .replace(/\s+/g, ' ') // 複数空白を1つに
    .trim();
}

/**
 * 質問からカテゴリを推測
 */
function categorizeQuestion(question) {
  const categories = {
    '料金': ['料金', '価格', '金額', 'いくら', '値段', '費用', 'コスト'],
    '予約': ['予約', '予約方法', '申込', '空き'],
    '撮影時間': ['時間', '何時', '所要時間', 'どのくらい'],
    '定休日': ['定休日', '休み', '営業日', '営業時間'],
    '衣装': ['衣装', '着物', 'ドレス', '持ち込み', '服'],
    '七五三': ['七五三', '753', '着付け'],
    '撮影内容': ['撮影', 'メイン', '兄弟', '家族', '人数'],
    'データ': ['データ', '納品', '写真', '受け取り'],
    'その他': ['その他']
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => question.includes(keyword))) {
      return category;
    }
  }
  
  return 'その他';
}

/**
 * キーワードを抽出
 */
function extractKeywords(question, answer) {
  const keywords = new Set();
  const text = question + ' ' + answer;
  
  // 重要なキーワードパターン
  const patterns = [
    /料金|価格|金額|円/,
    /予約|申込/,
    /時間|何時/,
    /定休日|休み/,
    /衣装|着物|ドレス/,
    /七五三/,
    /撮影|写真/,
    /データ|納品/,
    /キャンセル|変更/,
    /駐車場|アクセス/
  ];
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      keywords.add(matches[0]);
    }
  });
  
  return Array.from(keywords).join(',');
}

// グローバルスコープに登録完了
console.log('line-parser.js loaded successfully. parseLINECSV available:', typeof window.parseLINECSV);
