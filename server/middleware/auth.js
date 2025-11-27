const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.user = payload; // { id, email }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'invalid token' });
  }
}

module.exports = auth;