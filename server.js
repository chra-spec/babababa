const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB (fotoğraf, ses, video, çıkartma için yeterli)
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sabit oda kodu
const ROOM_CODE = 'efkaza7634';
const rooms = new Map();

function generateUserColor(username) {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
  const index = username ? username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) : 0;
  return colors[index % colors.length];
}

function updateUserList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const userList = Array.from(room.users.values()).map(u => ({
    id: u.id,
    userName: u.userName,
    userPhoto: u.userPhoto,
    userColor: u.userColor
  }));
  io.to(roomCode).emit('user-list-update', userList);
}

io.on('connection', (socket) => {
  console.log('✅ Bağlandı:', socket.id);

  let currentUser = null;
  let currentRoomCode = null;

  socket.on('join-chat', (data) => {
    try {
      const { roomCode, userName, userPhoto } = data;

      if (roomCode !== ROOM_CODE) {
        socket.emit('error', { message: 'Geçersiz oda kodu' });
        return;
      }

      if (!rooms.has(ROOM_CODE)) {
        rooms.set(ROOM_CODE, {
          code: ROOM_CODE,
          users: new Map(),
          messages: [],
          createdAt: new Date()
        });
      }

      const room = rooms.get(ROOM_CODE);

      currentUser = {
        id: socket.id,
        userName: userName,
        userPhoto: userPhoto || '',
        userColor: generateUserColor(userName)
      };

      room.users.set(socket.id, currentUser);
      currentRoomCode = ROOM_CODE;
      socket.join(ROOM_CODE);

      // Geçmiş mesajları gönder (son 50)
      const previousMessages = room.messages.slice(-50);
      previousMessages.forEach(msg => socket.emit('message', msg));

      socket.to(ROOM_CODE).emit('user-joined', { userName: currentUser.userName });
      updateUserList(ROOM_CODE);

      console.log(`✅ ${userName} sohbete katıldı`);
    } catch (error) {
      console.error('❌ Katılma hatası:', error);
      socket.emit('error', { message: 'Sohbete katılamadı' });
    }
  });

  // Yeni mesaj (text, image, video, sticker, audio)
  socket.on('message', (data) => {
    try {
      if (!currentRoomCode || !currentUser) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;

      const message = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userName: currentUser.userName,
        userPhoto: currentUser.userPhoto,
        userColor: currentUser.userColor,
        type: data.type || 'text',
        text: data.text || '',
        fileData: data.fileData || null,
        mimeType: data.mimeType || null,
        stickerType: data.stickerType || null,
        replyTo: data.replyTo || null,
        replyToUserName: data.replyToUserName || null,
        replyToText: data.replyToText || null,
        reactions: [],
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };

      room.messages.push(message);
      // 500 mesajla sınırla
      if (room.messages.length > 500) {
        room.messages = room.messages.slice(-500);
      }

      io.to(currentRoomCode).emit('message', message);
    } catch (error) {
      console.error('❌ Mesaj hatası:', error);
    }
  });

  // Mesaj silme
  socket.on('delete-message', (data) => {
    try {
      if (!currentRoomCode || !currentUser) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;

      const messageIndex = room.messages.findIndex(m => m.id === data.messageId);
      if (messageIndex === -1) return;

      // Sadece kendi mesajını silebilir (veya oda sahibi değil, herkes kendi mesajını)
      const message = room.messages[messageIndex];
      if (message.userName !== currentUser.userName) {
        socket.emit('error', { message: 'Sadece kendi mesajını silebilirsin' });
        return;
      }

      room.messages.splice(messageIndex, 1);
      io.to(currentRoomCode).emit('message-deleted', { messageId: data.messageId });
      console.log(`🗑️ Mesaj silindi: ${data.messageId}`);
    } catch (error) {
      console.error('❌ Mesaj silme hatası:', error);
    }
  });

  // Mesaja ifade bırakma
  socket.on('react-message', (data) => {
    try {
      if (!currentRoomCode || !currentUser) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;

      const message = room.messages.find(m => m.id === data.messageId);
      if (!message) return;

      const { emoji } = data;
      if (!['🖕', '🤨', '😜', '🤍'].includes(emoji)) return;

      // Aynı kullanıcı aynı emojiyi tekrar bırakmasın
      const existingReaction = message.reactions.find(r => r.emoji === emoji);
      if (existingReaction) {
        if (existingReaction.users.includes(currentUser.userName)) {
          return; // zaten bırakmış
        }
        existingReaction.users.push(currentUser.userName);
        existingReaction.count = existingReaction.users.length;
      } else {
        message.reactions.push({
          emoji: emoji,
          users: [currentUser.userName],
          count: 1
        });
      }

      io.to(currentRoomCode).emit('message-reaction', {
        messageId: data.messageId,
        emoji: emoji,
        userName: currentUser.userName
      });
      console.log(`😀 ${currentUser.userName} ${emoji} ifadesi bıraktı`);
    } catch (error) {
      console.error('❌ İfade bırakma hatası:', error);
    }
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    console.log('🔌 Ayrıldı:', socket.id);
    if (currentUser && currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.users.delete(socket.id);
        socket.to(currentRoomCode).emit('user-left', { userName: currentUser.userName });
        updateUserList(currentRoomCode);

        if (room.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(currentRoomCode)?.users.size === 0) {
              rooms.delete(currentRoomCode);
              console.log('🗑️ Boş oda silindi');
            }
          }, 600000); // 10 dakika sonra boş odayı temizle
        }
      }
    }
  });
});

app.get('/api/health', (req, res) => {
  const room = rooms.get(ROOM_CODE);
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    onlineUsers: room ? room.users.size : 0
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`🎮 Yılan oyunu + Gizli sohbet aktif`);
  console.log(`🔑 Oda kodu: ${ROOM_CODE}`);
  console.log(`📁 Maksimum dosya boyutu: 50MB`);
  console.log(`😀 Emoji ifadeler: 🖕 🤨 😜 🤍`);
});
