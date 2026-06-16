const LANG = {
  en: {
    'ui.title': 'ppdrop',
    'ui.device': 'Device:',
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected - reconnecting...',
    'section.devices': 'Devices',
    'device.count': '{n}',
    'device.none': 'No devices yet',
    'device.hint': 'Open this page on another device on the same network',
    'device.send_text': 'Send Text',
    'device.send_file': 'Send File',
    'section.activity': 'Activity',
    'activity.none': 'Waiting for activity...',
    'text.title': 'Send text to {name}',
    'text.placeholder': 'Type or paste text here...',
    'text.read_clipboard': '📋 Read Clipboard',
    'text.cancel': 'Cancel',
    'text.send': 'Send',
    'file.title': 'Incoming File Transfer',
    'file.from': 'From:',
    'file.name': 'File:',
    'file.size': 'Size:',
    'file.reject': 'Reject',
    'file.accept': 'Accept & Download',
    'toast.text_from': 'Text from {name}',
    'toast.copied_from': 'Copied from {name}',
    'toast.copy': 'Copy',
    'log.text_sent': 'Sent text to {name}',
    'log.text_received': 'Received text from {name}',
    'log.file_request': 'Sent file request "{file}" to {name} (awaiting approval)',
    'log.file_request_timeout': 'File request to {name} timed out',
    'log.file_sent': 'Sent file "{file}" to {name}',
    'log.file_received': 'Received file: {name}',
    'log.file_accepted': 'Accepted file "{file}" from {name}',
    'log.file_rejected': 'File transfer rejected by {name}',
    'prompt.device_name': 'Enter your device name:',
    'alert.enter_text': 'Enter some text first.',
    'alert.conn_not_ready': 'Connection not ready. Please wait...',
    'alert.conn_lost': 'Connection lost.',
    'lang.name': 'English',
  },

  zh: {
    'ui.title': 'ppdrop',
    'ui.device': '设备:',
    'status.connected': '已连接',
    'status.disconnected': '已断开 - 正在重连...',
    'section.devices': '设备',
    'device.count': '{n}',
    'device.none': '暂无设备',
    'device.hint': '在同网络的另一台设备上打开此页面',
    'device.send_text': '发送文本',
    'device.send_file': '发送文件',
    'section.activity': '活动',
    'activity.none': '等待活动记录...',
    'text.title': '发送文本给 {name}',
    'text.placeholder': '在此输入或粘贴文本...',
    'text.read_clipboard': '📋 读取剪贴板',
    'text.cancel': '取消',
    'text.send': '发送',
    'file.title': '接收文件',
    'file.from': '来自:',
    'file.name': '文件:',
    'file.size': '大小:',
    'file.reject': '拒绝',
    'file.accept': '接受并下载',
    'toast.text_from': '来自 {name} 的文本',
    'toast.copied_from': '已复制来自 {name} 的文本',
    'toast.copy': '复制',
    'log.text_sent': '已发送文本给 {name}',
    'log.text_received': '已收到来自 {name} 的文本',
    'log.file_request': '已发送文件请求 "{file}" 给 {name}（等待对方确认）',
    'log.file_request_timeout': '给 {name} 的文件请求超时',
    'log.file_sent': '已发送文件 "{file}" 给 {name}',
    'log.file_received': '收到文件: {name}',
    'log.file_accepted': '已接受来自 {name} 的文件 "{file}"',
    'log.file_rejected': '{name} 拒绝了文件传输',
    'prompt.device_name': '输入设备名称:',
    'alert.enter_text': '请先输入文本。',
    'alert.conn_not_ready': '连接未就绪，请稍候...',
    'alert.conn_lost': '连接已断开。',
    'lang.name': '中文',
  },
};

let currentLang = 'en';

function detectLang() {
  const saved = localStorage.getItem('pd_lang');
  if (saved && LANG[saved]) return saved;
  const browser = (navigator.language || '').split('-')[0];
  return LANG[browser] ? browser : 'en';
}

function setLang(lang) {
  if (!LANG[lang]) return;
  currentLang = lang;
  localStorage.setItem('pd_lang', lang);
  translatePage();
}

function t(key, params) {
  const text = LANG[currentLang]?.[key] || LANG.en[key] || key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}
