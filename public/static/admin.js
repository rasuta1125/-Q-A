// Q&A管理画面のJavaScript

// スクリプト読み込み確認
console.log('admin.js loaded');

const qaList = document.getElementById('qaList');
const addBtn = document.getElementById('addBtn');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const cancelBtn = document.getElementById('cancelBtn');
const qaForm = document.getElementById('qaForm');
const modalTitle = document.getElementById('modalTitle');

// 一括インポート関連の要素
const bulkImportBtn = document.getElementById('bulkImportBtn');
const bulkImportModal = document.getElementById('bulkImportModal');
const closeBulkImport = document.getElementById('closeBulkImport');
const cancelBulkImport = document.getElementById('cancelBulkImport');
const bulkImportText = document.getElementById('bulkImportText');
const parseDataBtn = document.getElementById('parseDataBtn');
const previewArea = document.getElementById('previewArea');
const previewList = document.getElementById('previewList');
const previewCount = document.getElementById('previewCount');
const executeBulkImport = document.getElementById('executeBulkImport');

let currentQAId = null;
let parsedQAData = [];

// 初期化
loadQAItems();

// Q&A一覧読み込み
async function loadQAItems() {
  try {
    const response = await axios.get('/api/qa');
    const items = response.data;

    if (items.length === 0) {
      qaList.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-4"></i>
          <p>Q&Aがまだ登録されていません</p>
          <p class="text-sm">「新規追加」ボタンから追加してください</p>
        </div>
      `;
      return;
    }

    qaList.innerHTML = items.map(item => {
      const statusColor = item.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
      const statusText = item.is_active ? '有効' : '無効';
      const priorityText = { 1: '高', 2: '中', 3: '低' }[item.priority] || '中';
      const priorityColor = { 1: 'text-red-600', 2: 'text-yellow-600', 3: 'text-gray-600' }[item.priority] || 'text-yellow-600';

      return `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition duration-200">
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center space-x-2">
              <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                ${item.category}
              </span>
              <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${statusColor}">
                ${statusText}
              </span>
              <span class="text-xs ${priorityColor} font-semibold">
                <i class="fas fa-flag mr-1"></i>優先度: ${priorityText}
              </span>
            </div>
            <div class="flex space-x-2">
              <button onclick="editQA(${item.id})" class="text-blue-500 hover:text-blue-700">
                <i class="fas fa-edit"></i>
              </button>
              <button onclick="deleteQA(${item.id})" class="text-red-500 hover:text-red-700">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          
          <h4 class="font-semibold text-gray-900 mb-2">Q: ${item.question}</h4>
          <p class="text-sm text-gray-600 mb-2">${item.answer.substring(0, 150)}${item.answer.length > 150 ? '...' : ''}</p>
          
          ${item.keywords ? `
            <div class="flex flex-wrap gap-1 mt-2">
              ${item.keywords.split(',').map(kw => `
                <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  ${kw.trim()}
                </span>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="text-xs text-gray-400 mt-2">
            最終更新: ${new Date(item.last_updated).toLocaleDateString('ja-JP')}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading QA items:', error);
    qaList.innerHTML = '<p class="text-red-500">データの読み込みに失敗しました</p>';
  }
}

// 新規追加ボタン
addBtn.addEventListener('click', () => {
  currentQAId = null;
  modalTitle.textContent = 'Q&A追加';
  qaForm.reset();
  modal.classList.remove('hidden');
});

// モーダルを閉じる
closeModal.addEventListener('click', () => {
  modal.classList.add('hidden');
});

cancelBtn.addEventListener('click', () => {
  modal.classList.add('hidden');
});

// フォーム送信
qaForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = {
    category: document.getElementById('category').value,
    question: document.getElementById('question').value,
    answer: document.getElementById('answer').value,
    keywords: document.getElementById('keywords').value,
    priority: parseInt(document.getElementById('priority').value),
    is_active: document.getElementById('isActive').checked ? 1 : 0,
  };

  try {
    if (currentQAId) {
      // 更新
      await axios.put(`/api/qa/${currentQAId}`, data);
    } else {
      // 新規作成
      await axios.post('/api/qa', data);
    }

    modal.classList.add('hidden');
    loadQAItems();
  } catch (error) {
    console.error('Error saving QA:', error);
    alert('保存に失敗しました: ' + (error.response?.data?.error || error.message));
  }
});

// 編集
window.editQA = async (id) => {
  try {
    const response = await axios.get('/api/qa');
    const item = response.data.find(qa => qa.id === id);
    
    if (!item) {
      alert('Q&Aが見つかりません');
      return;
    }

    currentQAId = id;
    modalTitle.textContent = 'Q&A編集';
    
    document.getElementById('category').value = item.category;
    document.getElementById('question').value = item.question;
    document.getElementById('answer').value = item.answer;
    document.getElementById('keywords').value = item.keywords || '';
    document.getElementById('priority').value = item.priority;
    document.getElementById('isActive').checked = item.is_active === 1;
    
    modal.classList.remove('hidden');
  } catch (error) {
    console.error('Error loading QA:', error);
    alert('データの読み込みに失敗しました');
  }
};

// 削除
window.deleteQA = async (id) => {
  if (!confirm('このQ&Aを削除してもよろしいですか？')) {
    return;
  }

  try {
    await axios.delete(`/api/qa/${id}`);
    loadQAItems();
  } catch (error) {
    console.error('Error deleting QA:', error);
    alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
  }
};

// ========== 一括インポート機能 ==========

// ========== CSVインポート機能 ==========

// CSV関連の要素
const csvImportBtn = document.getElementById('csvImportBtn');
const csvImportModal = document.getElementById('csvImportModal');
const closeCsvImport = document.getElementById('closeCsvImport');
const cancelCsvImport = document.getElementById('cancelCsvImport');
const csvFileInput = document.getElementById('csvFileInput');
const parseCsvBtn = document.getElementById('parseCsvBtn');
const csvStep1 = document.getElementById('csvStep1');
const csvStep2 = document.getElementById('csvStep2');
const duplicateGroups = document.getElementById('duplicateGroups');
const uniqueList = document.getElementById('uniqueList');
const duplicateCount = document.getElementById('duplicateCount');
const uniqueCount = document.getElementById('uniqueCount');
const finalCount = document.getElementById('finalCount');
const executeCsvImport = document.getElementById('executeCsvImport');

let csvParsedData = [];
let csvDuplicateGroups = [];
let csvUniqueItems = [];
let csvSelectedItems = [];

// CSVインポートモーダルを開く
csvImportBtn.addEventListener('click', () => {
  csvFileInput.value = '';
  csvStep1.classList.remove('hidden');
  csvStep2.classList.add('hidden');
  csvParsedData = [];
  csvDuplicateGroups = [];
  csvUniqueItems = [];
  csvSelectedItems = [];
  csvImportModal.classList.remove('hidden');
});

// CSVインポートモーダルを閉じる
closeCsvImport.addEventListener('click', () => {
  csvImportModal.classList.add('hidden');
});

cancelCsvImport.addEventListener('click', () => {
  csvImportModal.classList.add('hidden');
});

// CSVを読み込んで重複チェック
parseCsvBtn.addEventListener('click', async () => {
  const file = csvFileInput.files[0];
  
  if (!file) {
    alert('CSVファイルを選択してください');
    return;
  }

  try {
    const text = await file.text();
    console.log('File read successfully, length:', text.length);
    
    // parseCSV関数を呼び出す前に少し待つ（スクリプト読み込み確保）
    await new Promise(resolve => setTimeout(resolve, 100));
    
    csvParsedData = parseCSV(text);
    
    if (csvParsedData.length === 0) {
      alert('有効なデータが見つかりませんでした。ファイル形式を確認してください。');
      return;
    }

    // 重複検出
    detectDuplicates(csvParsedData);
    
    // ステップ2を表示
    csvStep1.classList.add('hidden');
    csvStep2.classList.remove('hidden');
    
    // 重複グループ表示
    displayDuplicateGroups();
    displayUniqueItems();
    updateFinalCount();
    
  } catch (error) {
    console.error('CSV parse error:', error);
    alert('CSVの読み込みに失敗しました: ' + error.message + '\n\nブラウザのコンソール（F12）で詳細を確認してください。');
  }
});

// CSV解析関数（LINEフォーマット自動検出）
function parseCSV(text) {
  console.log('parseCSV called, text length:', text.length);
  console.log('First 200 chars:', text.substring(0, 200));
  console.log('typeof parseLINECSV:', typeof parseLINECSV);
  console.log('window.parseLINECSV:', typeof window.parseLINECSV);
  console.log('Available window functions:', Object.keys(window).filter(k => k.toLowerCase().includes('parse')));
  
  // LINE Official Account形式かチェック
  if (text.includes('送信者タイプ,送信者名,送信日,送信時刻,内容')) {
    console.log('LINE Official Account形式を検出しました');
    
    // parseLINECSV関数が存在するかチェック（複数の方法で確認）
    let parseFunc = null;
    
    // 方法1: window.parseLINECSV
    if (typeof window.parseLINECSV === 'function') {
      parseFunc = window.parseLINECSV;
      console.log('Found parseLINECSV via window.parseLINECSV');
    }
    // 方法2: グローバルスコープ
    else if (typeof parseLINECSV === 'function') {
      parseFunc = parseLINECSV;
      console.log('Found parseLINECSV via global scope');
    }
    // 方法3: window['parseLINECSV']
    else if (window['parseLINECSV'] && typeof window['parseLINECSV'] === 'function') {
      parseFunc = window['parseLINECSV'];
      console.log('Found parseLINECSV via window["parseLINECSV"]');
    }
    
    if (!parseFunc) {
      console.error('❌ parseLINECSV関数が見つかりません！');
      console.error('line-parser.jsが正しく読み込まれているか確認してください');
      console.error('利用可能なwindowプロパティ:', Object.keys(window).slice(0, 50));
      
      // より詳細なエラーメッセージ
      const errorMsg = 
        'エラー: LINE解析機能が読み込まれていません。\n\n' +
        '以下を試してください:\n' +
        '1. ページを強制再読み込み（Ctrl+Shift+R / Cmd+Shift+R）\n' +
        '2. ブラウザのキャッシュをクリア\n' +
        '3. 別のブラウザで試す\n\n' +
        '問題が続く場合は開発者に連絡してください。';
      
      alert(errorMsg);
      return [];
    }
    
    try {
      console.log('✅ Calling parseLINECSV...');
      const result = parseFunc(text);
      console.log('✅ LINEパース成功:', result.length, '件');
      if (result.length > 0) {
        console.log('Sample result:', result[0]);
      }
      return result;
    } catch (error) {
      console.error('❌ LINEパースエラー:', error);
      console.error('Error stack:', error.stack);
      alert('LINE形式の解析に失敗しました: ' + error.message + '\n\nブラウザのコンソール（F12）で詳細を確認してください。');
      return [];
    }
  }
  
  // 通常のCSV形式
  console.log('通常のCSV形式として処理します');
  const items = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  
  // ヘッダー行をスキップ（最初の行が「カテゴリ」で始まる場合）
  let startIndex = 0;
  if (lines.length > 0 && lines[0].includes('カテゴリ')) {
    startIndex = 1;
  }
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // カンマで分割（クォートを考慮）
    const parts = parseCSVLine(line);
    
    if (parts.length < 3) continue; // 最低でもカテゴリ、質問、回答が必要
    
    const category = parts[0].trim();
    const question = parts[1].trim();
    const answer = parts[2].trim();
    const keywords = parts.length > 3 ? parts[3].trim() : '';
    
    if (category && question && answer) {
      items.push({
        category,
        question,
        answer,
        keywords,
        priority: 2,
        is_active: 1,
        originalIndex: i
      });
    }
  }
  
  return items;
}

// CSV行をパース（クォート対応）
function parseCSVLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  parts.push(current);
  return parts.map(p => p.replace(/^"|"$/g, '').trim());
}

// 重複検出関数
function detectDuplicates(items) {
  csvDuplicateGroups = [];
  csvUniqueItems = [];
  const processed = new Set();
  
  for (let i = 0; i < items.length; i++) {
    if (processed.has(i)) continue;
    
    const item = items[i];
    item.checked = true; // デフォルトで選択状態
    const duplicates = [item];
    
    // 他のアイテムと比較
    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(j)) continue;
      
      const otherItem = items[j];
      
      // 質問の類似度チェック
      if (isSimilarQuestion(item.question, otherItem.question)) {
        otherItem.checked = false; // 重複は初期状態で未選択
        duplicates.push(otherItem);
        processed.add(j);
      }
    }
    
    processed.add(i);
    
    if (duplicates.length > 1) {
      // 重複グループ
      csvDuplicateGroups.push({
        items: duplicates,
        selectedIndex: 0 // デフォルトで最初を選択（互換性維持）
      });
    } else {
      // ユニーク（デフォルトで選択）
      item.checked = true;
      csvUniqueItems.push(item);
    }
  }
  
  duplicateCount.textContent = csvDuplicateGroups.length;
  uniqueCount.textContent = csvUniqueItems.length;
}

// 質問の類似度判定
function isSimilarQuestion(q1, q2) {
  // 正規化（小文字化、空白除去、句読点除去）
  const normalize = (str) => str.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[、。！？,.!?]/g, '');
  
  const nq1 = normalize(q1);
  const nq2 = normalize(q2);
  
  // 完全一致
  if (nq1 === nq2) return true;
  
  // 一方が他方を含む（80%以上）
  const shorter = nq1.length < nq2.length ? nq1 : nq2;
  const longer = nq1.length < nq2.length ? nq2 : nq1;
  
  if (longer.includes(shorter) && shorter.length / longer.length > 0.8) {
    return true;
  }
  
  // 編集距離による類似度判定（簡易版）
  const similarity = calculateSimilarity(nq1, nq2);
  return similarity > 0.85; // 85%以上類似していれば重複とみなす
}

// 簡易類似度計算（Levenshtein距離ベース）
function calculateSimilarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

// Levenshtein距離
function levenshteinDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

// 重複グループを表示
function displayDuplicateGroups() {
  if (csvDuplicateGroups.length === 0) {
    duplicateGroups.innerHTML = '<p class="text-gray-500 text-center py-4">重複は検出されませんでした</p>';
    return;
  }
  
  duplicateGroups.innerHTML = csvDuplicateGroups.map((group, groupIndex) => `
    <div class="border border-yellow-300 rounded-lg p-4 bg-yellow-50">
      <div class="flex items-center justify-between mb-3">
        <h5 class="font-semibold text-gray-900">
          <i class="fas fa-copy text-yellow-600 mr-2"></i>
          重複グループ ${groupIndex + 1}（${group.items.length}件）
        </h5>
        <div class="space-x-2">
          <button 
            onclick="selectAllInGroup(${groupIndex})"
            class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
          >
            <i class="fas fa-check-double mr-1"></i>全選択
          </button>
          <button 
            onclick="deselectAllInGroup(${groupIndex})"
            class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            <i class="fas fa-times mr-1"></i>全解除
          </button>
        </div>
      </div>
      <div class="space-y-2">
        ${group.items.map((item, itemIndex) => `
          <label class="flex items-start p-3 border rounded cursor-pointer hover:bg-white transition ${item.checked ? 'bg-white border-green-500 ring-2 ring-green-200' : 'bg-gray-50 border-gray-300'}">
            <input 
              type="checkbox" 
              ${item.checked ? 'checked' : ''}
              onchange="toggleDuplicateItem(${groupIndex}, ${itemIndex})"
              class="mt-1 mr-3 w-4 h-4"
            />
            <div class="flex-1">
              <div class="flex items-center mb-1">
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 mr-2">
                  ${escapeHtml(item.category)}
                </span>
                ${item.checked ? '<span class="text-xs text-green-600 font-semibold"><i class="fas fa-check-circle mr-1"></i>選択中</span>' : '<span class="text-xs text-gray-500">未選択</span>'}
              </div>
              <p class="text-sm font-semibold text-gray-900 mb-1">Q: ${escapeHtml(item.question)}</p>
              <p class="text-xs text-gray-600">${escapeHtml(item.answer.substring(0, 100))}${item.answer.length > 100 ? '...' : ''}</p>
            </div>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// 重複グループのアイテムを選択/解除
window.toggleDuplicateItem = (groupIndex, itemIndex) => {
  csvDuplicateGroups[groupIndex].items[itemIndex].checked = !csvDuplicateGroups[groupIndex].items[itemIndex].checked;
  displayDuplicateGroups();
  updateFinalCount();
};

// 重複グループ内の全選択
window.selectAllInGroup = (groupIndex) => {
  csvDuplicateGroups[groupIndex].items.forEach(item => item.checked = true);
  displayDuplicateGroups();
  updateFinalCount();
};

// 重複グループ内の全解除
window.deselectAllInGroup = (groupIndex) => {
  csvDuplicateGroups[groupIndex].items.forEach(item => item.checked = false);
  displayDuplicateGroups();
  updateFinalCount();
};

// ユニークアイテムを表示
function displayUniqueItems() {
  if (csvUniqueItems.length === 0) {
    uniqueList.innerHTML = '<p class="text-gray-500 text-center py-4">ユニークなアイテムはありません</p>';
    return;
  }
  
  // 全選択/全解除ボタン
  const headerHtml = `
    <div class="flex items-center justify-between mb-3 pb-2 border-b">
      <h5 class="font-semibold text-gray-900">
        <i class="fas fa-star text-blue-600 mr-2"></i>
        ユニークなQ&A（${csvUniqueItems.length}件）
      </h5>
      <div class="space-x-2">
        <button 
          onclick="selectAllUnique()"
          class="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
        >
          <i class="fas fa-check-double mr-1"></i>全選択
        </button>
        <button 
          onclick="deselectAllUnique()"
          class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          <i class="fas fa-times mr-1"></i>全解除
        </button>
      </div>
    </div>
  `;
  
  uniqueList.innerHTML = headerHtml + csvUniqueItems.map((item, index) => `
    <label class="flex items-start bg-white border rounded-lg p-3 mb-2 cursor-pointer hover:border-blue-300 transition ${item.checked ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}">
      <input 
        type="checkbox" 
        ${item.checked ? 'checked' : ''}
        onchange="toggleUniqueItem(${index})"
        class="mt-1 mr-3 w-4 h-4"
      />
      <div class="flex-1">
        <div class="flex items-center mb-1">
          <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 mr-2">
            ${escapeHtml(item.category)}
          </span>
          <span class="text-xs text-gray-500">#${index + 1}</span>
          ${item.checked ? '<span class="text-xs text-green-600 font-semibold ml-2"><i class="fas fa-check-circle mr-1"></i>選択中</span>' : ''}
        </div>
        <p class="text-sm font-semibold text-gray-900 mb-1">Q: ${escapeHtml(item.question)}</p>
        <p class="text-xs text-gray-600">${escapeHtml(item.answer.substring(0, 80))}${item.answer.length > 80 ? '...' : ''}</p>
      </div>
    </label>
  `).join('');
}

// ユニークアイテムを選択/解除
window.toggleUniqueItem = (index) => {
  csvUniqueItems[index].checked = !csvUniqueItems[index].checked;
  displayUniqueItems();
  updateFinalCount();
};

// ユニークアイテムの全選択
window.selectAllUnique = () => {
  csvUniqueItems.forEach(item => item.checked = true);
  displayUniqueItems();
  updateFinalCount();
};

// ユニークアイテムの全解除
window.deselectAllUnique = () => {
  csvUniqueItems.forEach(item => item.checked = false);
  displayUniqueItems();
  updateFinalCount();
};

// 全体の全選択
window.selectAllItems = () => {
  // 重複グループのすべてのアイテムを選択
  csvDuplicateGroups.forEach(group => {
    group.items.forEach(item => item.checked = true);
  });
  
  // ユニークアイテムをすべて選択
  csvUniqueItems.forEach(item => item.checked = true);
  
  // 表示を更新
  displayDuplicateGroups();
  displayUniqueItems();
  updateFinalCount();
  
  console.log('✅ すべてのアイテムを選択しました');
};

// 全体の全解除
window.deselectAllItems = () => {
  // 重複グループのすべてのアイテムを解除
  csvDuplicateGroups.forEach(group => {
    group.items.forEach(item => item.checked = false);
  });
  
  // ユニークアイテムをすべて解除
  csvUniqueItems.forEach(item => item.checked = false);
  
  // 表示を更新
  displayDuplicateGroups();
  displayUniqueItems();
  updateFinalCount();
  
  console.log('❌ すべてのアイテムの選択を解除しました');
};

// 最終件数を更新
function updateFinalCount() {
  // 重複グループから選択されているアイテムを取得
  const selectedFromDuplicates = csvDuplicateGroups.flatMap(g => 
    g.items.filter(item => item.checked)
  );
  
  // ユニークアイテムから選択されているものを取得
  const selectedUnique = csvUniqueItems.filter(item => item.checked);
  
  // 全選択アイテムを結合
  csvSelectedItems = [...selectedUnique, ...selectedFromDuplicates];
  
  // 件数を表示
  finalCount.textContent = csvSelectedItems.length;
  
  // 選択状況のログ
  console.log('選択状況:', {
    重複グループから: selectedFromDuplicates.length,
    ユニークから: selectedUnique.length,
    合計: csvSelectedItems.length
  });
}

// CSVインポートを実行
executeCsvImport.addEventListener('click', async () => {
  if (csvSelectedItems.length === 0) {
    alert('インポートするデータがありません');
    return;
  }

  if (!confirm(`${csvSelectedItems.length}件のQ&Aをインポートします。よろしいですか？`)) {
    return;
  }

  try {
    const response = await axios.post('/api/qa/bulk-import', {
      items: csvSelectedItems
    });

    alert(`${response.data.inserted}件のQ&Aをインポートしました！`);
    csvImportModal.classList.add('hidden');
    loadQAItems();
  } catch (error) {
    console.error('CSV import error:', error);
    alert('CSVインポートに失敗しました: ' + (error.response?.data?.error || error.message));
  }
});

// 一括インポートモーダルを開く
bulkImportBtn.addEventListener('click', () => {
  bulkImportText.value = '';
  previewArea.classList.add('hidden');
  parsedQAData = [];
  bulkImportModal.classList.remove('hidden');
});

// 一括インポートモーダルを閉じる
closeBulkImport.addEventListener('click', () => {
  bulkImportModal.classList.add('hidden');
});

cancelBulkImport.addEventListener('click', () => {
  bulkImportModal.classList.add('hidden');
});

// テキストデータを解析してプレビュー表示
parseDataBtn.addEventListener('click', () => {
  const text = bulkImportText.value.trim();
  
  if (!text) {
    alert('データを入力してください');
    return;
  }

  try {
    parsedQAData = parseQAText(text);
    
    if (parsedQAData.length === 0) {
      alert('有効なデータが見つかりませんでした');
      return;
    }

    displayPreview(parsedQAData);
    previewArea.classList.remove('hidden');
  } catch (error) {
    console.error('Parse error:', error);
    alert('データの解析に失敗しました: ' + error.message);
  }
});

// テキストをパースしてQ&Aデータ配列を生成
function parseQAText(text) {
  const items = [];
  const blocks = text.split('---').map(b => b.trim()).filter(b => b);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    
    let category = '';
    let question = '';
    let answer = '';
    let keywords = '';

    for (const line of lines) {
      if (line.startsWith('カテゴリ:') || line.startsWith('カテゴリー:')) {
        category = line.replace(/^カテゴリ[ー]?:\s*/, '').trim();
      } else if (line.startsWith('質問:')) {
        question = line.replace(/^質問:\s*/, '').trim();
      } else if (line.startsWith('回答:')) {
        answer = line.replace(/^回答:\s*/, '').trim();
      } else if (line.startsWith('キーワード:')) {
        keywords = line.replace(/^キーワード:\s*/, '').trim();
      } else {
        // ラベルなしの行は前の項目に追加（改行対応）
        if (answer) {
          answer += '\n' + line;
        } else if (question) {
          question += '\n' + line;
        }
      }
    }

    // 必須項目がすべて揃っている場合のみ追加
    if (category && question && answer) {
      items.push({
        category,
        question,
        answer,
        keywords,
        priority: 2,  // デフォルト：中
        is_active: 1  // デフォルト：有効
      });
    }
  }

  return items;
}

// プレビューを表示
function displayPreview(items) {
  previewCount.textContent = items.length;
  
  previewList.innerHTML = items.map((item, index) => `
    <div class="bg-white border border-gray-300 rounded-lg p-4">
      <div class="flex items-center mb-2">
        <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 mr-2">
          ${item.category}
        </span>
        <span class="text-xs text-gray-500">#${index + 1}</span>
      </div>
      <h4 class="font-semibold text-gray-900 mb-1 text-sm">Q: ${escapeHtml(item.question)}</h4>
      <p class="text-xs text-gray-600 mb-2">${escapeHtml(item.answer.substring(0, 100))}${item.answer.length > 100 ? '...' : ''}</p>
      ${item.keywords ? `
        <div class="flex flex-wrap gap-1">
          ${item.keywords.split(',').map(kw => `
            <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
              ${escapeHtml(kw.trim())}
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// HTMLエスケープ処理
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 一括登録を実行
executeBulkImport.addEventListener('click', async () => {
  if (parsedQAData.length === 0) {
    alert('登録するデータがありません');
    return;
  }

  if (!confirm(`${parsedQAData.length}件のQ&Aを登録します。よろしいですか？`)) {
    return;
  }

  try {
    const response = await axios.post('/api/qa/bulk-import', {
      items: parsedQAData
    });

    alert(`${response.data.inserted}件のQ&Aを登録しました！`);
    bulkImportModal.classList.add('hidden');
    loadQAItems();
  } catch (error) {
    console.error('Bulk import error:', error);
    alert('一括登録に失敗しました: ' + (error.response?.data?.error || error.message));
  }
});
