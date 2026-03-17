// Tiêm inject.js vào môi trường chính của trang (main context)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Lắng nghe yêu cầu từ Popup của Extension và làm cầu nối xuống Inject code
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === 'GET_AUDIOS') {
        // Cần phải lắng nghe câu trả lời từ inject.js
        const listener = (event) => {
            if (event.data && event.data.type === 'RESPONSE_AUDIOS') {
                window.removeEventListener('message', listener);
                // Gửi lại dữ liệu cho Popup
                sendResponse({ audios: event.data.payload });
            }
        };
        
        window.addEventListener('message', listener);
        // Hét xuống Main World đòi danh sách
        window.postMessage({ type: 'REQUEST_AUDIOS' }, '*');
        
        // Trả về true để chrome biết chúng ta sẽ sendResponse() sau 1 khoảng thời gian
        return true; 
    }
    
    if (request.action === 'DOWNLOAD') {
        // Ra lệnh tải dựa trên ID
        window.postMessage({ type: 'DOWNLOAD_AUDIO_BY_ID', id: request.id }, '*');
        sendResponse({ success: true });
        return false;
    }
});
