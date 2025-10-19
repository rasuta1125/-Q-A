// Q&A管理画面のJavaScript

const qaList = document.getElementById('qaList');
const addBtn = document.getElementById('addBtn');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const cancelBtn = document.getElementById('cancelBtn');
const qaForm = document.getElementById('qaForm');
const modalTitle = document.getElementById('modalTitle');

let currentQAId = null;

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
