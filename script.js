document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素 ---
    const startStopBtn = document.getElementById('start-stop-btn');
    const cameraSelect = document.getElementById('camera-select');
    const sessionResultsList = document.getElementById('session-results-list');
    const historyList = document.getElementById('history-list');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    // 优化点 4: 获取计数元素
    const historyCountEl = document.getElementById('history-count');

    // --- 状态和常量 ---
    const HISTORY_KEY = 'qrScannerHistory';
    let html5QrCode;
    let isScanning = false;
    let lastResult = null;
    let lastResultTime = null;

    // --- 音频上下文 (用于播放提示音) ---
    let audioContext;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn("Web Audio API is not supported in this browser.");
    }

    /**
     * 优化点 3: 播放扫描成功提示音 (延长并增加渐出)
     */
    function playBeep() {
        if (!audioContext) return;
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        
        // 声音从 0.3 音量开始
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        // 在 0.3 秒内线性减弱到 0，避免爆音
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3); // 持续 0.3 秒
    }

    /**
     * 获取本地存储的历史记录
     * @returns {Array} 历史记录数组
     */
    function getHistory() {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    }

    /**
     * 保存一条记录到历史
     * @param {string} text - 扫描到的文本
     */
    function saveToHistory(text) {
        const history = getHistory();
        const timestamp = new Date().toISOString();
        history.unshift({ text, timestamp }); // 最新记录放在最前面
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        loadHistory(); // 保存后重新加载历史列表（会更新计数）
    }

    /**
     * 优化点 4: 将历史记录加载到 UI (并更新计数)
     */
    function loadHistory() {
        const history = getHistory();
        historyList.innerHTML = ''; // 清空
        
        // 更新计数
        historyCountEl.textContent = `(共 ${history.length} 条)`;

        if (history.length === 0) {
            historyList.innerHTML = '<li>暂无历史记录</li>';
            return;
        }
        history.forEach(item => {
            addHistoryItemToUI(item.text, item.timestamp);
        });
    }

    /**
     * 添加单条历史记录到 UI
     * @param {string} text - 扫描文本
     * @param {string} timestamp - ISO 格式时间戳
     */
    function addHistoryItemToUI(text, timestamp) {
        const li = document.createElement('li');
        
        const textNode = document.createElement('span');
        textNode.textContent = text;
        
        const timeNode = document.createElement('span');
        timeNode.className = 'timestamp';
        timeNode.textContent = new Date(timestamp).toLocaleString();
        
        li.appendChild(textNode);
        li.appendChild(timeNode);
        historyList.appendChild(li);
    }

    /**
     * 添加单条“本次扫描”结果到 UI
     * @param {string} text - 扫描文本
     */
    function addSessionResultToUI(text) {
        const li = document.createElement('li');
        li.textContent = text;
        sessionResultsList.prepend(li); // 插入到最前面
    }

    /**
     * 优化点 2: 导出历史记录为 CSV 文件
     */
    function exportHistory() {
        const history = getHistory();
        if (history.length === 0) {
            alert('没有历史记录可以导出。');
            return;
        }

        // 辅助函数：转义CSV字段，防止内容中的逗号或引号导致格式错乱
        const escapeCSV = (str) => {
            let result = String(str);
            // 如果字段包含逗号、换行符或双引号
            if (result.search(/("|,|\n)/g) >= 0) {
                // 用双引号包裹，并将内部的双引号转义为两个双引号
                result = '"' + result.replace(/"/g, '""') + '"';
            }
            return result;
        };

        // CSV 头部 ( \uFEFF 是 BOM 头，确保 Excel 正确识别 UTF-8 )
        let csvRows = ["\uFEFFTimestamp,Content"];

        // 添加数据行
        history.forEach(item => {
            const timestamp = new Date(item.timestamp).toLocaleString(); // 使用本地化时间
            const content = escapeCSV(item.text);
            csvRows.push(`${timestamp},${content}`);
        });

        const csvString = csvRows.join("\r\n"); // 使用 Windows 换行符
        const dataBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(dataBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qr-history.csv'; // 文件名修改为 .csv
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 清空所有历史记录
     */
    function clearHistory() {
        if (confirm('确定要清空所有历史记录吗？此操作不可撤销。')) {
            localStorage.removeItem(HISTORY_KEY);
            loadHistory(); // 重新加载（会显示为空并更新计数为 0）
            alert('历史记录已清空。');
        }
    }

    /**
     * 扫描成功的回调
     * @param {string} decodedText - 解码后的文本
     * @param {object} decodedResult - 解码结果详情
     */
    const onScanSuccess = (decodedText, decodedResult) => {
        const now = Date.now();
        
        // 防抖逻辑：2秒内相同的码只处理一次
        if (decodedText === lastResult && (now - lastResultTime) < 2000) {
            return;
        }

        lastResult = decodedText;
        lastResultTime = now;

        playBeep(); // 播放提示音
        addSessionResultToUI(decodedText); // 添加到本次会话列表
        saveToHistory(decodedText); // 保存到本地存储
    };

    /**
     * 扫描失败的回调（通常不需要处理）
     * @param {string} error - 错误信息
     */
    const onScanFailure = (error) => {
        // console.warn(`QR 扫描错误: ${error}`);
    };

    /**
     * 开始扫描
     */
    function startScanning() {
        const selectedCameraId = cameraSelect.value;
        html5QrCode.start(
            selectedCameraId, 
            {
                fps: 10, // 扫描帧率
                qrbox: { width: 250, height: 250 } // 扫描框大小
            },
            onScanSuccess,
            onScanFailure
        ).then(() => {
            isScanning = true;
            startStopBtn.textContent = '停止扫描';
            startStopBtn.classList.add('scanning');
            cameraSelect.disabled = true; // 扫描时禁止切换
        }).catch(err => {
            console.error("无法启动扫描器: ", err);
            alert("无法启动摄像头，请检查权限。");
        });
    }

    /**
     * 停止扫描
     */
    function stopScanning() {
        html5QrCode.stop().then(() => {
            isScanning = false;
            startStopBtn.textContent = '开始扫描';
            startStopBtn.classList.remove('scanning');
            cameraSelect.disabled = false; // 允许切换
            lastResult = null; // 重置防抖
            lastResultTime = null;
        }).catch(err => {
            console.error("停止扫描时出错: ", err);
        });
    }

    /**
     * 初始化扫描器和事件监听
     */
    function initialize() {
        // 实例化扫描器
        html5QrCode = new Html5Qrcode("qr-reader");

        // 获取摄像头并填充下拉框
        Html5Qrcode.getCameras().then(cameras => {
            if (cameras && cameras.length) {
                cameraSelect.innerHTML = ''; // 清空
                cameras.forEach(camera => {
                    const option = document.createElement('option');
                    option.value = camera.id;
                    // 尝试将后置摄像头设为默认
                    option.textContent = camera.label || `摄像头 ${camera.id}`;
                    if (camera.label.toLowerCase().includes('back') || camera.label.toLowerCase().includes('后置')) {
                        option.selected = true;
                    }
                    cameraSelect.appendChild(option);
                });
                cameraSelect.style.display = 'block'; // 显示下拉框
            }
        }).catch(err => {
            console.error("获取摄像头失败: ", err);
            alert("获取摄像头列表失败。");
        });

        // 绑定事件
        startStopBtn.addEventListener('click', () => {
            if (isScanning) {
                stopScanning();
            } else {
                startScanning();
            }
        });

        exportBtn.addEventListener('click', exportHistory);
        clearBtn.addEventListener('click', clearHistory);

        // 页面加载时载入历史记录
        loadHistory();
    }

    // --- 启动应用 ---
    initialize();
});