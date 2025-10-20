// 回答生成画面のJavaScript

const queryInput = document.getElementById('queryInput');
const generateBtn = document.getElementById('generateBtn');
const resultArea = document.getElementById('resultArea');
const loadingArea = document.getElementById('loadingArea');
const answerText = document.getElementById('answerText');
const sourcesArea = document.getElementById('sourcesArea');
const copyBtn = document.getElementById('copyBtn');
const confidenceBadge = document.getElementById('confidenceBadge');
const escalationNote = document.getElementById('escalationNote');
const webSearchBtn = document.getElementById('webSearchBtn');

// 回答生成ボタンクリック
generateBtn.addEventListener('click', async () => {
  const query = queryInput.value.trim();
  
  if (!query) {
    alert('問い合わせ内容を入力してください');
    return;
  }

  const tone = document.querySelector('input[name="tone"]:checked').value;

  // UI状態変更
  resultArea.classList.add('hidden');
  loadingArea.classList.remove('hidden');
  generateBtn.disabled = true;

  try {
    const response = await axios.post('/api/generate', { query, tone });
    const data = response.data;

    // 信頼度バッジ表示
    displayConfidenceBadge(data.confidence);

    // エスカレーションノート表示
    if (data.escalation_note) {
      escalationNote.innerHTML = `
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <i class="fas fa-exclamation-triangle text-yellow-400"></i>
            </div>
            <div class="ml-3">
              <p class="text-sm text-yellow-700 whitespace-pre-wrap">${data.escalation_note}</p>
            </div>
          </div>
        </div>
      `;
      escalationNote.classList.remove('hidden');
    } else {
      escalationNote.classList.add('hidden');
    }

    // 回答表示
    if (data.answer) {
      answerText.textContent = data.answer;
    } else {
      answerText.innerHTML = '<p class="text-gray-500 italic">情報が不足しているため、回答を生成できませんでした。下記の参考情報を確認してください。</p>';
    }

    // ソース表示
    displaySources(data.sources);

    // 結果エリア表示
    resultArea.classList.remove('hidden');
  } catch (error) {
    console.error('Error:', error);
    alert('エラーが発生しました: ' + (error.response?.data?.error || error.message));
  } finally {
    loadingArea.classList.add('hidden');
    generateBtn.disabled = false;
  }
});

// 信頼度バッジ表示
function displayConfidenceBadge(confidence) {
  const badges = {
    A: {
      color: 'bg-green-100 text-green-800 border-green-300',
      icon: 'fa-check-circle',
      text: '信頼度: A (十分な根拠あり)',
    },
    B: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      icon: 'fa-exclamation-circle',
      text: '信頼度: B (要注意 - 念のため確認推奨)',
    },
    C: {
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: 'fa-times-circle',
      text: '信頼度: C (情報不足 - 社内確認必須)',
    },
  };

  const badge = badges[confidence];
  confidenceBadge.innerHTML = `
    <div class="inline-flex items-center px-4 py-2 rounded-full border ${badge.color}">
      <i class="fas ${badge.icon} mr-2"></i>
      <span class="font-semibold">${badge.text}</span>
    </div>
  `;
}

// ソース表示
function displaySources(sources) {
  if (!sources || sources.length === 0) {
    sourcesArea.innerHTML = '<p class="text-gray-500">参考情報が見つかりませんでした</p>';
    return;
  }

  sourcesArea.innerHTML = sources.map((source, index) => {
    const scorePercent = Math.round(source.score * 100);
    const scoreColor = scorePercent >= 85 ? 'text-green-600' : scorePercent >= 70 ? 'text-yellow-600' : 'text-red-600';
    
    return `
      <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition duration-200">
        <div class="flex justify-between items-start mb-2">
          <div class="flex items-center">
            <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 mr-2">
              ${source.type === 'qa' ? 'Q&A' : 'Web'}
            </span>
            <span class="text-sm ${scoreColor} font-semibold">
              類似度: ${scorePercent}%
            </span>
          </div>
          <span class="text-xs text-gray-500">
            ${source.last_updated ? new Date(source.last_updated).toLocaleDateString('ja-JP') : ''}
          </span>
        </div>
        <h4 class="font-semibold text-gray-900 mb-2">${source.title}</h4>
        <p class="text-sm text-gray-600">${source.excerpt}</p>
        ${source.url ? `<a href="${source.url}" target="_blank" class="text-xs text-blue-500 hover:underline mt-2 inline-block">
          <i class="fas fa-external-link-alt mr-1"></i>詳細を見る
        </a>` : ''}
      </div>
    `;
  }).join('');
}

// コピーボタン
copyBtn.addEventListener('click', () => {
  const text = answerText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const originalHTML = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i class="fas fa-check mr-2"></i>コピーしました！';
    copyBtn.classList.remove('bg-gray-500', 'hover:bg-gray-600');
    copyBtn.classList.add('bg-green-500');
    
    setTimeout(() => {
      copyBtn.innerHTML = originalHTML;
      copyBtn.classList.remove('bg-green-500');
      copyBtn.classList.add('bg-gray-500', 'hover:bg-gray-600');
    }, 2000);
  });
});

// Webで追加検索ボタン
webSearchBtn.addEventListener('click', () => {
  const query = queryInput.value.trim();
  if (!query) {
    alert('問い合わせ内容がありません');
    return;
  }
  
  // Google検索をWeb管理画面へのリンクに変更
  const searchUrl = `/web-admin?query=${encodeURIComponent(query)}`;
  window.open(searchUrl, '_blank');
});
