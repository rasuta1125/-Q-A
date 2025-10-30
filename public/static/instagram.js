// Instagram投稿文生成ページのJavaScript

console.log('instagram.js loaded');

// メニューデータ
const MENU_DATA = {
  '100day': {
    name: '100日フォト',
    emoji: '👶',
    title: '𝟏𝟎𝟎 𝐝𝐚𝐲𝐬 𝐩𝐡𝐨𝐭𝐨',
    services: [
      '家族写真込み',
      '兄弟写真込み',
      '全データ納品（100枚保証）',
      'お衣装着放題'
    ],
    hashtags: '#100日 #100日フォト #赤ちゃん #ベビーフォト #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
  },
  'birthday': {
    name: 'バースデーフォト',
    emoji: '🎂',
    title: '𝟏𝐬𝐭 𝐛𝐢𝐫𝐭𝐡𝐝𝐚𝐲',
    services: [
      '家族写真込み',
      '兄弟写真込み',
      '全データ納品',
      '衣装着放題',
      'リピーター割有り'
    ],
    hashtags: '#1歳 #お誕生日 #1stbirthday #バースデーフォト #誕生日 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
  },
  'shichigosan': {
    name: '七五三',
    emoji: '👘',
    title: '𝟕𝟓𝟑 𝐩𝐡𝐨𝐭𝐨',
    services: [
      'ヘアメイク付き',
      '和装1着 洋装1着',
      '家族写真込み',
      '兄弟写真込み',
      'お衣装着放題',
      'リピーター割有り'
    ],
    hashtags: '#七五三 #753 #七五三撮影 #家族写真 #記念撮影 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ #沖縄イベント'
  },
  'milkbath': {
    name: 'ミルクバス',
    emoji: '🫧',
    title: '𝐦𝐢𝐥𝐤 𝐛𝐚𝐭𝐡',
    services: [
      'バスローブ姿',
      'ドレス姿',
      '私服姿も可能',
      '家族写真込み',
      '全データお渡し（100枚保証）',
      'お衣装着放題'
    ],
    hashtags: '#ミルクバス #沐浴 #ベビーフォト #ハーフバースデー #赤ちゃん #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ'
  },
  'halfbirthday': {
    name: 'ハーフバースデー',
    emoji: '⭐',
    title: '𝐡𝐚𝐥𝐟 𝐛𝐢𝐫𝐭𝐡𝐝𝐚𝐲',
    services: [
      '家族写真込み',
      '兄弟写真込み',
      '全データ納品（100枚保証）',
      'お衣装着放題'
    ],
    hashtags: '#ハーフバースデー #生後6ヶ月 #ベビーフォト #halfbirthday #6ヶ月 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄ママ'
  },
  'family': {
    name: 'ファミリーフォト',
    emoji: '👨‍👩‍👧',
    title: '𝐟𝐚𝐦𝐢𝐥𝐲 𝐩𝐡𝐨𝐭𝐨',
    services: [
      '家族写真込み',
      '兄弟写真込み',
      'お衣装着放題',
      '全データ納品（100枚保証）'
    ],
    hashtags: '#家族写真 #familyphoto #familytime #家族時間 #ファミリーフォト #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ #沖縄イベント'
  },
  'smashcake': {
    name: 'スマッシュケーキ',
    emoji: '🎂',
    title: '𝐬𝐦𝐚𝐬𝐡 𝐜𝐚𝐤𝐞',
    services: [
      '合成着色料不使用（お野菜パウダー使用）',
      '純正クリーム',
      '国産小麦粉使用（福岡産）',
      'アレルギー除去対応',
      '3日前までのご予約',
      '家族写真込み',
      '兄弟写真込み',
      'フォトフレーム付き'
    ],
    hashtags: '#スマッシュケーキ #smashcake #1歳 #1stbirthday #誕生日 #沖縄 #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ'
  },
  'ryuso': {
    name: '琉装撮影',
    emoji: '🌺',
    title: '-OKINAWA- 琉装',
    services: [
      '沖縄伝統琉装',
      '100日〜6ヶ月サイズ対応',
      '家族写真込み',
      '全データお渡し',
      'フォトフレーム付き',
      '貸切スタジオ'
    ],
    hashtags: '#琉装 #琉装撮影 #沖縄 #伝統 #ベビーフォト #那覇 #沖縄フォトスタジオ #沖縄写真館 #マカロニスタジオ'
  }
};

// 状態管理
let selectedMenu = null;
let generatedResults = null;

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  renderMenuButtons();
  attachEventListeners();
});

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
        <span class="menu-emoji">${menu.emoji}</span>
        <span class="menu-name">${menu.name}</span>
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
  
  // フォームを表示
  document.getElementById('inputSection').classList.remove('hidden');
  
  // スムーズスクロール
  document.getElementById('inputSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  console.log('Selected menu:', menuKey, MENU_DATA[menuKey]);
};

// イベントリスナー
function attachEventListeners() {
  // 生成ボタン
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.addEventListener('click', generatePost);
  
  // リセットボタン
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetForm);
  }
}

// 投稿文生成
async function generatePost() {
  if (!selectedMenu) {
    alert('撮影メニューを選択してください');
    return;
  }
  
  // 入力値を取得
  const description = document.getElementById('description').value.trim();
  const moods = Array.from(document.querySelectorAll('input[name="mood"]:checked'))
    .map(cb => cb.value);
  const specialPoint = document.getElementById('specialPoint').value.trim();
  
  // ローディング表示
  document.getElementById('inputSection').classList.add('hidden');
  document.getElementById('loadingSection').classList.remove('hidden');
  
  try {
    const response = await axios.post('/api/instagram/generate', {
      menu: selectedMenu,
      description: description || '元気で可愛らしい撮影でした',
      moods: moods.length > 0 ? moods : ['温かく優しい'],
      specialPoint: specialPoint || 'なし'
    });
    
    generatedResults = response.data;
    displayResults(generatedResults);
    
  } catch (error) {
    console.error('Generation error:', error);
    alert('投稿文の生成に失敗しました: ' + (error.response?.data?.error || error.message));
    
    // エラー時はフォームに戻る
    document.getElementById('loadingSection').classList.add('hidden');
    document.getElementById('inputSection').classList.remove('hidden');
  }
}

// 結果表示
function displayResults(results) {
  document.getElementById('loadingSection').classList.add('hidden');
  document.getElementById('resultsSection').classList.remove('hidden');
  
  const resultsContainer = document.getElementById('resultsContainer');
  
  resultsContainer.innerHTML = results.patterns.map((pattern, index) => `
    <div class="result-card">
      <div class="result-header">
        <h3>パターン ${index + 1}</h3>
        <span class="char-count">${pattern.text.length}文字</span>
      </div>
      
      <div class="result-content">
        <pre class="post-text">${escapeHtml(pattern.text)}</pre>
      </div>
      
      <button 
        class="copy-btn" 
        onclick="copyText('${escapeForAttribute(pattern.text)}', this)"
      >
        <i class="fas fa-copy mr-2"></i>投稿文をコピー
      </button>
      
      <div class="hashtag-section">
        <h4><i class="fas fa-hashtag mr-2"></i>推奨ハッシュタグ</h4>
        <p class="hashtags">${escapeHtml(pattern.hashtags)}</p>
        <button 
          class="copy-btn-small" 
          onclick="copyText('${escapeForAttribute(pattern.hashtags)}', this)"
        >
          <i class="fas fa-copy mr-1"></i>ハッシュタグをコピー
        </button>
      </div>
    </div>
  `).join('');
  
  // スムーズスクロール
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// テキストコピー
window.copyText = async (text, button) => {
  try {
    // 属性からエスケープされたテキストをデコード
    const decodedText = decodeHtmlEntities(text);
    
    await navigator.clipboard.writeText(decodedText);
    
    // ボタンのフィードバック
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
function resetForm() {
  selectedMenu = null;
  generatedResults = null;
  
  // フォームをクリア
  document.getElementById('description').value = '';
  document.getElementById('specialPoint').value = '';
  document.querySelectorAll('input[name="mood"]').forEach(cb => cb.checked = false);
  
  // 表示を戻す
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('inputSection').classList.add('hidden');
  
  // メニューボタンの選択状態をリセット
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // トップにスクロール
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 属性用エスケープ
function escapeForAttribute(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
}

// HTMLエンティティのデコード
function decodeHtmlEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}
