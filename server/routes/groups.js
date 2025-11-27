const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const User = require('../models/User');

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

// Get group by room code
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode }).populate('members', 'name email');
    if (!group) return res.status(404).json({ message: 'group not found' });
    return res.json({ group });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

module.exports = router;