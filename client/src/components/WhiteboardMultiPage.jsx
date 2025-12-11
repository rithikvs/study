import { useEffect, useRef, useState } from 'react';
import { Canvas, PencilBrush, Path, util } from 'fabric';
import { jsPDF } from 'jspdf';
import socket from '../lib/socket';
import api from '../lib/api';

export default function Whiteboard({ roomCode, userName, onClose }) {
  const containerRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(2);
  const [tool, setTool] = useState('pen');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isRemoteDrawing = useRef(false);
  const saveTimeoutRef = useRef(null);
  const [pages, setPages] = useState([]);
  const pageCanvasRefs = useRef({});
  const fabricCanvasRefs = useRef({});
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Constants for A4 size (at 72 DPI for screen, scaled for PDF)
  const PAGE_WIDTH = 794; // A4 width in pixels at 96 DPI
  const PAGE_HEIGHT = 1123; // A4 height in pixels at 96 DPI

  useEffect(() => {
    loadWhiteboardData();
    socket.emit('whiteboard:join', { roomCode, userName });

    // Socket listeners
    socket.on('whiteboard:draw', ({ pageId, pathData, userName: drawingUser }) => {
      if (drawingUser === userName) return;
      
      const canvas = fabricCanvasRefs.current[pageId];
      if (!canvas) return;

      isRemoteDrawing.current = true;
      Path.fromObject(pathData).then((path) => {
        canvas.add(path);
        canvas.renderAll();
        isRemoteDrawing.current = false;
        debouncedSave();
      }).catch((err) => {
        console.error('Error creating path:', err);
        isRemoteDrawing.current = false;
      });
    });

    socket.on('whiteboard:add-page', ({ pageId }) => {
      addPageFromRemote(pageId);
    });

    socket.on('whiteboard:delete-page', ({ pageId }) => {
      deletePageFromRemote(pageId);
    });

    socket.on('whiteboard:clear', ({ userName: clearingUser }) => {
      if (clearingUser !== userName) {
        clearAll();
      }
    });

    socket.on('whiteboard:undo', ({ pageId, userName: undoingUser }) => {
      if (undoingUser !== userName) {
        const canvas = fabricCanvasRefs.current[pageId];
        if (canvas) {
          const objects = canvas.getObjects();
          if (objects.length > 0) {
            canvas.remove(objects[objects.length - 1]);
            canvas.renderAll();
          }
        }
      }
    });

    socket.on('whiteboard:redo', ({ pageId, pathData, userName: redoingUser }) => {
      if (redoingUser !== userName) {
        const canvas = fabricCanvasRefs.current[pageId];
        if (canvas) {
          isRemoteDrawing.current = true;
          Path.fromObject(pathData).then((path) => {
            canvas.add(path);
            canvas.renderAll();
            isRemoteDrawing.current = false;
          }).catch((err) => {
            console.error('Error applying redo:', err);
            isRemoteDrawing.current = false;
          });
        }
      }
    });

    socket.on('whiteboard:user-joined', ({ userName: joinedUser, users: activeUsers }) => {
      setUsers(activeUsers);
      if (joinedUser !== userName) {
        showNotification(`${joinedUser} joined the whiteboard`);
      }
    });

    socket.on('whiteboard:user-left', ({ userName: leftUser, users: activeUsers }) => {
      setUsers(activeUsers);
      showNotification(`${leftUser} left the whiteboard`);
    });

    return () => {
      debouncedSave.flush?.();
      socket.emit('whiteboard:leave', { roomCode, userName });
      socket.off('whiteboard:draw');
      socket.off('whiteboard:add-page');
      socket.off('whiteboard:delete-page');
      socket.off('whiteboard:clear');
      socket.off('whiteboard:undo');
      socket.off('whiteboard:redo');
      socket.off('whiteboard:user-joined');
      socket.off('whiteboard:user-left');
      
      // Dispose all canvases
      Object.values(fabricCanvasRefs.current).forEach(canvas => {
        if (canvas) canvas.dispose();
      });
    };
  }, [roomCode, userName]);

  // Keyboard shortcuts for undo/redo - separate useEffect with dependencies
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undoStack, redoStack, pages]);

  // Initialize canvas when page is added
  useEffect(() => {
    pages.forEach((page) => {
      if (!fabricCanvasRefs.current[page.id] && pageCanvasRefs.current[page.id]) {
        initializeCanvas(page.id);
      }
    });
  }, [pages]);

  // Update brush settings when tool/color/size changes
  useEffect(() => {
    Object.values(fabricCanvasRefs.current).forEach((canvas) => {
      if (!canvas) return;
      
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
    });
  }, [color, brushSize, tool]);

  function initializeCanvas(pageId) {
    const canvasElement = pageCanvasRefs.current[pageId];
    if (!canvasElement || fabricCanvasRefs.current[pageId]) return;

    const canvas = new Canvas(canvasElement, {
      isDrawingMode: true,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      backgroundColor: '#ffffff',
    });

    fabricCanvasRefs.current[pageId] = canvas;

    // Set up brush
    const brush = new PencilBrush(canvas);
    brush.color = color;
    brush.width = brushSize;
    canvas.freeDrawingBrush = brush;

    // Handle drawing
    canvas.on('path:created', (e) => {
      if (isRemoteDrawing.current) return;
      
      const path = e.path;
      const pathJSON = path.toJSON();
      
      // Add to undo stack
      setUndoStack(prev => [...prev, { pageId, action: 'add', object: pathJSON }]);
      setRedoStack([]); // Clear redo stack on new action
      
      socket.emit('whiteboard:draw', {
        roomCode,
        pageId,
        pathData: pathJSON,
        userName,
      });

      debouncedSave();
    });

    canvas.on('object:modified', () => debouncedSave());
    canvas.on('object:removed', () => debouncedSave());

    // Load page data if exists
    const page = pages.find(p => p.id === pageId);
    if (page?.canvasData) {
      loadPageData(canvas, page.canvasData);
    }
  }

  async function loadWhiteboardData() {
    try {
      setLoading(true);
      const { data } = await api.get(`/whiteboard/${roomCode}`);
      
      if (data.pages && data.pages.length > 0) {
        setPages(data.pages);
      } else {
        // Create first page if none exists
        setPages([{ id: Date.now(), canvasData: null }]);
      }
    } catch (err) {
      console.error('Error loading whiteboard:', err);
      setPages([{ id: Date.now(), canvasData: null }]);
    } finally {
      setLoading(false);
    }
  }

  async function loadPageData(canvas, canvasData) {
    if (!canvasData || !canvasData.objects) return;
    
    try {
      isRemoteDrawing.current = true;
      const objects = await util.enlivenObjects(canvasData.objects);
      objects.forEach((obj) => canvas.add(obj));
      canvas.renderAll();
      isRemoteDrawing.current = false;
    } catch (err) {
      console.error('Error loading page data:', err);
      isRemoteDrawing.current = false;
    }
  }

  async function saveWhiteboardData() {
    try {
      const pagesData = pages.map(page => ({
        id: page.id,
        canvasData: fabricCanvasRefs.current[page.id]?.toJSON() || null,
      }));
      
      await api.post(`/whiteboard/${roomCode}`, { pages: pagesData });
    } catch (err) {
      console.error('Error saving whiteboard:', err);
    }
  }

  function debouncedSave() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveWhiteboardData();
    }, 2000);
  }
  debouncedSave.flush = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveWhiteboardData();
    }
  };

  function addNewPage() {
    const newPageId = Date.now();
    const newPage = { id: newPageId, canvasData: null };
    setPages(prev => [...prev, newPage]);
    
    socket.emit('whiteboard:add-page', { roomCode, pageId: newPageId });
    
    // Scroll to new page
    setTimeout(() => {
      const pageElement = document.getElementById(`page-${newPageId}`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }

  function addPageFromRemote(pageId) {
    setPages(prev => {
      if (prev.find(p => p.id === pageId)) return prev;
      return [...prev, { id: pageId, canvasData: null }];
    });
  }

  function deletePage(pageId) {
    if (pages.length === 1) {
      showNotification('Cannot delete the last page');
      return;
    }

    if (!confirm('Delete this page? This action cannot be undone.')) return;

    // Dispose canvas for this page
    const canvas = fabricCanvasRefs.current[pageId];
    if (canvas) {
      canvas.dispose();
      delete fabricCanvasRefs.current[pageId];
    }
    delete pageCanvasRefs.current[pageId];

    // Remove page from state
    setPages(prev => prev.filter(p => p.id !== pageId));

    // Broadcast to other users
    socket.emit('whiteboard:delete-page', { roomCode, pageId, userName });

    // Save updated pages
    setTimeout(() => debouncedSave(), 100);
  }

  function deletePageFromRemote(pageId) {
    // Dispose canvas for this page
    const canvas = fabricCanvasRefs.current[pageId];
    if (canvas) {
      canvas.dispose();
      delete fabricCanvasRefs.current[pageId];
    }
    delete pageCanvasRefs.current[pageId];

    // Remove page from state
    setPages(prev => prev.filter(p => p.id !== pageId));
  }

  function handleUndo() {
    if (undoStack.length === 0) return;

    const lastAction = undoStack[undoStack.length - 1];
    const canvas = fabricCanvasRefs.current[lastAction.pageId];
    
    if (!canvas) return;

    if (lastAction.action === 'add') {
      // Find and remove the last added object
      const objects = canvas.getObjects();
      if (objects.length > 0) {
        const removedObject = objects[objects.length - 1];
        canvas.remove(removedObject);
        canvas.renderAll();
        
        // Move to redo stack
        setRedoStack(prev => [...prev, lastAction]);
        setUndoStack(prev => prev.slice(0, -1));
        
        socket.emit('whiteboard:undo', { roomCode, pageId: lastAction.pageId, userName });
        debouncedSave();
      }
    }
  }

  function handleRedo() {
    if (redoStack.length === 0) return;

    const lastRedoAction = redoStack[redoStack.length - 1];
    const canvas = fabricCanvasRefs.current[lastRedoAction.pageId];
    
    if (!canvas) return;

    if (lastRedoAction.action === 'add') {
      isRemoteDrawing.current = true;
      Path.fromObject(lastRedoAction.object).then((path) => {
        canvas.add(path);
        canvas.renderAll();
        isRemoteDrawing.current = false;
        
        // Move back to undo stack
        setUndoStack(prev => [...prev, lastRedoAction]);
        setRedoStack(prev => prev.slice(0, -1));
        
        socket.emit('whiteboard:redo', { roomCode, pageId: lastRedoAction.pageId, pathData: lastRedoAction.object, userName });
        debouncedSave();
      }).catch((err) => {
        console.error('Error redoing:', err);
        isRemoteDrawing.current = false;
      });
    }
  }

  function clearAll() {
    if (!confirm('Clear all pages? This will permanently delete all saved drawings.')) return;
    
    Object.values(fabricCanvasRefs.current).forEach(canvas => {
      if (canvas) {
        canvas.clear();
        canvas.backgroundColor = '#ffffff';
        canvas.renderAll();
      }
    });
    
    setPages([{ id: Date.now(), canvasData: null }]);
    setUndoStack([]);
    setRedoStack([]);
    
    api.delete(`/whiteboard/${roomCode}`).catch(err => {
      console.error('Error clearing whiteboard from database:', err);
    });
    
    socket.emit('whiteboard:clear', { roomCode, userName });
  }

  async function downloadAsPDF() {
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [PAGE_WIDTH, PAGE_HEIGHT],
        compress: true,
      });

      for (let i = 0; i < pages.length; i++) {
        const canvas = fabricCanvasRefs.current[pages[i].id];
        if (!canvas) continue;

        const dataURL = canvas.toDataURL({
          format: 'png',
          quality: 1,
        });

        if (i > 0) {
          pdf.addPage();
        }

        pdf.addImage(dataURL, 'PNG', 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      }

      pdf.save(`whiteboard-${roomCode}-${Date.now()}.pdf`);
      showNotification('PDF downloaded successfully!');
    } catch (err) {
      console.error('Error downloading PDF:', err);
      showNotification('Error downloading PDF');
    }
  }

  function showNotification(message) {
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

  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#FF8800',
    '#8800FF', '#00FF88',
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-6xl h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-slate-200">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-800">Multi-Page Whiteboard</h2>
            <p className="text-xs sm:text-sm text-slate-500">Room: {roomCode} • {pages.length} {pages.length === 1 ? 'page' : 'pages'}</p>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3">
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

        {/* Toolbar */}
        <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 border-b border-slate-200 bg-slate-50 overflow-x-auto">
          {/* Tool Selection */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setTool('pen')}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition text-sm min-h-[44px] whitespace-nowrap ${
                tool === 'pen' ? 'bg-blue-500 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-slate-100'
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
                tool === 'eraser' ? 'bg-blue-500 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="hidden sm:inline">Eraser</span>
            </button>
          </div>

          {/* Color Picker */}
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
              onClick={addNewPage}
              className="px-3 sm:px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap"
              title="Add new page"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">New Page</span>
            </button>
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="hidden sm:inline">Undo</span>
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Y)"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
              </svg>
              <span className="hidden sm:inline">Redo</span>
            </button>
            <button
              onClick={downloadAsPDF}
              className="px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium text-sm min-h-[44px] whitespace-nowrap"
              title="Download as PDF"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">PDF</span>
            </button>
            <button
              onClick={clearAll}
              className="px-3 sm:px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-medium text-sm min-h-[44px] whitespace-nowrap"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 inline sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>

        {/* Pages Container - Vertical Scroll */}
        <div 
          ref={containerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-200 p-4 sm:p-6 space-y-4 sm:space-y-6"
        >
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                <p className="mt-3 text-slate-600 font-medium">Loading whiteboard...</p>
              </div>
            </div>
          )}
          
          {!loading && pages.map((page, index) => (
            <div 
              key={page.id}
              id={`page-${page.id}`}
              className="relative mx-auto shadow-2xl bg-white rounded-lg overflow-hidden group"
              style={{ width: `${PAGE_WIDTH}px`, height: `${PAGE_HEIGHT}px`, maxWidth: '100%' }}
            >
              {/* Page Header with Number and Delete Button */}
              <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                <div className="bg-slate-800 text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg">
                  Page {index + 1}
                </div>
                {pages.length > 1 && (
                  <button
                    onClick={() => deletePage(page.id)}
                    className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full shadow-lg transition opacity-0 group-hover:opacity-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    title="Delete this page"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
              
              {/* Canvas */}
              <canvas 
                ref={el => pageCanvasRefs.current[page.id] = el}
                className="touch-none"
              />
            </div>
          ))}
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
