const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

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

// Ana sayfa route'u
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Kullanıcıların IP'lerini sakla
const userSockets = new Map(); // socketId -> { ip, socket }
const ipToSocket = new Map(); // ip -> socketId

// HEDEF IP (barışılacak kişinin IP'si)
const TARGET_IP = '151.250.6.36';

// Ziyaretçinin IP'sini almak için middleware
app.get('/get-ip', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  res.json({ ip: ip.replace('::ffff:', '') });
});

io.on('connection', (socket) => {
  console.log('🔌 Yeni bağlantı:', socket.id);

  socket.on('register_ip', (ip) => {
    console.log(`📝 IP kaydedildi: ${ip} -> ${socket.id}`);
    userSockets.set(socket.id, { ip, socket });
    ipToSocket.set(ip, socket.id);
    
    // Hedef kullanıcıya özel mesaj
    if (ip === TARGET_IP) {
      socket.emit('target_user', { 
        message: 'Sen hedef kullanıcısın! Sevgilinden gelen mesajlar buraya gelecek.',
        isTarget: true 
      });
      console.log('🎯 Hedef kullanıcı bağlandı!');
    }
    
    // Bağlantı durumunu herkese bildir
    io.emit('user_status', { 
      ip: ip, 
      status: 'online',
      isTarget: ip === TARGET_IP
    });
  });

  // Mesaj gönderme
  socket.on('send_message', (data) => {
    const { targetIP, message, senderIP } = data;
    console.log(`📨 Mesaj: ${senderIP} -> ${targetIP}: ${message.content}`);
    
    // Hedef IP'ye sahip kullanıcıya mesajı ilet
    const targetSocketId = ipToSocket.get(targetIP);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('new_message', {
        message: message,
        senderIP: senderIP,
        targetIP: targetIP
      });
      console.log(`✅ Mesaj iletildi: ${targetIP}`);
      
      // Gönderene onay
      socket.emit('message_sent', { 
        success: true, 
        message: message,
        targetOnline: true
      });
    } else {
      console.log(`⚠️ Hedef IP bulunamadı veya çevrimdışı: ${targetIP}`);
      
      // Mesajı bekleme listesine kaydet (offline mesaj)
      const offlineMessages = JSON.parse(require('fs').readFileSync('./offline_messages.json', 'utf8') || '[]');
      offlineMessages.push({
        message: message,
        senderIP: senderIP,
        targetIP: targetIP,
        timestamp: new Date().toISOString()
      });
      require('fs').writeFileSync('./offline_messages.json', JSON.stringify(offlineMessages));
      
      socket.emit('message_sent', { 
        success: false, 
        error: 'Hedef kullanıcı çevrimdışı, mesaj kaydedildi',
        message: message 
      });
    }
  });

  // Yanıt mesajı
  socket.on('send_reply', (data) => {
    const { originalSenderIP, replyMessage, senderIP } = data;
    console.log(`💬 Yanıt: ${senderIP} -> ${originalSenderIP}`);
    
    const targetSocketId = ipToSocket.get(originalSenderIP);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('new_reply', {
        message: replyMessage,
        senderIP: senderIP,
        timestamp: new Date().toLocaleString('tr-TR')
      });
      socket.emit('reply_sent', { success: true });
    } else {
      socket.emit('reply_sent', { success: false, error: 'Kullanıcı çevrimdışı' });
    }
  });

  // Bağlantı kesilme
  socket.on('disconnect', () => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      console.log(`❌ Bağlantı kesildi: ${userInfo.ip}`);
      io.emit('user_status', { 
        ip: userInfo.ip, 
        status: 'offline',
        isTarget: userInfo.ip === TARGET_IP
      });
      ipToSocket.delete(userInfo.ip);
      userSockets.delete(socket.id);
    }
  });
  
  // Offline mesajları kontrol et (yeni bağlanan kullanıcıya)
  const fs = require('fs');
  if (fs.existsSync('./offline_messages.json')) {
    const offlineMessages = JSON.parse(fs.readFileSync('./offline_messages.json', 'utf8') || '[]');
    const userMessages = offlineMessages.filter(m => m.targetIP === socket.handshake.address);
    userMessages.forEach(msg => {
      socket.emit('new_message', {
        message: msg.message,
        senderIP: msg.senderIP,
        targetIP: msg.targetIP,
        isOffline: true
      });
    });
    // Gönderilen mesajları temizle
    const remaining = offlineMessages.filter(m => !userMessages.includes(m));
    fs.writeFileSync('./offline_messages.json', JSON.stringify(remaining));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 SUNUCU BAŞARIYLA ÇALIŞIYOR!`);
  console.log(`📍 Adres: http://localhost:${PORT}`);
  console.log(`🎯 Hedef IP: ${TARGET_IP}`);
  console.log(`💡 İki farklı tarayıcıda açarak mesajlaşmayı test edebilirsiniz\n`);
});
