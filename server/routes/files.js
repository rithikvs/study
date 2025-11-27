const express = require('express');
const multer = require('multer');
const router = express.Router();
const File = require('../models/File');
const Group = require('../models/Group');

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow specific file types
    const allowedTypes = [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, PPT, and images are allowed.'));
    }
  },
});

// Upload file to a room
router.post('/:roomCode/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode });
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Create file document
    const file = await File.create({
      group: group._id,
      uploadedBy: req.user.id,
      filename: req.file.originalname,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      data: req.file.buffer,
    });

    // Return file info without the binary data
    return res.json({
      file: {
        _id: file._id,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        uploadedBy: file.uploadedBy,
        createdAt: file.createdAt,
      },
    });
  } catch (err) {
    console.error('File upload error:', err);
    return res.status(500).json({ message: err.message || 'Upload failed' });
  }
});

// Get all files in a room
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const group = await Group.findOne({ roomCode });
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const files = await File.find({ group: group._id })
      .populate('uploadedBy', 'name email')
      .select('-data') // Exclude binary data from list
      .sort({ createdAt: -1 });

    return res.json({ files });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Download a specific file
router.get('/download/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${file.originalName}"`,
      'Content-Length': file.size,
    });

    return res.send(file.data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Download failed' });
  }
});

// Delete a file - any room member can delete
router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId).populate('group');
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Verify user is a member of the group
    const group = await Group.findById(file.group._id);
    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'Not authorized - not a room member' });
    }

    await File.findByIdAndDelete(fileId);
    return res.json({ message: 'File deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Delete failed' });
  }
});

module.exports = router;
