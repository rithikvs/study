const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const Note = require('../models/Note');

// Helper to get io instance
let io;
function setIO(ioInstance) {
  io = ioInstance;
}

router.setIO = setIO;

// Get notes for a group by room code - ONLY for members
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ error: 'group not found' });
    
    // Check if user is a member
    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ error: 'Access denied. Join this room first.' });
    }
    
    const notes = await Note.find({ group: group._id })
      .populate('createdBy', 'name')
      .sort({ updatedAt: -1 });
    return res.json({ notes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Create a note in a group - ONLY for members
router.post('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { title } = req.body;
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ error: 'group not found' });
    
    // Check if user is a member
    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ error: 'Access denied. Join this room first.' });
    }
    
    const note = await Note.create({ 
      group: group._id, 
      title: title || 'Untitled', 
      content: '',
      createdBy: req.user.id 
    });
    const populatedNote = await Note.findById(note._id).populate('createdBy', 'name');
    
    // Broadcast to all users in the room via socket
    if (io) {
      io.to(roomCode).emit('note:created', { note: populatedNote });
    }
    
    return res.json({ note: populatedNote });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Update a note
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    const note = await Note.findByIdAndUpdate(
      id,
      { title, content, updatedAt: new Date() },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'note not found' });
    return res.json({ note });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Delete a note - only creator can delete
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findById(id).populate('group');
    if (!note) {
      return res.status(404).json({ error: 'note not found' });
    }
    // Check if user is the creator
    if (note.createdBy && note.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only creator can delete this note' });
    }
    
    const roomCode = note.group?.roomCode;
    await Note.findByIdAndDelete(id);
    
    // Broadcast deletion to room
    if (io && roomCode) {
      io.to(roomCode).emit('note:deleted', { noteId: id });
    }
    
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;