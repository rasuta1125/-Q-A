// ブログ原稿生成ページのJavaScript

console.log('blog.js loaded');

// メニューデータ
const MENU_DATA = {
  '100day': { name: '100日フォト', emoji: '👶' },
  'birthday': { name: 'バースデー', emoji: '🎂' },
  'shichigosan': { name: '七五三', emoji: '👘' },
  'milkbath': { name: 'ミルクバス', emoji: '🫧' },
  'halfbirthday': { name: 'ハーフバースデー', emoji: '⭐' },
  'family': { name: 'ファミリー', emoji: '👨‍👩‍👧' },
  'smashcake': { name: 'スマッシュケーキ', emoji: '🎂' },
  'ryuso': { name: '琉装撮影', emoji: '🌺' }
};

// 状態管理
let selectedArticleType = null;
let selectedMenu = null;
let generatedArticle = null;

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  renderMenuButtons();
  attachEventListeners();
});

// 記事タイプ選択
window.selectArticleType = (type) => {
  selectedArticleType = type;
  
  // 全ボタンの選択状態をリセット
  document.querySelectorAll('.article-type-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 選択されたボタンをアクティブに
  document.querySelector(`[data-type="${type}"]`).classList.add('active');
  
  // フォームを表示
  document.getElementById('inputSection').classList.remove('hidden');
  
  // 記事タイプに応じてフォームを調整
  if (type === 'introduction') {
    document.getElementById('keywordsField').style.display = 'block';
    document.getElementById('mainPointsLabel').textContent = '📝 記事の要点・特徴';
    document.getElementById('mainPoints').placeholder = '例: サービスの魅力、他店との違い、マカロニスタジオの強みなど';
  } else {
    document.getElementById('keywordsField').style.display = 'none';
    document.getElementById('mainPointsLabel').textContent = '📝 撮影の様子・エピソード';
    document.getElementById('mainPoints').placeholder = '例: お子様の反応、撮影中のエピソード、印象的なシーンなど';
  }
  
  // スムーズスクロール
  document.getElementById('inputSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  console.log('Selected article type:', type);
};

// メニューボタンを描画
function renderMenuButtons() {
  const menuGrid = document.getElementById('menuGrid');
  
  menuGrid.innerHTML = Object.keys(MENU_DATA).map(key => {
    const menu = MENU_DATA[key];
    return `
      <button 
        class="menu-btn" 
        data-menu="${key}"
        onclick="selectMenu('${key}')"
      >
        <div class="text-2xl mb-1">${menu.emoji}</div>
        <div class="text-sm font-semibold">${menu.name}</div>
      </button>
    `;
  }).join('');
}

// メニュー選択
window.selectMenu = (menuKey) => {
  selectedMenu = menuKey;
  
  // 全ボタンの選択状態をリセット
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 選択されたボタンをアクティブに
  document.querySelector(`[data-menu="${menuKey}"]`).classList.add('active');
  
  console.log('Selected menu:', menuKey, MENU_DATA[menuKey]);
};

// イベントリスナー
function attachEventListeners() {
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.addEventListener('click', generateBlogPost);
}

// ブログ原稿生成
async function generateBlogPost() {
  // 記事タイプを取得（カード選択式UIから）
  const articleType = selectedArticleType;

  if (!articleType) {
    alert('記事タイプを選択してください');
    return;
  }

  // メニュー紹介タイプの場合のみメニュー選択が必須
  if (articleType === 'introduction' && !selectedMenu) {
    alert('撮影メニューを選択してください');
    return;
  }
  
  // 入力値を取得
  const title = document.getElementById('title').value.trim();
  const keywords = document.getElementById('keywords').value.trim();
  const mainPoints = document.getElementById('mainPoints').value.trim();
  const toneEl = document.querySelector('input[name="tone"]:checked');
  const tone = toneEl ? toneEl.value : 'friendly';
  
  // 自由記事の場合は内容が必須
  if (articleType === 'free' && !mainPoints) {
    alert('記事の内容を入力してください');
    return;
  }
  
  // ローディング表示
  document.getElementById('inputSection').classList.add('hidden');
  document.getElementById('loadingSection').classList.remove('hidden');
  
  try {
    const response = await axios.post('/api/blog/generate', {
      articleType: articleType,
      menu: selectedMenu || null,
      title: title,
      keywords: keywords,
      mainPoints: mainPoints,
      tone: tone
    });
    
    generatedArticle = response.data.article;
    displayResult(generatedArticle, response.data.wordCount);
    
  } catch (error) {
    console.error('Generation error:', error);
    alert('ブログ原稿の生成に失敗しました: ' + (error.response?.data?.error || error.message));
    
    // エラー時はフォームに戻る
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
  }
}

// 結果表示
function displayResult(article, wordCount) {
  document.getElementById('loadingSection').classList.add('hidden');
  document.getElementById('resultsSection').classList.remove('hidden');
  
  // 原稿を表示
  document.getElementById('articlePreview').textContent = article;
  document.getElementById('articleEditor').value = article;
  
  // 文字数表示
  document.getElementById('wordCount').textContent = `${wordCount}文字`;
  
  // 編集モードをリセット
  isEditMode = false;
  updateEditMode();
  
  // スムーズスクロール
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 編集モード管理
let isEditMode = false;

window.toggleEditMode = () => {
  isEditMode = !isEditMode;
  updateEditMode();
};

function updateEditMode() {
  const preview = document.getElementById('articlePreview');
  const editor = document.getElementById('articleEditor');
  const editBtn = document.getElementById('editToggleBtn');
  const editHint = document.getElementById('editHint');
  
  if (isEditMode) {
    // 編集モードに切り替え
    preview.classList.add('hidden');
    editor.classList.remove('hidden');
    editHint.classList.remove('hidden');
    editBtn.innerHTML = '<i class="fas fa-eye mr-1"></i>プレビュー';
    editBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
    editBtn.classList.add('bg-green-500', 'hover:bg-green-600');
    
    // エディタにフォーカス
    editor.focus();
    
    // エディタの内容変更を監視
    editor.addEventListener('input', updateWordCountFromEditor);
  } else {
    // プレビューモードに切り替え
    // エディタの内容をプレビューに反映
    const editedContent = editor.value;
    preview.textContent = editedContent;
    generatedArticle = editedContent; // コピー用に更新
    
    preview.classList.remove('hidden');
    editor.classList.add('hidden');
    editHint.classList.add('hidden');
    editBtn.innerHTML = '<i class="fas fa-edit mr-1"></i>編集';
    editBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
    editBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
    
    // 文字数を更新
    updateWordCount(editedContent);
  }
}

function updateWordCountFromEditor() {
  const content = document.getElementById('articleEditor').value;
  updateWordCount(content);
  generatedArticle = content; // リアルタイムで更新
}

function updateWordCount(content) {
  const count = content.length;
  document.getElementById('wordCount').textContent = `${count}文字`;
}

// 原稿コピー
window.copyArticle = async () => {
  try {
    await navigator.clipboard.writeText(generatedArticle);
    
    // ボタンのフィードバック
    const button = document.querySelector('.copy-btn');
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check mr-2"></i>コピー完了！';
    button.classList.add('copied');
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.classList.remove('copied');
    }, 2000);
    
  } catch (error) {
    console.error('Copy failed:', error);
    alert('コピーに失敗しました');
  }
};

// フォームリセット
window.resetForm = () => {
  selectedArticleType = null;
  selectedMenu = null;
  generatedArticle = null;
  isEditMode = false;
  
  // フォームをクリア
  document.getElementById('title').value = '';
  document.getElementById('keywords').value = '';
  document.getElementById('mainPoints').value = '';
  document.querySelectorAll('input[name="tone"]').forEach(radio => {
    if (radio.value === 'professional') {
      radio.checked = true;
    } else {
      radio.checked = false;
    }
  });
  
  // 表示を戻す
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('inputSection').classList.add('hidden');
  
  // ボタンの選択状態をリセット
  document.querySelectorAll('.article-type-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // トップにスクロール
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
