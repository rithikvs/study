const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'missing fields' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'email already registered' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
    return res.json({ user: { id: user._id, name: user.name, email: user.email }, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'missing fields' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
    return res.json({ user: { id: user._id, name: user.name, email: user.email }, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  return res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.json({ user: null });
    const jwtToken = authHeader.substring(7);
    const payload = jwt.verify(jwtToken, process.env.JWT_SECRET || 'dev-secret');
    const user = await User.findById(payload.id);
    return res.json({ user: user ? { id: user._id, name: user.name, email: user.email } : null });
  } catch (err) {
    return res.json({ user: null });
  }
});

// Get user's joined rooms from database
router.get('/my-rooms', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const jwtToken = authHeader.substring(7);
    const payload = jwt.verify(jwtToken, process.env.JWT_SECRET || 'dev-secret');
    
    const Group = require('../models/Group');
    // Find all groups where user is a member
    const groups = await Group.find({ members: payload.id })
      .select('name roomCode createdBy')
      .sort({ createdAt: -1 });
    
    return res.json({ groups });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'server error' });
  }
});

module.exports = router;