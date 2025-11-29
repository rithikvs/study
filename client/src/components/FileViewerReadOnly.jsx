import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import api from '../lib/api';

// Set up PDF.js worker - use local worker file from public directory
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export default function FileViewerReadOnly({ file, onClose }) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

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

          const loadingTask = pdfjsLib.getDocument({ data: response.data });
          const pdf = await loadingTask.promise;
          setPdfDoc(pdf);
          setTotalPages(pdf.numPages);
          setCurrentPage(1);
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
    } else if (file.mimeType.includes('presentation') || file.originalName.match(/\.(ppt|pptx)$/i)) {
      setError('PowerPoint files cannot be previewed. Please download to view.');
      setLoading(false);
    } else {
      setError('This file type cannot be previewed. Please download to view.');
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
      } else if (file.mimeType.startsWith('image/')) {
        // Render Image
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{file.originalName}</h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={prevPage} disabled={currentPage === 1} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-600">
                ←
              </button>
              <span>Page {currentPage} / {totalPages}</span>
              <button onClick={nextPage} disabled={currentPage === totalPages} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-600">
                →
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600">
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600">
              +
            </button>
          </div>

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
          <div className="text-white text-xl">Loading {file.mimeType.startsWith('image/') ? 'image' : 'file'}...</div>
        ) : error ? (
          <div className="text-center">
            <div className="text-red-400 text-xl mb-4">{error}</div>
            <button 
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="relative bg-white shadow-2xl">
            <canvas ref={canvasRef} className="block" />
          </div>
        )}
      </div>

      {/* Status bar */}
      {!loading && !error && (
        <div className="bg-slate-800 text-white p-2 text-sm text-center">
          {file.originalName} • {totalPages > 1 ? `Page ${currentPage} of ${totalPages}` : 'Viewing file'} • Zoom: {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
