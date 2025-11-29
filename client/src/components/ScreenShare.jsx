import { useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';
import { useApp } from '../context/AppContext';

export default function ScreenShare({ file, roomCode, onClose }) {
  const { authUser } = useApp();
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [presenter, setPresenter] = useState(null);
  const [error, setError] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef({});

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    // Join the file sharing session
    socket.emit('screenshare:join', {
      fileId: file._id,
      roomCode,
      userId: authUser.id,
      userName: authUser.name,
    });

    // Listen for presenter updates
    socket.on('screenshare:presenter-started', handlePresenterStarted);
    socket.on('screenshare:presenter-stopped', handlePresenterStopped);
    socket.on('screenshare:viewers-update', handleViewersUpdate);
    socket.on('screenshare:offer', handleOffer);
    socket.on('screenshare:answer', handleAnswer);
    socket.on('screenshare:ice-candidate', handleIceCandidate);

    return () => {
      stopSharing();
      socket.emit('screenshare:leave', {
        fileId: file._id,
        roomCode,
        userId: authUser.id,
      });
      socket.off('screenshare:presenter-started', handlePresenterStarted);
      socket.off('screenshare:presenter-stopped', handlePresenterStopped);
      socket.off('screenshare:viewers-update', handleViewersUpdate);
      socket.off('screenshare:offer', handleOffer);
      socket.off('screenshare:answer', handleAnswer);
      socket.off('screenshare:ice-candidate', handleIceCandidate);
    };
  }, []);

  function handlePresenterStarted({ userId, userName }) {
    setPresenter({ userId, userName });
    setIsViewing(userId !== authUser.id);
  }

  function handlePresenterStopped() {
    setPresenter(null);
    setIsViewing(false);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }

  function handleViewersUpdate({ viewers: viewersList }) {
    setViewers(viewersList.filter(v => v.userId !== authUser.id));
  }

  async function startSharing() {
    try {
      setError(null);
      // Get screen capture stream
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
        },
        audio: false,
      });

      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Notify server that we're presenting
      socket.emit('screenshare:start-presenting', {
        fileId: file._id,
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });

      setIsSharing(true);

      // Handle stream end (user clicks "Stop Sharing" in browser)
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

      // Create peer connections for each viewer
      socket.on('screenshare:viewer-joined', async ({ userId, userName }) => {
        console.log(`Viewer joined: ${userName}`);
        await createPeerConnection(userId, true);
      });

    } catch (err) {
      console.error('Error starting screen share:', err);
      setError('Failed to start screen sharing. Please allow screen access.');
    }
  }

  function stopSharing() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    // Close all peer connections
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};

    socket.emit('screenshare:stop-presenting', {
      fileId: file._id,
      roomCode,
      userId: authUser.id,
    });

    setIsSharing(false);
  }

  async function createPeerConnection(viewerId, isOfferer) {
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[viewerId] = peerConnection;

    // Add stream tracks to peer connection
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, streamRef.current);
      });
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('screenshare:ice-candidate', {
          fileId: file._id,
          roomCode,
          candidate: event.candidate,
          targetUserId: viewerId,
          fromUserId: authUser.id,
        });
      }
    };

    // Handle incoming stream (for viewers)
    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Create and send offer if we're the offerer
    if (isOfferer) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('screenshare:offer', {
        fileId: file._id,
        roomCode,
        offer,
        targetUserId: viewerId,
        fromUserId: authUser.id,
      });
    }

    return peerConnection;
  }

  async function handleOffer({ offer, fromUserId }) {
    console.log('Received offer from:', fromUserId);
    const peerConnection = await createPeerConnection(fromUserId, false);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('screenshare:answer', {
      fileId: file._id,
      roomCode,
      answer,
      targetUserId: fromUserId,
      fromUserId: authUser.id,
    });
  }

  async function handleAnswer({ answer, fromUserId }) {
    console.log('Received answer from:', fromUserId);
    const peerConnection = peerConnectionsRef.current[fromUserId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async function handleIceCandidate({ candidate, fromUserId }) {
    const peerConnection = peerConnectionsRef.current[fromUserId];
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function requestToView() {
    if (presenter) {
      await createPeerConnection(presenter.userId, false);
      socket.emit('screenshare:viewer-joined', {
        fileId: file._id,
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">📺 Screen Share - {file.originalName}</h2>
          {presenter && presenter.userId !== authUser.id && (
            <span className="text-sm text-green-400">
              👤 {presenter.userName} is presenting
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {viewers.length > 0 && isSharing && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">
                👥 {viewers.length} viewer{viewers.length !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-1">
                {viewers.slice(0, 3).map((v, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs"
                    title={v.userName}
                  >
                    {v.userName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {viewers.length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs">
                    +{viewers.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

          {!presenter && !isSharing && (
            <button
              onClick={startSharing}
              className="px-6 py-2 bg-green-600 rounded hover:bg-green-700 font-medium"
            >
              🎥 Start Sharing
            </button>
          )}

          {isSharing && (
            <button
              onClick={stopSharing}
              className="px-6 py-2 bg-red-600 rounded hover:bg-red-700 font-medium"
            >
              ⏹️ Stop Sharing
            </button>
          )}

          {presenter && !isSharing && presenter.userId !== authUser.id && !isViewing && (
            <button
              onClick={requestToView}
              className="px-6 py-2 bg-blue-600 rounded hover:bg-blue-700 font-medium"
            >
              👁️ Join View
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 rounded hover:bg-slate-600"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Video Display Area */}
      <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center p-8">
        {error && (
          <div className="text-red-400 text-xl">{error}</div>
        )}

        {!isSharing && !presenter && !error && (
          <div className="text-white text-center">
            <div className="text-6xl mb-4">📺</div>
            <h3 className="text-2xl mb-2">No one is sharing yet</h3>
            <p className="text-gray-400 mb-4">Click "Start Sharing" to share your screen with the room</p>
          </div>
        )}

        {isSharing && (
          <div className="w-full max-w-6xl">
            <h3 className="text-white text-xl mb-4">Your Screen (Preview)</h3>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-lg shadow-2xl bg-black"
            />
          </div>
        )}

        {isViewing && !isSharing && (
          <div className="w-full max-w-6xl">
            <h3 className="text-white text-xl mb-4">Viewing: {presenter?.userName}'s Screen</h3>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full rounded-lg shadow-2xl bg-black"
            />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800 text-white p-2 text-sm text-center">
        {isSharing && `📡 Sharing screen with ${viewers.length} viewer${viewers.length !== 1 ? 's' : ''}`}
        {isViewing && !isSharing && `👁️ Viewing ${presenter?.userName}'s screen`}
        {!isSharing && !presenter && '💡 Start sharing to let others study from your screen'}
      </div>
    </div>
  );
}
