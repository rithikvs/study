import { useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';

export default function ScreenShare({ roomCode, onClose, userName, authUser }) {
  const [isSharing, setIsSharing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [supportsScreenShare, setSupportsScreenShare] = useState(true);
  const [fallbackMode, setFallbackMode] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [isViewing, setIsViewing] = useState(false);
  const [presenterName, setPresenterName] = useState('');
  const [presenterId, setPresenterId] = useState(null);
  const [showJoinNotification, setShowJoinNotification] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const userIdRef = useRef(null);

  // WebRTC Configuration with STUN servers
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  // Feature detection on mount
  useEffect(() => {
    const checkDeviceCapabilities = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);

      // Check if getDisplayMedia is supported
      const hasDisplayMedia = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia;
      setSupportsScreenShare(hasDisplayMedia);

      if (mobile && !hasDisplayMedia) {
        setFallbackMode('camera');
      }
    };

    checkDeviceCapabilities();
  }, []);

  // Socket connection
  useEffect(() => {
    socketRef.current = socket;
    const userId = authUser?.id || socket.id;
    userIdRef.current = userId;

    // Handle presenter started event
    socket.on('screenshare:presenter-started', ({ userName: name, userId: presenterId }) => {
      if (userIdRef.current !== presenterId) {
        setPresenterName(name);
        setPresenterId(presenterId);
        setShowJoinNotification(true);
      }
    });

    // Check if there's already an ongoing presentation
    socket.on('screenshare:existing-presenter', ({ userName: name, userId: presenterId }) => {
      if (userIdRef.current !== presenterId) {
        setPresenterName(name);
        setPresenterId(presenterId);
        setShowJoinNotification(true);
      }
    });

    // Handle presenter stopped event
    socket.on('screenshare:presenter-stopped', () => {
      setIsViewing(false);
      setPresenterName('');
      setPresenterId(null);
      setShowJoinNotification(false);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    });

    // Handle request to view (presenter side)
    socket.on('screenshare:request-view', async ({ userId: viewerId, userName: viewerName }) => {
      if (isSharing) {
        setViewers(prev => [...prev, { id: viewerId, name: viewerName }]);
        await createOfferForViewer(viewerId);
      }
    });

    // Handle WebRTC offer (for viewers)
    socket.on('screenshare:offer', async ({ offer, fromUserId }) => {
      await handleReceiveOffer(offer, fromUserId);
    });

    // Handle WebRTC answer (for presenter)
    socket.on('screenshare:answer', async ({ answer }) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Process queued ICE candidates
        while (iceCandidatesQueue.current.length > 0) {
          const candidate = iceCandidatesQueue.current.shift();
          await peerConnectionRef.current.addIceCandidate(candidate);
        }
      }
    });

    // Handle ICE candidates
    socket.on('screenshare:ice-candidate', async ({ candidate }) => {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidatesQueue.current.push(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      if (userIdRef.current) {
        socket.emit('screenshare:leave', { roomCode, userId: userIdRef.current });
      }
      stopSharing();
    };
  }, [roomCode, userName, authUser]);

  // Start sharing screen or camera
  const startSharing = async () => {
    try {
      let stream;

      // Try getDisplayMedia first (desktop screen share)
      if (supportsScreenShare && !isMobile) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              cursor: 'always',
              displaySurface: 'monitor', // Can be 'monitor', 'window', or 'browser'
            },
            audio: false,
          });
        } catch (err) {
          console.log('getDisplayMedia failed, trying camera fallback:', err);
          stream = null;
        }
      }

      // Fallback to camera for mobile or if screen share failed
      if (!stream) {
        setFallbackMode('camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: isMobile ? 'environment' : 'user', // Use rear camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setIsSharing(true);
      setConnectionState('sharing');

      // Notify other users
      socketRef.current.emit('screenshare:start-presenting', {
        roomCode,
        userId: userIdRef.current,
        userName,
      });

      // Handle stream ended (user clicked "Stop Sharing" in browser)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopSharing();
      });

    } catch (error) {
      console.error('Error starting screen share:', error);
      alert('Could not start screen sharing. Please check permissions.');
    }
  };

  // Stop sharing
  const stopSharing = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setIsSharing(false);
    setViewers([]);
    setConnectionState('stopped');

    if (socketRef.current) {
      socketRef.current.emit('screenshare:stop-presenting', {
        roomCode,
        userId: userIdRef.current
      });
    }
  };

  // Create WebRTC offer for a viewer
  const createOfferForViewer = async (viewerId) => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = peerConnection;

      // Add local stream tracks to peer connection
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: userIdRef.current,
            toUserId: viewerId,
          });
        }
      };

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        setConnectionState(peerConnection.connectionState);
      };

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      socketRef.current.emit('screenshare:offer', {
        roomCode,
        offer,
        fromUserId: userIdRef.current,
        toUserId: viewerId,
      });

    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  // Handle receiving offer (viewer side)
  const handleReceiveOffer = async (offer, presenterId) => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = peerConnection;

      // Handle incoming stream
      peerConnection.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: userIdRef.current,
            toUserId: presenterId,
          });
        }
      };

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        setConnectionState(peerConnection.connectionState);
      };

      // Set remote description and create answer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socketRef.current.emit('screenshare:answer', {
        roomCode,
        answer,
        fromUserId: userIdRef.current,
        toUserId: presenterId,
      });

      // Process queued ICE candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        await peerConnection.addIceCandidate(candidate);
      }

    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  // Handle joining to view screen share
  const handleJoinScreenShare = () => {
    setIsViewing(true);
    setShowJoinNotification(false);
    
      // Request to view the presenter's screen
    if (socketRef.current) {
      socketRef.current.emit('screenshare:request-view', {
        roomCode,
        userId: userIdRef.current,
        userName,
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Screen Share</h2>
            {fallbackMode === 'camera' && (
              <p className="text-sm text-orange-600 mt-1">
                📱 Using camera fallback - Full screen sharing not supported on this device
              </p>
            )}
            {connectionState !== 'new' && connectionState !== 'connected' && (
              <p className="text-sm text-gray-600">Connection: {connectionState}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4">
          
          {/* Join Notification Banner */}
          {showJoinNotification && !isSharing && !isViewing && (
            <div className="mb-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg p-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="animate-pulse">
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-bold text-lg">{presenterName} is sharing their screen</div>
                    <div className="text-sm opacity-90">Click Join to view their screen</div>
                  </div>
                </div>
                <button
                  onClick={handleJoinScreenShare}
                  className="px-6 py-3 bg-white text-green-700 rounded-lg hover:bg-gray-100 font-bold shadow-lg transition flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Join & View
                </button>
              </div>
            </div>
          )}
          
          {/* Not sharing and not viewing - Initial state */}
          {!isSharing && !isViewing && !showJoinNotification && (
            <div className="flex flex-col items-center justify-center h-full space-y-6">
              <div className="text-center">
                <div className="text-6xl mb-4">🖥️</div>
                <h3 className="text-2xl font-bold text-gray-800 mb-2">Share Your Screen</h3>
                <p className="text-gray-600 max-w-md">
                  {supportsScreenShare && !isMobile
                    ? 'Share your entire screen, application window, or browser tab with everyone in the room.'
                    : 'Share your camera view with everyone in the room. Full screen sharing is not available on your device.'}
                </p>
              </div>

              <button
                onClick={startSharing}
                className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-3 text-lg font-semibold shadow-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {supportsScreenShare && !isMobile ? 'Start Screen Share' : 'Start Camera Share'}
              </button>

              {/* Device info */}
              <div className="bg-gray-50 rounded-lg p-4 max-w-md">
                <h4 className="font-semibold text-gray-700 mb-2">📋 Supported Features:</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>✅ {supportsScreenShare ? 'Screen/Window sharing' : 'Camera sharing'}</li>
                  <li>✅ WebRTC peer-to-peer streaming</li>
                  <li>✅ Real-time sync with room members</li>
                  <li>✅ Cross-platform compatibility</li>
                </ul>
              </div>
            </div>
          )}

          {/* Currently sharing */}
          {isSharing && (
            <div className="h-full flex flex-col space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="font-semibold text-green-800">
                    You are sharing your {fallbackMode === 'camera' ? 'camera' : 'screen'}
                  </span>
                </div>
                <div className="text-sm text-green-700">
                  {viewers.length} {viewers.length === 1 ? 'viewer' : 'viewers'}
                </div>
              </div>

              {/* Local preview */}
              <div className="flex-1 bg-gray-900 rounded-lg overflow-hidden relative">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white px-3 py-1 rounded-full text-sm">
                  Your Preview
                </div>
              </div>

              {/* Viewers list */}
              {viewers.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-700 mb-2">Viewers:</h4>
                  <div className="flex flex-wrap gap-2">
                    {viewers.map(viewer => (
                      <span key={viewer.id} className="px-3 py-1 bg-white rounded-full text-sm text-gray-700 border">
                        👤 {viewer.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stop button */}
              <button
                onClick={stopSharing}
                className="w-full py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop Sharing
              </button>
            </div>
          )}

          {/* Viewing someone else's share */}
          {isViewing && !isSharing && (
            <div className="h-full flex flex-col space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="font-semibold text-blue-800">
                  {presenterName} is sharing their screen
                </span>
              </div>

              {/* Remote video */}
              <div className="flex-1 bg-gray-900 rounded-lg overflow-hidden relative min-h-[400px]">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white px-3 py-1 rounded-full text-sm">
                  {presenterName}'s Screen
                </div>
                {connectionState !== 'connected' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="text-center text-white">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                      <p>Connecting...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with info */}
        <div className="border-t p-3 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Room: {roomCode}</span>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`}></span>
              WebRTC {connectionState}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
