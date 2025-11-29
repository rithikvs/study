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
  const [debugLog, setDebugLog] = useState([]);
  
  // Debug logger
  const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log('🔍', logEntry);
    setDebugLog(prev => [...prev.slice(-20), logEntry]); // Keep last 20 logs
  };
  
  // Drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#FF0000');
  const [penSize, setPenSize] = useState(3);
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map of userId -> RTCPeerConnection
  const pendingCandidatesRef = useRef(new Map()); // Queue for ICE candidates
  const canvasRef = useRef(null);
  const drawingContextRef = useRef(null);

  // Detect if mobile for forced TURN usage
  const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // WebRTC configuration - Use proven public TURN servers
  const rtcConfig = {
    iceServers: [
      // STUN servers for discovering public IP
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // OpenRelay - Free public TURN servers (most reliable)
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      // Backup TURN servers
      {
        urls: 'turn:a.relay.metered.ca:80',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
      {
        urls: 'turn:a.relay.metered.ca:443',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
    ],
    iceCandidatePoolSize: 10,
    // Force relay for mobile to ensure connection through TURN
    iceTransportPolicy: isMobileDevice ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
  
  console.log('📱 Device type:', isMobileDevice ? 'MOBILE' : 'DESKTOP');

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
    socket.on('screenshare:ice-restart', handleIceRestartOffer);
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
      socket.off('screenshare:ice-restart', handleIceRestartOffer);
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
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  }

  function handleViewersUpdate({ viewers: viewersList }) {
    setViewers(viewersList.filter(v => v.userId !== authUser.id));
  }

  async function startSharing() {
    // Check device type
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    try {
      setError(null);
      
      let stream = null;
      
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
    if (!presenter) {
      addDebugLog('❌ No presenter found');
      return;
    }

    try {
      addDebugLog('🚀 Starting joinViewing for: ' + presenter.userName);
      addDebugLog('📡 Socket ID: ' + socket.id + ' | Connected: ' + socket.connected);
      addDebugLog('👤 My User ID: ' + authUser.id + ' | Presenter ID: ' + presenter.userId);
      addDebugLog('🏠 Room Code: ' + roomCode);
      
      // Ensure socket is connected
      if (!socket.connected) {
        addDebugLog('❌ Socket not connected! Reconnecting...');
        socket.connect();
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!socket.connected) {
          addDebugLog('❌ Failed to reconnect socket');
          setError('❌ Connection Error\n\nNot connected to server.\n\nPlease refresh the page and try again.');
          return;
        }
        addDebugLog('✅ Socket reconnected');
      }
      
      setError(null);
      setIsViewing(true);
      addDebugLog('🎬 Set isViewing = true');
      
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
      addDebugLog('🔄 Status: connecting');
      
      // Request to view - presenter will send us an offer
      addDebugLog('📤 Emitting screenshare:request-view');
      socket.emit('screenshare:request-view', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
        isMobile: isMobileDevice, // Tell presenter we're mobile so they use relay mode
      });
      addDebugLog('✅ Request-view emitted (device: ' + (isMobileDevice ? 'MOBILE' : 'DESKTOP') + ')');
      addDebugLog('⏳ Waiting for offer from presenter...');

      // Set a timeout for connection with retry option
      const connectionTimeout = setTimeout(() => {
        if (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') {
          console.log('⏰ Connection timeout after 20 seconds');
          setError('⏱️ Connection Timeout\n\nUnable to connect to presenter.\n\nPossible issues:\n• Mobile network blocking WebRTC\n• Presenter\'s firewall settings\n• Network connectivity problems\n\nTry:\n1. Ask presenter to restart sharing\n2. Switch between WiFi and mobile data\n3. Refresh the page\n4. Try on a different network');
          setConnectionStatus('disconnected');
          setIsViewing(false);
        }
      }, 20000); // 20 second timeout
      
      // Clean up timeout if component unmounts
      return () => clearTimeout(connectionTimeout);

    } catch (err) {
      console.error('Error joining viewing:', err);
      setError('❌ Failed to Connect\n\nUnable to join screen sharing.\n\nPlease try:\n• Click "View" again\n• Check your internet connection\n• Refresh the page');
      setConnectionStatus('disconnected');
      setIsViewing(false);
    }
  }

  async function handleOffer({ offer, fromUserId, toUserId }) {
    // Only handle offers meant for us
    if (toUserId !== authUser.id) {
      addDebugLog('⏭️ Offer not for me (for: ' + toUserId + ')');
      return;
    }
    
    addDebugLog('📥 RECEIVED OFFER from: ' + fromUserId);
    addDebugLog('📋 Offer type: ' + offer.type + ' | SDP length: ' + offer.sdp?.length);
    
    try {
      // Clean up any existing connection first
      const existingPc = peerConnectionsRef.current.get(fromUserId);
      if (existingPc) {
        addDebugLog('🧹 Cleaning up existing connection');
        existingPc.close();
        peerConnectionsRef.current.delete(fromUserId);
      }
      
      addDebugLog('🔨 Creating RTCPeerConnection...');
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(fromUserId, peerConnection);
      addDebugLog('✅ Peer connection created');

      // Set up ALL event handlers FIRST
      addDebugLog('🔧 Setting up handlers...');

      // Handle incoming stream
      peerConnection.ontrack = (event) => {
        addDebugLog('📺 TRACK RECEIVED: ' + event.track.kind);
        console.log('📺 Full track event:', {
          trackKind: event.track.kind,
          trackId: event.track.id,
          trackEnabled: event.track.enabled,
          trackReadyState: event.track.readyState,
          streamCount: event.streams.length,
          streamId: event.streams[0]?.id
        });
        
        if (remoteVideoRef.current && event.streams[0]) {
          addDebugLog('🎬 Attaching stream to video element');
          const stream = event.streams[0];
          remoteVideoRef.current.srcObject = stream;
          
          // Set video properties for mobile
          remoteVideoRef.current.playsInline = true;
          remoteVideoRef.current.muted = false;
          remoteVideoRef.current.controls = false;
          
          addDebugLog('✅ Stream attached! Tracks: ' + stream.getTracks().length);
          setConnectionStatus('connected');
          setError(null);
          
          // Monitor track state changes
          stream.getTracks().forEach(track => {
            addDebugLog('📹 Track state: ' + track.readyState);
            track.onended = () => {
              addDebugLog('⚠️ Track ENDED');
              setError('📺 Stream ended by presenter');
            };
            track.onmute = () => {
              addDebugLog('⚠️ Track MUTED');
            };
            track.onunmute = () => {
              addDebugLog('✅ Track UNMUTED');
            };
          });
          
          // Monitor stream state
          stream.onremovetrack = () => {
            addDebugLog('⚠️ Track removed from stream');
          };
          
          stream.onaddtrack = () => {
            addDebugLog('✅ Track added to stream');
          };
          
          // Try to play video immediately
          const tryPlay = async () => {
            try {
              addDebugLog('▶️ Attempting video playback...');
              await remoteVideoRef.current.play();
              addDebugLog('✅ Video playing successfully!');
            } catch (playErr) {
              addDebugLog('⚠️ Autoplay blocked: ' + playErr.name);
              console.warn('Video play failed:', playErr);
              // Show tap-to-play message
              if (isMobileDevice) {
                setError('👆 Tap the video to start playback');
              }
            }
          };
          
          // Wait for video to have enough data
          remoteVideoRef.current.onloadedmetadata = () => {
            addDebugLog('📊 Video metadata loaded');
            tryPlay();
          };
          
          // Also try immediately
          setTimeout(tryPlay, 100);
        } else {
          addDebugLog('❌ No video element or stream!');
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          const type = event.candidate.type || 'unknown';
          const protocol = event.candidate.protocol || '';
          addDebugLog('🧊 Sending ICE: ' + type + ' (' + protocol + ')');
          console.log('📤 Mobile ICE candidate:', type, protocol, event.candidate.candidate?.substring(0, 60));
          socket.emit('screenshare:ice-candidate', {
            roomCode,
            candidate: event.candidate,
            fromUserId: authUser.id,
            toUserId: fromUserId,
          });
        } else {
          addDebugLog('✅ ICE gathering complete');
        }
      };

      // Monitor connection state
      let hasRetried = false; // Prevent multiple retries
      peerConnection.onconnectionstatechange = async () => {
        const state = peerConnection.connectionState;
        addDebugLog('🔌 Connection: ' + state);
        console.log('🔌 Full connection state:', state, {
          iceConnectionState: peerConnection.iceConnectionState,
          iceGatheringState: peerConnection.iceGatheringState,
          signalingState: peerConnection.signalingState
        });
        
        if (state === 'connected') {
          addDebugLog('✅ CONNECTED successfully!');
          setConnectionStatus('connected');
          setError(null);
        } else if (state === 'connecting') {
          addDebugLog('🔄 Connecting...');
        } else if (state === 'disconnected') {
          addDebugLog('⚠️ DISCONNECTED - waiting for reconnection');
          setConnectionStatus('reconnecting');
          setError('⚠️ Connection lost, reconnecting...');
        } else if (state === 'failed' && !hasRetried) {
          hasRetried = true;
          addDebugLog('❌ Connection FAILED - retrying with TURN relay...');
          setConnectionStatus('reconnecting');
          setError('⏳ Connection failed, retrying with relay server...');
          
          // Wait a moment before retry
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Close and cleanup failed connection
          try {
            peerConnection.close();
          } catch (e) { console.warn('PeerConnection close failed', e); }
          peerConnectionsRef.current.delete(fromUserId);
          
          // Notify user we're retrying
          addDebugLog('🔄 Creating relay connection (forced TURN)...');
          
          // Request viewer to reconnect - this will trigger a new offer from presenter
          // which we'll handle with relay mode
          socket.emit('screenshare:retry-with-relay', {
            roomCode,
            userId: authUser.id,
            userName: authUser.name || authUser.username || 'Anonymous',
          });
          
          addDebugLog('📤 Retry request sent to presenter');
        }
      };

      // Monitor ICE connection state
      peerConnection.oniceconnectionstatechange = () => {
        addDebugLog('📊 ICE State: ' + peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
          console.log('✅ ICE connection established');
          setConnectionStatus('connected');
          setError(null);
        } else if (peerConnection.iceConnectionState === 'checking') {
          console.log('🔍 Checking ICE connectivity...');
          setConnectionStatus('connecting');
        } else if (peerConnection.iceConnectionState === 'disconnected') {
          console.log('⚠️ ICE connection disconnected, waiting for reconnection...');
          setConnectionStatus('reconnecting');
        } else if (peerConnection.iceConnectionState === 'failed') {
          addDebugLog('❌ ICE connection failed, attempting restart...');
          // Try to restart ICE (async function)
          (async () => {
            try {
              const offer = await peerConnection.createOffer({ iceRestart: true });
              await peerConnection.setLocalDescription(offer);
              socket.emit('screenshare:ice-restart', {
                roomCode,
                offer,
                fromUserId: authUser.id,
                toUserId: fromUserId,
              });
              addDebugLog('🔄 ICE restart offer sent');
              setConnectionStatus('reconnecting');
            } catch (restartErr) {
              addDebugLog('❌ ICE restart failed: ' + restartErr.message);
              setError('🔴 Network Connection Failed\n\nUnable to establish connection.\n\nThis might be due to:\n• Firewall blocking connection\n• Network restrictions\n• Internet connection issues\n\nTry:\n• Check your internet connection\n• Try a different network (switch WiFi/mobile data)\n• Ask presenter to restart sharing\n• Refresh the page and try again');
              setConnectionStatus('disconnected');
              setIsViewing(false);
            }
          })();
        }
      };

      // Monitor ICE gathering state
      peerConnection.onicegatheringstatechange = () => {
        console.log('📊 ICE gathering state:', peerConnection.iceGatheringState);
        if (peerConnection.iceGatheringState === 'complete') {
          console.log('✅ ICE gathering completed');
        }
      };
      
      // Monitor signaling state
      peerConnection.onsignalingstatechange = () => {
        console.log('📊 Signaling state:', peerConnection.signalingState);
      };

      // Step 1: Set remote description
      addDebugLog('📝 Setting remote desc...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      addDebugLog('✅ Remote desc set');
      
      // Process pending ICE candidates
      const pending = pendingCandidatesRef.current.get(fromUserId) || [];
      if (pending.length > 0) {
        addDebugLog('🧊 Adding ' + pending.length + ' queued candidates');
        for (const c of pending) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
          } catch (err) { console.warn('ICE candidate add failed', err); }
        }
        pendingCandidatesRef.current.delete(fromUserId);
      }
      
      // Step 2: Create answer
      addDebugLog('📝 Creating answer...');
      const answer = await peerConnection.createAnswer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
      });
      addDebugLog('✅ Answer created');
      
      // Step 3: Set local description
      addDebugLog('📝 Setting local desc...');
      await peerConnection.setLocalDescription(answer);
      addDebugLog('✅ Local desc set');
      
      // Step 4: Send answer
      addDebugLog('📤 Sending answer...');
      socket.emit('screenshare:answer', {
        roomCode,
        answer,
        fromUserId: authUser.id,
        toUserId: fromUserId,
      });
      addDebugLog('✅ Answer sent! Waiting for connection...');

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
    console.log('📋 Answer SDP type:', answer.type, 'SDP length:', answer.sdp?.length);
    
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) {
      console.error('❌ No peer connection found for viewer:', fromUserId);
      return;
    }
    
    try {
      // Check signaling state before setting remote description
      console.log('📊 Current signaling state:', peerConnection.signalingState);
      
      if (peerConnection.signalingState === 'stable') {
        console.warn('⚠️ Connection already in stable state, skipping answer');
        return;
      }
      
      console.log('📝 Setting remote description (answer)...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('✅ Answer set successfully for viewer:', fromUserId);
      console.log('📊 New signaling state:', peerConnection.signalingState);
    } catch (err) {
      console.error('❌ Error handling answer from', fromUserId, ':', err.message, err);
    }
  }

  // Presenter: Handle ICE restart offer from viewer
  async function handleIceRestartOffer({ offer, fromUserId, toUserId }) {
    if (toUserId !== authUser.id) return;
    if (!isSharing || !streamRef.current) return;
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) {
      console.warn('⚠️ No peer connection found for ICE restart from:', fromUserId);
      return;
    }
    try {
      console.log('🔄 Presenter handling ICE restart offer from viewer:', fromUserId);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('screenshare:answer', {
        roomCode,
        answer,
        fromUserId: authUser.id,
        toUserId: fromUserId,
      });
      console.log('✅ Presenter sent ICE restart answer to viewer:', fromUserId);
    } catch (err) {
      console.error('❌ Presenter failed to process ICE restart offer:', err);
    }
  }

  async function handleIceCandidate({ candidate, fromUserId, toUserId }) {
    // Only handle candidates meant for us
    if (toUserId !== authUser.id) return;
    
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) {
      console.warn('⚠️ No peer connection found for ICE candidate from:', fromUserId);
      return;
    }
    
    try {
      // Check if remote description is set
      if (!peerConnection.remoteDescription || peerConnection.signalingState !== 'stable') {
        console.log('⏳ Queuing ICE candidate (waiting for stable state):', candidate.type || 'unknown');
        // Store candidate in queue
        if (!pendingCandidatesRef.current.has(fromUserId)) {
          pendingCandidatesRef.current.set(fromUserId, []);
        }
        pendingCandidatesRef.current.get(fromUserId).push(candidate);
        return;
      }
      
      console.log('🧊 Adding ICE candidate:', candidate.type || 'unknown type', '| candidate:', candidate.candidate?.substring(0, 50));
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('✅ ICE candidate added successfully');
    } catch (err) {
      console.error('❌ Error adding ICE candidate:', err.message);
      // Don't fail the connection for individual candidate errors
    }
  }

  // Presenter: Handle view requests and create offers for viewers
  useEffect(() => {
    async function handleViewRequest({ userId, userName, isMobile }) {
      if (!isSharing || !streamRef.current) return;
      if (userId === authUser.id) return; // Don't create connection to ourselves

      console.log('👁️ Viewer requesting to join:', userName, '(Device:', isMobile ? 'MOBILE' : 'DESKTOP', ')');

      try {
        // Use relay mode for mobile viewers from the start
        const config = isMobile ? {
          ...rtcConfig,
          iceTransportPolicy: 'relay'
        } : rtcConfig;
        
        if (isMobile) {
          console.log('📱 Using RELAY mode for mobile viewer:', userName);
        }
        
        const peerConnection = new RTCPeerConnection(config);
        peerConnectionsRef.current.set(userId, peerConnection);

        // Add our stream tracks
        const tracks = streamRef.current.getTracks();
        console.log('📤 Adding tracks to peer connection:', tracks.map(t => t.kind));
        console.log('📊 Stream stats:', {
          id: streamRef.current.id,
          active: streamRef.current.active,
          tracks: tracks.length
        });
        
        tracks.forEach(track => {
          console.log('Adding track:', {
            kind: track.kind,
            enabled: track.enabled,
            readyState: track.readyState,
            muted: track.muted,
            id: track.id
          });
          
          // Monitor track state
          track.onended = () => {
            console.log('⚠️ Presenter track ended for viewer:', userName);
          };
          track.onmute = () => {
            console.log('⚠️ Presenter track muted for viewer:', userName);
          };
          
          const sender = peerConnection.addTrack(track, streamRef.current);
          console.log('Track added, sender:', sender);
          
          // Verify track is being sent
          setTimeout(() => {
            sender.getStats().then(stats => {
              stats.forEach(report => {
                if (report.type === 'outbound-rtp') {
                  console.log('📊 Sending stats to', userName, ':', {
                    bytesSent: report.bytesSent,
                    packetsSent: report.packetsSent
                  });
                }
              });
            });
          }, 3000);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            const type = event.candidate.type || 'unknown';
            const protocol = event.candidate.protocol || '';
            console.log('🧊 Presenter sending ICE to', userName, ':', type, '('+protocol+')', event.candidate.candidate?.substring(0, 60));
            socket.emit('screenshare:ice-candidate', {
              roomCode,
              candidate: event.candidate,
              fromUserId: authUser.id,
              toUserId: userId,
            });
          } else {
            console.log('✅ All ICE candidates sent to', userName);
          }
        };

        // Monitor connection state
        peerConnection.onconnectionstatechange = async () => {
          console.log('Presenter connection state with', userName, ':', peerConnection.connectionState);
          if (peerConnection.connectionState === 'connected') {
            console.log('✅ Successfully connected to viewer:', userName);
          } else if (peerConnection.connectionState === 'failed') {
            console.error('❌ Connection failed with viewer:', userName);
            console.log('🔄 Retrying with forced TURN relay for viewer:', userName);
            
            // Retry with forced relay
            try {
              // Close failed connection
              peerConnection.close();
              peerConnectionsRef.current.delete(userId);
              
              // Create new connection with forced relay
              const relayConfig = {
                ...rtcConfig,
                iceTransportPolicy: 'relay'
              };
              console.log('📋 Presenter using relay mode (forced TURN) for:', userName);
              
              const newPc = new RTCPeerConnection(relayConfig);
              peerConnectionsRef.current.set(userId, newPc);
              
              // Add tracks
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => {
                  newPc.addTrack(track, streamRef.current);
                });
              }
              
              // Set up handlers
              newPc.onicecandidate = (event) => {
                if (event.candidate) {
                  console.log('🧊 Presenter sending RELAY ICE candidate to:', userName);
                  socket.emit('screenshare:ice-candidate', {
                    roomCode,
                    candidate: event.candidate,
                    fromUserId: authUser.id,
                    toUserId: userId,
                  });
                }
              };
              
              newPc.onconnectionstatechange = () => {
                console.log('Presenter RELAY connection state with', userName, ':', newPc.connectionState);
                if (newPc.connectionState === 'connected') {
                  console.log('✅ RELAY connection successful with viewer:', userName);
                } else if (newPc.connectionState === 'failed') {
                  console.error('❌ RELAY connection also failed with viewer:', userName);
                }
              };
              
              newPc.oniceconnectionstatechange = () => {
                console.log('Presenter RELAY ICE state with', userName, ':', newPc.iceConnectionState);
              };
              
              // Create and send new offer
              const offer = await newPc.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: true,
              });
              await newPc.setLocalDescription(offer);
              
              console.log('📤 Sending RELAY offer to viewer:', userName);
              socket.emit('screenshare:offer', {
                roomCode,
                offer,
                fromUserId: authUser.id,
                toUserId: userId,
              });
              
            } catch (retryErr) {
              console.error('❌ Presenter retry failed for viewer:', userName, retryErr);
            }
          }
        };

        // Monitor ICE connection for presenter
        peerConnection.oniceconnectionstatechange = () => {
          console.log('Presenter ICE state with', userName, ':', peerConnection.iceConnectionState);
        };

        // Create and send offer with explicit constraints
        console.log('📝 Creating offer for viewer:', userName);
        const offerOptions = {
          offerToReceiveAudio: false,
          offerToReceiveVideo: true,
        };
        const offer = await peerConnection.createOffer(offerOptions);
        console.log('✅ Offer created:', offer.type, 'SDP length:', offer.sdp?.length);
        
        console.log('📝 Setting local description...');
        await peerConnection.setLocalDescription(offer);
        console.log('✅ Local description set');
        
        console.log('📤 Sending offer to viewer:', userName);
        socket.emit('screenshare:offer', {
          roomCode,
          offer,
          fromUserId: authUser.id,
          toUserId: userId,
        });
        console.log('✅ Offer sent to viewer:', userName);

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
            <div className="bg-slate-800 p-2 rounded mb-2 text-sm text-gray-300 flex items-center justify-between">
              <div>
                📱 Connection Status: <span className={connectionStatus === 'connected' ? 'text-green-400 font-bold' : connectionStatus === 'connecting' ? 'text-yellow-400 animate-pulse' : connectionStatus === 'reconnecting' ? 'text-orange-400' : 'text-red-400'}>{connectionStatus}</span>
                {connectionStatus === 'connecting' && <span className="ml-2 text-xs text-gray-400">• Establishing connection...</span>}
                {connectionStatus === 'reconnecting' && <span className="ml-2 text-xs text-gray-400">• Reconnecting...</span>}
              </div>
              {connectionStatus === 'connected' && (
                <button
                  onClick={() => {
                    if (remoteVideoRef.current) {
                      remoteVideoRef.current.play().catch(e => console.error('Play error:', e));
                    }
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                >
                  ▶️ Play
                </button>
              )}
            </div>
            <div className="relative">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                webkit-playsinline="true"
                x5-playsinline="true"
                x5-video-player-type="h5"
                x5-video-player-fullscreen="true"
                className="w-full rounded-lg shadow-2xl bg-black min-h-[200px] md:min-h-[400px]"
                style={{ maxHeight: '70vh', objectFit: 'contain' }}
                onLoadedMetadata={() => console.log('📺 Video metadata loaded')}
                onPlay={() => console.log('▶️ Video playing')}
                onError={(e) => console.error('❌ Video error:', e)}
                onClick={() => {
                  // Allow tap to play on mobile
                  if (remoteVideoRef.current && remoteVideoRef.current.paused) {
                    remoteVideoRef.current.play().catch(e => console.error('Play error:', e));
                  }
                }}
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
            <button
              onClick={joinViewing}
              className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-700 font-medium transition text-lg"
            >
              👁️ Join Viewing
            </button>
          </div>
        )}

        {connectionStatus === 'connecting' && isViewing && !error && (
          <div className="text-white text-center max-w-md mx-auto px-4">
            <div className="text-6xl mb-4 animate-pulse">🔄</div>
            <h3 className="text-2xl mb-2">Connecting to {presenter?.userName}...</h3>
            <p className="text-gray-400 mb-4">Establishing WebRTC connection</p>
            <div className="flex flex-col gap-3 items-center">
              <div className="flex gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <p className="text-xs text-gray-500 mt-2">May take 10-20 seconds on mobile</p>
              {isMobileDevice && (
                <div className="text-xs text-yellow-400 bg-yellow-900/20 p-3 rounded mt-2">
                  📱 Mobile tip: Check the debug log below for progress
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Debug Panel - Show on mobile for troubleshooting */}
      {isMobileDevice && (
        <div className="bg-slate-900 border-t border-slate-700 p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-yellow-400">📋 Debug Log ({debugLog.length}):</span>
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  addDebugLog('🔄 Manual refresh triggered');
                  addDebugLog('Socket: ' + socket.connected);
                  addDebugLog('Presenter: ' + (presenter?.userName || 'none'));
                  addDebugLog('Viewing: ' + isViewing);
                  addDebugLog('Status: ' + connectionStatus);
                }}
                className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded"
              >
                Info
              </button>
              <button 
                onClick={() => setDebugLog([])} 
                className="text-xs text-gray-400 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
          {debugLog.length > 0 ? (
            <div className="text-xs font-mono text-gray-300 space-y-0.5 max-h-32 overflow-y-auto">
              {debugLog.slice(-15).map((log, i) => (
                <div key={i} className="text-[10px] leading-tight">{log}</div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-500 text-center py-2">
              No debug logs yet. Click "View" to start connection.
            </div>
          )}
        </div>
      )}

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
