const express = require('express');
const router = express.Router();
const Whiteboard = require('../models/Whiteboard');
const Group = require('../models/Group');

// Get whiteboard for a room
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    
    // Verify room exists and user has access
    const group = await Group.findOne({ roomCode });
    if (!group) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Check if user is a member
    const isMember = group.members.some(
      (member) => member.toString() === req.user.id
    );
    if (!isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get whiteboard data
    const whiteboard = await Whiteboard.findOne({ roomCode });
    
    if (!whiteboard) {
      return res.json({ canvasData: null });
    }

    res.json({ canvasData: whiteboard.canvasData });
  } catch (err) {
    console.error('Get whiteboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save whiteboard for a room
router.post('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { canvasData } = req.body;

    // Verify room exists and user has access
    const group = await Group.findOne({ roomCode });
    if (!group) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Check if user is a member
    const isMember = group.members.some(
      (member) => member.toString() === req.user.id
    );
    if (!isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update or create whiteboard
    const whiteboard = await Whiteboard.findOneAndUpdate(
      { roomCode },
      { canvasData, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, whiteboard });
  } catch (err) {
    console.error('Save whiteboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Clear whiteboard for a room
router.delete('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;

    // Verify room exists and user has access
    const group = await Group.findOne({ roomCode });
    if (!group) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Check if user is a member
    const isMember = group.members.some(
      (member) => member.toString() === req.user.id
    );
    if (!isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Delete whiteboard data
    await Whiteboard.findOneAndDelete({ roomCode });

    res.json({ success: true, message: 'Whiteboard cleared' });
  } catch (err) {
    console.error('Clear whiteboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
