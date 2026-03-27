const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// HEDEF IP (MESAJ BEKLEYEN KİŞİ - SEN)
const TARGET_IP = '151.250.6.36';

// Kullanıcıları sakla
const userSockets = new Map();
const ipToSocket = new Map();

// Offline mesajlar için dosya
const OFFLINE_FILE = path.join(__dirname, 'offline_messages.json');
if (!fs.existsSync(OFFLINE_FILE)) {
  fs.writeFileSync(OFFLINE_FILE, JSON.stringify([]));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/get-ip', (req, res) => {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ip = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
  res.json({ ip: ip, isTarget: ip === TARGET_IP });
});

io.on('connection', (socket) => {
  console.log('🔌 Yeni bağlantı:', socket.id);

  socket.on('register_ip', (ip) => {
    console.log(`📝 IP kaydedildi: ${ip}`);
    userSockets.set(socket.id, { ip, socket });
    ipToSocket.set(ip, socket.id);
    
    const isTarget = (ip === TARGET_IP);
    socket.emit('user_type', { isTarget: isTarget, myIp: ip });
    
    if (isTarget) {
      console.log('🎯 HEDEF KULLANICI (SEN) BAĞLANDI!');
      socket.emit('target_notification', { 
        message: '💖 Barışma portalına hoş geldin! Sevgilinden gelecek mesajları burada bekliyorsun.' 
      });
      
      // Offline mesajları kontrol et
      const offlineMessages = JSON.parse(fs.readFileSync(OFFLINE_FILE, 'utf8'));
      const myMessages = offlineMessages.filter(m => m.targetIP === ip);
      if (myMessages.length > 0) {
        myMessages.forEach(msg => {
          socket.emit('new_message', {
            message: msg.message,
            senderIP: msg.senderIP,
            isOffline: true
          });
        });
        const remaining = offlineMessages.filter(m => m.targetIP !== ip);
        fs.writeFileSync(OFFLINE_FILE, JSON.stringify(remaining));
      }
    }
  });

  // MESAJ GÖNDER (karşı taraftan gelen)
  socket.on('send_message', (data) => {
    const { targetIP, message, senderIP } = data;
    console.log(`📨 Mesaj: ${senderIP} -> ${targetIP}`);
    
    const targetSocketId = ipToSocket.get(targetIP);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('new_message', {
        message: message,
        senderIP: senderIP,
        timestamp: new Date().toLocaleString('tr-TR')
      });
      socket.emit('message_sent', { success: true, targetOnline: true });
      console.log(`✅ Mesaj iletildi: ${targetIP}`);
    } else {
      // Offline kaydet
      const offlineMessages = JSON.parse(fs.readFileSync(OFFLINE_FILE, 'utf8'));
      offlineMessages.push({
        message: message,
        senderIP: senderIP,
        targetIP: targetIP,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(OFFLINE_FILE, JSON.stringify(offlineMessages));
      socket.emit('message_sent', { success: false, targetOnline: false });
      console.log(`💾 Mesaj kaydedildi (offline): ${targetIP}`);
    }
  });

  socket.on('disconnect', () => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      console.log(`❌ Bağlantı kesildi: ${userInfo.ip}`);
      ipToSocket.delete(userInfo.ip);
      userSockets.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 SUNUCU ÇALIŞIYOR: http://localhost:${PORT}`);
  console.log(`🎯 HEDEF IP (MESAJ BEKLEYEN): ${TARGET_IP}`);
  console.log(`📌 Bu IP'ye sahip kişi siteye girince SADECE MESAJ BEKLEME EKRANI görür\n`);
});
