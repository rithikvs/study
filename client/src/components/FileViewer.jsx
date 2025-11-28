import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import api from '../lib/api';
import socket from '../lib/socket';
import { useApp } from '../context/AppContext';

// Set up PDF.js worker - use local worker file from public directory
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export default function FileViewer({ file, onClose }) {
  const { authUser } = useApp();
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState('pen'); // 'pen', 'highlighter', or 'eraser'
  const [color, setColor] = useState('#000000');
  const [penSize, setPenSize] = useState(3);
  const [highlighterSize, setHighlighterSize] = useState(20);
  const [eraserSize, setEraserSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [currentStroke, setCurrentStroke] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cursorPos, setCursorPos] = useState(null);
  
  const canvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const containerRef = useRef(null);

  // Colors palette
  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', 
    '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#FFC0CB'
  ];

  // Load PDF or Image
  useEffect(() => {
    setLoading(true);
    setError(null);
    
    if (file.mimeType === 'application/pdf') {
      async function loadPDF() {
        try {
          console.log('Loading PDF file:', file._id);
          const response = await api.get(`/files/download/${file._id}`, {
            responseType: 'arraybuffer',
          });

          console.log('PDF downloaded, size:', response.data.byteLength);
          const loadingTask = pdfjsLib.getDocument({ data: response.data });
          const pdf = await loadingTask.promise;
          console.log('PDF loaded successfully, pages:', pdf.numPages);
          setPdfDoc(pdf);
          setTotalPages(pdf.numPages);
          setLoading(false);
        } catch (err) {
          console.error('Failed to load PDF:', err);
          setError(`Failed to load PDF: ${err.message || 'Unknown error'}`);
          setLoading(false);
        }
      }
      loadPDF();
    } else if (file.mimeType.startsWith('image/')) {
      // For images, set totalPages to 1
      setTotalPages(1);
      setCurrentPage(1);
      setLoading(false);
    } else {
      setError('Unsupported file type. Only PDF and images are supported.');
      setLoading(false);
    }
  }, [file]);

  // Render PDF page or Image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    async function renderContent() {
      const context = canvas.getContext('2d');

      if (file.mimeType === 'application/pdf' && pdfDoc) {
        // Render PDF
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Setup drawing canvas to match
        const drawCanvas = drawCanvasRef.current;
        if (drawCanvas) {
          drawCanvas.height = viewport.height;
          drawCanvas.width = viewport.width;
        }
      } else if (file.mimeType.startsWith('image/')) {
        // Render Image - Always fetch via API for authentication
        api.get(`/files/download/${file._id}`, { responseType: 'blob' })
          .then(response => {
            const url = URL.createObjectURL(response.data);
            const img = new Image();
            
            img.onload = () => {
              const scaledWidth = img.width * scale;
              const scaledHeight = img.height * scale;
              
              canvas.width = scaledWidth;
              canvas.height = scaledHeight;
              
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.drawImage(img, 0, 0, scaledWidth, scaledHeight);

              // Setup drawing canvas to match
              const drawCanvas = drawCanvasRef.current;
              if (drawCanvas) {
                drawCanvas.width = scaledWidth;
                drawCanvas.height = scaledHeight;
              }
              
              // Clean up blob URL
              URL.revokeObjectURL(url);
            };

            img.onerror = () => {
              console.error('Failed to load image');
              setError('Failed to load image');
            };

            img.src = url;
          })
          .catch(err => {
            console.error('Failed to fetch image:', err);
            setError('Failed to fetch image');
          });
      }
    }

    renderContent();
  }, [pdfDoc, currentPage, scale, file]);

  // Load annotations for current page
  useEffect(() => {
    async function loadAnnotations() {
      try {
        const { data } = await api.get(`/annotations/${file._id}/${currentPage}`);
        setAnnotations(data.annotation?.annotations || []);
      } catch (err) {
        console.error('Failed to load annotations:', err);
      }
    }

    loadAnnotations();
  }, [file._id, currentPage]);

  // Redraw all annotations
  useEffect(() => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;

    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    annotations.forEach((ann) => {
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = ann.width;
      
      // Highlighter uses butt cap for straight lines, others use round
      if (ann.type === 'highlighter') {
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.globalAlpha = 0.05;
      } else {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ann.points.forEach((point, idx) => {
        if (idx === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
    });

    ctx.globalAlpha = 1;
  }, [annotations]);

  // Socket listeners for real-time annotations
  useEffect(() => {
    function onAnnotationDraw({ fileId, pageNumber, annotation }) {
      if (fileId === file._id && pageNumber === currentPage) {
        setAnnotations((prev) => [...prev, annotation]);
      }
    }

    function onAnnotationClear({ fileId, pageNumber }) {
      if (fileId === file._id && pageNumber === currentPage) {
        setAnnotations([]);
      }
    }

    socket.on('annotation:draw', onAnnotationDraw);
    socket.on('annotation:clear', onAnnotationClear);

    return () => {
      socket.off('annotation:draw', onAnnotationDraw);
      socket.off('annotation:clear', onAnnotationClear);
    };
  }, [file._id, currentPage]);

  // Drawing handlers
  function getMousePos(e) {
    const canvas = drawCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function handleMouseDown(e) {
    setIsDrawing(true);
    const pos = getMousePos(e);
    setCurrentStroke([pos]);
  }

  function handleMouseMove(e) {
    const pos = getMousePos(e);
    setCursorPos(pos);

    if (!isDrawing) return;
    setCurrentStroke((prev) => [...prev, pos]);

    // Draw current stroke in real-time
    const ctx = drawCanvasRef.current.getContext('2d');
    
    if (tool === 'eraser') {
      // Eraser mode - remove annotations by clearing the area
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = eraserSize;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = tool === 'highlighter' ? highlighterSize : penSize;
    }
    
    // Highlighter uses butt cap for straight lines, pen and eraser use round
    if (tool === 'highlighter') {
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    } else {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    if (tool === 'highlighter') {
      ctx.globalAlpha = 0.20;
    } else {
      ctx.globalAlpha = 1;
    }

    if (currentStroke.length > 0) {
      const lastPos = currentStroke[currentStroke.length - 1];
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  async function handleMouseUp() {
    if (!isDrawing || currentStroke.length === 0) {
      setIsDrawing(false);
      return;
    }

    setIsDrawing(false);

    // For eraser, find and remove annotations that intersect with the stroke
    if (tool === 'eraser') {
      // Remove annotations that intersect with eraser path
      const remainingAnnotations = annotations.filter(ann => {
        // Simple check: if any point in annotation is within eraser radius
        return !ann.points.some(point => 
          currentStroke.some(eraserPoint => {
            const dx = point.x - eraserPoint.x;
            const dy = point.y - eraserPoint.y;
            return Math.sqrt(dx * dx + dy * dy) < eraserSize; // use dynamic eraser radius
          })
        );
      });
      
      if (remainingAnnotations.length !== annotations.length) {
        // Some annotations were erased, update on server
        try {
          await api.delete(`/annotations/${file._id}/${currentPage}`);
          // Re-add remaining annotations
          for (const ann of remainingAnnotations) {
            await api.post(`/annotations/${file._id}/${currentPage}/draw`, ann);
          }
        } catch (err) {
          console.error('Failed to erase:', err);
        }
      }
    } else {
      // Save annotation to backend (pen or highlighter)
      try {
        await api.post(`/annotations/${file._id}/${currentPage}/draw`, {
          type: tool,
          color,
          width: tool === 'highlighter' ? highlighterSize : penSize,
          points: currentStroke,
          userName: authUser?.name || 'Anonymous',
        });
        // Socket will broadcast to all users
      } catch (err) {
        console.error('Failed to save annotation:', err);
      }
    }

    setCurrentStroke([]);
  }

  async function clearAnnotations() {
    if (!confirm('Clear all annotations on this page?')) return;

    try {
      await api.delete(`/annotations/${file._id}/${currentPage}`);
      // Socket will broadcast to all users
    } catch (err) {
      console.error('Failed to clear annotations:', err);
      alert('Failed to clear annotations');
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  }

  function prevPage() {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  }

  // Render with annotations (both PDF and images)
  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{file.originalName}</h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={prevPage} disabled={currentPage === 1} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-50">
                ←
              </button>
              <span>Page {currentPage} / {totalPages}</span>
              <button onClick={nextPage} disabled={currentPage === totalPages} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-50">
                →
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="px-3 py-1 bg-slate-700 rounded">
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="px-3 py-1 bg-slate-700 rounded">
              +
            </button>
          </div>

          <div className="w-px h-8 bg-slate-600"></div>

          {/* Tool selection */}
          <div className="flex gap-2">
            <button
              onClick={() => setTool('pen')}
              className={`px-4 py-2 rounded ${tool === 'pen' ? 'bg-blue-600' : 'bg-slate-700'}`}
              title="Pen Tool"
            >
              🖊️ Pen
            </button>
            <button
              onClick={() => setTool('highlighter')}
              className={`px-4 py-2 rounded ${tool === 'highlighter' ? 'bg-yellow-600' : 'bg-slate-700'}`}
              title="Highlighter Tool"
            >
              🖍️ Highlighter
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`px-4 py-2 rounded ${tool === 'eraser' ? 'bg-pink-600' : 'bg-slate-700'}`}
              title="Eraser Tool"
            >
              🧹 Eraser
            </button>
          </div>

          <div className="w-px h-8 bg-slate-600"></div>

          {/* Size controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm">Size:</span>
            {tool === 'pen' && (
              <input
                type="range"
                min="1"
                max="10"
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
                className="w-20"
                title="Pen Size"
              />
            )}
            {tool === 'highlighter' && (
              <input
                type="range"
                min="10"
                max="40"
                value={highlighterSize}
                onChange={(e) => setHighlighterSize(Number(e.target.value))}
                className="w-20"
                title="Highlighter Size"
              />
            )}
            {tool === 'eraser' && (
              <input
                type="range"
                min="10"
                max="50"
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                className="w-20"
                title="Eraser Size"
              />
            )}
            <span className="text-sm font-mono">
              {tool === 'pen' ? penSize : tool === 'highlighter' ? highlighterSize : eraserSize}px
            </span>
          </div>

          <div className="w-px h-8 bg-slate-600"></div>

          {/* Color picker */}
          <div className="flex gap-1">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          <div className="w-px h-8 bg-slate-600"></div>

          <button onClick={clearAnnotations} className="px-4 py-2 bg-red-600 rounded hover:bg-red-700">
            🗑️ Clear Page
          </button>

          <button onClick={onClose} className="px-4 py-2 bg-slate-700 rounded hover:bg-slate-600">
            ✕ Close
          </button>
        </div>
      </div>

      {/* Canvas container */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto bg-slate-700 flex items-center justify-center p-8"
      >
        {loading ? (
          <div className="text-white text-xl">Loading {file.mimeType.startsWith('image/') ? 'image' : 'PDF'}...</div>
        ) : error ? (
          <div className="text-red-400 text-xl">{error}</div>
        ) : (
          <div className="relative bg-white shadow-2xl">
            {/* PDF/Image canvas */}
            <canvas ref={canvasRef} className="block" />
            
            {/* Drawing canvas overlay */}
            <canvas
              ref={drawCanvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { handleMouseUp(); setCursorPos(null); }}
              className="absolute top-0 left-0 cursor-none"
              style={{ touchAction: 'none' }}
            />
            
            {/* Custom cursor indicator */}
            {cursorPos && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${(cursorPos.x / drawCanvasRef.current?.width) * 100}%`,
                  top: `${(cursorPos.y / drawCanvasRef.current?.height) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div
                  className="rounded-full border-2"
                  style={{
                    width: `${(tool === 'pen' ? penSize : tool === 'highlighter' ? highlighterSize : eraserSize) * (drawCanvasRef.current?.getBoundingClientRect().width / drawCanvasRef.current?.width || 1)}px`,
                    height: `${(tool === 'pen' ? penSize : tool === 'highlighter' ? highlighterSize : eraserSize) * (drawCanvasRef.current?.getBoundingClientRect().width / drawCanvasRef.current?.width || 1)}px`,
                    borderColor: tool === 'eraser' ? '#ff69b4' : tool === 'highlighter' ? '#fbbf24' : color,
                    backgroundColor: tool === 'eraser' ? 'rgba(255, 105, 180, 0.1)' : tool === 'highlighter' ? 'rgba(251, 191, 36, 0.1)' : `${color}20`
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="bg-slate-800 text-white p-2 text-sm text-center">
        {annotations.length} annotation(s) • {tool === 'pen' ? 'Pen' : tool === 'highlighter' ? 'Highlighter' : 'Eraser'} • Size: {tool === 'pen' ? penSize : tool === 'highlighter' ? highlighterSize : eraserSize}px {tool !== 'eraser' && `• Color: ${color}`}
      </div>
    </div>
  );
}
