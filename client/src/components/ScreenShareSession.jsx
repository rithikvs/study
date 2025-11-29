import { useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';
import { useApp } from '../context/AppContext';

export default function ScreenShareSession({ roomCode, onClose, autoJoinPresenter, triggerAutoJoin }) {
  const { authUser } = useApp();
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [presenter, setPresenter] = useState(autoJoinPresenter || null);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [currentFacingMode, setCurrentFacingMode] = useState('environment');
  
  // Drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#FF0000');
  const [penSize, setPenSize] = useState(3);
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map of userId -> RTCPeerConnection
  const canvasRef = useRef(null);
  const drawingContextRef = useRef(null);

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

  // Auto-join when banner button is clicked
  useEffect(() => {
    if (triggerAutoJoin > 0 && autoJoinPresenter) {
      console.log('🎯 Auto-joining presenter:', autoJoinPresenter.userName);
      // Set presenter first if not already set
      if (!presenter || presenter.userId !== autoJoinPresenter.userId) {
        setPresenter(autoJoinPresenter);
      }
      // Then join viewing
      setTimeout(() => {
        joinViewing();
      }, 300);
    }
  }, [triggerAutoJoin]);

  useEffect(() => {
    if (!roomCode || !authUser) return;

    console.log('🔌 Joining screenshare room:', roomCode, 'as', authUser.name);

    // Make sure we're in the main room first
    socket.emit('join', { roomCode });

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
    socket.on('screenshare:draw', handleRemoteDrawing);
    socket.on('screenshare:connection-error', ({ error }) => {
      console.error('❌ Connection error from presenter:', error);
      setError('❌ ' + error);
      setConnectionStatus('disconnected');
      setIsViewing(false);
    });

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
      socket.off('screenshare:draw', handleRemoteDrawing);
      socket.off('screenshare:connection-error');
    };
  }, [roomCode, authUser]);

  // Initialize canvas for drawing
  useEffect(() => {
    if (canvasRef.current && isSharing) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawingContextRef.current = ctx;
    }
  }, [isSharing]);

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
    console.log('📺 Presenter started event received:', userName, 'userId:', userId, 'my userId:', authUser.id);
    setPresenter({ userId, userName });
    setIsViewing(false); // Reset viewing state for everyone
    setError(null); // Clear any previous errors
    console.log(userId === authUser.id ? '🎥 I am the presenter' : '👁️ I am a viewer');
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
      
      let stream = null;
      
      // Check device type
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      
      console.log('📱 Device detected:', { isMobile, isAndroid, userAgent: navigator.userAgent });
      
      // Try screen sharing for all devices (desktop and mobile)
      if (!navigator.mediaDevices?.getDisplayMedia) {
        // getDisplayMedia not available at all
        const noSupportError = isMobile
          ? '📱 Screen Sharing API Not Found\n\n' +
            'Your browser doesn\'t have screen sharing support.\n\n' +
            '✅ Fix this:\n' +
            '1. Install/Open Chrome browser from Play Store\n' +
            '2. Update Chrome to latest version\n' +
            '3. Open this link directly in Chrome (not in-app browser)\n' +
            '4. Check Chrome version: chrome://version\n' +
            '   (Must be version 72 or higher)\n\n' +
            '💡 If you clicked a link from WhatsApp/Instagram/etc, copy the link and paste it in Chrome app instead.\n\n' +
            '❌ Note: iOS devices don\'t support screen sharing yet.'
          : '🖥️ Screen sharing not available.\n\nPlease use a modern browser:\n• Chrome\n• Firefox\n• Edge\n• Safari';
        setError(noSupportError);
        return;
      }

      console.log('🖥️ Attempting screen share...', { isMobile, isAndroid });
      
      // Use simpler constraints for mobile to increase compatibility
      const constraints = isMobile ? {
        video: true, // More permissive for mobile browsers
        audio: false,
      } : {
        video: {
          cursor: 'always',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };
      
      console.log('📋 Using constraints:', constraints);
      stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      console.log('✅ Screen sharing started successfully', stream);

      streamRef.current = stream;
      
      // Set local video preview
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('✅ Local video stream set:', stream.getTracks());
        console.log('Video track settings:', stream.getVideoTracks()[0]?.getSettings());
        
        // Force video to play immediately
        setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.play()
              .then(() => console.log('✅ Local video playing'))
              .catch(e => console.error('❌ Error playing local video:', e));
          }
        }, 100);
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
      console.error('❌ Error starting screen share:', err.name, err.message, err);
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('❌ Screen sharing permission denied.\n\nPlease click "Start Sharing" again and allow screen sharing when prompted.');
        return;
      }
      
      if (err.name === 'NotSupportedError' || err.name === 'NotFoundError') {
        const errorMsg = isMobile 
          ? '📱 Screen Sharing Not Available\n\n' +
            'Your mobile browser doesn\'t support screen sharing.\n\n' +
            '✅ Try these steps:\n' +
            '1. Open Chrome browser (not Chrome Custom Tab)\n' +
            '2. Type chrome://version in address bar\n' +
            '3. Check if version is 72 or higher\n' +
            '4. If lower, update Chrome from Play Store\n' +
            '5. Come back and try again\n\n' +
            '💡 Make sure you\'re using the actual Chrome app, not an in-app browser.\n\n' +
            '❌ iOS Safari doesn\'t support mobile screen sharing.'
          : '🖥️ Screen sharing not supported in this browser.\n\nPlease use:\n• Chrome (recommended)\n• Firefox\n• Edge\n• Safari on macOS';
        setError(errorMsg);
        return;
      }
      
      // Generic error
      const genericError = isMobile
        ? '📱 Unable to Start Screen Sharing\n\n' +
          '🔍 Troubleshooting:\n' +
          '1. Are you using Chrome browser? (Required)\n' +
          '2. Did you deny the permission? Try again and allow\n' +
          '3. Check Chrome version: Type chrome://version\n' +
          '4. Update Chrome if version is below 72\n' +
          '5. Restart Chrome and try again\n\n' +
          '📱 Samsung Users: Chrome works better than Samsung Internet\n\n' +
          '💡 Copy this URL and open directly in Chrome app if you\'re in an in-app browser.'
        : '🖥️ Screen Sharing Failed\n\nPlease:\n• Use Chrome, Firefox, or Edge browser\n• Make sure you selected a screen or window to share\n• Try refreshing the page and trying again\n\nError: ' + (err.message || 'Unknown error');
      setError(genericError);
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
    setIsCameraMode(false);
  }

  async function switchCamera() {
    if (!isCameraMode || !streamRef.current) return;

    try {
      // Stop current stream
      streamRef.current.getTracks().forEach(track => track.stop());

      // Switch facing mode
      const newFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      
      // Get new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: newFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      streamRef.current = newStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
      }

      setCurrentFacingMode(newFacingMode);

      // Update all peer connections with new track
      const videoTrack = newStream.getVideoTracks()[0];
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      console.log('📱 Camera switched to:', newFacingMode);
    } catch (err) {
      console.error('Error switching camera:', err);
      setError('Failed to switch camera');
    }
  }

  // Drawing functions
  function startDrawing(e) {
    if (!isSharing || !showDrawingTools) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left) * (canvas.width / rect.width);
    const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top) * (canvas.height / rect.height);
    
    const ctx = drawingContextRef.current;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penSize;
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    // Broadcast start of stroke
    socket.emit('screenshare:draw', {
      roomCode,
      fromUserId: authUser.id,
      x,
      y,
      color: penColor,
      size: penSize,
      type: 'start'
    });
  }

  function draw(e) {
    if (!isDrawing || !isSharing || !showDrawingTools) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX || e.touches?.[0]?.clientX) - rect.left) * (canvas.width / rect.width);
    const y = ((e.clientY || e.touches?.[0]?.clientY) - rect.top) * (canvas.height / rect.height);
    
    const ctx = drawingContextRef.current;
    ctx.lineTo(x, y);
    ctx.stroke();
    
    // Broadcast drawing to viewers
    socket.emit('screenshare:draw', {
      roomCode,
      fromUserId: authUser.id,
      x,
      y,
      color: penColor,
      size: penSize,
      type: 'draw'
    });
  }

  function stopDrawing() {
    if (!isSharing) return;
    setIsDrawing(false);
    const ctx = drawingContextRef.current;
    if (ctx) {
      ctx.beginPath();
    }
    
    // Notify end of stroke
    socket.emit('screenshare:draw', {
      roomCode,
      fromUserId: authUser.id,
      type: 'end'
    });
  }

  function clearCanvas() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = drawingContextRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Broadcast clear to viewers
    socket.emit('screenshare:draw', {
      roomCode,
      fromUserId: authUser.id,
      type: 'clear'
    });
  }

  function handleRemoteDrawing({ fromUserId, x, y, color, size, type }) {
    // Only viewers should draw what presenter sends
    if (fromUserId === authUser.id || !isViewing || presenter?.userId === authUser.id) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (type === 'start') {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else if (type === 'draw') {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (type === 'end') {
      ctx.beginPath();
    }
  }

  async function joinViewing() {
    if (!presenter) return;

    try {
      setError(null);
      setIsViewing(true);
      
      // Allow presenter to view their own screen (just show local stream)
      if (presenter.userId === authUser.id) {
        setConnectionStatus('Viewing your own screen');
        // Ensure local video is visible
        if (localVideoRef.current && streamRef.current) {
          localVideoRef.current.srcObject = streamRef.current;
          localVideoRef.current.play().catch(e => console.error('Play error:', e));
        }
        return;
      }
      
      setConnectionStatus('connecting');
      
      // Request to view - presenter will send us an offer
      socket.emit('screenshare:request-view', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });

      console.log('👁️ Requested to join viewing from', presenter.userName);

      // Set a timeout for connection
      setTimeout(() => {
        if (connectionStatus === 'connecting') {
          console.log('⏰ Connection timeout');
          setError('⏱️ Connection Timeout\n\nUnable to connect to presenter.\n\nTry these steps:\n• Click "View" button again\n• Ask presenter to stop and restart sharing\n• Check your internet connection\n• Refresh the page and try again');
          setConnectionStatus('disconnected');
          setIsViewing(false);
        }
      }, 15000); // 15 second timeout

    } catch (err) {
      console.error('Error joining viewing:', err);
      setError('❌ Failed to Connect\n\nUnable to join screen sharing.\n\nPlease try:\n• Click "View" again\n• Check your internet connection\n• Refresh the page');
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
        console.log('📺 Received remote track:', event.track.kind, event.streams);
        console.log('Track enabled:', event.track.enabled, 'muted:', event.track.muted, 'readyState:', event.track.readyState);
        
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setConnectionStatus('connected');
          console.log('✅ Video stream set to remote video element');
          console.log('Stream tracks:', event.streams[0].getTracks());
          console.log('Video element readyState:', remoteVideoRef.current.readyState);
          
          // Force video to play
          setTimeout(() => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.play()
                .then(() => {
                  console.log('✅ Remote video playing');
                  console.log('Video dimensions:', remoteVideoRef.current.videoWidth, 'x', remoteVideoRef.current.videoHeight);
                })
                .catch(e => console.error('❌ Error playing remote video:', e));
            }
          }, 100);
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
        console.log('Viewer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          setConnectionStatus('connected');
          setError(null); // Clear any errors
        } else if (peerConnection.connectionState === 'failed') {
          setConnectionStatus('disconnected');
          setIsViewing(false);
          setError('🔴 Connection Failed\n\nUnable to connect to presenter\'s screen.\n\nTry these steps:\n1. Click "View" button again\n2. Ask presenter to restart sharing\n3. Check your internet connection\n4. Try refreshing the page');
        } else if (peerConnection.connectionState === 'disconnected') {
          console.log('⚠️ Connection disconnected');
          setConnectionStatus('disconnected');
        }
      };

      // Add error handler
      peerConnection.onicecandidateerror = (event) => {
        console.error('ICE candidate error:', event);
      };

      // Monitor ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
          console.error('ICE connection failed');
          setError('🔴 Network Connection Failed\n\nUnable to establish connection.\n\nThis might be due to:\n• Firewall blocking connection\n• Network restrictions\n• Internet connection issues\n\nTry:\n• Check your internet connection\n• Try a different network\n• Contact your network administrator');
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
      console.error('❌ Error handling offer:', err);
      setError('❌ Connection Setup Failed\n\nUnable to establish connection with presenter.\n\nError: ' + err.message + '\n\nPlease:\n• Click "View" again\n• Ask presenter to restart sharing\n• Refresh the page and try again');
      setConnectionStatus('disconnected');
      setIsViewing(false);
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
        const tracks = streamRef.current.getTracks();
        console.log('📤 Adding tracks to peer connection:', tracks.map(t => t.kind));
        tracks.forEach(track => {
          console.log('Adding track:', track.kind, track.enabled, track.readyState);
          const sender = peerConnection.addTrack(track, streamRef.current);
          console.log('Track added, sender:', sender);
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
        console.error('❌ Error creating offer for viewer:', userName, err);
        // Notify the viewer that connection failed
        socket.emit('screenshare:connection-error', {
          roomCode,
          toUserId: userId,
          error: 'Presenter failed to create connection. Please try again.'
        });
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
            <>
              {isCameraMode && (
                <button
                  onClick={switchCamera}
                  className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 font-medium transition flex items-center gap-2"
                  title="Switch Camera"
                >
                  🔄 Switch
                </button>
              )}
              <button
                onClick={stopSharing}
                className="px-6 py-2 bg-red-600 rounded-lg hover:bg-red-700 font-medium transition"
              >
                ⏹️ Stop Sharing
              </button>
            </>
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
          <div className="text-center max-w-lg px-4">
            <div className="text-red-400 text-6xl mb-4">⚠️</div>
            <h3 className="text-red-400 text-xl mb-3">Unable to Start Sharing</h3>
            <div className="text-gray-300 text-left bg-slate-800 rounded-lg p-4 mb-4 whitespace-pre-line">
              {error}
            </div>
            <button
              onClick={() => setError(null)}
              className="px-6 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 font-medium"
            >
              Try Again
            </button>
          </div>
        )}

        {!isSharing && !presenter && !error && (
          <div className="text-white text-center max-w-lg px-4">
            <div className="text-6xl mb-4">📺</div>
            <h3 className="text-2xl mb-2">No active screen share</h3>
            <p className="text-gray-400 mb-4">Click "Start Sharing" to share with the room</p>
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4 mt-4">
              <p className="text-sm text-blue-300 mb-3 font-semibold">
                💻 <strong className="text-green-400">Laptop/Desktop ONLY:</strong> Can SHARE screen with drawing tools<br/>
                📱 <strong className="text-yellow-400">Mobile Devices:</strong> Can only VIEW shared screens (Cannot share)
              </p>
              <div className="bg-slate-800/50 rounded p-3 text-xs text-gray-300">
                <p className="font-semibold text-red-400 mb-2 text-sm">⚠️ IMPORTANT - Screen Sharing Limitation:</p>
                <p className="mb-3 text-yellow-200 font-semibold">
                  📱 Mobile phones and tablets can ONLY VIEW screens shared by laptop/desktop users.<br/>
                  💻 To SHARE your screen, you MUST use a laptop or desktop computer.
                </p>
                <div className="border-t border-gray-600 pt-2 mt-2">
                  <p className="font-semibold text-blue-300 mb-2">👁️ Mobile users can:</p>
                  <p className="mb-1">✅ Join the room and view shared screens</p>
                  <p className="mb-1">✅ See drawing annotations in real-time</p>
                  <p className="mb-3">✅ Watch presentations from laptop users</p>
                  
                  <p className="font-semibold text-green-300 mb-2">🖥️ Laptop/Desktop users can:</p>
                  <p className="mb-1">✅ Share their entire screen</p>
                  <p className="mb-1">✅ Use drawing tools to annotate</p>
                  <p className="mb-1">✅ Share with multiple viewers</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Owner's screen view - shown when sharing OR when owner is viewing their own share */}
        {((isSharing && !isViewing) || (presenter?.userId === authUser.id && isViewing)) && !error && (
          <div className="w-full max-w-6xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-xl">
                {isViewing 
                  ? (isCameraMode ? `📱 Viewing Your Camera (${currentFacingMode === 'user' ? 'Front' : 'Back'})` : '📺 Viewing Your Screen')
                  : (isCameraMode ? `📱 Camera (${currentFacingMode === 'user' ? 'Front' : 'Back'})` : '🖥️ Your Screen (Sharing)')}
              </h3>
              <div className="text-sm text-gray-400 flex items-center gap-4">
                {streamRef.current && (
                  <span>
                    Tracks: {streamRef.current.getTracks().length} | 
                    Video: {streamRef.current.getVideoTracks()[0]?.enabled ? '✅' : '❌'} | 
                    Viewers: {peerConnectionsRef.current.size}
                  </span>
                )}
                <button
                  onClick={() => setShowDrawingTools(!showDrawingTools)}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-white font-medium transition"
                >
                  ✏️ {showDrawingTools ? 'Hide' : 'Draw'}
                </button>
              </div>
            </div>
            
            {/* Drawing Tools */}
            {showDrawingTools && (
              <div className="mb-3 p-3 bg-slate-800 rounded-lg flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-white text-sm">Color:</label>
                  <input
                    type="color"
                    value={penColor}
                    onChange={(e) => setPenColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer"
                  />
                  <div className="flex gap-1">
                    {['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFFFFF', '#000000'].map(color => (
                      <button
                        key={color}
                        onClick={() => setPenColor(color)}
                        className={`w-8 h-8 rounded border-2 ${penColor === color ? 'border-white' : 'border-gray-600'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-white text-sm">Size:</label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={penSize}
                    onChange={(e) => setPenSize(Number(e.target.value))}
                    className="w-32"
                  />
                  <span className="text-white text-sm w-8">{penSize}px</span>
                </div>
                <button
                  onClick={clearCanvas}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white font-medium transition"
                >
                  🗑️ Clear
                </button>
              </div>
            )}
            
            <div className="relative">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                webkit-playsinline="true"
                className="w-full rounded-lg shadow-2xl bg-black min-h-[200px] md:min-h-[400px]"
                style={{ maxHeight: '70vh', objectFit: 'contain' }}
              />
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="absolute top-0 left-0 w-full h-full rounded-lg"
                style={{ cursor: showDrawingTools ? 'crosshair' : 'default', touchAction: 'none' }}
              />
            </div>
          </div>
        )}

        {isViewing && !isSharing && presenter?.userId !== authUser.id && !error && (
          <div className="w-full max-w-6xl">
            <h3 className="text-white text-xl mb-4">Viewing: {presenter?.userName}'s Screen</h3>
            <div className="relative">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                webkit-playsinline="true"
                className="w-full rounded-lg shadow-2xl bg-black min-h-[200px] md:min-h-[400px]"
                style={{ maxHeight: '70vh', objectFit: 'contain' }}
              />
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                className="absolute top-0 left-0 w-full h-full rounded-lg pointer-events-none"
              />
            </div>
          </div>
        )}

        {presenter && !isSharing && !isViewing && !error && (
          <div className="text-white text-center">
            <div className="text-6xl mb-4">👤</div>
            <h3 className="text-2xl mb-2">{presenter.userName} is sharing</h3>
            <p className="text-gray-400 mb-4">Use the banner at the top of the page to join and view</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800 text-white p-2 text-sm text-center">
        {isSharing && `📡 Sharing screen with ${viewers.length} viewer${viewers.length !== 1 ? 's' : ''} • ${streamRef.current ? `Stream: ${streamRef.current.getTracks().length} track(s)` : 'No stream'}`}
        {isViewing && !isSharing && `👁️ Viewing ${presenter?.userName}'s screen • Status: ${connectionStatus}`}
        {!isSharing && !presenter && '💡 Click "Start Sharing" to begin screen sharing session'}
        {presenter && !isSharing && !isViewing && `📺 ${presenter.userName} is presenting - Use the banner at the top to join`}
      </div>
    </div>
  );
}
