const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const Note = require('../models/Note');

// Get notes for a group by room code
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const notes = await Note.find({ group: group._id }).sort({ updatedAt: -1 });
    return res.json({ notes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Create a note in a group
router.post('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { title } = req.body;
    const group = await Group.findOne({ roomCode });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const note = await Note.create({ group: group._id, title: title || 'Untitled', content: '' });
    return res.json({ note });
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

// Delete a note
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Note.findByIdAndDelete(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;