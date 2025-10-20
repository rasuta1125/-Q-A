// テンプレート管理画面のJavaScript

const templateList = document.getElementById('templateList');
const addBtn = document.getElementById('addBtn');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const cancelBtn = document.getElementById('cancelBtn');
const templateForm = document.getElementById('templateForm');
const modalTitle = document.getElementById('modalTitle');

let currentTemplateId = null;

// 初期化
loadTemplates();

// テンプレート一覧読み込み
async function loadTemplates() {
  try {
    const response = await axios.get('/api/templates');
    const items = response.data;

    if (items.length === 0) {
      templateList.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-clipboard-list text-4xl mb-4"></i>
          <p>テンプレートがまだ登録されていません</p>
          <p class="text-sm">「新規追加」ボタンからテンプレートを追加してください</p>
        </div>
      `;
      return;
    }

    templateList.innerHTML = items.map(item => {
      const categoryBadge = item.category ? 
        `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-purple-100 text-purple-800 mr-2">
          ${item.category}
        </span>` : '';
      
      const usageInfo = item.usage_count > 0 ? 
        `<span class="text-xs text-gray-500">使用回数: ${item.usage_count}回</span>` : '';

      return `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition duration-200">
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <div class="flex items-center mb-2">
                ${categoryBadge}
                <h4 class="font-semibold text-gray-900">${item.title}</h4>
              </div>
            </div>
            <div class="flex space-x-2 ml-4">
              <button onclick="copyTemplate(${item.id}, \`${item.content.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" 
                      class="text-blue-500 hover:text-blue-700"
                      title="コピー">
                <i class="fas fa-copy"></i>
              </button>
              <button onclick="editTemplate(${item.id})" class="text-green-500 hover:text-green-700" title="編集">
                <i class="fas fa-edit"></i>
              </button>
              <button onclick="deleteTemplate(${item.id})" class="text-red-500 hover:text-red-700" title="削除">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          
          <div class="bg-gray-50 p-3 rounded mb-2">
            <p class="text-sm text-gray-700 whitespace-pre-wrap">${item.content}</p>
          </div>
          
          <div class="flex justify-between items-center text-xs text-gray-400">
            ${usageInfo}
            <span>更新: ${new Date(item.updated_at).toLocaleDateString('ja-JP')}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading templates:', error);
    templateList.innerHTML = '<p class="text-red-500">データの読み込みに失敗しました</p>';
  }
}

// 新規追加ボタン
addBtn.addEventListener('click', () => {
  currentTemplateId = null;
  modalTitle.textContent = 'テンプレート追加';
  templateForm.reset();
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
templateForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = {
    title: document.getElementById('title').value,
    category: document.getElementById('category').value,
    content: document.getElementById('content').value,
  };

  try {
    if (currentTemplateId) {
      // 更新
      await axios.put(`/api/templates/${currentTemplateId}`, data);
    } else {
      // 新規作成
      await axios.post('/api/templates', data);
    }

    modal.classList.add('hidden');
    loadTemplates();
  } catch (error) {
    console.error('Error saving template:', error);
    alert('保存に失敗しました: ' + (error.response?.data?.error || error.message));
  }
});

// コピー
window.copyTemplate = async (id, content) => {
  try {
    await navigator.clipboard.writeText(content);
    
    // 使用回数をカウント
    await axios.post(`/api/templates/${id}/use`);
    
    // 成功メッセージ
    const btn = event.target.closest('button');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    btn.classList.add('text-green-500');
    
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove('text-green-500');
      btn.classList.add('text-blue-500');
      loadTemplates(); // 使用回数を更新するためリロード
    }, 1000);
  } catch (error) {
    console.error('Error copying:', error);
    alert('コピーに失敗しました');
  }
};

// 編集
window.editTemplate = async (id) => {
  try {
    const response = await axios.get('/api/templates');
    const item = response.data.find(t => t.id === id);
    
    if (!item) {
      alert('テンプレートが見つかりません');
      return;
    }

    currentTemplateId = id;
    modalTitle.textContent = 'テンプレート編集';
    
    document.getElementById('title').value = item.title;
    document.getElementById('category').value = item.category || '';
    document.getElementById('content').value = item.content;
    
    modal.classList.remove('hidden');
  } catch (error) {
    console.error('Error loading template:', error);
    alert('データの読み込みに失敗しました');
  }
};

// 削除
window.deleteTemplate = async (id) => {
  if (!confirm('このテンプレートを削除してもよろしいですか？')) {
    return;
  }

  try {
    await axios.delete(`/api/templates/${id}`);
    loadTemplates();
  } catch (error) {
    console.error('Error deleting template:', error);
    alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
  }
};
