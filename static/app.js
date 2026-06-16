(function () {
    'use strict';

    function copyToClipboard(text) {
        return new Promise(function (resolve, reject) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(resolve).catch(function () {
                    fallbackCopy(text, resolve, reject);
                });
            } else {
                fallbackCopy(text, resolve, reject);
            }
        });
    }

    function fallbackCopy(text, resolve, reject) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) { resolve(); } else { reject(); }
        } catch (e) { reject(e); }
    }

    const RTC_CONFIG = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    const DEVICE_ICONS = { phone: '\u{1F4F1}', tablet: '\u{1F4DF}', desktop: '\u{1F4BB}' };

    let ws = null;
    let deviceId = localStorage.getItem('pd_device_id');
    if (!deviceId) {
        deviceId = 'p' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('pd_device_id', deviceId);
    }

    let deviceName = localStorage.getItem('pd_device_name') || '';
    const deviceType = detectDeviceType();
    const peers = {};
    const connections = {};

    let reqIdCounter = 0;
    const pendingOutgoing = {};
    let currentIncoming = null;

    let pendingFileMeta = null;
    let pendingFileData = [];

    let toastTimer = null;

    const el = (id) => document.getElementById(id);

    function detectDeviceType() {
        const ua = navigator.userAgent;
        if (/tablet|iPad|PlayBook|Silk|KF(ON|SA|TH|AP)|Xoom|Nexus\s(7|10|9)|Surface/i.test(ua)) return 'tablet';
        if (/Mobi|Android|iPhone|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i.test(ua)) return 'phone';
        return 'desktop';
    }

    function connectWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws');

        ws.onopen = () => {
            setStatus('connected');
            sendWS({ type: 'join', device_name: deviceName, device_id: deviceId, device_type: deviceType });
        };

        ws.onmessage = (e) => {
            try { handleMessage(JSON.parse(e.data)); }
            catch (err) { console.error('Bad message:', e.data); }
        };

        ws.onclose = () => {
            setStatus('disconnected');
            Object.keys(connections).forEach(cleanupPeer);
            setTimeout(connectWS, 2000);
        };

        ws.onerror = () => ws.close();
    }

    function sendWS(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function handleMessage(msg) {
        switch (msg.type) {
            case 'peer_list':
                msg.peers.forEach(p => addPeer(p.device_id, p.device_name, p.device_type));
                break;
            case 'peer_joined':
                addPeer(msg.device_id, msg.device_name, msg.device_type || 'desktop');
                break;
            case 'peer_left':
                removePeer(msg.device_id);
                break;
            case 'signal':
                handleSignal(msg.from, msg.from_name, msg.data);
                break;
        }
    }

    function addPeer(id, name, type) {
        if (id === deviceId || peers[id]) return;
        peers[id] = { id, name, type: type || 'desktop' };
        renderPeers();
        initiateConnection(id, name);
    }

    function removePeer(id) {
        delete peers[id];
        cleanupPeer(id);
        renderPeers();
    }

    function cleanupPeer(id) {
        if (connections[id]) {
            connections[id].dc && connections[id].dc.close();
            connections[id].pc && connections[id].pc.close();
            delete connections[id];
        }
    }

    function renderPeers() {
        const list = el('peer-list');
        list.innerHTML = '';
        const ids = Object.keys(peers);
        el('peer-count').textContent = ids.length;

        if (!ids.length) {
            list.innerHTML =
                '<div class="empty-state">' +
                '<div class="empty-icon">\u{1F5B1}\uFE0F</div>' +
                '<div class="empty-text">' + esc(t('device.none')) + '</div>' +
                '<div class="empty-hint">' + esc(t('device.hint')) + '</div>' +
                '</div>';
            return;
        }

        ids.forEach(id => {
            const p = peers[id];
            const icon = DEVICE_ICONS[p.type] || '\u{1F4BB}';
            const card = document.createElement('div');
            card.className = 'peer-card';
            card.innerHTML =
                '<div class="peer-avatar ' + p.type + '">' + icon + '</div>' +
                '<div class="peer-info">' +
                '<div class="peer-name">' + esc(p.name) + '</div>' +
                '<div class="peer-id" id="pst-' + id + '">connecting...</div>' +
                '</div>' +
                '<div class="peer-actions">' +
                '<button class="btn btn-text" onclick="window._sendText(\'' + id + '\')">' + esc(t('device.send_text')) + '</button>' +
                '<button class="btn btn-file" onclick="window._sendFile(\'' + id + '\')">' + esc(t('device.send_file')) + '</button>' +
                '</div>';
            list.appendChild(card);
        });
    }

    function initiateConnection(peerId, peerName) {
        if (connections[peerId]) return;

        const pc = new RTCPeerConnection(RTC_CONFIG);
        let dc = null;

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendWS({ type: 'signal', to: peerId, data: { type: 'ice', candidate: e.candidate } });
            }
        };

        pc.onconnectionstatechange = () => {
            const st = pc.connectionState;
            updatePeerStatus(peerId, st);
            if (st === 'failed' || st === 'disconnected') {
                removePeer(peerId);
            }
        };

        if (deviceId > peerId) {
            dc = pc.createDataChannel('pairdrop');
            setupDC(dc, peerId);
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                sendWS({ type: 'signal', to: peerId, data: { type: 'offer', sdp: offer.sdp } });
            }).catch(e => console.error('Offer error:', e));
        } else {
            pc.ondatachannel = (e) => {
                dc = e.channel;
                connections[peerId].dc = dc;
                setupDC(dc, peerId);
            };
        }

        connections[peerId] = { pc, dc };
    }

    function setupDC(dc, peerId) {
        dc.binaryType = 'arraybuffer';

        function onOpen() {
            updatePeerStatus(peerId, 'connected');
            connections[peerId].dc = dc;
        }

        if (dc.readyState === 'open') {
            onOpen();
        } else {
            dc.onopen = onOpen;
        }

        dc.onclose = () => updatePeerStatus(peerId, 'disconnected');
        dc.onmessage = (e) => {
            if (typeof e.data === 'string') {
                handleDCString(e.data, peerId);
            } else {
                handleDCBinary(e.data, peerId);
            }
        };
    }

    function handleDCString(data, peerId) {
        try {
            const msg = JSON.parse(data);
            const pName = peers[peerId] ? peers[peerId].name : peerId;

            if (msg.type === 'text') {
                showToast('\u{1F4CB}', t('toast.text_from', { name: pName }), msg.data, pName);
                addLog(t('log.text_received', { name: pName }));
                return;
            }

            if (msg.type === 'file_request') {
                if (currentIncoming) {
                    rejectRequest(msg.id, peerId);
                    return;
                }
                currentIncoming = { id: msg.id, peerId: peerId, fromName: pName, name: msg.name, size: msg.size };
                showFileModal(msg.id, pName, msg.name, msg.size);
                return;
            }

            if (msg.type === 'file_accept') {
                const pending = pendingOutgoing[msg.id];
                if (pending) {
                    delete pendingOutgoing[msg.id];
                    startFileSend(pending.peerId, pending.file, pending.dc);
                }
                return;
            }

            if (msg.type === 'file_reject') {
                const pending = pendingOutgoing[msg.id];
                if (pending) {
                    delete pendingOutgoing[msg.id];
                    addLog(t('log.file_rejected', { name: peers[pending.peerId] ? peers[pending.peerId].name : pending.peerId }));
                }
                return;
            }

            if (msg.type === 'file_start') {
                pendingFileMeta = { name: msg.name, size: msg.size, mime: msg.mime || 'application/octet-stream' };
                pendingFileData = [];
                return;
            }
        } catch (e) {
            console.error('DC string error:', e);
        }
    }

    function handleDCBinary(data, peerId) {
        if (!pendingFileMeta) return;

        let buf;
        if (data instanceof ArrayBuffer) {
            buf = data;
        } else if (data instanceof Blob) {
            data.arrayBuffer().then(function (ab) { handleDCBinary(ab, peerId); });
            return;
        } else if (data.buffer instanceof ArrayBuffer) {
            buf = data.buffer;
        } else {
            return;
        }

        pendingFileData.push(new Uint8Array(buf));
        const received = pendingFileData.reduce(function (a, b) { return a + b.length; }, 0);
        if (received >= pendingFileMeta.size) {
            finishFileDownload();
        }
    }

    function finishFileDownload() {
        if (!pendingFileMeta) return;
        const full = new Uint8Array(pendingFileMeta.size);
        let pos = 0;
        pendingFileData.forEach(function (chunk) {
            full.set(chunk, pos);
            pos += chunk.length;
        });
        const blob = new Blob([full], { type: pendingFileMeta.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = pendingFileMeta.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog(t('log.file_received', { name: pendingFileMeta.name }));
        pendingFileMeta = null;
        pendingFileData = [];
    }

    function handleSignal(from, fromName, data) {
        if (!connections[from]) {
            initiateConnection(from, fromName);
        }
        const pc = connections[from] && connections[from].pc;
        if (!pc) return;

        if (data.type === 'offer') {
            pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
                .then(function () { return pc.createAnswer(); })
                .then(function (answer) {
                    pc.setLocalDescription(answer);
                    sendWS({ type: 'signal', to: from, data: { type: 'answer', sdp: answer.sdp } });
                })
                .catch(function (e) { console.error('Offer handling error:', e); });
        } else if (data.type === 'answer') {
            pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
                .catch(function (e) { console.error('Answer handling error:', e); });
        } else if (data.type === 'ice') {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(function (e) { console.error('ICE error:', e); });
        }
    }

    function sendText(peerId) {
        const conn = connections[peerId];
        if (!conn || !conn.dc || conn.dc.readyState !== 'open') {
            alert(t('alert.conn_not_ready'));
            return;
        }

        const pName = peers[peerId] ? peers[peerId].name : peerId;
        el('text-modal-title').textContent = t('text.title', { name: pName });
        el('text-modal-input').value = '';
        el('text-modal').classList.remove('hidden');

        function submit() {
            const text = el('text-modal-input').value.trim();
            if (!text) { return; }
            el('text-modal').classList.add('hidden');
            doSendText(peerId, text);
        }

        el('text-modal-submit').onclick = submit;

        el('text-modal-clipboard').onclick = function () {
            navigator.clipboard.readText().then(function (text) {
                if (text) { el('text-modal-input').value = text; }
                el('text-modal-input').focus();
            }).catch(function () { el('text-modal-input').focus(); });
        };

        function cancel() { el('text-modal').classList.add('hidden'); }
        el('text-modal-cancel').onclick = cancel;

        el('text-modal-input').onkeydown = function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                var text = el('text-modal-input').value.trim();
                if (text) { el('text-modal').classList.add('hidden'); doSendText(peerId, text); }
            }
            if (e.key === 'Escape') { cancel(); }
        };

        setTimeout(function () { el('text-modal-input').focus(); }, 100);
    }

    document.querySelectorAll('.modal-overlay').forEach(function (m) {
        m.addEventListener('click', function (e) {
            if (e.target === this) this.classList.add('hidden');
        });
    });

    function doSendText(peerId, text) {
        if (!text) return;
        const conn = connections[peerId];
        if (!conn || !conn.dc || conn.dc.readyState !== 'open') {
            alert(t('alert.conn_lost'));
            return;
        }
        conn.dc.send(JSON.stringify({ type: 'text', data: text }));
        const pName = peers[peerId] ? peers[peerId].name : peerId;
        addLog(t('log.text_sent', { name: pName }));
    }

    function sendFile(peerId) {
        const conn = connections[peerId];
        if (!conn || !conn.dc || conn.dc.readyState !== 'open') {
            alert(t('alert.conn_not_ready'));
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = function () {
            const file = input.files[0];
            if (!file) return;

            const reqId = 'req_' + (++reqIdCounter) + '_' + deviceId;
            conn.dc.send(JSON.stringify({
                type: 'file_request',
                id: reqId,
                name: file.name,
                size: file.size,
                mime: file.type || 'application/octet-stream'
            }));
            pendingOutgoing[reqId] = { peerId: peerId, file: file, dc: conn.dc, name: file.name };
            const pName = peers[peerId] ? peers[peerId].name : peerId;
            addLog(t('log.file_request', { file: file.name, name: pName }));

            setTimeout(function () {
                if (pendingOutgoing[reqId]) {
                    delete pendingOutgoing[reqId];
                    addLog(t('log.file_request_timeout', { name: pName }));
                }
            }, 30000);
        };
        input.click();
    }

    function startFileSend(peerId, file, dc) {
        const CHUNK_SIZE = 16 * 1024;
        let offset = 0;

        dc.send(JSON.stringify({
            type: 'file_start',
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream'
        }));

        function sendNext() {
            if (offset >= file.size) {
                addLog(t('log.file_sent', { file: file.name, name: peers[peerId] ? peers[peerId].name : peerId }));
                return;
            }
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const reader = new FileReader();
            reader.onload = function () {
                dc.send(new Uint8Array(reader.result));
                offset += CHUNK_SIZE;
                setTimeout(sendNext, 0);
            };
            reader.readAsArrayBuffer(chunk);
        }
        sendNext();
    }

    window._sendText = sendText;
    window._sendFile = sendFile;

    function showFileModal(reqId, fromName, fileName, fileSize) {
        el('modal-sender').textContent = t('file.from') + ' ' + fromName;
        el('modal-fileinfo').textContent = t('file.name') + ' ' + fileName;
        el('modal-filesize').textContent = t('file.size') + ' ' + formatSize(fileSize);
        el('file-modal').classList.remove('hidden');

        el('modal-accept').onclick = function () {
            el('file-modal').classList.add('hidden');
            if (currentIncoming && currentIncoming.id === reqId) {
                const dc = connections[currentIncoming.peerId] && connections[currentIncoming.peerId].dc;
                if (dc && dc.readyState === 'open') {
                    dc.send(JSON.stringify({ type: 'file_accept', id: reqId }));
                    addLog(t('log.file_accepted', { file: fileName, name: fromName }));
                }
                currentIncoming = null;
            }
        };

        el('modal-reject').onclick = function () {
            rejectRequest(reqId, currentIncoming ? currentIncoming.peerId : null);
        };
    }

    function rejectRequest(reqId, peerId) {
        el('file-modal').classList.add('hidden');
        peerId = peerId || (currentIncoming ? currentIncoming.peerId : null);
        if (peerId) {
            const dc = connections[peerId] && connections[peerId].dc;
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'file_reject', id: reqId }));
            }
        }
        if (currentIncoming && currentIncoming.id === reqId) {
            currentIncoming = null;
        }
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    function showToast(icon, title, body, peerName) {
        if (toastTimer) {
            clearTimeout(toastTimer);
            el('toast').classList.remove('fade-out');
        }
        el('toast').classList.remove('hidden');
        el('toast-icon').textContent = icon;
        el('toast-title').textContent = title;
        el('toast-body').textContent = body.length > 200 ? body.substring(0, 200) + '...' : body;

        var copyBtn = el('toast-copy');
        if (peerName) {
            copyBtn.style.display = '';
            function doCopy() {
                copyToClipboard(body).then(function () {
                    copyBtn.textContent = '\u2713';
                    el('toast-title').textContent = t('toast.copied_from', { name: peerName });
                    setTimeout(function () { copyBtn.textContent = t('toast.copy'); }, 2000);
                }).catch(function () {});
            }
            copyBtn.onclick = doCopy;
            el('toast-body').onclick = doCopy;
        } else {
            copyBtn.style.display = 'none';
            el('toast-body').onclick = null;
        }

        var progress = el('toast-progress');
        progress.style.animation = 'none';
        void progress.offsetWidth;
        progress.style.animation = 'shrinkProgress 10s linear forwards';

        toastTimer = setTimeout(function () {
            el('toast').classList.add('fade-out');
            setTimeout(function () {
                el('toast').classList.add('hidden');
                el('toast').classList.remove('fade-out');
            }, 500);
            toastTimer = null;
        }, 10000);
    }

    el('toast-close').onclick = function () {
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        el('toast').classList.add('fade-out');
        setTimeout(function () {
            el('toast').classList.add('hidden');
            el('toast').classList.remove('fade-out');
        }, 500);
    };

    function editName() {
        const name = prompt(t('prompt.device_name'), deviceName);
        if (name && name.trim()) {
            deviceName = name.trim();
            localStorage.setItem('pd_device_name', deviceName);
            el('device-name').textContent = deviceName;
            if (ws && ws.readyState === WebSocket.OPEN) {
                sendWS({ type: 'join', device_name: deviceName, device_id: deviceId, device_type: deviceType });
            }
        }
    }

    window._editName = editName;

    function setStatus(cls) {
        const s = el('status');
        s.textContent = t('status.' + cls);
        s.className = 'status-inline ' + cls;
        el('status-dot').className = 'status-dot ' + cls;
    }

    function updatePeerStatus(peerId, status) {
        const s = document.getElementById('pst-' + peerId);
        if (s) {
            s.textContent = status;
            var color = '#666';
            if (status === 'connected') color = '#66bb6a';
            else if (status === 'failed') color = '#ef5350';
            else if (status === 'connecting' || status === 'new') color = '#ffa726';
            s.style.color = color;
        }
    }

    function addLog(msg) {
        const log = el('log');
        const empty = log.querySelector('.log-empty');
        if (empty) empty.remove();

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = '> ' + new Date().toLocaleTimeString() + ' - ' + msg;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    function esc(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function translatePage() {
        document.querySelectorAll('[data-lang]').forEach(function (el) {
            const key = el.getAttribute('data-lang');
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = t(key);
            } else {
                el.textContent = t(key);
            }
        });
        document.title = t('ui.title');
        renderPeers();
        setStatus(el('status').className.replace('status-inline ', ''));
    }

    document.addEventListener('DOMContentLoaded', function () {
        currentLang = detectLang();

        el('device-icon').textContent = DEVICE_ICONS[deviceType] || '\u{1F4BB}';

        if (!deviceName) {
            deviceName = prompt(t('prompt.device_name'), 'Device-' + deviceId.substring(0, 4));
            if (!deviceName || !deviceName.trim()) deviceName = 'Device-' + deviceId.substring(0, 4);
            localStorage.setItem('pd_device_name', deviceName);
        }
        el('device-name').textContent = deviceName;

        translatePage();

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        connectWS();
    });

})();
