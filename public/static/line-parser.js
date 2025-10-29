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
          !isFormOrPromotion(nextMsg.content) &&
          !isPrivateMessage(nextMsg.content)) {
        
        // 有効なQ&Aペア
        const question = cleanText(msg.content);
        const answer = cleanText(nextMsg.content);
        
        // より厳密な妥当性チェック
        if (isValidQAPair(question, answer)) {
          // 回答が長すぎる場合は切り詰める
          const trimmedAnswer = answer.length > 2000 ? answer.substring(0, 2000) + '...' : answer;
          
          qaItems.push({
            category: categorizeQuestion(question),
            question: question,
            answer: trimmedAnswer,
            keywords: extractKeywords(question, trimmedAnswer),
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
    
    // 空行はスキップ
    if (!trimmed) continue;
    
    // Q.で始まる行（様々なバリエーションに対応）
    // Q. Q: Q） Q】【Q】などに対応
    if (trimmed.match(/^[Q�Qq][.．:：）】\]]\s*/) || trimmed.match(/^【[Qq]】\s*/)) {
      // 前のQ&Aペアを保存
      if (currentQ && currentA) {
        const cleanQ = cleanText(currentQ);
        const cleanA = cleanText(currentA);
        
        // 質問と回答の妥当性チェック
        if (isValidQAPair(cleanQ, cleanA)) {
          qaItems.push({
            category: categorizeQuestion(cleanQ),
            question: cleanQ,
            answer: cleanA,
            keywords: extractKeywords(cleanQ, cleanA),
            priority: 1, // 埋め込みQ&Aは優先度高
            is_active: 1,
            source: 'LINE (FAQ)'
          });
        }
      }
      
      // 新しい質問を開始
      currentQ = trimmed.replace(/^[Q�Qq][.．:：）】\]]\s*/, '').replace(/^【[Qq]】\s*/, '');
      currentA = null;
    }
    // A.で始まる行（様々なバリエーションに対応）
    // A. A: A） A】【A】などに対応
    else if (trimmed.match(/^[A�Aa][.．:：）】\]]\s*/) || trimmed.match(/^【[Aa]】\s*/)) {
      currentA = trimmed.replace(/^[A�Aa][.．:：）】\]]\s*/, '').replace(/^【[Aa]】\s*/, '');
    }
    // 継続行の処理
    else if (trimmed && !trimmed.match(/^[QA�Qq�Aa][.．:：）】\]]/)) {
      if (currentA !== null) {
        // 回答の継続
        currentA += '\n' + trimmed;
      } else if (currentQ !== null) {
        // 質問の継続（Q.の後にA.がない場合）
        currentQ += '\n' + trimmed;
      }
    }
  }
  
  // 最後のQ&Aペアを保存
  if (currentQ && currentA) {
    const cleanQ = cleanText(currentQ);
    const cleanA = cleanText(currentA);
    
    if (isValidQAPair(cleanQ, cleanA)) {
      qaItems.push({
        category: categorizeQuestion(cleanQ),
        question: cleanQ,
        answer: cleanA,
        keywords: extractKeywords(cleanQ, cleanA),
        priority: 1,
        is_active: 1,
        source: 'LINE (FAQ)'
      });
    }
  }
  
  console.log('extractEmbeddedQA: found', qaItems.length, 'QA items');
  if (qaItems.length > 0) {
    console.log('Sample extracted QA:', qaItems[0]);
  }
  
  return qaItems;
}

/**
 * Q&Aペアが有効かどうかをチェック
 */
function isValidQAPair(question, answer) {
  // 質問が短すぎる（5文字未満）
  if (question.length < 5) {
    console.log('Question too short:', question);
    return false;
  }
  
  // 回答が短すぎる（10文字未満）
  if (answer.length < 10) {
    console.log('Answer too short:', answer);
    return false;
  }
  
  // 質問が長すぎる（200文字以上はおかしい）
  if (question.length > 200) {
    console.log('Question too long:', question.substring(0, 50) + '...');
    return false;
  }
  
  // 回答が長すぎる（2000文字以上は切り詰め）
  if (answer.length > 2000) {
    console.log('Answer too long, will be trimmed');
    // 長すぎる回答は切り詰めるが、有効とみなす
  }
  
  // 質問が疑問形でない場合は警告（ただし除外はしない）
  if (!question.match(/[?？]/) && 
      !question.match(/ですか$/) && 
      !question.match(/ますか$/) && 
      !question.match(/でしょうか$/) &&
      !question.match(/いつ|どこ|だれ|何|なに|なん|どの|どう|いくら/)) {
    console.log('Question may not be interrogative:', question);
    // 疑問形でなくても有効とみなす（「〜について」などのケースもあるため）
  }
  
  return true;
}

/**
 * プライベートメッセージかどうか判定
 */
function isPrivateMessage(content) {
  // 個人名パターン（さん、様、ちゃん、くん）
  if (content.match(/^[ぁ-んァ-ヶ一-龥]{2,10}(さん|様|ちゃん|くん)/)) return true;
  
  // 電話番号（様々な形式に対応）
  if (content.match(/\d{2,4}[-\s()]\d{2,4}[-\s()]\d{4}/)) return true;
  if (content.match(/(?:電話|TEL|tel|Tel)[:：\s]*\d{10,11}/)) return true;
  
  // メールアドレス
  if (content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)) return true;
  
  // 住所パターン
  if (content.match(/[都道府県][市区町村]/)) return true;
  
  // 個人的な挨拶や感謝のみのメッセージ
  if (content.match(/^(ありがとうございます|ありがとうございました|了解です|承知しました|よろしくお願いします)$/)) return true;
  
  return false;
}

/**
 * フォームや営業メッセージかどうか判定
 */
function isFormOrPromotion(content) {
  const patterns = [
    /お子様の名前[:：]/,
    /お名前[:：]/,
    /生年月日[:：]/,
    /撮影希望日[:：]/,
    /電話[:：]/,
    /メールアドレス[:：]/,
    /ご予約の際は/,
    /企画を担当/,
    /広告代理店/,
    /掲載料金/,
    /InRed/,
    /雑誌/,
    /キャンペーン/,
    /プレゼント/,
    /フォーム/,
    /ご入力/,
    /必須項目/,
    /お問い合わせ番号/,
    /以下の内容/,
    /【重要】/,
    /＜重要＞/,
    /※注意/,
    /■/,  // フォーム風の記号
    /▼/,
    /★/
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
    '料金・七五三': ['七五三', '753', '着付け', '七五三 料金'],
    '料金・スマッシュケーキ': ['スマッシュケーキ', 'スマッシュ', 'ケーキ'],
    '料金・ミルクバス': ['ミルクバス', 'ミルク'],
    '料金': ['料金', '価格', '金額', 'いくら', '値段', '費用', 'コスト', '円', '割引', '支払'],
    '予約方法': ['予約', '予約方法', '申込', '空き', '予約できます', 'どうやって予約'],
    '所要時間': ['所要時間', 'どのくらい', 'かかります', '時間'],
    '対象年齢': ['年齢', '何歳', '赤ちゃん', '子供', '対象'],
    '定休日': ['定休日', '休み', '営業日', '営業時間', '何曜日', 'いつやって'],
    '衣装': ['衣装', '着物', 'ドレス', '持ち込み', '服', '着替え'],
    '撮影内容': ['撮影', 'メイン', '兄弟', '家族', '人数', '撮れます', 'ポーズ'],
    '納品': ['納品', '受け取り', 'いつ届く', 'データ', '写真'],
    'レタッチ': ['レタッチ', '修正', '加工', '編集'],
    'キャンセル': ['キャンセル', 'キャンセル料', '取り消し'],
    '日程変更': ['変更', '日程変更', '時間変更', '予約変更'],
    '駐車場': ['駐車場', '駐車', '車', 'パーキング'],
    '持ち物': ['持ち物', '持って', '必要なもの', '用意'],
    '家族撮影': ['家族', '両親', 'パパ', 'ママ', '祖父母', '兄弟'],
    'その他': ['その他']
  };
  
  // 優先順位付きでマッチング（より具体的なカテゴリを優先）
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
  
  // 重要なキーワードパターン（より詳細に）
  const patterns = [
    { regex: /料金|価格|金額|円|費用|コスト|割引|支払/, keyword: '料金' },
    { regex: /七五三|753|着付け/, keyword: '七五三' },
    { regex: /スマッシュケーキ|スマッシュ|ケーキ/, keyword: 'スマッシュケーキ' },
    { regex: /ミルクバス|ミルク/, keyword: 'ミルクバス' },
    { regex: /予約|申込|空き/, keyword: '予約' },
    { regex: /時間|何時|所要時間/, keyword: '時間' },
    { regex: /定休日|休み|営業/, keyword: '定休日' },
    { regex: /衣装|着物|ドレス|服/, keyword: '衣装' },
    { regex: /撮影|写真|フォト/, keyword: '撮影' },
    { regex: /データ|納品|受け取り/, keyword: 'データ' },
    { regex: /キャンセル|取り消し/, keyword: 'キャンセル' },
    { regex: /変更|日程変更/, keyword: '変更' },
    { regex: /駐車場|駐車|パーキング/, keyword: '駐車場' },
    { regex: /持ち物|用意|必要/, keyword: '持ち物' },
    { regex: /家族|両親|兄弟/, keyword: '家族' },
    { regex: /年齢|何歳|対象/, keyword: '年齢' },
    { regex: /レタッチ|修正|加工/, keyword: 'レタッチ' }
  ];
  
  patterns.forEach(({ regex, keyword }) => {
    if (regex.test(text)) {
      keywords.add(keyword);
    }
  });
  
  // キーワードが1つもない場合は「一般」を追加
  if (keywords.size === 0) {
    keywords.add('一般');
  }
  
  return Array.from(keywords).join(',');
}

// グローバルスコープに登録完了
console.log('line-parser.js loaded successfully. parseLINECSV available:', typeof window.parseLINECSV);
