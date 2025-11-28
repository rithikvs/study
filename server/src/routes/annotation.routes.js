const express = require('express');
const router = express.Router();
const Annotation = require('../models/Annotation');
const File = require('../models/File');
const Group = require('../models/Group');
const auth = require('../middleware/auth');

let io;
function setIO(ioInstance) {
  io = ioInstance;
}
router.setIO = setIO;

// Get annotations for a specific file and page
router.get('/:fileId/:pageNumber', auth, async (req, res) => {
  try {
    const { fileId, pageNumber } = req.params;
    
    // Get file to check room membership
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Verify user is member of the room
    const group = await Group.findOne({ roomCode: file.roomCode });
    if (!group || !group.members.includes(req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get or create annotation document
    let annotation = await Annotation.findOne({ 
      fileId, 
      pageNumber: parseInt(pageNumber) 
    });
    
    if (!annotation) {
      annotation = await Annotation.create({
        fileId,
        roomCode: file.roomCode,
        pageNumber: parseInt(pageNumber),
        annotations: []
      });
    }
    
    res.json({ annotation });
  } catch (err) {
    console.error('Get annotations error:', err);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
});

// Add annotation (real-time drawing)
router.post('/:fileId/:pageNumber/draw', auth, async (req, res) => {
  try {
    const { fileId, pageNumber } = req.params;
    const { type, color, width, points, userName } = req.body;
    
    // Get file to check room membership
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Verify user is member of the room
    const group = await Group.findOne({ roomCode: file.roomCode });
    if (!group || !group.members.includes(req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get or create annotation document
    let annotation = await Annotation.findOne({ 
      fileId, 
      pageNumber: parseInt(pageNumber) 
    });
    
    if (!annotation) {
      annotation = await Annotation.create({
        fileId,
        roomCode: file.roomCode,
        pageNumber: parseInt(pageNumber),
        annotations: []
      });
    }
    
    // Add new annotation
    const newAnnotation = {
      type,
      color,
      width,
      points,
      userId: req.userId,
      userName,
      timestamp: new Date()
    };
    
    annotation.annotations.push(newAnnotation);
    await annotation.save();
    
    // Broadcast to all users in the room
    if (io) {
      console.log(`📝 Broadcasting annotation to room: ${file.roomCode}`);
      io.to(file.roomCode).emit('annotation:draw', {
        fileId,
        pageNumber: parseInt(pageNumber),
        annotation: newAnnotation
      });
    }
    
    res.json({ annotation: newAnnotation });
  } catch (err) {
    console.error('Add annotation error:', err);
    res.status(500).json({ error: 'Failed to add annotation' });
  }
});

// Clear all annotations for a page
router.delete('/:fileId/:pageNumber', auth, async (req, res) => {
  try {
    const { fileId, pageNumber } = req.params;
    
    // Get file to check room membership
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Verify user is member of the room
    const group = await Group.findOne({ roomCode: file.roomCode });
    if (!group || !group.members.includes(req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Clear annotations
    await Annotation.findOneAndUpdate(
      { fileId, pageNumber: parseInt(pageNumber) },
      { annotations: [] },
      { new: true, upsert: true }
    );
    
    // Broadcast to all users in the room
    if (io) {
      console.log(`🗑️ Broadcasting annotation clear to room: ${file.roomCode}`);
      io.to(file.roomCode).emit('annotation:clear', {
        fileId,
        pageNumber: parseInt(pageNumber)
      });
    }
    
    res.json({ message: 'Annotations cleared' });
  } catch (err) {
    console.error('Clear annotations error:', err);
    res.status(500).json({ error: 'Failed to clear annotations' });
  }
});

module.exports = router;
