# Screen Sharing Feature

## Overview
Replaced the paint/annotation functionality with **real-time screen sharing** using WebRTC. Now users can share their screens and others in the room can join to study together.

## How It Works

### For the Presenter (Screen Sharer):
1. Open any file in the room
2. Click **"📺 Screen Share"** button
3. Click **"🎥 Start Sharing"**
4. Select which screen/window to share from the browser popup
5. Your screen appears in a preview
6. See live count of viewers watching your screen
7. Click **"⏹️ Stop Sharing"** when done

### For Viewers:
1. Open the same file that someone is presenting
2. You'll see "👤 [Name] is presenting" at the top
3. Click **"👁️ Join View"** to see their screen
4. The presenter's screen displays in real-time
5. Multiple people can view simultaneously

## Technical Details

### WebRTC Peer-to-Peer Connection:
- Uses STUN servers for NAT traversal
- Peer-to-peer video streaming (no video goes through server)
- Real-time signaling via Socket.IO
- Automatic reconnection on network issues

### Features:
- ✅ Multiple viewers can watch one presenter
- ✅ Live viewer count and avatars
- ✅ High-quality screen capture with cursor
- ✅ Works across different devices/browsers
- ✅ Automatic cleanup when presenter stops
- ✅ Browser notifies when screen sharing ends

### Socket Events:
- `screenshare:join` - User enters screen share session
- `screenshare:start-presenting` - User starts sharing screen
- `screenshare:stop-presenting` - User stops sharing
- `screenshare:viewer-joined` - New viewer joins
- `screenshare:offer/answer/ice-candidate` - WebRTC signaling

## Browser Requirements
- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support  
- Safari: ✅ Works (may need permissions)
- Mobile browsers: ⚠️ Limited (viewing works, sharing may not)

## Security
- Screen sharing requires explicit user permission
- Only room members can view shared screens
- WebRTC connections are encrypted
- No recordings stored on server

## Use Cases
- Study sessions with shared notes/documents
- Collaborative problem-solving
- Live tutoring/teaching
- Group code reviews
- Presentation practice

## Files Changed
- **NEW**: `client/src/components/ScreenShare.jsx` - Main screen sharing component
- **MODIFIED**: `client/src/pages/Room.jsx` - Replaced FileViewer with ScreenShare
- **MODIFIED**: `server/index.js` - Added WebRTC signaling socket events
- **REMOVED**: Paint/annotation functionality from FileViewer
