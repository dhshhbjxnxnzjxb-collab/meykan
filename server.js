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

const userSockets = new Map();
const ipToSocket = new Map();

const OFFLINE_FILE = path.join(__dirname, 'offline_messages.json');
if (!fs.existsSync(OFFLINE_FILE)) {
  fs.writeFileSync(OFFLINE_FILE, JSON.stringify([]));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GERÇEK IP'Yİ DOĞRU ALAN FONKSİYON
function getRealIP(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Eğer birden fazla IP varsa (proxy'den geliyorsa), ilkini al (gerçek kullanıcı IP'si)
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  
  // IPv6 prefix'ini temizle
  ip = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');
  
  // Localhost ise 127.0.0.1 yap
  if (ip === '::1' || ip === 'localhost') {
    ip = '127.0.0.1';
  }
  
  return ip;
}

app.get('/get-ip', (req, res) => {
  const ip = getRealIP(req);
  res.json({ 
    ip: ip, 
    isTarget: (ip === TARGET_IP),
    rawHeaders: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });
});

io.on('connection', (socket) => {
  console.log('🔌 Yeni bağlantı:', socket.id);

  socket.on('register_ip', (ip) => {
    // IP'yi temizle
    let cleanIp = ip;
    if (cleanIp && cleanIp.includes(',')) {
      cleanIp = cleanIp.split(',')[0].trim();
    }
    cleanIp = cleanIp.replace('::ffff:', '');
    
    console.log(`📝 IP kaydedildi: ${cleanIp}`);
    userSockets.set(socket.id, { ip: cleanIp, socket });
    ipToSocket.set(cleanIp, socket.id);
    
    const isTarget = (cleanIp === TARGET_IP);
    socket.emit('user_type', { isTarget: isTarget, myIp: cleanIp });
    
    if (isTarget) {
      console.log('🎯 HEDEF KULLANICI (SEN) BAĞLANDI!');
      socket.emit('target_notification', { 
        message: '💖 Barışma portalına hoş geldin! Sevgilinden gelecek mesajları burada bekliyorsun.' 
      });
      
      const offlineMessages = JSON.parse(fs.readFileSync(OFFLINE_FILE, 'utf8'));
      const myMessages = offlineMessages.filter(m => m.targetIP === cleanIp);
      if (myMessages.length > 0) {
        myMessages.forEach(msg => {
          socket.emit('new_message', {
            message: msg.message,
            senderIP: msg.senderIP,
            isOffline: true
          });
        });
        const remaining = offlineMessages.filter(m => m.targetIP !== cleanIp);
        fs.writeFileSync(OFFLINE_FILE, JSON.stringify(remaining));
      }
    }
  });

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
  console.log(`💡 NOT: Eğer Cloudflare veya proxy kullanıyorsan, gerçek IP'nin ${TARGET_IP} olup olmadığını kontrol et`);
});
