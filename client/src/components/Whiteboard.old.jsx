import { useEffect, useRef, useState } from 'react';
import { Canvas, PencilBrush, Path, util } from 'fabric';
import { jsPDF } from 'jspdf';
import socket from '../lib/socket';
import api from '../lib/api';

export default function Whiteboard({ roomCode, userName, onClose }) {
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(2);
  const [tool, setTool] = useState('pen'); // 'pen' or 'eraser'
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isRemoteDrawing = useRef(false);
  const saveTimeoutRef = useRef(null);
  const [pages, setPages] = useState([{ id: 0, canvas: null, history: [] }]);
  const canvasRefs = useRef([]);
  const fabricCanvasRefs = useRef([]);
  const containerRef = useRef(null);

  // Initialize canvases for all pages
  useEffect(() => {
    const initializeCanvases = () => {
      pages.forEach((page, index) => {
        if (!canvasRefs.current[index] || fabricCanvasRefs.current[index]) return;

        const canvasWidth = window.innerWidth > 768 ? 800 : window.innerWidth - 40;
        const canvasHeight = 600;

        const canvas = new Canvas(canvasRefs.current[index], {
          isDrawingMode: true,
          width: canvasWidth,
          height: canvasHeight,
          backgroundColor: '#ffffff',
        });

        fabricCanvasRefs.current[index] = canvas;

        // Set up drawing brush
        const brush = new PencilBrush(canvas);
        brush.color = color;
        brush.width = brushSize;
        canvas.freeDrawingBrush = brush;

        // Handle path created (drawing completed)
        canvas.on('path:created', (e) => {
          if (isRemoteDrawing.current) return;
          
          const path = e.path;
          
          // Add to this page's history
          setPages(prevPages => {
            const newPages = [...prevPages];
            newPages[index] = {
              ...newPages[index],
              history: [...newPages[index].history, path]
            };
            return newPages;
          });
          
          // Serialize the path to JSON for transmission
          const pathJSON = path.toJSON();
          
          // Broadcast drawing to all users in room
          socket.emit('whiteboard:draw', {
            roomCode,
            pathData: pathJSON,
            userName,
            pageNumber: index,
          });

          // Auto-save to database after drawing
          debouncedSave();
        });

        // Load existing data for this page if any
        if (page.objects && page.objects.length > 0) {
          isRemoteDrawing.current = true;
          util.enlivenObjects(page.objects).then((objects) => {
            objects.forEach((obj) => canvas.add(obj));
            canvas.renderAll();
            isRemoteDrawing.current = false;
          });
        }
      });
    };

    initializeCanvases();

    // Join whiteboard room only once
    if (pages.length === 1 && !fabricCanvasRefs.current[0]) {
      socket.emit('whiteboard:join', { roomCode, userName });
      loadWhiteboardData();
    }

    return () => {
      // Cleanup handled in separate effect
    };
  }, [pages.length]);

    // Listen for drawings from other users
      socket.on('whiteboard:draw', ({ pathData, userName: drawingUser }) => {
      if (drawingUser === userName) return; // Don't draw own paths again
      
      isRemoteDrawing.current = true;
      
      // Create path from JSON data
      Path.fromObject(pathData).then((path) => {
        setDrawingHistory(prev => [...prev, path]);
        canvas.add(path);
        canvas.renderAll();
        isRemoteDrawing.current = false;
        // Auto-save when receiving remote drawings
        debouncedSave(canvas);
      }).catch((err) => {
        console.error('Error creating path:', err);
        isRemoteDrawing.current = false;
      });
    });

    // Listen for clear events
    socket.on('whiteboard:clear', ({ userName: clearingUser, pageNumber }) => {
      if (clearingUser !== userName && pageNumber === currentPage) {
        canvas.clear();
        canvas.backgroundColor = '#ffffff';
        canvas.renderAll();
        setDrawingHistory([]);
        pagesDataRef.current[currentPage] = { objects: [], history: [] };
      }
    });

    // Listen for undo from other users
    socket.on('whiteboard:undo', ({ userName: undoingUser }) => {
      if (undoingUser !== userName) {
        setDrawingHistory(prev => {
          if (prev.length === 0) return prev;
          const lastPath = prev[prev.length - 1];
          canvas.remove(lastPath);
          canvas.renderAll();
          return prev.slice(0, -1);
        });
      }
    });

    // Listen for page add events
    socket.on('whiteboard:page-add', ({ userName: addingUser, pageCount }) => {
      if (addingUser !== userName) {
        while (pagesDataRef.current.length < pageCount) {
          pagesDataRef.current.push({ objects: [], history: [] });
        }
        setPages([...pagesDataRef.current]);
        showNotification(`${addingUser} added a new page`);
      }
    });

    // Listen for page switch events
    socket.on('whiteboard:page-switch', ({ userName: switchingUser, pageNumber }) => {
      if (switchingUser !== userName) {
        showNotification(`${switchingUser} switched to page ${pageNumber + 1}`);
      }
    });

    // Listen for page delete events
    socket.on('whiteboard:page-delete', ({ userName: deletingUser, pageIndex, pageCount }) => {
      if (deletingUser !== userName) {
        pagesDataRef.current.splice(pageIndex, 1);
        setPages([...pagesDataRef.current]);
        
        if (currentPage >= pagesDataRef.current.length) {
          const newPage = pagesDataRef.current.length - 1;
          setCurrentPage(newPage);
          loadPageData(newPage);
        }
        
        showNotification(`${deletingUser} deleted page ${pageIndex + 1}`);
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
        util.enlivenObjects(canvasJSON.objects || []).then((objects) => {
          canvas.clear();
          canvas.backgroundColor = '#ffffff';
          objects.forEach((obj) => canvas.add(obj));
          canvas.renderAll();
          isRemoteDrawing.current = false;
        }).catch((err) => {
          console.error('Error loading canvas state:', err);
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
      // Save before closing
      if (fabricCanvasRef.current) {
        saveWhiteboardData(fabricCanvasRef.current);
      }
      
      // Clear timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      socket.emit('whiteboard:leave', { roomCode, userName });
      socket.off('whiteboard:draw');
      socket.off('whiteboard:clear');
      socket.off('whiteboard:undo');
      socket.off('whiteboard:page-add');
      socket.off('whiteboard:page-switch');
      socket.off('whiteboard:page-delete');
      socket.off('whiteboard:user-joined');
      socket.off('whiteboard:user-left');
      socket.off('whiteboard:state');
      socket.off('whiteboard:request-state');
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
  }, [roomCode, userName]);

  // Load whiteboard data from database
  async function loadWhiteboardData(canvas) {
    try {
      setLoading(true);
      const { data } = await api.get(`/whiteboard/${roomCode}`);
      
      if (data.canvasData && data.canvasData.objects) {
        isRemoteDrawing.current = true;
        const objects = await util.enlivenObjects(data.canvasData.objects);
        objects.forEach((obj) => canvas.add(obj));
        canvas.renderAll();
        isRemoteDrawing.current = false;
      }
    } catch (err) {
      console.error('Error loading whiteboard:', err);
    } finally {
      setLoading(false);
    }
  }

  // Save whiteboard data to database
  async function saveWhiteboardData(canvas) {
    try {
      const canvasData = canvas.toJSON();
      await api.post(`/whiteboard/${roomCode}`, { canvasData });
    } catch (err) {
      console.error('Error saving whiteboard:', err);
    }
  }

  // Debounced save function
  function debouncedSave(canvas) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveWhiteboardData(canvas);
    }, 2000); // Save 2 seconds after last change
  }

  // Update brush when color or size changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    
    if (tool === 'pen') {
      const brush = new PencilBrush(canvas);
      brush.color = color;
      brush.width = brushSize;
      canvas.freeDrawingBrush = brush;
      canvas.isDrawingMode = true;
    } else if (tool === 'eraser') {
      const brush = new PencilBrush(canvas);
      brush.color = '#ffffff';
      brush.width = brushSize * 3;
      canvas.freeDrawingBrush = brush;
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

  function undoLastStroke() {
    if (!fabricCanvasRef.current || drawingHistory.length === 0) return;
    
    const canvas = fabricCanvasRef.current;
    const lastPath = drawingHistory[drawingHistory.length - 1];
    
    // Remove the last path from canvas
    canvas.remove(lastPath);
    canvas.renderAll();
    
    // Update history
    setDrawingHistory(prev => prev.slice(0, -1));
    
    // Broadcast undo to all users
    socket.emit('whiteboard:undo', { roomCode, userName });
    
    // Save to database
    debouncedSave(canvas);
  }

  async function clearCanvas() {
    if (!fabricCanvasRef.current) return;
    if (!confirm('Clear the current page for everyone? This will permanently delete all drawings on this page.')) return;
    
    const canvas = fabricCanvasRef.current;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    canvas.renderAll();
    
    // Clear current page history
    setDrawingHistory([]);
    pagesDataRef.current[currentPage] = { objects: [], history: [] };
    setPages([...pagesDataRef.current]);
    
    // Save to database
    debouncedSave(canvas);
    
    // Broadcast clear to all users
    socket.emit('whiteboard:clear', { roomCode, userName, pageNumber: currentPage });
  }

  async function downloadAsPDF() {
    if (!fabricCanvasRef.current) return;
    
    const canvas = fabricCanvasRef.current;
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    
    // Save current page before exporting
    saveCurrentPageData();
    
    // Export each page to PDF
    for (let i = 0; i < pagesDataRef.current.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      
      // Temporarily load this page's data
      canvas.clear();
      canvas.backgroundColor = '#ffffff';
      
      if (pagesDataRef.current[i].objects && pagesDataRef.current[i].objects.length > 0) {
        isRemoteDrawing.current = true;
        try {
          const objects = await util.enlivenObjects(pagesDataRef.current[i].objects);
          objects.forEach((obj) => canvas.add(obj));
          canvas.renderAll();
        } catch (err) {
          console.error('Error loading page for PDF:', err);
        }
        isRemoteDrawing.current = false;
      }
      
      // Convert canvas to image and add to PDF
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    }
    
    // Restore current page
    loadPageData(currentPage);
    
    // Download PDF
    pdf.save(`whiteboard-${roomCode}-${Date.now()}.pdf`);
  }
  
  function downloadCanvas() {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    const dataURL = canvas.toDataURL({
      format: 'png',
      quality: 1,
    });
    
    const link = document.createElement('a');
    link.download = `whiteboard-${roomCode}-page${currentPage + 1}-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  }

  function saveCurrentPageData() {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    pagesDataRef.current[currentPage] = {
      objects: canvas.toJSON().objects,
      history: [...drawingHistory]
    };
    setPages([...pagesDataRef.current]);
  }
  
  function loadPageData(pageIndex) {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    
    isRemoteDrawing.current = true;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    
    const pageData = pagesDataRef.current[pageIndex];
    if (pageData && pageData.objects && pageData.objects.length > 0) {
      util.enlivenObjects(pageData.objects).then((objects) => {
        objects.forEach((obj) => canvas.add(obj));
        canvas.renderAll();
        setDrawingHistory(pageData.history || []);
        isRemoteDrawing.current = false;
      }).catch((err) => {
        console.error('Error loading page:', err);
        isRemoteDrawing.current = false;
      });
    } else {
      setDrawingHistory([]);
      canvas.renderAll();
      isRemoteDrawing.current = false;
    }
  }
  
  function addNewPage() {
    saveCurrentPageData();
    pagesDataRef.current.push({ objects: [], history: [] });
    setPages([...pagesDataRef.current]);
    setCurrentPage(pagesDataRef.current.length - 1);
    loadPageData(pagesDataRef.current.length - 1);
    
    // Broadcast page addition
    socket.emit('whiteboard:page-add', { roomCode, userName, pageCount: pagesDataRef.current.length });
  }
  
  function switchToPage(pageIndex) {
    if (pageIndex === currentPage || pageIndex < 0 || pageIndex >= pagesDataRef.current.length) return;
    saveCurrentPageData();
    setCurrentPage(pageIndex);
    loadPageData(pageIndex);
    
    // Broadcast page switch
    socket.emit('whiteboard:page-switch', { roomCode, userName, pageNumber: pageIndex });
  }
  
  function deletePage(pageIndex) {
    if (pagesDataRef.current.length <= 1) {
      alert('Cannot delete the last page. At least one page is required.');
      return;
    }
    
    if (!confirm(`Delete page ${pageIndex + 1}? This action cannot be undone.`)) return;
    
    pagesDataRef.current.splice(pageIndex, 1);
    setPages([...pagesDataRef.current]);
    
    const newCurrentPage = Math.min(currentPage, pagesDataRef.current.length - 1);
    setCurrentPage(newCurrentPage);
    loadPageData(newCurrentPage);
    
    // Broadcast page deletion
    socket.emit('whiteboard:page-delete', { roomCode, userName, pageIndex, pageCount: pagesDataRef.current.length });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-6xl h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header - Mobile Optimized */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-4 border-b border-slate-200">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-800">Collaborative Whiteboard</h2>
            <p className="text-xs sm:text-sm text-slate-500">Room: {roomCode}</p>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3">
            {/* Active Users */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-green-50 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs sm:text-sm font-medium text-green-700">
                {users.length} {users.length === 1 ? 'user' : 'users'}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition p-2 hover:bg-slate-100 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar - Mobile Scrollable */}
        <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 border-b border-slate-200 bg-slate-50 overflow-x-auto">
          {/* Tool Selection */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setTool('pen')}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition text-sm min-h-[44px] whitespace-nowrap ${
                tool === 'pen'
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span className="hidden sm:inline">Pen</span>
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition text-sm min-h-[44px] whitespace-nowrap ${
                tool === 'eraser'
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="hidden sm:inline">Eraser</span>
            </button>
          </div>

          {/* Color Picker - Mobile Scrollable */}
          {tool === 'pen' && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs sm:text-sm font-medium text-slate-600 hidden sm:inline">Color:</span>
              <div className="flex gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 transition flex-shrink-0 ${
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
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-slate-300 cursor-pointer flex-shrink-0"
                  title="Custom color"
                />
              </div>
            </div>
          )}

          {/* Brush Size */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs sm:text-sm font-medium text-slate-600 hidden sm:inline">Size:</span>
            <input
              type="range"
              min="1"
              max="20"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16 sm:w-24"
            />
            <span className="text-xs sm:text-sm font-medium text-slate-600 min-w-[2rem]">{brushSize}px</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 ml-auto flex-shrink-0">
            <button
              onClick={undoLastStroke}
              disabled={drawingHistory.length === 0}
              className="px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo last stroke"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="hidden sm:inline">Undo</span>
            </button>
            <button
              onClick={downloadAsPDF}
              className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm min-h-[44px] whitespace-nowrap"
              title="Download all pages as PDF"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">PDF</span>
            </button>
            <button
              onClick={clearCanvas}
              className="px-3 sm:px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>

        {/* Page Navigation - Mobile Responsive */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-200 bg-white">
          <button
            onClick={() => switchToPage(currentPage - 1)}
            disabled={currentPage === 0}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Previous page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="flex items-center gap-2 overflow-x-auto flex-1 px-2">
            {pagesDataRef.current.map((_, index) => (
              <button
                key={index}
                onClick={() => switchToPage(index)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium transition text-xs sm:text-sm min-h-[44px] whitespace-nowrap flex-shrink-0 ${
                  currentPage === index
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Page {index + 1}
              </button>
            ))}
          </div>
          
          <button
            onClick={addNewPage}
            className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Add new page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          
          <button
            onClick={() => switchToPage(currentPage + 1)}
            disabled={currentPage === pagesDataRef.current.length - 1}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Next page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          
          {pagesDataRef.current.length > 1 && (
            <button
              onClick={() => deletePage(currentPage)}
              className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Delete current page"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>

        {/* Canvas - Touch Optimized */}
        <div className="flex-1 overflow-auto p-2 sm:p-4 bg-slate-100 flex items-center justify-center relative touch-none">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 bg-opacity-90 z-10">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                <p className="mt-3 text-slate-600 font-medium">Loading whiteboard...</p>
              </div>
            </div>
          )}
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
