const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const User = require('../models/User');

// Helper to get io instance
let io;
function setIO(ioInstance) {
  io = ioInstance;
}

router.setIO = setIO;

// Create a group
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'name required' });
    const group = await Group.create({ 
      name, 
      createdBy: req.user.id,
      members: [req.user.id]
    });
    // persist membership to the user who created
    try { await User.findByIdAndUpdate(req.user.id, { $addToSet: { groups: group._id } }); } catch {}
    return res.json({ group });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

// Join a group via room code
router.post('/join', async (req, res) => {
  try {
    const { roomCode } = req.body;
    if (!roomCode) return res.status(400).json({ message: 'roomCode required' });
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ message: 'group not found' });
    
    // Add user to members if not already present
    if (!group.members.includes(req.user.id)) {
      group.members.push(req.user.id);
      await group.save();
    }
    
    // persist membership to the user who joined
    try { await User.findByIdAndUpdate(req.user.id, { $addToSet: { groups: group._id } }); } catch {}
    return res.json({ group });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

// Get group by room code - ONLY if user is a member
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode }).populate('members', 'name email');
    if (!group) return res.status(404).json({ message: 'group not found' });
    
    // Check if user is a member of this group
    const isMember = group.members.some(member => member._id.toString() === req.user.id);
    if (!isMember) {
      return res.status(403).json({ message: 'Access denied. You must join this room first.' });
    }
    
    return res.json({ group });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

// Delete a group - only creator can delete
router.delete('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ message: 'group not found' });
    
    // Check if user is the creator
    if (group.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only room creator can delete this room' });
    }

    // Broadcast room deletion to ALL users in the room BEFORE deleting
    if (io) {
      console.log(`🗑️ Broadcasting room deletion: ${roomCode}`);
      io.to(roomCode).emit('room:deleted', { roomCode, message: 'This room has been deleted by the owner' });
    }

    // Delete associated notes and files
    const Note = require('../models/Note');
    const File = require('../models/File');
    await Note.deleteMany({ group: group._id });
    await File.deleteMany({ group: group._id });
    
    // Remove group from all users
    await User.updateMany(
      { groups: group._id },
      { $pull: { groups: group._id } }
    );
    
    // Delete the group
    await Group.findByIdAndDelete(group._id);
    
    return res.json({ message: 'Room deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

module.exports = router;