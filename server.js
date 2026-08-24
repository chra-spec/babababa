const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

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

const pushSubscriptions = new Map();
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

      socket.to(ROOM_CODE).emit('user-joined', { userName: currentUser.userName });
      updateUserList(ROOM_CODE);

      console.log(`✅ ${userName} sohbete katıldı`);
    } catch (error) {
      console.error('❌ Katılma hatası:', error);
      socket.emit('error', { message: 'Sohbete katılamadı' });
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
            body: 'Yılan seni özledi gel ve skorunu arttır!'
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
    const { receiver, text, replyTo, replyToId, replyToSender } = data;
    if (!receiver || !text) return;

    const dmMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      sender: currentUser.userName,
      receiver: receiver,
      message: text,
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
      reply_to: dmMessage.reply_to,
      reply_to_id: dmMessage.reply_to_id,
      edited: dmMessage.edited,
      reactions: dmMessage.reactions
    });
    if (error) console.error('DM kayıt hatası:', error.message);

    let receiverSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
      if (user.userName === receiver) {
        receiverSocketId = socketId;
      }
    });

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('dm-message', dmMessage);
    }
    socket.emit('dm-message', dmMessage);
  } catch (error) {
    console.error('DM mesaj hatası:', error);
  }
});

  socket.on('dm-delete', async (data) => {
    try {
      if (!currentUser) return;
      const { messageId } = data;
      await supabase.from('dm_messages').delete().eq('id', messageId).eq('sender', currentUser.userName);
      // Basitçe silme işlemini taraflara bildir
      io.emit('dm-deleted', { messageId });
    } catch (error) {
      console.error('DM silme hatası:', error);
    }
  });
  
  // ============ DM İFADE BIRAK ============
socket.on('dm-react', async (data) => {
  try {
    if (!currentUser) return;
    const { messageId, emoji } = data;
    if (!messageId || !emoji) return;
    if (!['🖕', '❤️', '😜', '🤍'].includes(emoji)) return;

    // Supabase'den mesajı çek
    const { data: dmMsg, error: fetchError } = await supabase
      .from('dm_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (fetchError || !dmMsg) {
      console.error('DM mesaj bulunamadı:', fetchError?.message);
      return;
    }

    // Mevcut reaksiyonları güncelle
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

    // Taraflara bildir
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
    let targetSocketId = null;
    rooms.get(ROOM_CODE)?.users.forEach((user, socketId) => {
        if (user.userName === data.targetUserName) targetSocketId = socketId;
    });
    if (targetSocketId) {
        io.to(targetSocketId).emit('screen-share-request', {
            requesterId: socket.id,
            requesterName: currentUser?.name,
            targetUserName: data.targetUserName
        });
    }
});

socket.on('screen-share-accept', (data) => {
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

  socket.on('request-music', (data) => {
    try{
  if (!currentUser || !currentUser.name) {
  socket.emit('music-status', { status: 'error' });
  return;
}
    
    data.requester = currentUser.name;
    data.requesterId = socket.id;
    
    const targetUsers = Array.from(rooms.get(ROOM_CODE)?.users.values() || [])
      .filter(u => u.userName !== currentUser.name);
    
    if (targetUsers.length === 0) {
      // Odada kimse yok
      socket.emit('music-status', { status: 'no-users' });
      return;
    }
    
    targetUsers.forEach(user => {
  const targetSocketId = Array.from(rooms.get(ROOM_CODE).users.entries())
    .find(([id, u]) => u.userName === user.userName)?.[0];
  
  // Kendine gönderme
  if (targetSocketId && targetSocketId !== socket.id) {
    io.to(targetSocketId).emit('music-request', data);
  }
});
    
    // İstek atan kişiye "gönderildi" bildirimi
    socket.emit('music-status', { status: 'sent' });
  } catch (error) {
    console.error('Müzik istek hatası:', error);
  }
});

socket.on('music-accept', (data) => {
  try {
    // Kabul eden kişiye müziği çal
    socket.emit('music-play', {
      videoId: data.videoId,
      title: data.title,
      channel: data.channel,
      requesterId: data.requesterId
    });
    
    // İstek atan kişiye "kabul edildi" bildirimi + müzik
    const requesterId = data.requesterId;
    if (requesterId) {
      io.to(requesterId).emit('music-status', { status: 'accepted' });
      io.to(requesterId).emit('music-play', {
        videoId: data.videoId,
        title: data.title,
        channel: data.channel,
        requesterId: data.requesterId
      });
    }
  } catch (error) {
    console.error('Müzik kabul hatası:', error);
  }
});

  socket.on('reject-music', (data) => {
  try {
    const requesterId = data.requesterId;
    if (requesterId) {
      io.to(requesterId).emit('music-status', { status: 'rejected' });
    }
  } catch (error) {
    console.error('Müzik reddetme hatası:', error);
  }
});

socket.on('music-control', (data) => {
  try {
    // Sadece teklif eden kişi kontrol edebilir
    if (data.requesterId === socket.id) {
      socket.to(ROOM_CODE).emit('music-control', data);
    }
  } catch (error) {
    console.error('Müzik kontrol hatası:', error);
  }
});
  
// ============ MÜZİK SİSTEMİ (TEMİZ) ============

// İzin isteği gönder
socket.on('request-music-permission', (data) => {
  try {
    if (!currentUser) return;
    
    const requesterId = socket.id;
    const requesterName = currentUser.name;
    
    const targetUsers = Array.from(rooms.get(ROOM_CODE)?.users.values() || [])
      .filter(u => u.userName !== requesterName);
    
    if (targetUsers.length === 0) {
      socket.emit('music-permission-status', { status: 'no-users' });
      return;
    }
    
    // Her hedef kullanıcıya istek gönder
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

// İzin kabul edildi
socket.on('accept-music-permission', (data) => {
  try {
    const requesterId = data.requesterId;
    if (requesterId) {
      io.to(requesterId).emit('music-permission-status', { 
        status: 'accepted', 
        listenerName: currentUser.name 
      });
    }
  } catch (error) {
    console.error('Müzik izin kabul hatası:', error);
  }
});

// İzin reddedildi
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

// İzin iptal edildi
socket.on('revoke-music-permission', (data) => {
  try {
    const requesterId = data.requesterId;
    if (requesterId) {
      io.to(requesterId).emit('music-permission-status', { 
        status: 'revoked', 
        listenerName: currentUser.name 
      });
    }
  } catch (error) {
    console.error('Müzik izin iptal hatası:', error);
  }
});

// Müzik çal (kontrolcü gönderir)
socket.on('music-play', (data) => {
  try {
    if (!currentUser) return;
    
    // Sadece izinli kontrolcü gönderebilir, ama biz yine de kontrol edelim
    // Burada basitçe odaya yayınlıyoruz
    io.to(ROOM_CODE).emit('music-play', {
      videoId: data.videoId,
      title: data.title,
      channel: data.channel,
      requesterId: data.requesterId || socket.id
    });
  } catch (error) {
    console.error('Müzik çalma hatası:', error);
  }
});

// Müzik kontrolü (play/pause/mute/unmute/stop)
socket.on('music-control', (data) => {
  try {
    // Sadece istekte bulunan kişi (kontrolcü) kontrol edebilir
    if (data.requesterId === socket.id) {
      socket.to(ROOM_CODE).emit('music-control', data);
    }
  } catch (error) {
    console.error('Müzik kontrol hatası:', error);
  }
});
  
  // ============ BAĞLANTI KOPTU ============
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
          }, 600000);
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
    

    const { data, error } = await supabase
      .from('dm_messages')
      .select('*')
      .or(`sender.eq.${sender},receiver.eq.${sender}`)
      .or(`sender.eq.${receiver},receiver.eq.${receiver}`)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // İki kişi arasındaki mesajları filtrele
    const filtered = data.filter(msg => 
      (msg.sender === sender && msg.receiver === receiver) ||
      (msg.sender === receiver && msg.receiver === sender)
    );

    res.json(filtered);
  } catch (error) {
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
}, 60 * 60 * 1000); // Her saat kontrol

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`🔔 Push bildirimler aktif`);
  console.log(`💾 Supabase bağlantısı kuruldu`);
});
