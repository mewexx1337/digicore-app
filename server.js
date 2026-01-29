const { SignalingServer } = require('y-webrtc/bin/server.js');
const port = process.env.PORT || 10000;
const host = '0.0.0.0';

// Этот код запустит тот же сервер, но с правильным логом
console.log(`Проверка: Сервер запускается на ${host}:${port}...`);
// Сервер y-webrtc автоматически слушает PORT из окружения