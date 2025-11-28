const mongoose = require('mongoose');

const annotationSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  roomCode: { type: String, required: true },
  pageNumber: { type: Number, required: true, default: 1 },
  annotations: [{
    type: { type: String, enum: ['pen', 'highlighter'], required: true },
    color: { type: String, required: true },
    width: { type: Number, required: true },
    points: [{ x: Number, y: Number }],
    timestamp: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String }
  }]
}, { timestamps: true });

// Index for faster queries
annotationSchema.index({ fileId: 1, pageNumber: 1 });
annotationSchema.index({ roomCode: 1 });

module.exports = mongoose.model('Annotation', annotationSchema);
