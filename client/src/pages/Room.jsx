import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../lib/api';
import socket from '../lib/socket';

export default function Room() {
  const { roomCode } = useParams();
  const [group, setGroup] = useState(null);
  const [notes, setNotes] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const activeNote = useMemo(() => notes.find((n) => n._id === activeId), [notes, activeId]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState('notes'); // 'notes' or 'files'

  useEffect(() => {
    async function init() {
      try {
        const gRes = await api.get(`/groups/${roomCode}`);
        setGroup(gRes.data.group);
        const nRes = await api.get(`/notes/${roomCode}`);
        setNotes(nRes.data.notes);
        const fRes = await api.get(`/files/${roomCode}`);
        setFiles(fRes.data.files);
        socket.emit('join', { roomCode });
      } catch (err) {
        alert('Room not found');
        console.error(err);
      }
    }
    init();
  }, [roomCode]);

  useEffect(() => {
    function onUpdated({ note }) {
      setNotes((prev) => prev.map((n) => (n._id === note._id ? note : n)));
    }
    function onCreated({ note }) {
      setNotes((prev) => [note, ...prev]);
      setActiveId(note._id);
    }
    function onDeleted({ noteId }) {
      setNotes((prev) => prev.filter((n) => n._id !== noteId));
      if (activeId === noteId) setActiveId(null);
    }
    socket.on('note:updated', onUpdated);
    socket.on('note:created', onCreated);
    socket.on('note:deleted', onDeleted);
    return () => {
      socket.off('note:updated', onUpdated);
      socket.off('note:created', onCreated);
      socket.off('note:deleted', onDeleted);
    };
  }, [roomCode, activeId]);

  async function createNote() {
    try {
      const { data } = await api.post(`/notes/${roomCode}`, { title: 'Untitled' });
      // Socket will broadcast and update lists
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteNote(id) {
    try {
      await api.delete(`/notes/${id}`);
      // Socket broadcast handles UI
    } catch (err) {
      console.error(err);
    }
  }

  async function saveActive() {
    if (!activeNote) return;
    try {
      setSaving(true);
      await api.put(`/notes/${activeNote._id}`, { title: activeNote.title, content: activeNote.content });
      socket.emit('note:update', { noteId: activeNote._id, content: activeNote.content, roomCode });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await api.post(`/files/${roomCode}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setFiles((prev) => [data.file, ...prev]);
      alert('File uploaded successfully!');
      e.target.value = ''; // Reset input
    } catch (err) {
      alert(err.response?.data?.message || 'Upload failed');
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  async function downloadFile(fileId, filename) {
    try {
      const response = await api.get(`/files/download/${fileId}`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed');
      console.error(err);
    }
  }

  async function openFile(fileId, mimeType) {
    try {
      const response = await api.get(`/files/download/${fileId}`, {
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
      
      // Clean up after a delay
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
    } catch (err) {
      alert('Failed to open file');
      console.error(err);
    }
  }

  async function deleteFile(fileId) {
    if (!confirm('Delete this file?')) return;
    try {
      await api.delete(`/files/${fileId}`);
      setFiles((prev) => prev.filter((f) => f._id !== fileId));
    } catch (err) {
      alert(err.response?.data?.message || 'Delete failed');
      console.error(err);
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Room: {roomCode}</h1>
            {group && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-slate-600">Members:</span>
                <div className="flex flex-wrap gap-2">
                  {group.members?.map((member) => (
                    <span key={member._id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                      </svg>
                      {member.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={createNote} className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark">New Note</button>
            <label className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 cursor-pointer flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {uploading ? 'Uploading...' : 'Upload File'}
              <input type="file" onChange={handleFileUpload} className="hidden" disabled={uploading} accept=".pdf,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp" />
            </label>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-4 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('notes')}
            className={`pb-2 px-4 font-medium ${activeTab === 'notes' ? 'border-b-2 border-primary text-primary' : 'text-slate-600'}`}
          >
            Notes ({notes.length})
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`pb-2 px-4 font-medium ${activeTab === 'files' ? 'border-b-2 border-primary text-primary' : 'text-slate-600'}`}
          >
            Files ({files.length})
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          {activeTab === 'notes' ? (
            <>
              <aside className="bg-white border border-slate-200 rounded-xl p-4 overflow-auto h-[60vh]">
                <h2 className="text-sm font-semibold text-slate-600">Notes</h2>
                <ul className="mt-3 space-y-2">
                  {notes.map((n) => (
                <li key={n._id}>
                  <button
                    onClick={() => setActiveId(n._id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border ${activeId === n._id ? 'border-primary bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{n.title || 'Untitled'}</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteNote(n._id); }} className="text-xs text-red-600">Delete</button>
                    </div>
                    <span className="text-xs text-slate-500">Updated {new Date(n.updatedAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
                </ul>
              </aside>

              <section className="bg-white border border-slate-200 rounded-xl p-4 h-[60vh] flex flex-col">
                {!activeNote ? (
                  <div className="h-full grid place-items-center text-slate-500">Select or create a note</div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <input
                      value={activeNote.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotes((prev) => prev.map((n) => (n._id === activeNote._id ? { ...n, title: v } : n)));
                      }}
                      className="px-3 py-2 border rounded-lg"
                    />
                    <textarea
                      value={activeNote.content}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotes((prev) => prev.map((n) => (n._id === activeNote._id ? { ...n, content: v } : n)));
                        socket.emit('note:update', { noteId: activeNote._id, content: v, roomCode });
                      }}
                      className="mt-3 flex-1 resize-none px-3 py-2 border rounded-lg font-mono"
                    />
                    <div className="mt-3 flex items-center justify-end gap-3">
                      <button
                        onClick={saveActive}
                        className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="col-span-full bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Shared Files</h2>
                <div className="text-sm text-slate-500 bg-blue-50 px-3 py-1 rounded-full">
                  <svg className="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                  All members can access these files
                </div>
              </div>
              {files.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-16 h-16 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <p>No files uploaded yet</p>
                  <p className="text-sm mt-1">Upload PDF, PPT, or images to share with everyone (max 10MB)</p>
                  <p className="text-xs mt-2 text-slate-400">Files are permanently stored in the cloud ☁️</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {files.map((file) => (
                    <div key={file._id} className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          {file.mimeType.startsWith('image/') ? (
                            <svg className="w-10 h-10 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                            </svg>
                          ) : file.mimeType === 'application/pdf' ? (
                            <svg className="w-10 h-10 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg className="w-10 h-10 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{file.originalName}</p>
                          <p className="text-xs text-slate-500 mt-1">{formatFileSize(file.size)}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            Uploaded by {file.uploadedBy?.name}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(file.createdAt).toLocaleString()}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              onClick={() => openFile(file._id, file.mimeType)}
                              className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded hover:bg-green-100 font-medium"
                            >
                              📂 Open
                            </button>
                            <button
                              onClick={() => downloadFile(file._id, file.originalName)}
                              className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                            >
                              ⬇️ Download
                            </button>
                            <button
                              onClick={() => deleteFile(file._id)}
                              className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}