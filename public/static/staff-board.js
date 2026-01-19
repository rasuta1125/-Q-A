// スタッフ連絡掲示板のJavaScript

let currentFilter = 'all';
let allMessages = [];
let selectedStaff = '';

// スタッフを選択（グローバル関数として定義）
window.selectStaff = function(staffName) {
    selectedStaff = staffName;
    document.getElementById('staffName').value = staffName;
    
    // すべてのタブから選択状態を解除
    document.querySelectorAll('.staff-tab').forEach(tab => {
        tab.classList.remove('selected');
    });
    
    // クリックされたタブを選択状態にする
    // data-staff属性でスタッフ名が一致するボタンを選択
    const targetButton = document.querySelector(`.staff-tab[data-staff="${staffName}"]`);
    if (targetButton) {
        targetButton.classList.add('selected');
    }
};

// ページ読み込み時に連絡事項を取得
document.addEventListener('DOMContentLoaded', () => {
    loadMessages();
    
    // フォーム送信
    document.getElementById('addMessageForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addMessage();
    });
    
    // 画像プレビュー
    const imageInput = document.getElementById('messageImage');
    if (imageInput) {
        imageInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    document.getElementById('previewImg').src = event.target.result;
                    document.getElementById('imagePreview').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            } else {
                document.getElementById('imagePreview').classList.add('hidden');
            }
        });
    }
});

// 連絡事項を読み込む
async function loadMessages(filter = 'all') {
    const loading = document.getElementById('loading');
    const messagesList = document.getElementById('messagesList');
    
    loading.classList.remove('hidden');
    messagesList.innerHTML = '';
    
    try {
        const url = filter === 'all' 
            ? '/api/staff-messages' 
            : `/api/staff-messages?status=${filter}`;
        
        const response = await axios.get(url);
        allMessages = response.data.messages || [];
        
        displayMessages(allMessages);
    } catch (error) {
        console.error('Failed to load messages:', error);
        messagesList.innerHTML = `
            <div class="text-center py-8 text-red-500">
                <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
                <p>連絡事項の読み込みに失敗しました</p>
            </div>
        `;
    } finally {
        loading.classList.add('hidden');
    }
}

// 連絡事項を表示
function displayMessages(messages) {
    const messagesList = document.getElementById('messagesList');
    
    if (messages.length === 0) {
        messagesList.innerHTML = `
            <div class="text-center py-12 text-gray-400">
                <i class="fas fa-inbox text-6xl mb-4"></i>
                <p class="text-xl">連絡事項がありません</p>
            </div>
        `;
        return;
    }
    
    messagesList.innerHTML = messages.map(msg => createMessageCard(msg)).join('');
}

// 連絡事項カードを作成
function createMessageCard(message) {
    const isCompleted = message.is_completed === 1;
    const statusIcon = isCompleted ? 'fa-check-circle' : 'fa-clock';
    const statusColor = isCompleted ? 'text-gray-500' : 'text-blue-500';
    const statusText = isCompleted ? '対応済み' : '未対応';
    
    // 日付をフォーマット
    const date = new Date(message.message_date);
    const formattedDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    
    // 画像があれば表示
    const imageHtml = message.image_url ? `
        <div class="mb-4">
            <img src="${escapeHtml(message.image_url)}" alt="添付画像" class="max-w-md rounded-lg shadow-md" />
        </div>
    ` : '';
    
    return `
        <div class="message-card ${isCompleted ? 'completed' : ''} bg-white rounded-xl shadow-md p-6" data-message-id="${message.id}">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                <div class="flex items-center gap-4 mb-3 md:mb-0">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-user-circle text-2xl" style="color: #FF69B4;"></i>
                        <span class="font-bold text-lg">${escapeHtml(message.staff_name)}</span>
                    </div>
                    <div class="flex items-center gap-2 text-gray-600">
                        <i class="fas fa-calendar-alt"></i>
                        <span>${formattedDate}</span>
                    </div>
                </div>
                
                <div class="flex items-center gap-3">
                    <span class="flex items-center gap-2 ${statusColor} font-semibold">
                        <i class="fas ${statusIcon}"></i>
                        ${statusText}
                    </span>
                </div>
            </div>
            
            <div class="mb-4" id="content-${message.id}">
                <p class="text-gray-700 whitespace-pre-wrap">${escapeHtml(message.content)}</p>
            </div>
            
            <div class="mb-4 hidden" id="edit-${message.id}">
                <textarea 
                    id="edit-content-${message.id}" 
                    class="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none resize-vertical"
                    rows="4"
                >${escapeHtml(message.content)}</textarea>
                <input 
                    type="file" 
                    id="edit-image-${message.id}" 
                    accept="image/*"
                    class="mt-2 w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-pink-400 focus:outline-none"
                />
            </div>
            
            ${imageHtml}
            
            <div class="flex flex-wrap gap-3 justify-end">
                <button 
                    id="edit-btn-${message.id}"
                    onclick="startEdit(${message.id})"
                    class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-semibold text-sm"
                >
                    <i class="fas fa-edit mr-1"></i>編集
                </button>
                <button 
                    id="save-btn-${message.id}"
                    onclick="saveEdit(${message.id})"
                    class="hidden px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition font-semibold text-sm"
                >
                    <i class="fas fa-save mr-1"></i>保存
                </button>
                <button 
                    id="cancel-btn-${message.id}"
                    onclick="cancelEdit(${message.id})"
                    class="hidden px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold text-sm"
                >
                    <i class="fas fa-times mr-1"></i>キャンセル
                </button>
                ${!isCompleted ? `
                    <button 
                        onclick="toggleStatus(${message.id}, 1)"
                        class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition font-semibold text-sm"
                    >
                        <i class="fas fa-check mr-1"></i>対応済みにする
                    </button>
                ` : `
                    <button 
                        onclick="toggleStatus(${message.id}, 0)"
                        class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold text-sm"
                    >
                        <i class="fas fa-undo mr-1"></i>未対応に戻す
                    </button>
                `}
                <button 
                    onclick="deleteMessage(${message.id})"
                    class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-semibold text-sm"
                >
                    <i class="fas fa-trash mr-1"></i>削除
                </button>
            </div>
        </div>
    `;
}

// 新規連絡事項を追加
async function addMessage() {
    const staffName = document.getElementById('staffName').value;
    const messageDate = document.getElementById('messageDate').value;
    const content = document.getElementById('messageContent').value;
    const imageFile = document.getElementById('messageImage').files[0];
    
    if (!staffName || !messageDate || !content) {
        if (!staffName) {
            showNotification('スタッフ名を選択してください', 'error');
        } else {
            showNotification('すべての項目を入力してください', 'error');
        }
        return;
    }
    
    try {
        let image_url = null;
        
        // ファイルがある場合はR2にアップロード（サイズチェック: 10MB = 10485760バイト）
        if (imageFile) {
            if (imageFile.size > 10485760) {
                showNotification('画像ファイルは10MB以下にしてください', 'error');
                return;
            }
            
            // ローディング表示
            showNotification('画像をアップロード中...', 'info');
            
            // R2にアップロード
            const formData = new FormData();
            formData.append('image', imageFile);
            
            const uploadResponse = await axios.post('/api/upload-image', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            if (uploadResponse.data.success) {
                image_url = uploadResponse.data.imageUrl;
            } else {
                throw new Error('画像のアップロードに失敗しました');
            }
        }
        
        const response = await axios.post('/api/staff-messages', {
            staff_name: staffName,
            message_date: messageDate,
            content: content,
            image_url: image_url
        });
        
        if (response.data.success) {
            // フォームをリセット
            document.getElementById('addMessageForm').reset();
            document.getElementById('messageDate').valueAsDate = new Date();
            document.getElementById('imagePreview').classList.add('hidden');
            
            // スタッフタブの選択状態をリセット
            selectedStaff = '';
            document.querySelectorAll('.staff-tab').forEach(tab => {
                tab.classList.remove('selected');
            });
            
            // 成功メッセージ
            showNotification('連絡事項を追加しました', 'success');
            
            // リストを再読み込み
            await loadMessages(currentFilter);
        }
    } catch (error) {
        console.error('Failed to add message:', error);
        if (error.response && error.response.status === 413) {
            showNotification('画像ファイルが大きすぎます。10MB以下にしてください', 'error');
        } else {
            showNotification('連絡事項の追加に失敗しました', 'error');
        }
    }
}

// 対応ステータスを切り替え（グローバル関数として定義）
window.toggleStatus = async function(id, isCompleted) {
    try {
        const response = await axios.put(`/api/staff-messages/${id}`, {
            is_completed: isCompleted
        });
        
        if (response.data.success) {
            showNotification(response.data.message, 'success');
            await loadMessages(currentFilter);
        }
    } catch (error) {
        console.error('Failed to toggle status:', error);
        showNotification('ステータスの更新に失敗しました', 'error');
    }
};

// 連絡事項を削除（グローバル関数として定義）
window.deleteMessage = async function(id) {
    if (!confirm('この連絡事項を削除してもよろしいですか？')) {
        return;
    }
    
    try {
        const response = await axios.delete(`/api/staff-messages/${id}`);
        
        if (response.data.success) {
            showNotification('連絡事項を削除しました', 'success');
            await loadMessages(currentFilter);
        }
    } catch (error) {
        console.error('Failed to delete message:', error);
        showNotification('連絡事項の削除に失敗しました', 'error');
    }
};

// フィルター切り替え（グローバル関数として定義）
window.filterMessages = function(filter) {
    currentFilter = filter;
    
    // アクティブなボタンを更新
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // クリックされたボタンをアクティブにする
    const targetButton = event ? event.target : document.querySelector('.filter-btn');
    if (targetButton) {
        targetButton.classList.add('active');
    }
    
    // メッセージを再読み込み
    loadMessages(filter);
};

// 通知を表示
function showNotification(message, type = 'success') {
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in`;
    notification.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// HTMLエスケープ
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 編集モードを開始（グローバル関数として定義）
window.startEdit = function(id) {
    document.getElementById(`content-${id}`).classList.add('hidden');
    document.getElementById(`edit-${id}`).classList.remove('hidden');
    document.getElementById(`edit-btn-${id}`).classList.add('hidden');
    document.getElementById(`save-btn-${id}`).classList.remove('hidden');
    document.getElementById(`cancel-btn-${id}`).classList.remove('hidden');
};

// 編集をキャンセル（グローバル関数として定義）
window.cancelEdit = function(id) {
    document.getElementById(`content-${id}`).classList.remove('hidden');
    document.getElementById(`edit-${id}`).classList.add('hidden');
    document.getElementById(`edit-btn-${id}`).classList.remove('hidden');
    document.getElementById(`save-btn-${id}`).classList.add('hidden');
    document.getElementById(`cancel-btn-${id}`).classList.add('hidden');
};

// 編集を保存（グローバル関数として定義）
window.saveEdit = async function(id) {
    const content = document.getElementById(`edit-content-${id}`).value;
    const imageFile = document.getElementById(`edit-image-${id}`).files[0];
    
    if (!content.trim()) {
        showNotification('連絡内容を入力してください', 'error');
        return;
    }
    
    try {
        const updateData = { content };
        
        // 画像がある場合はR2にアップロード（サイズチェック: 10MB = 10485760バイト）
        if (imageFile) {
            if (imageFile.size > 10485760) {
                showNotification('画像ファイルは10MB以下にしてください', 'error');
                return;
            }
            
            showNotification('画像をアップロード中...', 'info');
            
            // R2にアップロード
            const formData = new FormData();
            formData.append('image', imageFile);
            
            const uploadResponse = await axios.post('/api/upload-image', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            if (uploadResponse.data.success) {
                updateData.image_url = uploadResponse.data.imageUrl;
            } else {
                throw new Error('画像のアップロードに失敗しました');
            }
        }
        
        const response = await axios.put(`/api/staff-messages/${id}`, updateData);
        
        if (response.data.success) {
            showNotification('メモを更新しました', 'success');
            await loadMessages(currentFilter);
        }
    } catch (error) {
        console.error('Failed to update message:', error);
        showNotification('メモの更新に失敗しました', 'error');
    }
};

