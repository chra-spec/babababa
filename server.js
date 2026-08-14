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
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB max (ses/fotoğraf için yeterli)
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// SABİT ODA
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
  
  const userList = Array.from(room.users.values()).map(user => ({
    id: user.id,
    userName: user.userName,
    userPhoto: user.userPhoto,
    userColor: user.userColor
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

      // Geçmiş mesajları gönder
      const previousMessages = room.messages.slice(-30);
      if (previousMessages.length > 0) {
        previousMessages.forEach(msg => {
          socket.emit('message', msg);
        });
      }

      socket.to(ROOM_CODE).emit('user-joined', {
        userName: currentUser.userName
      });

      updateUserList(ROOM_CODE);

      console.log(`✅ ${userName} sohbete katıldı`);

    } catch (error) {
      console.error('❌ Katılma hatası:', error);
      socket.emit('error', { message: 'Sohbete katılamadı' });
    }
  });

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
        time: new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        timestamp: Date.now()
      };

      room.messages.push(message);
      if (room.messages.length > 200) {
        room.messages = room.messages.slice(-200);
      }

      io.to(currentRoomCode).emit('message', message);

    } catch (error) {
      console.error('❌ Mesaj hatası:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Ayrıldı:', socket.id);

    if (currentUser && currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.users.delete(socket.id);
        socket.to(currentRoomCode).emit('user-left', {
          userName: currentUser.userName
        });
        updateUserList(currentRoomCode);

        if (room.users.size === 0) {
          setTimeout(() => {
            if (rooms.get(currentRoomCode)?.users.size === 0) {
              rooms.delete(currentRoomCode);
            }
          }, 600000);
        }
      }
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    onlineUsers: rooms.get(ROOM_CODE)?.users.size || 0
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
});
