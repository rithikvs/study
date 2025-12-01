const mongoose = require('mongoose');

const whiteboardSchema = new mongoose.Schema({
  roomCode: {
    type: String,
    required: true,
    index: true,
  },
  canvasData: {
    type: Object,
    required: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Only one whiteboard per room
whiteboardSchema.index({ roomCode: 1 }, { unique: true });

module.exports = mongoose.model('Whiteboard', whiteboardSchema);
