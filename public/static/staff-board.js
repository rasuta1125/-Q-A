// スタッフ連絡掲示板のJavaScript

let currentFilter = 'all';
let allMessages = [];
let selectedStaff = '';

// スタッフを選択
function selectStaff(staffName) {
    selectedStaff = staffName;
    document.getElementById('staffName').value = staffName;
    
    // すべてのタブから選択状態を解除
    document.querySelectorAll('.staff-tab').forEach(tab => {
        tab.classList.remove('selected');
    });
    
    // クリックされたタブを選択状態にする
    event.target.classList.add('selected');
}

// ページ読み込み時に連絡事項を取得
document.addEventListener('DOMContentLoaded', () => {
    loadMessages();
    
    // フォーム送信
    document.getElementById('addMessageForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addMessage();
    });
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
    
    return `
        <div class="message-card ${isCompleted ? 'completed' : ''} bg-white rounded-xl shadow-md p-6">
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
            
            <div class="mb-4">
                <p class="text-gray-700 whitespace-pre-wrap">${escapeHtml(message.content)}</p>
            </div>
            
            <div class="flex flex-wrap gap-3 justify-end">
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
    
    if (!staffName || !messageDate || !content) {
        if (!staffName) {
            showNotification('スタッフ名を選択してください', 'error');
        } else {
            showNotification('すべての項目を入力してください', 'error');
        }
        return;
    }
    
    try {
        const response = await axios.post('/api/staff-messages', {
            staff_name: staffName,
            message_date: messageDate,
            content: content
        });
        
        if (response.data.success) {
            // フォームをリセット
            document.getElementById('addMessageForm').reset();
            document.getElementById('messageDate').valueAsDate = new Date();
            
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
        showNotification('連絡事項の追加に失敗しました', 'error');
    }
}

// 対応ステータスを切り替え
async function toggleStatus(id, isCompleted) {
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
}

// 連絡事項を削除
async function deleteMessage(id) {
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
}

// フィルター切り替え
function filterMessages(filter) {
    currentFilter = filter;
    
    // アクティブなボタンを更新
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // メッセージを再読み込み
    loadMessages(filter);
}

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
