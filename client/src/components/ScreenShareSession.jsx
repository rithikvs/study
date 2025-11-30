import { useEffect, useRef, useState } from 'react';
import socket from '../lib/socket';
import { useApp } from '../context/AppContext';

export default function ScreenShareSession({ roomCode, onClose, autoJoinPresenter, triggerAutoJoin }) {
  // 🚫 CRITICAL: Block mobile devices IMMEDIATELY before ANY state initialization
  const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  
  if (isMobileDevice) {
    // IMMEDIATE BLOCK - No state, no effects, no logic runs on mobile
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.98)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: '40px 32px',
          maxWidth: '420px',
          textAlign: 'center',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
          border: '3px solid #ef4444',
          animation: 'fadeIn 0.3s ease-in'
        }}>
          <div style={{ fontSize: '80px', marginBottom: '24px' }}>📱🚫</div>
          <h2 style={{
            color: 'white',
            fontSize: '28px',
            fontWeight: 'bold',
            marginBottom: '16px',
            lineHeight: '1.3'
          }}>
            Mobile Devices<br/>Not Supported
          </h2>
          <p style={{
            color: '#94a3b8',
            fontSize: '17px',
            marginBottom: '28px',
            lineHeight: '1.6'
          }}>
            Screen sharing is only available on laptop and desktop computers.
          </p>
          <div style={{
            background: '#1e40af',
            border: '2px solid #3b82f6',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '28px'
          }}>
            <p style={{
              color: '#93c5fd',
              fontSize: '15px',
              fontWeight: '600',
              margin: 0
            }}>
              💻 Please use your laptop or desktop browser
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '16px 24px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>
    );
  }
  
  // Desktop-only code from here
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
  
  // WebRTC configuration - base config (we'll override per-connection for mobile viewers)
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // OpenRelay TURN - Free public TURN server
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
      // Metered.ca TURN servers
      {
        urls: 'turn:a.relay.metered.ca:80',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
      {
        urls: 'turn:a.relay.metered.ca:80?transport=tcp',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
      {
        urls: 'turn:a.relay.metered.ca:443',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
      {
        urls: 'turns:a.relay.metered.ca:443?transport=tcp',
        username: 'e21d09ead091c0c763d3e78f',
        credential: 'h5xjAVDq3ac3JSl1',
      },
    ],
    iceCandidatePoolSize: 10,
    // Use all transports by default; we will force 'relay' explicitly where needed
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
  
  console.log('💻 Device: DESKTOP (Mobile blocked at component level)');

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
    console.log('🧹 Cleaning up screen share...');
    
    if (streamRef.current) {
      console.log('🛑 Stopping all tracks');
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('Track stopped:', track.kind);
      });
      streamRef.current = null;
    }

    // Close all peer connections
    console.log('🔌 Closing peer connections:', peerConnectionsRef.current.size);
    peerConnectionsRef.current.forEach((pc, userId) => {
      try {
        pc.close();
        console.log('Closed connection to:', userId);
      } catch (e) {
        console.error('Error closing peer connection:', e);
      }
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
      console.log('🖥️ Local video cleared');
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
      console.log('📺 Remote video cleared');
    }

    // Reset all state variables
    setIsSharing(false);
    setIsViewing(false);
    setViewers([]);
    setError(null);
    setConnectionStatus('disconnected');
    setIsCameraMode(false);
    setDebugLog([]);
    
    console.log('✅ Cleanup complete');
  }

  function handlePresenterStarted({ userId, userName }) {
    console.log('📺 Presenter started event received:', userName, 'userId:', userId, 'my userId:', authUser.id);
    
    // If there's a new presenter (different from current), clean up old connections
    if (presenter && presenter.userId !== userId) {
      console.log('🔄 New presenter detected, cleaning up old connections');
      setIsViewing(false);
      setConnectionStatus('disconnected');
      
      // Close old peer connections
      peerConnectionsRef.current.forEach(pc => {
        try {
          pc.close();
        } catch (e) {}
      });
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();
      
      // Clear remote video
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    }
    
    setPresenter({ userId, userName });
    
    // If we're starting to present, stop being a viewer
    if (userId === authUser.id) {
      console.log('🎥 I am now the presenter');
      setIsViewing(false);
      setConnectionStatus('disconnected');
    } else {
      console.log('👁️ I am a viewer');
    }
    
    setError(null); // Clear any previous errors
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
    try {
      console.log('🎬 Starting screen sharing...');
      setError(null);
      
      // CRITICAL: Clean up any existing streams/connections first
      if (streamRef.current) {
        console.log('🧹 Cleaning up existing stream before starting new share');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      // Close any existing peer connections
      if (peerConnectionsRef.current.size > 0) {
        console.log('🧹 Cleaning up existing peer connections');
        peerConnectionsRef.current.forEach(pc => {
          try {
            pc.close();
          } catch (e) {}
        });
        peerConnectionsRef.current.clear();
        pendingCandidatesRef.current.clear();
      }
      
      // Clear video elements
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      
      // Reset state
      setIsViewing(false);
      setConnectionStatus('disconnected');
      setViewers([]);
      
      let stream = null;
      
      console.log('🖥️ Desktop screen sharing initiated');
      
      // Check if screen sharing is available
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setError('🖥️ Screen sharing not available.\n\nPlease use a modern browser:\n• Chrome\n• Firefox\n• Edge\n• Safari');
        return;
      }

      console.log('🖥️ Attempting screen share...');
      
      // Desktop screen sharing constraints
      const constraints = {
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
        setError('🖥️ Screen sharing not supported in this browser.\n\nPlease use:\n• Chrome (recommended)\n• Firefox\n• Edge\n• Safari on macOS');
        return;
      }
      
      // Generic error
      setError('🖥️ Screen Sharing Failed\n\nPlease:\n• Use Chrome, Firefox, or Edge browser\n• Make sure you selected a screen or window to share\n• Try refreshing the page and trying again\n\nError: ' + (err.message || 'Unknown error'));
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
      console.log('� [joinViewing] Detected device:', {
        isMobileDevice,
        userAgent: navigator.userAgent,
      });
      socket.emit('screenshare:request-view', {
        roomCode,
        userId: authUser.id,
        userName: authUser.name,
      });
      addDebugLog('✅ Request-view emitted');
      addDebugLog('⏳ Waiting for offer from presenter...');

      // Set connection timeout (30 seconds)
      const connectionTimeout = setTimeout(() => {
        if (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') {
          console.log('⏰ Connection timeout after 30 seconds');
          addDebugLog('❌ Connection timeout');
          setError('⏱️ Connection Timeout\n\nUnable to connect to presenter.\n\nTry:\n1. Ask presenter to restart sharing\n2. Check your firewall settings\n3. Refresh the page');
          setConnectionStatus('disconnected');
          setIsViewing(false);
        }
      }, 30000); // 30 second timeout for mobile compatibility
      
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
      console.log('Creating peer connection with config:', {
        iceServers: rtcConfig.iceServers.length,
        iceTransportPolicy: rtcConfig.iceTransportPolicy
      });
      
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(fromUserId, peerConnection);
      addDebugLog('✅ Peer connection created with ' + rtcConfig.iceServers.length + ' ICE servers');

      // Set up ALL event handlers FIRST
      addDebugLog('🔧 Setting up event handlers...');

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
              setError('📺 Use your laptop/desktop to view or share screen');
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
              setError('try on laptop/desktop to view screen');
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
          setError('⏳ Try in your laptop/sesktop for screen sharing and viewing...');
          
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

      // Monitor ICE connection state - SIMPLIFIED
      peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        addDebugLog('📊 ICE: ' + iceState);
        console.log('ICE state:', iceState);
        
        if (iceState === 'connected' || iceState === 'completed') {
          addDebugLog('✅ ICE Connected!');
          setConnectionStatus('connected');
          setError(null);
        } else if (iceState === 'failed') {
          addDebugLog('❌ ICE Failed');
          setConnectionStatus('disconnected');
          setIsViewing(false);
          setError('Connection failed.\n\nTry:\n1. Refresh page\n2. Ask presenter to restart\n3. Check internet connection');
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
      
      // Process pending ICE candidates now that remote description is set
      const pending = pendingCandidatesRef.current.get(fromUserId) || [];
      if (pending.length > 0) {
        addDebugLog('🧊 Adding ' + pending.length + ' queued candidates');
        for (const c of pending) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
          } catch (err) {
            console.warn('ICE candidate add failed', err);
          }
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
  // Viewer will send a fresh offer; presenter responds with a new answer
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

      // Replace existing remote description with the new offer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      // Create and set a new answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send the new answer back to the viewer
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

  // Handle incoming ICE candidates from remote peer
  async function handleIceCandidate({ candidate, fromUserId, toUserId }) {
    // Only handle candidates meant for us
    if (toUserId !== authUser.id) return;
    
    const peerConnection = peerConnectionsRef.current.get(fromUserId);
    if (!peerConnection) {
      console.warn('⚠️ No peer connection found for ICE candidate from:', fromUserId);
      return;
    }
    
    try {
      // If remote description is not set yet, queue the candidate
      if (!peerConnection.remoteDescription || peerConnection.remoteDescription.type === '') {
        console.log('⏳ Queuing ICE candidate (waiting for remote description)');
        const pending = pendingCandidatesRef.current.get(fromUserId) || [];
        pending.push(candidate);
        pendingCandidatesRef.current.set(fromUserId, pending);
        return;
      }
      
      // Add the ICE candidate
      const iceCandidate = new RTCIceCandidate(candidate);
      const type = iceCandidate.type || 'unknown';
      const protocol = iceCandidate.protocol || '';
      
      console.log('🧊 Adding ICE candidate:', type, 'type |', 'candidate:', iceCandidate.candidate?.substring(0, 80));
      await peerConnection.addIceCandidate(iceCandidate);
      console.log('✅ ICE candidate added successfully');
      
    } catch (err) {
      console.error('❌ Error adding ICE candidate:', err);
    }
  }

  // Presenter: Handle view requests and create offers for viewers
  useEffect(() => {
    async function handleViewRequest({ userId, userName }) {
      if (!isSharing || !streamRef.current) return;
      if (userId === authUser.id) return; // Don't create connection to ourselves

      console.log('👁️ Viewer requesting to join:', userName);

      try {
        console.log('🔧 Creating peer connection for', userName, ':', {
          iceTransportPolicy: rtcConfig.iceTransportPolicy,
          iceServers: rtcConfig.iceServers.length + ' servers',
        });
        
        const peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnectionsRef.current.set(userId, peerConnection);
        
        console.log('✅ Peer connection created for', userName);

        // CRITICAL: Verify stream is active before adding tracks
        if (!streamRef.current || !streamRef.current.active) {
          console.error('❌ Stream is not active! Cannot add tracks.');
          throw new Error('Stream is not active');
        }
        
        const tracks = streamRef.current.getTracks();
        console.log('📤 Adding tracks to peer connection:', tracks.map(t => t.kind));
        console.log('📊 Stream stats:', {
          id: streamRef.current.id,
          active: streamRef.current.active,
          tracks: tracks.length
        });
        
        if (tracks.length === 0) {
          console.error('❌ No tracks available in stream!');
          throw new Error('No tracks in stream');
        }
        
        tracks.forEach(track => {
          // Verify track is live
          if (track.readyState !== 'live') {
            console.error('❌ Track is not live:', track.readyState);
          }
          
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
          track.onunmute = () => {
            console.log('✅ Presenter track unmuted for viewer:', userName);
          };
          
          const sender = peerConnection.addTrack(track, streamRef.current);
          console.log('✅ Track successfully added, sender:', sender.track?.kind, sender.track?.readyState);
          
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
        let candidateCount = 0;
        let relayCount = 0;
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            candidateCount++;
            const type = event.candidate.type || 'unknown';
            const protocol = event.candidate.protocol || '';
            
            if (type === 'relay') {
              relayCount++;
              console.log('✅✅ RELAY candidate #' + relayCount + ' for', userName, '('+protocol+')');
            }
            
            console.log('🧊 ICE #' + candidateCount + ' to', userName, ':', type, '('+protocol+')', event.candidate.candidate?.substring(0, 60));
            
            socket.emit('screenshare:ice-candidate', {
              roomCode,
              candidate: event.candidate,
              fromUserId: authUser.id,
              toUserId: userId,
            });
          } else {
            console.log('✅ ICE gathering complete for', userName, '- Total:', candidateCount, 'Relay:', relayCount);
          }
        };

        // Monitor connection state - SIMPLIFIED
        peerConnection.onconnectionstatechange = () => {
          console.log('Presenter → ', userName, ':', peerConnection.connectionState);
          if (peerConnection.connectionState === 'connected') {
            console.log('✅ Connected to:', userName);
          } else if (peerConnection.connectionState === 'failed') {
            console.log('❌ Connection failed with:', userName);
          }
        };

        // Monitor ICE connection for presenter
        peerConnection.oniceconnectionstatechange = () => {
          const state = peerConnection.iceConnectionState;
          console.log('Presenter ICE state with', userName, ':', state);
          
          if (state === 'connected' || state === 'completed') {
            console.log('✅✅ ICE CONNECTED to viewer:', userName);
          } else if (state === 'failed') {
            console.error('❌ ICE FAILED with viewer:', userName);
          } else if (state === 'disconnected') {
            console.warn('⚠️ ICE DISCONNECTED from viewer:', userName);
          }
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

      {/* Mobile Connection Status Banner */}
      {isMobileDevice && connectionStatus === 'connecting' && (
        <div className="bg-yellow-600 text-white px-4 py-3 text-center font-semibold border-b-4 border-yellow-700">
          <div className="text-xl mb-1">🔄 Connecting to Desktop...</div>
          <div className="text-sm opacity-90">Using TURN relay servers for mobile connection</div>
        </div>
      )}
      
      {isMobileDevice && connectionStatus === 'connected' && isViewing && (
        <div className="bg-green-600 text-white px-4 py-2 text-center font-semibold border-b-4 border-green-700">
          <div className="text-lg">✅ Connected! Viewing {presenter?.userName}'s screen</div>
        </div>
      )}

      {/* Video Display Area */}
      <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center p-4 md:p-8">
        {error && (
          <div className="text-center max-w-lg px-4">
            <div className="text-red-400 text-6xl mb-4">⚠️</div>
            <h3 className="text-red-400 text-xl mb-3">Mobile device is not supported </h3>
            <div className="text-gray-300 text-left bg-slate-800 rounded-lg p-4 mb-4 whitespace-pre-line">
              {error}
            </div>
           
          </div>
        )}

        {!isSharing && !presenter && !error && (
          <div className="text-white text-center max-w-lg px-4">
            <div className="text-6xl mb-4">📺</div>
            <h3 className="text-2xl mb-2">No active screen share</h3>
            <p className="text-gray-400 mb-4">Click "Start Sharing" to share with the room</p>
            <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4 mt-4">
              <p className="text-sm text-yellow-300 font-semibold">
                💻 Screen sharing works only on laptop/desktop browsers
              </p>
              <p className="text-xs text-gray-400 mt-2">
                📱 Mobile devices are not supported
              </p>
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
                onLoadedMetadata={() => {
                  console.log('📺 Local video metadata loaded');
                  if (localVideoRef.current) {
                    localVideoRef.current.play().catch(e => console.error('Local video play error:', e));
                  }
                }}
                onPlay={() => console.log('▶️ Local video playing')}
                onError={(e) => console.error('❌ Local video error:', e)}
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
          isMobileDevice ? (
            <div className="text-center max-w-lg px-4">
              <div style={{ fontSize: '80px', marginBottom: '24px' }}>📱🚫</div>
              <h2 style={{
                color: 'white',
                fontSize: '28px',
                fontWeight: 'bold',
                marginBottom: '16px',
                lineHeight: '1.3'
              }}>
                Mobile Not Supported
              </h2>
              <p style={{
                color: '#94a3b8',
                fontSize: '17px',
                marginBottom: '28px',
                lineHeight: '1.6'
              }}>
                Screen viewing is only available on laptop and desktop computers.
              </p>
              <div style={{
                background: '#1e40af',
                border: '2px solid #3b82f6',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '28px'
              }}>
                <p style={{
                  color: '#93c5fd',
                  fontSize: '15px',
                  fontWeight: '600',
                  margin: 0
                }}>
                  💻 Please use your laptop or desktop browser
                </p>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '16px 24px',
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                }}
              >
                ✕ Close
              </button>
            </div>
          ) : (
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
                  webkit-playsinline="true"
                  x5-playsinline="true"
                  x5-video-player-type="h5"
                  x5-video-player-fullscreen="true"
                  className="w-full rounded-lg shadow-2xl bg-black min-h-[200px] md:min-h-[400px]"
                  style={{ maxHeight: '70vh', objectFit: 'contain' }}
                  onLoadedMetadata={() => {
                    console.log('📺 Remote video metadata loaded');
                    if (remoteVideoRef.current) {
                      remoteVideoRef.current.play().catch(e => console.error('Remote video play error:', e));
                    }
                  }}
                  onPlay={() => console.log('▶️ Remote video playing')}
                  onError={(e) => console.error('❌ Remote video error:', e)}
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
          )
        )}

        {presenter && !isSharing && !isViewing && !error && !isMobileDevice && (
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

        {connectionStatus === 'connecting' && isViewing && !error && !isMobileDevice && (
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
