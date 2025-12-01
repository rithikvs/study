import { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import socket from '../lib/socket';

export default function Whiteboard({ roomCode, userName, onClose }) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(2);
  const [tool, setTool] = useState('pen'); // 'pen' or 'eraser'
  const [users, setUsers] = useState([]);
  const isRemoteDrawing = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Fabric canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      width: window.innerWidth > 768 ? 800 : window.innerWidth - 40,
      height: window.innerHeight > 768 ? 600 : window.innerHeight - 200,
      backgroundColor: '#ffffff',
    });

    fabricCanvasRef.current = canvas;

    // Configure brush
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = brushSize;

    // Join whiteboard room
    socket.emit('whiteboard:join', { roomCode, userName });

    // Handle path created (drawing completed)
    canvas.on('path:created', (e) => {
      if (isRemoteDrawing.current) return; // Don't broadcast remote drawings
      
      const path = e.path;
      const pathData = {
        path: path.path,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
        fill: path.fill,
        scaleX: path.scaleX,
        scaleY: path.scaleY,
        left: path.left,
        top: path.top,
      };

      // Broadcast drawing to all users in room
      socket.emit('whiteboard:draw', {
        roomCode,
        pathData,
        userName,
      });
    });

    // Listen for drawings from other users
    socket.on('whiteboard:draw', ({ pathData, userName: drawingUser }) => {
      if (drawingUser === userName) return; // Don't draw own paths again
      
      isRemoteDrawing.current = true;
      
      const path = new fabric.Path(pathData.path, {
        stroke: pathData.stroke,
        strokeWidth: pathData.strokeWidth,
        fill: pathData.fill || '',
        scaleX: pathData.scaleX || 1,
        scaleY: pathData.scaleY || 1,
        left: pathData.left || 0,
        top: pathData.top || 0,
      });
      
      canvas.add(path);
      canvas.renderAll();
      
      isRemoteDrawing.current = false;
    });

    // Listen for clear events
    socket.on('whiteboard:clear', ({ userName: clearingUser }) => {
      if (clearingUser !== userName) {
        canvas.clear();
        canvas.backgroundColor = '#ffffff';
        canvas.renderAll();
      }
    });

    // Listen for user joined
    socket.on('whiteboard:user-joined', ({ userName: joinedUser, users: activeUsers }) => {
      setUsers(activeUsers);
      if (joinedUser !== userName) {
        showNotification(`${joinedUser} joined the whiteboard`);
      }
    });

    // Listen for user left
    socket.on('whiteboard:user-left', ({ userName: leftUser, users: activeUsers }) => {
      setUsers(activeUsers);
      showNotification(`${leftUser} left the whiteboard`);
    });

    // Request current canvas state from other users
    socket.emit('whiteboard:request-state', { roomCode });

    // Listen for canvas state
    socket.on('whiteboard:state', ({ canvasJSON }) => {
      if (canvasJSON) {
        isRemoteDrawing.current = true;
        canvas.loadFromJSON(canvasJSON, () => {
          canvas.renderAll();
          isRemoteDrawing.current = false;
        });
      }
    });

    // Handle canvas state requests from new users
    socket.on('whiteboard:request-state', () => {
      const canvasJSON = canvas.toJSON();
      socket.emit('whiteboard:send-state', { roomCode, canvasJSON });
    });

    // Handle window resize
    const handleResize = () => {
      const newWidth = window.innerWidth > 768 ? 800 : window.innerWidth - 40;
      const newHeight = window.innerHeight > 768 ? 600 : window.innerHeight - 200;
      canvas.setDimensions({ width: newWidth, height: newHeight });
      canvas.renderAll();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      socket.emit('whiteboard:leave', { roomCode, userName });
      socket.off('whiteboard:draw');
      socket.off('whiteboard:clear');
      socket.off('whiteboard:user-joined');
      socket.off('whiteboard:user-left');
      socket.off('whiteboard:state');
      socket.off('whiteboard:request-state');
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
  }, [roomCode, userName]);

  // Update brush when color or size changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    
    if (tool === 'pen') {
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = brushSize;
      canvas.isDrawingMode = true;
    } else if (tool === 'eraser') {
      canvas.freeDrawingBrush.color = '#ffffff';
      canvas.freeDrawingBrush.width = brushSize * 3;
      canvas.isDrawingMode = true;
    }
  }, [color, brushSize, tool]);

  function showNotification(message) {
    // Simple notification - you can enhance this
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function clearCanvas() {
    if (!fabricCanvasRef.current) return;
    if (!confirm('Clear the entire whiteboard for everyone?')) return;
    
    const canvas = fabricCanvasRef.current;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    
    // Broadcast clear to all users
    socket.emit('whiteboard:clear', { roomCode, userName });
  }

  function downloadCanvas() {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    const dataURL = canvas.toDataURL({
      format: 'png',
      quality: 1,
    });
    
    const link = document.createElement('a');
    link.download = `whiteboard-${roomCode}-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  }

  const colors = [
    '#000000', // Black
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FF8800', // Orange
    '#8800FF', // Purple
    '#00FF88', // Teal
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Collaborative Whiteboard</h2>
            <p className="text-sm text-slate-500">Room: {roomCode}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Active Users */}
            <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-green-700">
                {users.length} {users.length === 1 ? 'user' : 'users'} online
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-4 p-4 border-b border-slate-200 bg-slate-50">
          {/* Tool Selection */}
          <div className="flex gap-2">
            <button
              onClick={() => setTool('pen')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                tool === 'pen'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="w-5 h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Pen
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                tool === 'eraser'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="w-5 h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Eraser
            </button>
          </div>

          {/* Color Picker */}
          {tool === 'pen' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600">Color:</span>
              <div className="flex gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full border-2 transition ${
                      color === c ? 'border-slate-800 scale-110' : 'border-slate-300'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded-full border-2 border-slate-300 cursor-pointer"
                  title="Custom color"
                />
              </div>
            </div>
          )}

          {/* Brush Size */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Size:</span>
            <input
              type="range"
              min="1"
              max="20"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm font-medium text-slate-600 min-w-[2rem]">{brushSize}px</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={downloadCanvas}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
            >
              <svg className="w-5 h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Save
            </button>
            <button
              onClick={clearCanvas}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
            >
              <svg className="w-5 h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto p-4 bg-slate-100 flex items-center justify-center">
          <div className="shadow-lg rounded-lg overflow-hidden bg-white">
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Active Users Footer */}
        {users.length > 0 && (
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <div className="flex flex-wrap gap-2">
              {users.map((user, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                  </svg>
                  {user}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
