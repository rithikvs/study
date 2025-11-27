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

app.use('/api/groups', auth, groupRoutes);
app.use('/api/notes', auth, noteRoutes);
app.use('/api/files', auth, fileRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Study Platform API' });
});

// Socket.IO logic
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', async ({ roomCode }) => {
    if (!roomCode) return;
    socket.join(roomCode);
    io.to(roomCode).emit('presence', { socketId: socket.id, joined: true });
    console.log(`Socket ${socket.id} joined room ${roomCode}`);
  });

  socket.on('note:update', async ({ noteId, content, roomCode }) => {
    try {
      if (!noteId || roomCode == null) return;
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

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});