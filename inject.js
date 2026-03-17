(function() {
    const originalFetch = window.fetch;
    
    // Kho chứa lịch sử Audio trong Tab
    window.__CHATGPT_AUDIOS = [];

    // Giao tiếp với Content Script (được popup gọi)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'REQUEST_AUDIOS') {
            // Lọc ra các thông tin cần thiết gởi lên (Không gửi BlobUrl vì có thể lỗi security chéo máy ảo)
            const list = window.__CHATGPT_AUDIOS.map(item => ({
                id: item.id,
                filename: item.filename,
                time: item.time
            }));
            window.postMessage({ type: 'RESPONSE_AUDIOS', payload: list }, '*');
        } else if (event.data && event.data.type === 'DOWNLOAD_AUDIO_BY_ID') {
            // Tìm blob và tự tạo tải xuống
            const item = window.__CHATGPT_AUDIOS.find(x => x.id === event.data.id);
            if (item) {
                downloadBlob(item.blobUrl, item.filename);
            }
        }
    });

    function downloadBlob(blobUrl, filename) {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    
    // Ghi đè hàm fetch của trình duyệt để chặn mạng
    window.fetch = async function(...args) {
        let url = "";
        if (typeof args[0] === 'string') {
            url = args[0];
        } else if (args[0] && args[0].url) {
            url = args[0].url;
        }

        let loadingBtn = null;
        let audioId = null;

        // Nếu là request tải audio, hiển thị ngay nút Loading
        const synthesizeUrlIndicator = '/backend-api/synthesize';
        if (url && url.includes(synthesizeUrlIndicator)) {
            audioId = "audio_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
            loadingBtn = showLoadingButton(audioId);
        }

        try {
            // Gọi hàm fetch gốc để request vẫn được xử lý bình thường
            const response = await originalFetch.apply(this, args);
            
            if (url && url.includes(synthesizeUrlIndicator)) {
                // Clone response để không làm mất dữ liệu của trang web
                const responseClone = response.clone();
                responseClone.blob().then((blob) => {
                    const objectUrl = URL.createObjectURL(blob);
                    
                    const date = new Date();
                    const timeString = date.toLocaleTimeString().replace(/:/g, '-');
                    const timeStr = date.toLocaleTimeString();
                    const filename = `ChatGPT_Audio_${timeString}.aac`; 

                    // LƯU VÀO LỊCH SỬ TAB
                    window.__CHATGPT_AUDIOS.push({
                        id: audioId,
                        blobUrl: objectUrl,
                        filename: filename,
                        time: timeStr
                    });

                    // Chuyển nút Loading thành nút Download trên màn hình (sẽ tự xoá sau 60s)
                    turnLoadingToDownload(loadingBtn, objectUrl, filename, timeStr);

                }).catch(err => {
                    console.error("Không thể lấy dữ liệu Audio:", err);
                    if(loadingBtn) loadingBtn.remove();
                });
            }
            return response;
        } catch (error) {
            if(loadingBtn) loadingBtn.remove();
            throw error;
        }
    };

    function getContainer() {
        let container = document.getElementById('chatgpt-audio-download-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'chatgpt-audio-download-container';
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999999;
                display: flex;
                flex-direction: column;
                gap: 8px;
            `;
            document.body.appendChild(container);
        }
        return container;
    }

    function showLoadingButton(id) {
        const container = getContainer();
        const btn = document.createElement('button');
        btn.id = id;
        btn.innerHTML = `⏳ Đang xử lý Audio...`;
        btn.style.cssText = `
            padding: 8px 16px;
            background-color: #f59e0b; /* Màu cam để báo hiệu đang chờ */
            color: white;
            border: none;
            border-radius: 6px;
            cursor: wait;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            opacity: 0.9;
        `;
        container.appendChild(btn);
        return btn;
    }

    function turnLoadingToDownload(btn, blobUrl, filename, timeStr) {
        if (!btn) return;
        
        btn.innerHTML = `⬇️ Tải Audio (${timeStr})`;
        btn.style.cssText = `
            padding: 8px 16px;
            background-color: #10a37f; /* Màu xanh lá khi sẵn sàng */
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            transition: background-color 0.2s;
        `;
        
        btn.onmouseover = () => btn.style.backgroundColor = '#0e906f';
        btn.onmouseout = () => btn.style.backgroundColor = '#10a37f';
        
        btn.onclick = () => {
            downloadBlob(blobUrl, filename);
            btn.remove();
        };
        
        // Tự động xoá nút sau 60 giây nếu không bấm (vẫn tải được ở Popup)
        setTimeout(() => {
            if (btn.parentNode) {
                btn.remove();
            }
        }, 60000);
    }
})();
