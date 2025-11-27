import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../lib/api';
import socket from '../lib/socket';

export default function Room() {
  const { roomCode } = useParams();
  const [group, setGroup] = useState(null);
  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const activeNote = useMemo(() => notes.find((n) => n._id === activeId), [notes, activeId]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const gRes = await api.get(`/groups/${roomCode}`);
        setGroup(gRes.data.group);
        const nRes = await api.get(`/notes/${roomCode}`);
        setNotes(nRes.data.notes);
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
          <button onClick={createNote} className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark">New Note</button>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
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
        </div>
      </main>
    </div>
  );
}