require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

async function deleteRoom() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Get models
    const Group = mongoose.model('Group', new mongoose.Schema({
      name: String,
      roomCode: String,
      members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }));

    const Note = mongoose.model('Note', new mongoose.Schema({
      group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
      title: String,
      content: String,
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }));

    const File = mongoose.model('File', new mongoose.Schema({
      group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      filename: String,
      originalName: String,
      mimeType: String,
      size: Number,
      data: Buffer,
    }));

    const User = mongoose.model('User', new mongoose.Schema({
      name: String,
      email: String,
      passwordHash: String,
      groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
    }));

    // Find the room
    const room = await Group.findOne({ roomCode: 'USS3QS' });
    if (!room) {
      console.log('Room USS3QS not found');
      process.exit(0);
    }

    console.log(`Found room: ${room.name} (${room.roomCode})`);

    // Delete notes
    const notesDeleted = await Note.deleteMany({ group: room._id });
    console.log(`Deleted ${notesDeleted.deletedCount} notes`);

    // Delete files
    const filesDeleted = await File.deleteMany({ group: room._id });
    console.log(`Deleted ${filesDeleted.deletedCount} files`);

    // Remove from users' groups array
    const usersUpdated = await User.updateMany(
      { groups: room._id },
      { $pull: { groups: room._id } }
    );
    console.log(`Updated ${usersUpdated.modifiedCount} users`);

    // Delete the room
    await Group.findByIdAndDelete(room._id);
    console.log('Room USS3QS deleted successfully from database!');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

deleteRoom();
