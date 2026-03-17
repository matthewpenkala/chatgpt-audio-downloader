document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('audio-list');

    // Chặn gọi quá nhiều lần
    let hasPolled = false;

    // Truy vấn tab đang mở hiện tại
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        
        // Kiểm tra xem có đang ở trên ChatGPT không
        if (!activeTab.url || !activeTab.url.includes("chatgpt.com")) {
            listEl.innerHTML = '<div class="empty">🎵<br/><br/>Extension này chỉ hoạt động khi bạn đang truy cập trang chatgpt.com</div>';
            return;
        }

        // Xin dữ liệu từ content.js của tab hiện tại
        fetchAudios(activeTab.id);
    });

    function fetchAudios(tabId) {
        if (hasPolled) return;
        hasPolled = true;

        chrome.tabs.sendMessage(tabId, { action: 'GET_AUDIOS' }, function(response) {
            // Xử lý lỗi nếu content script chưa chạy hoặc bạn chưa reload
            if (chrome.runtime.lastError) {
                listEl.innerHTML = '<div class="empty">🔄 Vui lòng tải lại trang ChatGPT (F5) để dữ liệu Extension được cập nhật.</div>';
                return;
            }

            if (response && response.audios && response.audios.length > 0) {
                renderList(response.audios, tabId);
            } else {
                listEl.innerHTML = '<div class="empty">Chưa có audio nào được tạo.<br/><br/>Hãy thử yêu cầu ChatGPT đọc một tin nhắn ("Read Aloud") xem sao nhé!</div>';
            }
        });
    }

    function renderList(audios, tabId) {
        listEl.innerHTML = '';
        
        // Đảo ngược mảng để Audio mới nhất nằm trên cùng
        const reversedAudios = [...audios].reverse();

        reversedAudios.forEach(audio => {
            const item = document.createElement('div');
            item.className = 'audio-item';
            
            const info = document.createElement('div');
            info.className = 'info';
            
            const name = document.createElement('div');
            name.className = 'filename';
            name.textContent = audio.filename;
            name.title = audio.filename; // Hiện tooltip khi hover nếu quá dài
            
            const time = document.createElement('div');
            time.className = 'time';
            time.textContent = "⏱ Lúc: " + audio.time;
            
            info.appendChild(name);
            info.appendChild(time);
            
            const btn = document.createElement('button');
            btn.className = 'btn-download';
            btn.textContent = '⬇️ Tải';
            btn.onclick = () => {
                chrome.tabs.sendMessage(tabId, { action: 'DOWNLOAD', id: audio.id });
                btn.textContent = 'Đã tải!';
                btn.style.backgroundColor = '#4caf50';
                setTimeout(() => {
                    btn.textContent = '⬇️ Tải';
                    btn.style.backgroundColor = '#10a37f';
                }, 2000);
            };
            
            item.appendChild(info);
            item.appendChild(btn);
            listEl.appendChild(item);
        });
    }
});
