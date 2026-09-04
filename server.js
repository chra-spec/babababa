
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 50 * 1024 * 1024
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ROOM_CODE = 'efkaza7634';

// Supabase bağlantısı
const supabaseUrl = 'https://xmmwsjzipluvbdtsqegz.supabase.co';
const supabaseKey = 'sb_publishable_CWiyCnet9IVtwAK8mSI7VQ_YRTyrg0r';
const supabase = createClient(supabaseUrl, supabaseKey);

// VAPID anahtarları
const VAPID_PUBLIC_KEY = 'BGi5YzcNdxf0cwoOedi2_IHJ3dQ8R6gzqSu-WmDUM9C0cldXbtjkoOZcQirdT-Pb3GVelT3G206tIAyaDu59m_0';
const VAPID_PRIVATE_KEY = '4baVyLZ1-ruqf-j1m0du27BNbDJd9zv5VaB3fd_uhjQ';

webpush.setVapidDetails(
  'mailto:destek@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// CockroachDB bağlantısı
const cockroachPool = new Pool({
  user: 'tncwn4641_gmail_com',
  password: 'eUYuxelhs0piwiL0Z3mQ7A',
  host: 'fbgtgh-32639.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  database: 'defaultdb',
  ssl: { rejectUnauthorized: false }
});

// Tabloları oluştur
async function initCockroachTables() {
  try {
  await cockroachPool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS admin_name TEXT`);
    await cockroachPool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        admin_id TEXT NOT NULL,
        admin_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        max_users INT DEFAULT 10
      );
      CREATE TABLE IF NOT EXISTS room_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        user_tag TEXT NOT NULL,
        user_name TEXT,
        message TEXT,
        type TEXT DEFAULT 'text',
        file_data TEXT,
        mime_type TEXT,
        sticker_type TEXT,
        reply_to TEXT,
        reply_to_user_name TEXT,
        reply_to_text TEXT,
        font TEXT,
        banner_mode BOOLEAN DEFAULT false,
        reactions JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_tags (
        tag TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pinned_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  dm_id TEXT,
  message_id TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
    `);
    console.log('✅ CockroachDB tabloları hazır');
  } catch (e) {
    console.error('CockroachDB tablo hatası:', e.message);
  }
}
initCockroachTables().catch(err => {
  console.error('Tablo oluşturma başarısız:', err.message);
});

const pushSubscriptions = new Map();
const rooms = new Map();
// Oda içi kullanıcı profilleri (odaId -> Map(socketId -> {userName, emoji}))
const roomProfiles = new Map();
function generateUserColor(username) {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
  const index = username ? username.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) : 0;
  return colors[index % colors.length];
}

function generateRandomEmoji(roomId, userName) {
  const emojis = ['🐼','🐰','🐻','🐶','🐱','🐭','🐮','🦊','🐯'];
  if (!roomProfiles.has(roomId)) roomProfiles.set(roomId, new Map());
  const profileMap = roomProfiles.get(roomId);

  // Eğer kullanıcı zaten atanmışsa onu döndür
  for (const [sid, profile] of profileMap.entries()) {
    if (profile.userName === userName) return profile.emoji;
  }

  // Kullanılmamış emojilerden rastgele seç
  const usedEmojis = Array.from(profileMap.values()).map(p => p.emoji);
  const available = emojis.filter(e => !usedEmojis.includes(e));
  const emoji = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : emojis[Math.floor(Math.random() * emojis.length)];
  
  profileMap.set(null, { userName, emoji }); // null geçici, bağlantı kopunca temizlenecek
  return emoji;
}

async function isRoomAdmin(roomId, socketId) {
  const result = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [roomId]);
  return result.rows.length > 0 && result.rows[0].admin_id === socketId;
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

  // ============ SOBETE KATIL ============
  socket.on('join-chat', async (data) => {
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

      // Tüm mesajları bu kullanıcıya gönder
      room.messages.forEach(msg => {
        socket.emit('message', msg);
      });

      socket.to(ROOM_CODE).emit('user-joined', { userName: currentUser.userName });
      updateUserList(ROOM_CODE);

      console.log(`✅ ${userName} sohbete katıldı`);
    } catch (error) {
      console.error('❌ Katılma hatası:', error);
      socket.emit('error', { message: 'Sohbete katılamadı' });
    }
  });
  
// ============ ODA KUR ============
socket.on('room-create', async (data) => {
  try {
    if (!currentUser) return;
    const { roomName, roomPassword, userTag } = data;

    // Şifre kriteri kontrolü
    const passwordValid = /[A-Z]/.test(roomPassword) && /[0-9]/.test(roomPassword) && /[.,!?;:]/.test(roomPassword);
    if (!passwordValid) {
      socket.emit('room-error', { message: 'Şifre en az 1 büyük harf, 1 rakam ve 1 noktalama işareti içermeli' });
      return;
    }

    // Tag benzersizlik kontrolü
    const tagResult = await cockroachPool.query('SELECT * FROM user_tags WHERE tag = $1', [userTag]);
    if (tagResult.rows.length > 0 && tagResult.rows[0].user_name !== currentUser.userName) {
      socket.emit('room-error', { message: 'Bu tag başkası tarafından kullanılıyor, başka bir tag seçin' });
      return;
    }

    // Tag'i kaydet veya güncelle
    await cockroachPool.query(
      'INSERT INTO user_tags (tag, user_name) VALUES ($1,$2) ON CONFLICT (tag) DO UPDATE SET user_name = $2',
      [userTag, currentUser.userName]
    );
    
    // Tag benzersizlik kontrolü
if (userTag) {
    const tagResult = await cockroachPool.query('SELECT * FROM user_tags WHERE tag = $1', [userTag]);
    if (tagResult.rows.length > 0 && tagResult.rows[0].user_name !== currentUser.userName) {
        socket.emit('room-error', { message: 'Bu tag başkası tarafından kullanılıyor, başka bir tag seçin' });
        return;
    }
    await cockroachPool.query(
        'INSERT INTO user_tags (tag, user_name) VALUES ($1,$2) ON CONFLICT (tag) DO UPDATE SET user_name = $2',
        [userTag, currentUser.userName]
    );
}

    const roomId = 'room_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    await cockroachPool.query(
      'INSERT INTO rooms (id, name, password, admin_id, admin_name, max_users) VALUES ($1,$2,$3,$4,$5,$6)',
      [roomId, roomName, roomPassword, socket.id, currentUser.userName, 10]
    );

    // Kullanıcıyı normal sohbetten çıkar
    socket.leave(ROOM_CODE);
    rooms.get(ROOM_CODE)?.users.delete(socket.id);
    updateUserList(ROOM_CODE);

    currentRoomCode = roomId;
    socket.join(roomId);
    const adminEmoji = '🅰️';
if (!roomProfiles.has(roomId)) roomProfiles.set(roomId, new Map());
roomProfiles.get(roomId).set(socket.id, { userName: currentUser.userName, emoji: adminEmoji });
    socket.emit('room-created', { roomId, roomName, roomPassword, isAdmin: true });
    console.log(`🏠 Oda kuruldu: ${roomName} (${roomId}) admin: ${currentUser.userName}`);
  } catch (e) {
    console.error('Oda kurma hatası:', e);
    socket.emit('room-error', { message: 'Oda kurulamadı' });
  }
});
socket.on('room-join', async (data) => {
  try {
    if (!currentUser) return;
    const { roomName, roomPassword, userTag } = data;

    const result = await cockroachPool.query(
      'SELECT * FROM rooms WHERE name = $1 AND password = $2',
      [roomName, roomPassword]
    );
    if (result.rows.length === 0) {
      socket.emit('room-error', { message: 'Oda bulunamadı veya şifre hatalı' });
      return;
    }
    const room = result.rows[0];

    if (userTag) {
      const tagResult = await cockroachPool.query('SELECT * FROM user_tags WHERE tag = $1', [userTag]);
      if (tagResult.rows.length > 0 && tagResult.rows[0].user_name !== currentUser.userName) {
        socket.emit('room-error', { message: 'Bu tag başkası tarafından kullanılıyor' });
        return;
      }
      await cockroachPool.query(
        'INSERT INTO user_tags (tag, user_name) VALUES ($1,$2) ON CONFLICT (tag) DO UPDATE SET user_name = $2',
        [userTag, currentUser.userName]
      );
    }

    let isAdmin = false;
    if (room.admin_name === currentUser.userName) {
      isAdmin = true;
      await cockroachPool.query('UPDATE rooms SET admin_id = $1 WHERE id = $2', [socket.id, room.id]);
    }

    // Normal sohbetten çıkar
    socket.leave(ROOM_CODE);
    rooms.get(ROOM_CODE)?.users.delete(socket.id);
    updateUserList(ROOM_CODE);

    // Odaya katıl
    currentRoomCode = room.id;
    socket.join(room.id);

    socket.emit('room-joined', {
      roomId: room.id,
      roomName: room.name,
      roomPassword: room.password,
      isAdmin: isAdmin,
      userTag: userTag || ''
    });
    console.log(`🚪 ${currentUser.userName} odaya katıldı: ${room.name}`);
  } catch (e) {
    console.error('Odaya katılma hatası:', e);
    socket.emit('room-error', { message: 'Odaya katılamadı' });
  }
});

// ============ ODA ŞİFRESİ GÜNCELLE ============
socket.on('room-update-password', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { newPassword } = data;
    if (!newPassword) return;

    // Şifre kriteri kontrolü
    const passwordValid = /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[.,!?;:]/.test(newPassword);
    if (!passwordValid) {
      socket.emit('room-error', { message: 'Şifre en az 1 büyük harf, 1 rakam ve 1 noktalama işareti içermeli' });
      return;
    }

    // Admin kontrolü
    const roomResult = await cockroachPool.query('SELECT * FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    const room = roomResult.rows[0];
    if (room.admin_id !== socket.id) {
      socket.emit('room-error', { message: 'Sadece admin şifreyi değiştirebilir' });
      return;
    }

    await cockroachPool.query('UPDATE rooms SET password = $1 WHERE id = $2', [newPassword, currentRoomCode]);

    // Odadaki herkese yeni şifreyi bildir
    io.to(currentRoomCode).emit('room-password-updated', { newPassword });
    console.log(`🔑 Oda şifresi güncellendi: ${currentRoomCode}`);
  } catch (e) {
    console.error('Şifre güncelleme hatası:', e);
  }
});

// ============ AKTİF ODA LİSTESİ ============
socket.on('room-list', async () => {
  try {
    const result = await cockroachPool.query('SELECT id, name, password, admin_name FROM rooms');
    const roomsList = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      password: r.password,
      adminName: r.admin_name || ''
    }));
    socket.emit('room-list-update', roomsList);
  } catch (e) {
    console.error('Oda listesi hatası:', e);
  }
});

// ============ ODA MESAJI GÖNDER ============
socket.on('room-message', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { text, type, fileData, mimeType, stickerType, replyTo, replyToUserName, replyToText, font, bannerMode } = data;

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      roomId: currentRoomCode,
      userTag: currentUser.userName, // şimdilik mevcut isim, tag sonra değişecek
      userName: currentUser.userName,
      text: text || '',
      type: type || 'text',
      fileData: fileData || null,
      mimeType: mimeType || null,
      stickerType: stickerType || null,
      replyTo: replyTo || null,
      replyToUserName: replyToUserName || null,
      replyToText: replyToText || null,
      font: font || null,
      bannerMode: bannerMode === true,
      reactions: [],
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
      timestamp: Date.now()
    };

    // DB'ye kaydet
    await cockroachPool.query(
      `INSERT INTO room_messages (id, room_id, user_tag, user_name, message, type, file_data, mime_type, sticker_type, reply_to, reply_to_user_name, reply_to_text, font, banner_mode, reactions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
      [message.id, message.roomId, message.userTag, message.userName, message.text, message.type, message.fileData, message.mimeType, message.stickerType, message.replyTo, message.replyToUserName, message.replyToText, message.font, message.bannerMode, JSON.stringify([])]
    );

    io.to(currentRoomCode).emit('room-message', message);
  } catch (e) {
    console.error('Oda mesaj hatası:', e);
  }
await cockroachPool.query(
  `DELETE FROM room_messages WHERE room_id = $1 AND id NOT IN (
    SELECT id FROM room_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 250
  )`,
  [currentRoomCode]
);  
});

// ============ ODA MESAJ SİL ============
socket.on('room-delete-message', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { messageId } = data;
    if (!messageId) return;

    // Mesajı bul
    const msgResult = await cockroachPool.query(
      'SELECT * FROM room_messages WHERE id = $1 AND room_id = $2',
      [messageId, currentRoomCode]
    );
    if (msgResult.rows.length === 0) return;
    const message = msgResult.rows[0];

    // Yetki kontrolü: kendi mesajı veya admin
    const isAdmin = await isRoomAdmin(currentRoomCode, socket.id);
    if (message.user_name !== currentUser.userName && !isAdmin) {
      socket.emit('room-error', { message: 'Sadece kendi mesajını veya admin herkesin mesajını silebilir' });
      return;
    }

    // DB'den sil
    await cockroachPool.query('DELETE FROM room_messages WHERE id = $1', [messageId]);

    // Odadaki herkese bildir
    io.to(currentRoomCode).emit('room-message-deleted', { messageId });
  } catch (e) {
    console.error('Oda mesaj silme hatası:', e);
  }
});

// ============ ODA MESAJ DÜZENLE ============
socket.on('room-edit-message', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { messageId, newText } = data;
    if (!messageId || !newText || !newText.trim()) return;

    // Mesajı bul
    const msgResult = await cockroachPool.query(
      'SELECT * FROM room_messages WHERE id = $1 AND room_id = $2',
      [messageId, currentRoomCode]
    );
    if (msgResult.rows.length === 0) return;
    const message = msgResult.rows[0];

    // Sadece kendi mesajını düzenleyebilir
    if (message.user_name !== currentUser.userName) {
      socket.emit('room-error', { message: 'Sadece kendi mesajını düzenleyebilirsin' });
      return;
    }

    // Güncelle
    await cockroachPool.query(
      'UPDATE room_messages SET message = $1 WHERE id = $2',
      [newText.trim(), messageId]
    );

    // Herkese bildir
    io.to(currentRoomCode).emit('room-message-edited', {
      messageId,
      newText: newText.trim()
    });
  } catch (e) {
    console.error('Oda mesaj düzenleme hatası:', e);
  }
});

// ============ ODA MESAJ İFADE BIRAK ============
socket.on('room-react-message', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { messageId, emoji } = data;
    if (!messageId || !emoji) return;
    if (!['🖕', '❤️', '😜', '🤍'].includes(emoji)) return;

    const msgResult = await cockroachPool.query(
      'SELECT * FROM room_messages WHERE id = $1 AND room_id = $2',
      [messageId, currentRoomCode]
    );
    if (msgResult.rows.length === 0) return;
    const message = msgResult.rows[0];

    let reactions = message.reactions || [];
    const existing = reactions.find(r => r.emoji === emoji);
    if (existing) {
      if (existing.users.includes(currentUser.userName)) return;
      existing.users.push(currentUser.userName);
      existing.count = existing.users.length;
    } else {
      reactions.push({ emoji, users: [currentUser.userName], count: 1 });
    }

    await cockroachPool.query(
      'UPDATE room_messages SET reactions = $1 WHERE id = $2',
      [JSON.stringify(reactions), messageId]
    );

    io.to(currentRoomCode).emit('room-message-reaction', {
      messageId,
      emoji,
      userName: currentUser.userName
    });
  } catch (e) {
    console.error('Oda ifade hatası:', e);
  }
});

// ============ ODA MESAJ GEÇMİŞİ ============
socket.on('room-history', async () => {
  try {
    if (!currentRoomCode) return;
    const result = await cockroachPool.query(
      'SELECT * FROM room_messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT 100',
      [currentRoomCode]
    );
    const messages = result.rows.map(r => ({
      id: r.id,
      userName: r.user_name,
      userTag: r.user_tag,
      text: r.message,
      type: r.type,
      fileData: r.file_data,
      mimeType: r.mime_type,
      stickerType: r.sticker_type,
      replyTo: r.reply_to,
      replyToUserName: r.reply_to_user_name,
      replyToText: r.reply_to_text,
      font: r.font,
      bannerMode: r.banner_mode,
      reactions: r.reactions,
      time: new Date(r.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
    }));
    socket.emit('room-history', messages);
  } catch (e) {
    console.error('Oda geçmiş hatası:', e);
  }
});

// ============ DAVET GÖNDER ============
socket.on('room-invite', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { targetUserName } = data;
    if (!targetUserName) return;

    // Alıcı socket'ini bul
    let targetSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
      if (user.userName === targetUserName) targetSocketId = socketId;
    });
    if (!targetSocketId) {
      socket.emit('room-error', { message: 'Davet edilecek kullanıcı çevrimiçi değil' });
      return;
    }

    // Oda bilgisini al
    const roomResult = await cockroachPool.query('SELECT * FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    const room = roomResult.rows[0];

    const inviteMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      sender: 'SİSTEM',
      receiver: targetUserName,
      message: `🏠 Oda daveti: ${room.name}\nŞifre: ${room.password}`,
      type: 'text',
      created_at: new Date().toISOString()
    };

    // DM olarak gönder
    io.to(targetSocketId).emit('dm-message', inviteMessage);
    socket.emit('room-invite-sent', { targetUserName });
  } catch (e) {
    console.error('Davet hatası:', e);
  }
});

// ============ DAVET İSTEĞİ GÖNDER ============
socket.on('room-invite-request', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    const { targetUserName } = data;
    if (!targetUserName) return;

    // Hedef socket'i normal sohbetteki kullanıcı listesinden bul
    let targetSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
      if (user.userName === targetUserName) {
        targetSocketId = socketId;
      }
    });

    if (!targetSocketId) {
      socket.emit('room-invite-result', { status: 'offline', targetUserName });
      return;
    }

    // Oda bilgisini al
    const roomResult = await cockroachPool.query('SELECT * FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) {
      socket.emit('room-invite-result', { status: 'room_not_found', targetUserName });
      return;
    }
    const room = roomResult.rows[0];

    // Davet isteğini hedef kullanıcıya gönder
    io.to(targetSocketId).emit('room-invitation', {
      requesterId: socket.id,
      requesterName: currentUser.userName,
      roomName: room.name,
      roomId: room.id,
      expiresAt: Date.now() + 15000 // 15 saniye geçerlilik
    });

    // Davet eden kişiye bilgi ver
    socket.emit('room-invite-result', { status: 'sent', targetUserName });
  } catch (e) {
    console.error('Davet gönderme hatası:', e);
    socket.emit('room-invite-result', { status: 'error', targetUserName: data?.targetUserName });
  }
});
// ============ DAVET KABUL ============
socket.on('room-invite-accept', async (data) => {
  try {
    const { roomId, userTag } = data;
    if (!roomId || !currentUser) return;

    const roomResult = await cockroachPool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (roomResult.rows.length === 0) {
      socket.emit('room-error', { message: 'Oda artık mevcut değil' });
      return;
    }
    const room = roomResult.rows[0];

    socket.leave(ROOM_CODE);
    rooms.get(ROOM_CODE)?.users.delete(socket.id);
    updateUserList(ROOM_CODE);

    currentRoomCode = room.id;
    socket.join(room.id);

    socket.emit('room-joined', {
      roomId: room.id,
      roomName: room.name,
      roomPassword: room.password,
      isAdmin: false,
      userTag: userTag || ''
    });
    console.log(`🚪 ${currentUser.userName} davetle odaya katıldı: ${room.name}`);
  } catch (e) {
    console.error('Davet kabul hatası:', e);
    socket.emit('room-error', { message: 'Davet kabul edilemedi, teknik hata: ' + e.message });
  }
});

// ============ DAVET RED ============
socket.on('room-invite-reject', (data) => {
  try {
    const { requesterId } = data;
    if (requesterId) {
      io.to(requesterId).emit('room-invite-result', {
        status: 'rejected',
        targetUserName: currentUser?.userName || 'Kullanıcı'
      });
    }
  } catch (e) {
    console.error('Davet red hatası:', e);
  }
});

// ============ ODA TEMİZLİK ============
setInterval(async () => {
  try {
    // 24 saatten eski odaları sil
    await cockroachPool.query("DELETE FROM rooms WHERE created_at < NOW() - INTERVAL '24 hours'");
  } catch (e) {
    console.error('Oda temizlik hatası:', e);
  }
}, 60 * 60 * 1000);

// ============ MESAJ SABİTLE ============
socket.on('pin-message', async (data) => {
  try {
    if (!currentUser) return;
    const { messageId, roomId, dmId } = data;

    const pinId = 'pin_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    await cockroachPool.query(
      'INSERT INTO pinned_messages (id, room_id, dm_id, message_id, pinned_by) VALUES ($1,$2,$3,$4,$5)',
      [pinId, roomId || null, dmId || null, messageId, currentUser.userName]
    );

    if (roomId) {
      io.to(roomId).emit('message-pinned', { messageId, roomId, pinnedBy: currentUser.userName });
    } else if (dmId) {
      io.to(dmId).emit('message-pinned', { messageId, dmId, pinnedBy: currentUser.userName });
    }
  } catch (e) {
    console.error('Mesaj sabitleme hatası:', e);
  }
});

// ============ SABİTLEMEYİ KALDIR ============
socket.on('unpin-message', async (data) => {
  try {
    const { messageId } = data;
    await cockroachPool.query('DELETE FROM pinned_messages WHERE message_id = $1', [messageId]);
    
    // Her iki tarafa da bildir
    io.emit('message-unpinned', { messageId });
  } catch (e) {
    console.error('Sabitleme kaldırma hatası:', e);
  }
});

  // ============ PUSH ABONELİĞİ KAYDET ============
  socket.on('save-subscription', (data) => {
    try {
      if (currentUser && data.subscription) {
        pushSubscriptions.set(currentUser.userName, data.subscription);
        console.log(`🔔 ${currentUser.userName} bildirime abone oldu`);
      }
    } catch (error) {
      console.error('❌ Abonelik hatası:', error);
    }
  });

  // ============ MESAJ GÖNDER ============
  socket.on('message', async (data) => {
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
        isMirrored: data.isMirrored === true,
        replyToUserName: data.replyToUserName || null,
        replyToText: data.replyToText || null,
        font: data.font || null,
        bannerMode: data.bannerMode === true,
        reactions: [],
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }),
        timestamp: Date.now()
      };

      room.messages.push(message);

      io.to(currentRoomCode).emit('message', message);
// Diğer kullanıcılara push bildirimi gönder
const targetUsers = Array.from(room.users.values()).filter(u => u.userName !== currentUser.userName);
targetUsers.forEach(user => {
  const sub = pushSubscriptions.get(user.userName);
  if (sub) {
    webpush.sendNotification(sub, JSON.stringify({
      title: 'Yılan Oyunu Platformu',
      body: `${currentUser.userName}: ${data.text || '📎 Medya'}`,
      tag: 'room-' + currentRoomCode,
      data: { url: '/' }
    })).catch(err => console.error('Push hatası:', err));
  }
});

    } catch (error) {
      console.error('❌ Mesaj hatası:', error);
    }
  });

  // ============ MESAJ SİL ============
  socket.on('delete-message', async (data) => {
    try {
      if (!currentRoomCode || !currentUser) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;

      const messageIndex = room.messages.findIndex(m => m.id === data.messageId);
      if (messageIndex === -1) return;

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

  // ============ MESAJA İFADE BIRAK ============
  socket.on('react-message', (data) => {
    try {
      if (!currentRoomCode || !currentUser) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;

      const message = room.messages.find(m => m.id === data.messageId);
      if (!message) return;

      const { emoji } = data;
      if (!['🖕', '❤️', '😜', '🤍'].includes(emoji)) return;

      const existingReaction = message.reactions.find(r => r.emoji === emoji);
      if (existingReaction) {
        if (existingReaction.users.includes(currentUser.userName)) return;
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

  // ============ WEBRTC ARAMA ============
  socket.on('webrtc-offer', (data) => {
    try {
      const { targetUserName, offer, candidates, type, callerName } = data;
      console.log(`📞 Teklif: ${callerName} -> ${targetUserName} (${type}) [${candidates ? candidates.length : 0} aday]`);

      let targetSocketId = null;
      rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === targetUserName) {
          targetSocketId = socketId;
        }
      });

      if (targetSocketId) {
        io.to(targetSocketId).emit('incoming-call', {
          offer: offer,
          candidates: candidates || [],
          callerName: callerName,
          callerPhoto: currentUser?.userPhoto || '',
          type: type
        });
        console.log(`✅ Teklif iletildi: ${callerName} -> ${targetUserName}`);
      } else {
        socket.emit('call-error', { message: 'Kullanıcı bulunamadı' });
      }
    } catch (error) {
      console.error('❌ Teklif hatası:', error);
    }
  });

  socket.on('webrtc-answer', (data) => {
    try {
      const { targetUserName, answer, candidates } = data;

      let targetSocketId = null;
      rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === targetUserName) {
          targetSocketId = socketId;
        }
      });

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-answer', {
          answer: answer,
          candidates: candidates || [],
          answererName: currentUser?.userName
        });
        console.log(`✅ Cevap iletildi: ${currentUser?.userName} -> ${targetUserName} [${candidates ? candidates.length : 0} aday]`);
      }
    } catch (error) {
      console.error('❌ Cevap hatası:', error);
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    try {
      const { targetUserName, candidate } = data;

      let targetSocketId = null;
      rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === targetUserName) {
          targetSocketId = socketId;
        }
      });

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-ice-candidate', {
          candidate: candidate,
          senderName: currentUser?.userName
        });
      }
    } catch (error) {
      console.error('❌ ICE candidate hatası:', error);
    }
  });

  socket.on('reject-call', (data) => {
    try {
      const { targetUserName } = data;

      let targetSocketId = null;
      rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === targetUserName) {
          targetSocketId = socketId;
        }
      });

      if (targetSocketId) {
        io.to(targetSocketId).emit('call-rejected', {
          rejectedBy: currentUser?.userName
        });
      }
    } catch (error) {
      console.error('❌ Çağrı reddetme hatası:', error);
    }
  });

  socket.on('end-call', (data) => {
    try {
      const { targetUserName } = data;

      let targetSocketId = null;
      rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === targetUserName) {
          targetSocketId = socketId;
        }
      });

      if (targetSocketId) {
        io.to(targetSocketId).emit('call-ended', {
          endedBy: currentUser?.userName
        });
      }
    } catch (error) {
      console.error('❌ Çağrı sonlandırma hatası:', error);
    }
  });

// ============ DM MESAJLARI ============
socket.on('dm-message', async (data) => {
  try {
    if (!currentUser) return;
    const { receiver, text, type, fileData, mimeType, stickerType, replyTo, replyToId, replyToSender } = data;
    if (!receiver) return;
    if (!text && !fileData) return;

    const dmMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      sender: currentUser.userName,
      receiver: receiver,
      message: text || '',
      type: type || 'text',
      fileData: fileData || null,
      mimeType: mimeType || null,
      stickerType: stickerType || null,
      reply_to: replyTo ? `${replyToSender ? replyToSender + ': ' : ''}${replyTo}` : null,
      reply_to_id: replyToId || null,
      edited: false,
      reactions: [],
      created_at: new Date().toISOString()
    };

    const { error } = await supabase.from('dm_messages').insert({
      id: dmMessage.id,
      sender: dmMessage.sender,
      receiver: dmMessage.receiver,
      message: dmMessage.message,
      type: dmMessage.type,
      file_data: dmMessage.fileData,
      mime_type: dmMessage.mimeType,
      sticker_type: dmMessage.stickerType,
      reply_to: dmMessage.reply_to,
      reply_to_id: dmMessage.reply_to_id,
      edited: dmMessage.edited,
      reactions: dmMessage.reactions
    });
    if (error) console.error('DM kayıt hatası:', error.message);

    // DM mesaj limiti: son 100 mesajı tut, eski fazlalıkları sil
    const { count, error: countError } = await supabase
      .from('dm_messages')
      .select('*', { count: 'exact', head: true })
      .or(`and(sender.eq.${currentUser.userName},receiver.eq.${receiver}),and(sender.eq.${receiver},receiver.eq.${currentUser.userName})`);

    if (countError) {
      console.error('DM sayım hatası:', countError.message);
    } else if (count > 100) {
      const excess = count - 100;
      const { data: oldMessages, error: oldError } = await supabase
        .from('dm_messages')
        .select('id')
        .or(`and(sender.eq.${currentUser.userName},receiver.eq.${receiver}),and(sender.eq.${receiver},receiver.eq.${currentUser.userName})`)
        .order('created_at', { ascending: true })
        .limit(excess);

      if (oldError) {
        console.error('Eski mesajları getirme hatası:', oldError.message);
      } else if (oldMessages && oldMessages.length > 0) {
        const idsToDelete = oldMessages.map(m => m.id);
        const { error: deleteError } = await supabase
          .from('dm_messages')
          .delete()
          .in('id', idsToDelete);
        if (deleteError) {
          console.error('Eski mesajları silme hatası:', deleteError.message);
        } else {
          console.log(`🗑️ ${idsToDelete.length} eski DM mesajı silindi (limit 100)`);
        }
      }
    }

    let receiverSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
      if (user.userName === receiver) receiverSocketId = socketId;
    });
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('dm-message', dmMessage);
    }
    if (error) {
      console.error('DM kayıt hatası:', error.message);
    } else {
      console.log('✅ DM kaydedildi:', dmMessage.id);
    }
    socket.emit('dm-message', dmMessage);

    // Alıcıya push bildirimi gönder (doğru yerde)
    const receiverSub = pushSubscriptions.get(receiver);
    if (receiverSub) {
      webpush.sendNotification(receiverSub, JSON.stringify({
        title: '💬 Yeni DM Mesajı',
        body: `${currentUser.userName}: ${text || '📎 Medya'}`,
        icon: currentUser.userPhoto || '/default-avatar.png',
        tag: 'dm-' + currentUser.userName,
        data: { url: '/' }
      })).catch(err => console.error('DM push hatası:', err));
    }
  } catch (error) {
    console.error('DM mesaj hatası:', error);
  }
});

  // ============ DM İFADE BIRAK ============
  socket.on('dm-react', async (data) => {
    try {
      if (!currentUser) return;
      const { messageId, emoji } = data;
      if (!messageId || !emoji) return;
      if (!['🖕', '❤️', '😜', '🤍'].includes(emoji)) return;

      const { data: dmMsg, error: fetchError } = await supabase
        .from('dm_messages')
        .select('*')
        .eq('id', messageId)
        .single();

      if (fetchError || !dmMsg) {
        console.error('DM mesaj bulunamadı:', fetchError?.message);
        return;
      }

      let reactions = dmMsg.reactions || [];
      const existingReaction = reactions.find(r => r.emoji === emoji);
      if (existingReaction) {
        if (existingReaction.users.includes(currentUser.userName)) return;
        existingReaction.users.push(currentUser.userName);
        existingReaction.count = existingReaction.users.length;
      } else {
        reactions.push({
          emoji: emoji,
          users: [currentUser.userName],
          count: 1
        });
      }

      const { error: updateError } = await supabase
        .from('dm_messages')
        .update({ reactions: reactions })
        .eq('id', messageId);

      if (updateError) {
        console.error('DM reaksiyon güncelleme hatası:', updateError.message);
        return;
      }

      io.emit('dm-reaction-updated', {
        messageId: messageId,
        emoji: emoji,
        userName: currentUser.userName
      });
    } catch (error) {
      console.error('DM reaksiyon hatası:', error);
    }
  });

  // ============ DM MESAJ DÜZENLE ============
  socket.on('dm-edit', async (data) => {
    try {
      if (!currentUser) return;
      const { messageId, newText } = data;
      if (!messageId || !newText || !newText.trim()) return;

      const { error } = await supabase
        .from('dm_messages')
        .update({ message: newText.trim(), edited: true })
        .eq('id', messageId)
        .eq('sender', currentUser.userName);

      if (error) {
        console.error('DM düzenleme hatası:', error.message);
        return;
      }

      io.emit('dm-edited', {
        messageId: messageId,
        newText: newText.trim(),
        edited: true
      });
    } catch (error) {
      console.error('DM düzenleme hatası:', error);
    }
  });

  // ============ EKRAN PAYLAŞIMI OLAYLARI ============
  socket.on('screen-share-request', (data) => {
    console.log('📺 Ekran paylaşımı isteği geldi:', data);
    if (!currentUser) {
      console.log('❌ currentUser yok, istek gönderilemedi');
      return;
    }

    let targetSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
      if (user.userName === data.targetUserName) targetSocketId = socketId;
    });

    console.log('Hedef socket ID:', targetSocketId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('screen-share-request', {
        requesterId: socket.id,
        requesterName: currentUser.userName || 'Bilinmeyen Kullanıcı',
        targetUserName: data.targetUserName,
        mode: data.mode
      });
      console.log('✅ İstek karşı tarafa iletildi');
    } else {
      console.log('❌ Hedef kullanıcı bulunamadı');
    }
  });

  socket.on('screen-share-accept', (data) => {
    console.log('📞 Kabul geldi, gönderen:', data.requesterId);
    io.to(data.requesterId).emit('screen-share-accepted', { requesterId: socket.id });
  });

  socket.on('screen-share-reject', (data) => {
    io.to(data.requesterId).emit('screen-share-rejected');
  });

  socket.on('screen-share-offer', (data) => {
    io.to(data.targetUserId).emit('screen-share-offer', {
      offer: data.offer,
      targetUserId: socket.id
    });
  });

  socket.on('screen-share-answer', (data) => {
    io.to(data.targetUserId).emit('screen-share-answer', { answer: data.answer });
  });

  socket.on('screen-share-ice', (data) => {
    io.to(data.targetUserId).emit('screen-share-ice', { candidate: data.candidate });
  });

  socket.on('screen-share-stopped', (data) => {
    io.to(data.targetUserId).emit('screen-share-stopped');
  });

  socket.on('screen-share-call-ended', (data) => {
    io.to(data.targetUserId).emit('screen-share-call-ended');
  });

  // ============ MÜZİK SİSTEMİ ============
  socket.on('request-music-permission', (data) => {
    try {
      if (!currentUser) return;

      const requesterId = socket.id;
      const requesterName = currentUser.userName;

      const targetUsers = Array.from(rooms.get(ROOM_CODE)?.users.values() || [])
        .filter(u => u.userName !== requesterName);

      if (targetUsers.length === 0) {
        socket.emit('music-permission-status', { status: 'no-users' });
        return;
      }

      targetUsers.forEach(user => {
        const targetSocketId = Array.from(rooms.get(ROOM_CODE).users.entries())
          .find(([id, u]) => u.userName === user.userName)?.[0];

        if (targetSocketId && targetSocketId !== socket.id) {
          io.to(targetSocketId).emit('music-permission-request', {
            requesterId: requesterId,
            requester: requesterName
          });
        }
      });

      socket.emit('music-permission-status', { status: 'sent' });
    } catch (error) {
      console.error('Müzik izin istek hatası:', error);
    }
  });

  socket.on('accept-music-permission', (data) => {
    try {
      const requesterId = data.requesterId;
      if (requesterId) {
        io.to(requesterId).emit('music-permission-status', {
          status: 'accepted',
          listenerName: currentUser.userName
        });
      }
    } catch (error) {
      console.error('Müzik izin kabul hatası:', error);
    }
  });

  socket.on('reject-music-permission', (data) => {
    try {
      const requesterId = data.requesterId;
      if (requesterId) {
        io.to(requesterId).emit('music-permission-status', { status: 'rejected' });
      }
    } catch (error) {
      console.error('Müzik izin reddetme hatası:', error);
    }
  });

  socket.on('revoke-music-permission', (data) => {
    try {
      const requesterId = data.requesterId;
      if (requesterId) {
        io.to(requesterId).emit('music-permission-status', {
          status: 'revoked',
          listenerName: currentUser.userName
        });
      }
    } catch (error) {
      console.error('Müzik izin iptal hatası:', error);
    }
  });

  socket.on('music-play', (data) => {
    try {
      if (!currentUser) return;

      io.to(ROOM_CODE).emit('music-play', {
        videoId: data.videoId,
        title: data.title,
        channel: data.channel,
        requesterId: socket.id
      });
    } catch (error) {
      console.error('Müzik çalma hatası:', error);
    }
  });

  socket.on('music-control', (data) => {
    try {
      if (data.requesterId === socket.id) {
        socket.to(ROOM_CODE).emit('music-control', {
          action: data.action,
          requesterId: socket.id
        });
      }
    } catch (error) {
      console.error('Müzik kontrol hatası:', error);
    }
  });
  
// ============ ODA İÇİ MÜZİK BAŞLAT ============
socket.on('room-music-play', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;

    // Sadece admin müzik başlatabilir
    const roomResult = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    if (roomResult.rows[0].admin_id !== socket.id) {
      socket.emit('room-error', { message: 'Sadece admin müzik başlatabilir' });
      return;
    }

    io.to(currentRoomCode).emit('room-music-play', {
      videoId: data.videoId,
      title: data.title,
      channel: data.channel,
      requesterId: socket.id
    });
  } catch (e) {
    console.error('Oda müzik başlatma hatası:', e);
  }
});  

// ============ ODA İÇİ MÜZİK KONTROL ============
socket.on('room-music-control', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;

    // Sadece admin kontrol edebilir
    const roomResult = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    if (roomResult.rows[0].admin_id !== socket.id) {
      return;
    }

    socket.to(currentRoomCode).emit('room-music-control', {
      action: data.action,
      requesterId: socket.id
    });
  } catch (e) {
    console.error('Oda müzik kontrol hatası:', e);
  }
});

// ============ ODA İÇİ ORTAK VİDEO BAŞLAT ============
socket.on('room-video-play', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;

    // Sadece admin video başlatabilir
    const roomResult = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    if (roomResult.rows[0].admin_id !== socket.id) {
      socket.emit('room-error', { message: 'Sadece admin video başlatabilir' });
      return;
    }

    io.to(currentRoomCode).emit('room-video-play', {
      videoId: data.videoId || null,
      videoUrl: data.videoUrl || null,
      title: data.title || '',
      channel: data.channel || '',
      isUpload: data.isUpload === true,
      timestamp: Date.now(),
      requesterId: socket.id
    });
  } catch (e) {
    console.error('Oda video başlatma hatası:', e);
  }
});

// ============ ODA İÇİ ORTAK VİDEO KONTROL ============
socket.on('room-video-control', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;

    // Sadece admin kontrol edebilir
    const roomResult = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    if (roomResult.rows[0].admin_id !== socket.id) {
      return;
    }

    socket.to(currentRoomCode).emit('room-video-control', {
      action: data.action, // play, pause, seek
      currentTime: data.currentTime || 0,
      timestamp: Date.now(),
      requesterId: socket.id
    });
  } catch (e) {
    console.error('Oda video kontrol hatası:', e);
  }
});

// ============ ODA İÇİ VİDEO KALDIR ============
socket.on('room-video-remove', async (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;

    // Sadece admin kaldırabilir
    const roomResult = await cockroachPool.query('SELECT admin_id FROM rooms WHERE id = $1', [currentRoomCode]);
    if (roomResult.rows.length === 0) return;
    if (roomResult.rows[0].admin_id !== socket.id) {
      return;
    }

    io.to(currentRoomCode).emit('room-video-remove');
  } catch (e) {
    console.error('Oda video kaldırma hatası:', e);
  }
});

// ============ ODA İÇİ YAZIYOR GÖSTERGESİ ============
socket.on('room-typing', (data) => {
  try {
    if (!currentRoomCode || !currentUser) return;
    // Sadece oda içindekilere gönder
    socket.to(currentRoomCode).emit('room-typing', {
      userName: currentUser.userName,
      isTyping: data.isTyping === true
    });
  } catch (e) {
    console.error('Yazıyor göstergesi hatası:', e);
  }
});

// ============ SABİTLENMİŞ MESAJLARI GETİR ============
socket.on('room-pinned-messages', async () => {
  try {
    if (!currentRoomCode) return;
    const result = await cockroachPool.query(
      `SELECT pm.message_id, rm.message 
       FROM pinned_messages pm 
       LEFT JOIN room_messages rm ON pm.message_id = rm.id 
       WHERE pm.room_id = $1`,
      [currentRoomCode]
    );
    const pinnedList = result.rows.map(r => ({
      messageId: r.message_id,
      messagePreview: r.message ? r.message.substring(0, 50) : 'Mesaj'
    }));
    socket.emit('room-pinned-messages', pinnedList);
  } catch (e) {
    console.error('Sabit mesajları getirme hatası:', e);
  }
});


// ============ BAĞLANTI KOPTU ============
socket.on('disconnect', async () => {
  console.log('🔌 Ayrıldı:', socket.id);
  if (currentUser && currentRoomCode) {
    // Normal sohbetten ayrılma kontrolü
    const normalRoom = rooms.get(ROOM_CODE);
    if (normalRoom && currentRoomCode === ROOM_CODE) {
      normalRoom.users.delete(socket.id);
      socket.to(ROOM_CODE).emit('user-left', { userName: currentUser.userName });
      updateUserList(ROOM_CODE);

      if (normalRoom.users.size === 0) {
        setTimeout(() => {
          if (rooms.get(ROOM_CODE)?.users.size === 0) {
            rooms.delete(ROOM_CODE);
            console.log('🗑️ Boş normal sohbet alanı silindi');
          }
        }, 600000);
      }
    }

    // Oda içinden ayrılma kontrolü ve admin devri
    if (currentRoomCode && currentRoomCode !== ROOM_CODE) {
      const roomResult = await cockroachPool.query('SELECT * FROM rooms WHERE id = $1', [currentRoomCode]);
      if (roomResult.rows.length > 0) {
        const roomData = roomResult.rows[0];
        
        // Eğer ayrılan kişi admin ise
        if (roomData.admin_id === socket.id) {
          // Odadaki diğer socketleri bul
          const roomSockets = io.sockets.adapter.rooms.get(currentRoomCode);
          let newAdminSocketId = null;
          if (roomSockets) {
            for (const sid of roomSockets) {
              if (sid !== socket.id) {
                newAdminSocketId = sid;
                break;
              }
            }
          }

          if (newAdminSocketId) {
            // Yeni admini ata (şimdilik adını bilmediğimiz için 'gecici_admin' yapıyoruz,
            // istemci kendi bilgisiyle zaten isAdmin durumunu öğrenecek)
            await cockroachPool.query(
              'UPDATE rooms SET admin_id = $1, admin_name = $2 WHERE id = $3',
              [newAdminSocketId, 'gecici_admin', currentRoomCode]
            );
            io.to(newAdminSocketId).emit('room-admin-transferred', { message: 'Admin yetkisi size devredildi' });
            console.log(`👑 Admin yetkisi devredildi: ${socket.id} -> ${newAdminSocketId}`);
          } else {
            // Odada kimse kalmadıysa odayı sil
            await cockroachPool.query('DELETE FROM rooms WHERE id = $1', [currentRoomCode]);
            console.log('🗑️ Boş oda silindi:', currentRoomCode);
          }
        }
      }
    }
  }
});
});

// ============ CLOUDFLARE TURN KİMLİK ÜRETME ============
app.get('/api/turn-config', async (req, res) => {
  try {
    const response = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/b7ae356ddfbcf724dbf0a80bbcffe1d3/credentials/generate-ice-servers', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer 66db5c5d5686c1ad66857a565f3d777997379f46d1b5370e0544d4d7f858a2f7',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: 86400 })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('TURN kimlik üretme hatası:', error);
    res.status(500).json({ error: 'TURN kimlik üretilemedi' });
  }
});

app.get('/zombie', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'zombie.html'));
});

app.get('/api/dm-messages', async (req, res) => {
  try {
    const { sender, receiver } = req.query;
    if (!sender || !receiver) {
      return res.status(400).json({ error: 'sender ve receiver gerekli' });
    }

const { data: messages, error } = await supabase
  .from('dm_messages')
  .select('*')
  .or(`and(sender.eq.${sender},receiver.eq.${receiver}),and(sender.eq.${receiver},receiver.eq.${sender})`)
  .order('created_at', { ascending: true })
  .limit(100);

    if (error) throw error;

    res.json(messages.map(msg => ({
      id: msg.id,
      sender: msg.sender,
      receiver: msg.receiver,
      message: msg.message,
      type: msg.type,
      fileData: msg.file_data,
      mimeType: msg.mime_type,
      stickerType: msg.sticker_type,
      reply_to: msg.reply_to,
      reply_to_id: msg.reply_to_id,
      edited: msg.edited,
      reactions: msg.reactions,
      created_at: msg.created_at
    })));
  } catch (error) {
    console.error('DM mesaj getirme hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', onlineUsers: rooms.get(ROOM_CODE)?.users.size || 0 });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 24 saatten eski DM mesajlarını temizle
setInterval(async () => {
  try {
    const { error } = await supabase
      .from('dm_messages')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (error) console.error('DM temizleme hatası:', error.message);
  } catch (e) {
    console.error('DM temizlik hatası:', e);
  }
}, 60 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`🔔 Push bildirimler aktif`);
  console.log(`💾 Supabase bağlantısı kuruldu`);
});
