// Web管理画面のJavaScript

const webList = document.getElementById('webList');
const urlInput = document.getElementById('urlInput');
const addBtn = document.getElementById('addBtn');
const loadingArea = document.getElementById('loadingArea');

// 初期化
loadWebSources();

// Webソース一覧読み込み
async function loadWebSources() {
  try {
    const response = await axios.get('/api/web');
    const items = response.data;

    if (items.length === 0) {
      webList.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-globe text-4xl mb-4"></i>
          <p>Webソースがまだ登録されていません</p>
          <p class="text-sm">上記の入力欄からURLを追加してください</p>
        </div>
      `;
      return;
    }

    webList.innerHTML = items.map(item => {
      const date = new Date(item.last_crawled).toLocaleDateString('ja-JP');
      const contentPreview = item.content ? item.content.substring(0, 200) + '...' : '';

      return `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition duration-200">
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <h4 class="font-semibold text-gray-900 mb-2">
                <i class="fas fa-external-link-alt text-blue-500 mr-2"></i>
                ${item.title || 'タイトルなし'}
              </h4>
              <a href="${item.url}" target="_blank" class="text-sm text-blue-500 hover:underline break-all">
                ${item.url}
              </a>
            </div>
            <button onclick="deleteWeb(${item.id})" class="text-red-500 hover:text-red-700 ml-4">
              <i class="fas fa-trash"></i>
            </button>
          </div>
          
          <p class="text-sm text-gray-600 mb-2">${contentPreview}</p>
          
          <div class="text-xs text-gray-400">
            最終取得: ${date}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading web sources:', error);
    webList.innerHTML = '<p class="text-red-500">データの読み込みに失敗しました</p>';
  }
}

// 追加ボタンクリック
addBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  
  if (!url) {
    alert('URLを入力してください');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    alert('有効なURLを入力してください（http:// または https:// で始まる）');
    return;
  }

  // UI状態変更
  loadingArea.classList.remove('hidden');
  addBtn.disabled = true;

  try {
    await axios.post('/api/web', { url });
    urlInput.value = '';
    loadWebSources();
    alert('Webページを取得しました！');
  } catch (error) {
    console.error('Error adding web source:', error);
    alert('Webページの取得に失敗しました: ' + (error.response?.data?.error || error.message));
  } finally {
    loadingArea.classList.add('hidden');
    addBtn.disabled = false;
  }
});

// 削除
window.deleteWeb = async (id) => {
  if (!confirm('このWebソースを削除してもよろしいですか？')) {
    return;
  }

  try {
    await axios.delete(`/api/web/${id}`);
    loadWebSources();
  } catch (error) {
    console.error('Error deleting web source:', error);
    alert('削除に失敗しました: ' + (error.response?.data?.error || error.message));
  }
};
