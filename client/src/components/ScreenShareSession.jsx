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
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);

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

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

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
      
      // Check if screen sharing is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setError('Screen sharing is only available on desktop browsers (Chrome, Firefox, Edge, Safari). However, you can still join to view others\' shared screens!');
        return;
      }

      // Get screen capture stream
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

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
        setError('Screen sharing permission denied. Please allow screen access and try again.');
      } else if (err.name === 'NotSupportedError') {
        setError('Screen sharing (presenting) is only available on desktop browsers. You can still join to view others\' screens!');
      } else {
        setError('Failed to start screen sharing. Please try again or use a desktop browser to share.');
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
      
      // Create peer connection
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = peerConnection;

      // Handle incoming stream
      peerConnection.ontrack = (event) => {
        console.log('📺 Received remote stream');
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setConnectionStatus('connected');
          setIsViewing(true);
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: authUser.id,
          });
        }
      };

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          setConnectionStatus('connected');
        } else if (peerConnection.connectionState === 'disconnected' || 
                   peerConnection.connectionState === 'failed') {
          setConnectionStatus('disconnected');
          setError('Connection lost. Please try joining again.');
        }
      };

      // Request to join as viewer
      socket.emit('screenshare:request-view', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });

    } catch (err) {
      console.error('Error joining viewing:', err);
      setError('Failed to join screen sharing. Please try again.');
      setConnectionStatus('disconnected');
    }
  }

  async function handleOffer({ offer, fromUserId }) {
    if (fromUserId === authUser.id) return;
    
    console.log('📥 Received offer from:', fromUserId);
    
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = peerConnection;

      // Add our stream tracks if we're the presenter
      if (streamRef.current && isSharing) {
        streamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, streamRef.current);
        });
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: authUser.id,
          });
        }
      };

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('screenshare:answer', {
        roomCode,
        answer,
        fromUserId: authUser.id,
      });

    } catch (err) {
      console.error('Error handling offer:', err);
    }
  }

  async function handleAnswer({ answer, fromUserId }) {
    if (fromUserId === authUser.id || !peerConnectionRef.current) return;
    
    console.log('📬 Received answer from:', fromUserId);
    
    try {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }

  async function handleIceCandidate({ candidate, fromUserId }) {
    if (fromUserId === authUser.id || !peerConnectionRef.current) return;
    
    try {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }

  // Listen for when presenter creates offer for us
  useEffect(() => {
    async function handleViewRequest() {
      if (!isSharing || !streamRef.current || !presenter || presenter.userId !== authUser.id) return;

      try {
        const peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnectionRef.current = peerConnection;

        // Add stream tracks
        streamRef.current.getTracks().forEach(track => {
          peerConnection.addTrack(track, streamRef.current);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('screenshare:ice-candidate', {
              roomCode,
              candidate: event.candidate,
              fromUserId: authUser.id,
            });
          }
        };

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('screenshare:offer', {
          roomCode,
          offer,
          fromUserId: authUser.id,
        });

      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }

    socket.on('screenshare:request-view', handleViewRequest);
    return () => socket.off('screenshare:request-view', handleViewRequest);
  }, [isSharing, presenter, authUser, roomCode]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 text-white p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">📺 Screen Share Session</h2>
          {presenter && presenter.userId !== authUser.id && (
            <span className="text-sm text-green-400 animate-pulse">
              👤 {presenter.userName} is presenting
            </span>
          )}
          {connectionStatus === 'connecting' && (
            <span className="text-sm text-yellow-400">
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
            <p className="text-gray-400 mb-4">Click "Start Sharing" to share your screen with the room</p>
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4 mt-4">
              <p className="text-sm text-blue-300">
                📱 <strong>Mobile users:</strong> You can join to view shared screens, but screen sharing (presenting) requires a desktop browser.
              </p>
              <p className="text-xs text-gray-400 mt-2">
                💻 Desktop: Chrome, Firefox, Edge, Safari supported
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
