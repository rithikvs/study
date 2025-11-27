import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_API_URL?.replace('/api', '') || 'https://study-2-5wjr.onrender.com', {
  autoConnect: true,
  withCredentials: true,
});

export default socket;