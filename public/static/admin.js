// Q&A管理画面のJavaScript

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
