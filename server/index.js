const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Allow both local and production origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5176',
  'https://study-fwpj.vercel.app', // Your Vercel deployment URL
  'https://a7d3a4b.vercel.app',
  process.env.CLIENT_URL, // Add your production frontend URL in environment variables
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Middleware
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// DB Connection
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 4000;

if (!MONGO_URI) {
  console.warn('Warning: MONGO_URI not set. Please add your MongoDB Atlas URI to server/.env');
}

mongoose
  .connect(MONGO_URI || 'mongodb://127.0.0.1:27017/study')
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Models
const Group = require('./models/Group');
const Note = require('./models/Note');

// Routes
const groupRoutes = require('./routes/groups');
const noteRoutes = require('./routes/notes');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const auth = require('./middleware/auth');

// Pass io instance to routes that need it
noteRoutes.setIO(io);
groupRoutes.setIO(io);

app.use('/api/groups', auth, groupRoutes);
app.use('/api/notes', auth, noteRoutes);
app.use('/api/files', auth, fileRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Study Platform API' });
});

// Socket.IO logic
io.on('connection', (socket) => {
  console.log('✅ Socket connected:', socket.id);

  socket.on('join', async ({ roomCode }) => {
    if (!roomCode) return;
    socket.join(roomCode);
    const roomSize = io.sockets.adapter.rooms.get(roomCode)?.size || 0;
    console.log(`🔌 Socket ${socket.id} joined room ${roomCode} (${roomSize} users)`);
    io.to(roomCode).emit('presence', { socketId: socket.id, joined: true });
  });

  socket.on('note:update', async ({ noteId, content, roomCode }) => {
    try {
      if (!noteId || roomCode == null) return;
      console.log(`📝 Broadcasting note:update for ${noteId} to room ${roomCode}`);
      const note = await Note.findByIdAndUpdate(
        noteId,
        { content, updatedAt: new Date() },
        { new: true }
      );
      io.to(roomCode).emit('note:updated', { note });
    } catch (err) {
      console.error('note:update error', err);
    }
  });

  socket.on('note:create', async ({ roomCode, title }) => {
    try {
      if (!roomCode) return;
      const group = await Group.findOne({ roomCode });
      if (!group) return;
      const note = await Note.create({ group: group._id, title: title || 'Untitled', content: '' });
      io.to(roomCode).emit('note:created', { note });
    } catch (err) {
      console.error('note:create error', err);
    }
  });

  socket.on('note:delete', async ({ roomCode, noteId }) => {
    try {
      if (!roomCode || !noteId) return;
      await Note.findByIdAndDelete(noteId);
      io.to(roomCode).emit('note:deleted', { noteId });
    } catch (err) {
      console.error('note:delete error', err);
    }
  });

  socket.on('file:viewer:join', ({ fileId, roomCode, userId, userName }) => {
    try {
      if (!fileId || !roomCode || !userId) return;
      console.log(`👁️ User ${userName} started viewing file ${fileId} in room ${roomCode}`);
      // Broadcast to all users in the room that someone is viewing the file
      io.to(roomCode).emit('file:viewer:joined', { fileId, userId, userName });
    } catch (err) {
      console.error('file:viewer:join error', err);
    }
  });

  socket.on('file:viewer:leave', ({ fileId, roomCode, userId }) => {
    try {
      if (!fileId || !roomCode || !userId) return;
      console.log(`👋 User ${userId} stopped viewing file ${fileId} in room ${roomCode}`);
      // Broadcast to all users in the room that someone stopped viewing the file
      io.to(roomCode).emit('file:viewer:left', { fileId, userId });
    } catch (err) {
      console.error('file:viewer:leave error', err);
    }
  });

  // Screen Share WebRTC Signaling
  socket.on('screenshare:join', ({ roomCode, userId, userName }) => {
    try {
      if (!roomCode || !userId) return;
      
      // Ensure socket data is set (merge with existing data)
      socket.data = { ...socket.data, userId, userName };
      
      console.log(`📺 User ${userName} (${userId}) joined screenshare session in room ${roomCode}`);
      
      // Send current presenter info to late joiners
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        console.log(`📺 Checking ${roomSockets.size} sockets in room ${roomCode} for existing presenter`);
        for (const socketId of roomSockets) {
          const s = io.sockets.sockets.get(socketId);
          if (s && s.data?.isPresenting && s.data?.userId) {
            socket.emit('screenshare:existing-presenter', {
              userId: s.data.userId,
              userName: s.data.userName
            });
            console.log(`📺 Notifying late joiner ${userName} about ongoing presentation by ${s.data.userName}`);
            break;
          }
        }
      }
    } catch (err) {
      console.error('screenshare:join error', err);
    }
  });

  socket.on('screenshare:leave', ({ roomCode, userId }) => {
    try {
      if (!roomCode) return;
      console.log(`👋 User ${userId} left screenshare session in room ${roomCode}`);
    } catch (err) {
      console.error('screenshare:leave error', err);
    }
  });

  socket.on('screenshare:start-presenting', ({ roomCode, userId, userName }) => {
    try {
      if (!roomCode || !userId) return;
      
      // Check if there's already a presenter and notify them to stop
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const otherSocket = io.sockets.sockets.get(socketId);
          if (otherSocket && otherSocket.data?.isPresenting && otherSocket.id !== socket.id) {
            console.log(`⏹️ Stopping old presenter in room ${roomCode}`);
            otherSocket.data.isPresenting = false;
            io.to(roomCode).emit('screenshare:presenter-stopped', { userId: otherSocket.data.userId });
          }
        });
      }
      
      socket.data.isPresenting = true;
      socket.data.userId = userId;
      socket.data.userName = userName;
      
      console.log(`🎥 User ${userName} (${userId}) started presenting screen in room ${roomCode}`);
      
      // Broadcast to entire room (including sender)
      io.to(roomCode).emit('screenshare:presenter-started', { userId, userName });
      
      // Log how many sockets received the broadcast
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      console.log(`📤 Broadcast screenshare:presenter-started to ${roomSockets?.size || 0} users in room ${roomCode}`);
    } catch (err) {
      console.error('screenshare:start-presenting error', err);
    }
  });
  socket.on('screenshare:stop-presenting', ({ roomCode, userId }) => {
    try {
      if (!roomCode) return;
      socket.data.isPresenting = false;
      console.log(`⏹️ User ${userId} stopped presenting in room ${roomCode}`);
      io.to(roomCode).emit('screenshare:presenter-stopped', { userId });
    } catch (err) {
      console.error('screenshare:stop-presenting error', err);
    }
  });

  socket.on('screenshare:request-view', ({ roomCode, userId, userName, isMobile }) => {
    try {
      if (!roomCode || !userId) return;
      console.log(`👁️ Viewer ${userName} requesting to view screenshare in room ${roomCode}`);
      // Broadcast to presenter to create offer
      socket.to(roomCode).emit('screenshare:request-view', { userId, userName, isMobile });
      
      // Update viewers list
      const viewers = [];
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket && socket.data?.userId && socket.data?.userId !== userId) {
            viewers.push({ userId: socket.data.userId, userName: socket.data.userName });
          }
        });
      }
      viewers.push({ userId, userName });
      io.to(roomCode).emit('screenshare:viewers-update', { viewers });
    } catch (err) {
      console.error('screenshare:request-view error', err);
    }
  });

  // Viewer requests retry with forced TURN relay; re-trigger view request with isMobile=true
  socket.on('screenshare:retry-with-relay', ({ roomCode, userId, userName }) => {
    try {
      if (!roomCode || !userId) return;
      console.log(`🔄 Retry requested by viewer ${userName} in room ${roomCode} (forced relay)`);
      socket.to(roomCode).emit('screenshare:request-view', { userId, userName, isMobile: true });
    } catch (err) {
      console.error('screenshare:retry-with-relay error', err);
    }
  });

  socket.on('screenshare:offer', ({ roomCode, offer, fromUserId, toUserId }) => {
    try {
      if (!offer || !roomCode) return;
      console.log(`📤 Sending WebRTC offer from ${fromUserId} to ${toUserId} in room ${roomCode}`);
      
      // Find the socket of the target user
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.data?.userId === toUserId) {
            targetSocket.emit('screenshare:offer', { offer, fromUserId, toUserId });
          }
        });
      }
    } catch (err) {
      console.error('screenshare:offer error', err);
    }
  });

  socket.on('screenshare:answer', ({ roomCode, answer, fromUserId, toUserId }) => {
    try {
      if (!answer || !roomCode) return;
      console.log(`📥 Sending WebRTC answer from ${fromUserId} to ${toUserId} in room ${roomCode}`);
      
      // Find the socket of the target user
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.data?.userId === toUserId) {
            targetSocket.emit('screenshare:answer', { answer, fromUserId, toUserId });
          }
        });
      }
    } catch (err) {
      console.error('screenshare:answer error', err);
    }
  });

  socket.on('screenshare:ice-candidate', ({ roomCode, candidate, fromUserId, toUserId }) => {
    try {
      if (!candidate || !roomCode) return;
      console.log(`🧊 Sending ICE candidate from ${fromUserId} to ${toUserId} in room ${roomCode}`);
      
      // Find the socket of the target user
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.data?.userId === toUserId) {
            targetSocket.emit('screenshare:ice-candidate', { candidate, fromUserId, toUserId });
          }
        });
      }
    } catch (err) {
      console.error('screenshare:ice-candidate error', err);
    }
  });

  // Forward ICE restart offers from viewer to presenter
  socket.on('screenshare:ice-restart', ({ roomCode, offer, fromUserId, toUserId }) => {
    try {
      if (!offer || !roomCode) return;
      console.log(`🔄 Forwarding ICE restart offer from ${fromUserId} to ${toUserId} in room ${roomCode}`);
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.data?.userId === toUserId) {
            targetSocket.emit('screenshare:ice-restart', { offer, fromUserId, toUserId });
          }
        });
      }
    } catch (err) {
      console.error('screenshare:ice-restart error', err);
    }
  });

  socket.on('screenshare:draw', ({ roomCode, fromUserId, x, y, color, size, type }) => {
    try {
      if (!roomCode) return;
      // Broadcast drawing data to all viewers in the room except sender
      socket.to(roomCode).emit('screenshare:draw', { fromUserId, x, y, color, size, type });
    } catch (err) {
      console.error('screenshare:draw error', err);
    }
  });

  socket.on('screenshare:connection-error', ({ roomCode, toUserId, error }) => {
    try {
      if (!roomCode || !toUserId) return;
      console.log(`❌ Connection error for ${toUserId} in room ${roomCode}:`, error);
      
      // Find the socket of the target user and send error
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        roomSockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket && targetSocket.data?.userId === toUserId) {
            targetSocket.emit('screenshare:connection-error', { error });
          }
        });
      }
    } catch (err) {
      console.error('screenshare:connection-error handler error', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
