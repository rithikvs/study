import { useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';
import { useApp } from '../context/AppContext';

export default function ScreenShareSession({ roomCode, onClose }) {
  const { authUser } = useApp();
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [presenter, setPresenter] = useState(null);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map of userId -> RTCPeerConnection

  // WebRTC configuration with multiple STUN servers for better connectivity
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
  };

  useEffect(() => {
    if (!roomCode || !authUser) return;

    // Join the screen share room
    socket.emit('screenshare:join', {
      roomCode,
      userId: authUser.id,
      userName: authUser.name,
    });

    // Listen for screen share events
    socket.on('screenshare:presenter-started', handlePresenterStarted);
    socket.on('screenshare:presenter-stopped', handlePresenterStopped);
    socket.on('screenshare:viewers-update', handleViewersUpdate);
    socket.on('screenshare:offer', handleOffer);
    socket.on('screenshare:answer', handleAnswer);
    socket.on('screenshare:ice-candidate', handleIceCandidate);

    return () => {
      cleanup();
      socket.emit('screenshare:leave', {
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
  }, [roomCode, authUser]);

  function cleanup() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }

  function handlePresenterStarted({ userId, userName }) {
    console.log('📺 Presenter started:', userName);
    setPresenter({ userId, userName });
    
    // If it's not us, we're now a viewer
    if (userId !== authUser.id) {
      setIsViewing(false); // Reset viewing state, user needs to click Join
      setError(null); // Clear any previous errors
    }
  }

  function handlePresenterStopped({ userId }) {
    console.log('⏹️ Presenter stopped:', userId);
    setPresenter(null);
    setIsViewing(false);
    setConnectionStatus('disconnected');
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }

  function handleViewersUpdate({ viewers: viewersList }) {
    setViewers(viewersList.filter(v => v.userId !== authUser.id));
  }

  async function startSharing() {
    try {
      setError(null);
      
      let stream;
      
      // Try screen sharing first (desktop browsers)
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              cursor: 'always',
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
        } catch (err) {
          // If getDisplayMedia fails, try getUserMedia for mobile
          if (err.name === 'NotAllowedError') {
            throw err; // User denied permission
          }
          console.log('getDisplayMedia not available, trying camera for mobile...');
          stream = null;
        }
      }
      
      // Fallback to camera for mobile devices
      if (!stream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user', // front camera by default
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
          // Let user know they're sharing camera instead of screen
          console.log('📱 Sharing camera stream (mobile device)');
        } catch (err) {
          throw new Error('Camera access denied or not available');
        }
      }
      
      if (!stream) {
        setError('Unable to start sharing. Please allow camera/screen access or use a desktop browser.');
        return;
      }

      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Notify server that we're presenting
      socket.emit('screenshare:start-presenting', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });

      setIsSharing(true);
      setPresenter({ userId: authUser.id, userName: authUser.name });

      // Handle stream end (user clicks "Stop Sharing" in browser)
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

    } catch (err) {
      console.error('Error starting screen share:', err);
      if (err.name === 'NotAllowedError') {
        setError('Permission denied. Please allow camera/screen access in your browser settings and try again.');
      } else if (err.message && err.message.includes('Camera access denied')) {
        setError('Camera access denied. Please allow camera permission in your browser settings.');
      } else {
        setError('Failed to start sharing. Make sure you have a camera or use a desktop browser for screen sharing.');
      }
    }
  }

  function stopSharing() {
    cleanup();

    socket.emit('screenshare:stop-presenting', {
      roomCode,
      userId: authUser.id,
    });

    setIsSharing(false);
    setPresenter(null);
  }

  async function joinViewing() {
    if (!presenter || presenter.userId === authUser.id) return;

    try {
      setError(null);
      setConnectionStatus('connecting');
      setIsViewing(true);
      
      // Request to view - presenter will send us an offer
      socket.emit('screenshare:request-view', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });

      console.log('👁️ Requested to join viewing from', presenter.userName);

    } catch (err) {
      console.error('Error joining viewing:', err);
      setError('Failed to join screen sharing. Please try again.');
      setConnectionStatus('disconnected');
      setIsViewing(false);
    }
  }

  async function handleOffer({ offer, fromUserId, toUserId }) {
    // Only handle offers meant for us
    if (toUserId !== authUser.id) return;
    
    console.log('📥 Received offer from presenter:', fromUserId);
    
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(fromUserId, peerConnection);

      // Handle incoming stream from presenter
      peerConnection.ontrack = (event) => {
        console.log('📺 Received remote stream from presenter', event.streams[0]);
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setConnectionStatus('connected');
          console.log('✅ Video stream set to remote video element');
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: authUser.id,
            toUserId: fromUserId,
          });
        }
      };

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          setConnectionStatus('connected');
        } else if (peerConnection.connectionState === 'failed') {
          setConnectionStatus('disconnected');
          setError('Connection failed. Please try joining again.');
        }
      };

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('screenshare:answer', {
        roomCode,
        answer,
        fromUserId: authUser.id,
        toUserId: fromUserId,
      });

    } catch (err) {
      console.error('Error handling offer:', err);
      setError('Failed to connect. Please try again.');
    }
  }

  async function handleAnswer({ answer, fromUserId, toUserId }) {
    // Only handle answers meant for us
    if (toUserId !== authUser.id) return;
    
    console.log('📬 Received answer from viewer:', fromUserId);
    
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) {
      console.error('No peer connection found for', fromUserId);
      return;
    }
    
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('✅ Answer set successfully');
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }

  async function handleIceCandidate({ candidate, fromUserId, toUserId }) {
    // Only handle candidates meant for us
    if (toUserId !== authUser.id) return;
    
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) return;
    
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }

  // Presenter: Handle view requests and create offers for viewers
  useEffect(() => {
    async function handleViewRequest({ userId, userName }) {
      if (!isSharing || !streamRef.current) return;
      if (userId === authUser.id) return; // Don't create connection to ourselves

      console.log('👁️ Viewer requesting to join:', userName);

      try {
        const peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnectionsRef.current.set(userId, peerConnection);

        // Add our stream tracks
        streamRef.current.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          peerConnection.addTrack(track, streamRef.current);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('screenshare:ice-candidate', {
              roomCode,
              candidate: event.candidate,
              fromUserId: authUser.id,
              toUserId: userId,
            });
          }
        };

        // Monitor connection state
        peerConnection.onconnectionstatechange = () => {
          console.log('Presenter connection state with', userName, ':', peerConnection.connectionState);
        };

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        console.log('📤 Sending offer to viewer:', userName);
        socket.emit('screenshare:offer', {
          roomCode,
          offer,
          fromUserId: authUser.id,
          toUserId: userId,
        });

      } catch (err) {
        console.error('Error creating offer for viewer:', err);
      }
    }

    socket.on('screenshare:request-view', handleViewRequest);
    return () => socket.off('screenshare:request-view', handleViewRequest);
  }, [isSharing, authUser, roomCode]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 text-white p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">📺 Screen Share</h2>
          {connectionStatus === 'connecting' && (
            <span className="text-sm text-yellow-400 animate-pulse">
              🔄 Connecting...
            </span>
          )}
          {connectionStatus === 'connected' && isViewing && (
            <span className="text-sm text-green-400">
              ✅ Connected
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {viewers.length > 0 && isSharing && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-300">
                👥 {viewers.length} viewer{viewers.length !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-1">
                {viewers.slice(0, 3).map((v, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold"
                    title={v.userName}
                  >
                    {v.userName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {viewers.length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-semibold">
                    +{viewers.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

          {!presenter && (
            <button
              onClick={startSharing}
              className="px-6 py-2 bg-green-600 rounded-lg hover:bg-green-700 font-medium transition"
            >
              🎥 Start Sharing
            </button>
          )}

          {isSharing && (
            <button
              onClick={stopSharing}
              className="px-6 py-2 bg-red-600 rounded-lg hover:bg-red-700 font-medium transition"
            >
              ⏹️ Stop Sharing
            </button>
          )}

          {presenter && !isSharing && presenter.userId !== authUser.id && !isViewing && (
            <button
              onClick={joinViewing}
              disabled={connectionStatus === 'connecting'}
              className="px-6 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connectionStatus === 'connecting' ? '🔄 Connecting...' : '👁️ Join View'}
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 rounded-lg hover:bg-slate-600 transition"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {presenter && presenter.userId !== authUser.id && !isViewing && (
        <div className="bg-gradient-to-r from-green-600 to-blue-600 text-white p-4 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <div className="text-3xl">👤</div>
            <div>
              <div className="font-bold text-lg">{presenter.userName} is sharing their screen</div>
              <div className="text-sm opacity-90">Click "Join View" to see what they're sharing</div>
            </div>
          </div>
          <button
            onClick={joinViewing}
            disabled={connectionStatus === 'connecting'}
            className="px-6 py-3 bg-white text-blue-600 rounded-lg hover:bg-blue-50 font-bold shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connectionStatus === 'connecting' ? '🔄 Connecting...' : '👁️ Join View'}
          </button>
        </div>
      )}

      {/* Video Display Area */}
      <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center p-4 md:p-8">
        {error && (
          <div className="text-center max-w-md">
            <div className="text-red-400 text-6xl mb-4">⚠️</div>
            <h3 className="text-red-400 text-xl mb-2">Error</h3>
            <p className="text-gray-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-4 px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {!isSharing && !presenter && !error && (
          <div className="text-white text-center max-w-lg px-4">
            <div className="text-6xl mb-4">📺</div>
            <h3 className="text-2xl mb-2">No active screen share</h3>
            <p className="text-gray-400 mb-4">Click "Start Sharing" to share with the room</p>
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4 mt-4">
              <p className="text-sm text-blue-300">
                💻 <strong>Desktop:</strong> Share your screen<br/>
                📱 <strong>Mobile:</strong> Share your camera
              </p>
              <p className="text-xs text-gray-400 mt-2">
                All room members can view what you share
              </p>
            </div>
          </div>
        )}

        {isSharing && !error && (
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

        {isViewing && !isSharing && !error && (
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

        {presenter && !isSharing && !isViewing && !error && (
          <div className="text-white text-center">
            <div className="text-6xl mb-4">👤</div>
            <h3 className="text-2xl mb-2">{presenter.userName} is sharing</h3>
            <p className="text-gray-400 mb-4">Click "Join View" to see their screen</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800 text-white p-2 text-sm text-center">
        {isSharing && `📡 Sharing screen with ${viewers.length} viewer${viewers.length !== 1 ? 's' : ''}`}
        {isViewing && !isSharing && `👁️ Viewing ${presenter?.userName}'s screen`}
        {!isSharing && !presenter && '💡 Click "Start Sharing" to begin screen sharing session'}
        {presenter && !isSharing && !isViewing && `📺 ${presenter.userName} is presenting - Click "Join View" to watch`}
      </div>
    </div>
  );
}
