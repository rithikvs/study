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
const whiteboardRoutes = require('./routes/whiteboard');
const auth = require('./middleware/auth');

// Pass io instance to routes that need it
noteRoutes.setIO(io);
groupRoutes.setIO(io);

app.use('/api/groups', auth, groupRoutes);
app.use('/api/notes', auth, noteRoutes);
app.use('/api/files', auth, fileRoutes);
app.use('/api/whiteboard', auth, whiteboardRoutes);
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

  // Whiteboard events
  socket.on('whiteboard:join', ({ roomCode, userName }) => {
    try {
      if (!roomCode || !userName) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      socket.join(whiteboardRoom);
      
      // Store user info in socket
      socket.whiteboardRoom = whiteboardRoom;
      socket.whiteboardUser = userName;
      
      // Get all users in the whiteboard room
      const room = io.sockets.adapter.rooms.get(whiteboardRoom);
      const users = [];
      if (room) {
        room.forEach((socketId) => {
          const sock = io.sockets.sockets.get(socketId);
          if (sock && sock.whiteboardUser) {
            users.push(sock.whiteboardUser);
          }
        });
      }
      
      console.log(`🎨 ${userName} joined whiteboard ${roomCode} (${users.length} users)`);
      
      // Notify all users in the room
      io.to(whiteboardRoom).emit('whiteboard:user-joined', { userName, users });
    } catch (err) {
      console.error('whiteboard:join error', err);
    }
  });

  socket.on('whiteboard:leave', ({ roomCode, userName }) => {
    try {
      if (!roomCode || !userName) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      socket.leave(whiteboardRoom);
      
      // Get remaining users
      const room = io.sockets.adapter.rooms.get(whiteboardRoom);
      const users = [];
      if (room) {
        room.forEach((socketId) => {
          const sock = io.sockets.sockets.get(socketId);
          if (sock && sock.whiteboardUser) {
            users.push(sock.whiteboardUser);
          }
        });
      }
      
      console.log(`🚪 ${userName} left whiteboard ${roomCode} (${users.length} users remaining)`);
      
      // Notify remaining users
      io.to(whiteboardRoom).emit('whiteboard:user-left', { userName, users });
    } catch (err) {
      console.error('whiteboard:leave error', err);
    }
  });

  socket.on('whiteboard:draw', ({ roomCode, pathData, userName }) => {
    try {
      if (!roomCode || !pathData) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      
      // Broadcast drawing to all other users in the room
      socket.to(whiteboardRoom).emit('whiteboard:draw', { pathData, userName });
    } catch (err) {
      console.error('whiteboard:draw error', err);
    }
  });

  socket.on('whiteboard:clear', ({ roomCode, userName }) => {
    try {
      if (!roomCode) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      
      console.log(`🧹 ${userName} cleared whiteboard ${roomCode}`);
      
      // Broadcast clear to all other users in the room
      socket.to(whiteboardRoom).emit('whiteboard:clear', { userName });
    } catch (err) {
      console.error('whiteboard:clear error', err);
    }
  });

  socket.on('whiteboard:undo', ({ roomCode, userName }) => {
    try {
      if (!roomCode) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      
      console.log(`↩️ ${userName} undid last stroke in whiteboard ${roomCode}`);
      
      // Broadcast undo to all other users in the room
      socket.to(whiteboardRoom).emit('whiteboard:undo', { userName });
    } catch (err) {
      console.error('whiteboard:undo error', err);
    }
  });

  socket.on('whiteboard:request-state', ({ roomCode }) => {
    try {
      if (!roomCode) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      
      // Ask other users in the room to send their canvas state
      socket.to(whiteboardRoom).emit('whiteboard:request-state');
    } catch (err) {
      console.error('whiteboard:request-state error', err);
    }
  });

  socket.on('whiteboard:send-state', ({ roomCode, canvasJSON }) => {
    try {
      if (!roomCode || !canvasJSON) return;
      
      const whiteboardRoom = `whiteboard:${roomCode}`;
      
      // Send canvas state to the requesting user
      socket.to(whiteboardRoom).emit('whiteboard:state', { canvasJSON });
    } catch (err) {
      console.error('whiteboard:send-state error', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    
    // Handle whiteboard disconnection
    if (socket.whiteboardRoom && socket.whiteboardUser) {
      const room = io.sockets.adapter.rooms.get(socket.whiteboardRoom);
      const users = [];
      if (room) {
        room.forEach((socketId) => {
          const sock = io.sockets.sockets.get(socketId);
          if (sock && sock.whiteboardUser) {
            users.push(sock.whiteboardUser);
          }
        });
      }
      
      io.to(socket.whiteboardRoom).emit('whiteboard:user-left', { 
        userName: socket.whiteboardUser, 
        users 
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
