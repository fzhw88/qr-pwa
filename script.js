document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素 ---
    const startStopBtn = document.getElementById('start-stop-btn');
    const cameraSelect = document.getElementById('camera-select');
    const sessionResultsList = document.getElementById('session-results-list');
    const historyList = document.getElementById('history-list');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    const historyCountEl = document.getElementById('history-count');
    
    // 云同步元素
    const githubTokenInput = document.getElementById('github-token');
    const cloudUploadBtn = document.getElementById('cloud-upload-btn');
    const cloudDownloadBtn = document.getElementById('cloud-download-btn');
    const cloudStatus = document.getElementById('cloud-status');

    // --- 状态和常量 ---
    const HISTORY_KEY = 'qrScannerHistory';
    const TOKEN_KEY = 'qrScannerGithubToken';
    const GIST_FILENAME = 'qr-scanner-backup.json'; // Gist 中的文件名
    const GIST_DESC = 'QR Scanner History Backup (Auto-generated)';
    
    let html5QrCode;
    let isScanning = false;
    let lastResult = null;
    let lastResultTime = null;

    // --- 音频上下文 ---
    let audioContext;
    try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}

    function playBeep() {
        if (!audioContext) return;

        // 兼容性处理：确保音频上下文在交互后处于激活状态
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const now = audioContext.currentTime;

        // --- “叮” (高音部分 - High Pitch) ---
        const osc1 = audioContext.createOscillator();
        const gain1 = audioContext.createGain();
        
        osc1.type = 'sine'; 
        osc1.frequency.setValueAtTime(1046.5, now); // C6 
        
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.5, now + 0.01); // 快速起音，音量加大
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.4); // 较长的自然消失
        
        osc1.connect(gain1);
        gain1.connect(audioContext.destination);
        
        osc1.start(now);
        osc1.stop(now + 0.5);

        // --- “咚” (低音部分 - Low Pitch) ---
        // 在“叮”开始 0.12 秒后触发，形成连贯的“叮咚”感
        const startTime2 = now + 0.12;
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(783.99, startTime2); // G5
        
        gain2.gain.setValueAtTime(0, startTime2);
        gain2.gain.linearRampToValueAtTime(0.4, startTime2 + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.01, startTime2 + 0.7); // 咚声余音更长，更有辨识度
        
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        
        osc2.start(startTime2);
        osc2.stop(startTime2 + 0.8);
    }

    // --- 基础历史记录功能 ---
    function getHistory() {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    }

    function saveHistoryToLocal(history) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        loadHistory();
    }

    function saveToHistory(text) {
        const history = getHistory();
        const timestamp = new Date().toISOString();
        history.unshift({ text, timestamp });
        saveHistoryToLocal(history);
    }

    function loadHistory() {
        const history = getHistory();
        historyList.innerHTML = '';
        historyCountEl.textContent = `(共 ${history.length} 条)`;
        if (history.length === 0) {
            historyList.innerHTML = '<li>暂无历史记录</li>';
            return;
        }
        history.forEach(item => {
            const li = document.createElement('li');
            const textNode = document.createElement('span');
            textNode.textContent = item.text;
            const timeNode = document.createElement('span');
            timeNode.className = 'timestamp';
            timeNode.textContent = new Date(item.timestamp).toLocaleString();
            li.appendChild(textNode);
            li.appendChild(timeNode);
            historyList.appendChild(li);
        });
    }

    function addSessionResultToUI(text) {
        const li = document.createElement('li');
        li.textContent = text;
        sessionResultsList.prepend(li);
    }

    function exportHistory() {
        const history = getHistory();
        if (history.length === 0) return alert('无记录可导出');
        const escapeCSV = (str) => {
            let result = String(str);
            if (result.search(/("|,|\n)/g) >= 0) result = '"' + result.replace(/"/g, '""') + '"';
            return result;
        };
        let csvRows = ["\uFEFFTimestamp,Content"];
        history.forEach(item => csvRows.push(`${new Date(item.timestamp).toLocaleString()},${escapeCSV(item.text)}`));
        const url = URL.createObjectURL(new Blob([csvRows.join("\r\n")], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qr-history.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function clearHistory() {
        if (confirm('确定清空？')) {
            localStorage.removeItem(HISTORY_KEY);
            loadHistory();
        }
    }

    // --- 🚀 云同步功能实现 (GitHub Gist) ---

    // 1. 加载保存的 Token
    githubTokenInput.value = localStorage.getItem(TOKEN_KEY) || '';
    githubTokenInput.addEventListener('change', () => {
        localStorage.setItem(TOKEN_KEY, githubTokenInput.value.trim());
    });

    function updateStatus(msg, isError = false) {
        cloudStatus.textContent = msg;
        cloudStatus.style.color = isError ? 'red' : 'green';
        setTimeout(() => cloudStatus.textContent = '', 5000);
    }

    async function findMyGist(token) {
        // 获取用户的所有 Gist，寻找描述匹配的
        const response = await fetch('https://api.github.com/gists', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!response.ok) throw new Error('Token 无效或网络错误');
        const gists = await response.json();
        return gists.find(g => g.description === GIST_DESC);
    }

    async function createGist(token, content) {
        const response = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: GIST_DESC,
                public: false, // 私有 Gist
                files: { [GIST_FILENAME]: { content: content } }
            })
        });
        if (!response.ok) throw new Error('创建 Gist 失败');
    }

    async function updateGist(token, gistId, content) {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: { [GIST_FILENAME]: { content: content } }
            })
        });
        if (!response.ok) throw new Error('更新 Gist 失败');
    }

    // 上传逻辑 (覆盖云端)
    cloudUploadBtn.addEventListener('click', async () => {
        const token = githubTokenInput.value.trim();
        if (!token) return alert('请输入 GitHub Token');
        
        const history = getHistory();
        if (history.length === 0) return alert('本地没有记录可上传');

        cloudUploadBtn.disabled = true;
        cloudStatus.textContent = '正在连接 GitHub...';

        try {
            const content = JSON.stringify(history, null, 2);
            const existingGist = await findMyGist(token);
            
            if (existingGist) {
                await updateGist(token, existingGist.id, content);
                updateStatus('✅ 上传成功！云端记录已更新。');
            } else {
                await createGist(token, content);
                updateStatus('✅ 创建并上传成功！(Private Gist)');
            }
        } catch (err) {
            updateStatus(`❌ 失败: ${err.message}`, true);
        } finally {
            cloudUploadBtn.disabled = false;
        }
    });

    // 下载逻辑 (合并到本地)
    cloudDownloadBtn.addEventListener('click', async () => {
        const token = githubTokenInput.value.trim();
        if (!token) return alert('请输入 GitHub Token');

        cloudDownloadBtn.disabled = true;
        cloudStatus.textContent = '正在查找云端备份...';

        try {
            const existingGist = await findMyGist(token);
            if (!existingGist) throw new Error('未找到云端备份文件');

            const file = existingGist.files[GIST_FILENAME];
            if (!file || !file.raw_url) throw new Error('备份文件损坏');

            // 获取原始内容
            const rawResponse = await fetch(file.raw_url);
            const cloudHistory = await rawResponse.json();

            // 🚀 智能合并逻辑：去重
            const localHistory = getHistory();
            // 使用 Map 以 "时间戳+内容" 为 key 进行去重
            const historyMap = new Map();
            
            // 先放入本地
            localHistory.forEach(item => historyMap.set(item.timestamp + item.text, item));
            // 再放入云端 (如果 key 相同，这里逻辑是不覆盖还是覆盖？既然是 key 相同，内容也相同，无所谓)
            // 但为了防止时间戳微小差异，我们也可以只用 text 去重？
            // 不，严格去重比较安全。
            cloudHistory.forEach(item => historyMap.set(item.timestamp + item.text, item));

            // 转回数组并按时间倒序排序
            const mergedHistory = Array.from(historyMap.values()).sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            saveHistoryToLocal(mergedHistory);
            updateStatus(`✅ 同步成功！合并后共 ${mergedHistory.length} 条。`);

        } catch (err) {
            updateStatus(`❌ 失败: ${err.message}`, true);
        } finally {
            cloudDownloadBtn.disabled = false;
        }
    });


    // --- 扫描逻辑 ---
    const onScanSuccess = (decodedText, decodedResult) => {
        const now = Date.now();
        if (decodedText === lastResult && (now - lastResultTime) < 2000) return;
        lastResult = decodedText;
        lastResultTime = now;
        playBeep();
        addSessionResultToUI(decodedText);
        saveToHistory(decodedText);
    };

    function startScanning() {
        const selectedCameraId = cameraSelect.value;
        html5QrCode.start(
            selectedCameraId, 
            { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
            onScanSuccess,
            () => {}
        ).then(() => {
            isScanning = true;
            startStopBtn.textContent = '停止扫描';
            startStopBtn.classList.add('scanning');
            cameraSelect.disabled = true;
        }).catch(err => alert("无法启动摄像头，请检查权限。"));
    }

    function stopScanning() {
        html5QrCode.stop().then(() => {
            isScanning = false;
            startStopBtn.textContent = '开始扫描';
            startStopBtn.classList.remove('scanning');
            cameraSelect.disabled = false;
            lastResult = null;
        }).catch(console.error);
    }

    function initialize() {
        html5QrCode = new Html5Qrcode("qr-reader");
        Html5Qrcode.getCameras().then(cameras => {
            if (cameras && cameras.length) {
                cameraSelect.innerHTML = '';
                cameras.forEach(camera => {
                    const option = document.createElement('option');
                    option.value = camera.id;
                    option.textContent = camera.label || `摄像头 ${camera.id}`;
                    if (camera.label.toLowerCase().includes('back') || camera.label.toLowerCase().includes('后置')) option.selected = true;
                    cameraSelect.appendChild(option);
                });
                cameraSelect.style.display = 'block';
            }
        });
        startStopBtn.addEventListener('click', () => isScanning ? stopScanning() : startScanning());
        exportBtn.addEventListener('click', exportHistory);
        clearBtn.addEventListener('click', clearHistory);
        loadHistory();
    }

    initialize();
});

