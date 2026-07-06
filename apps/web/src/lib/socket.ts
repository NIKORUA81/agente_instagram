import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

let socket: Socket | null = null;

/**
 * Socket compartido del dashboard (namespace /realtime).
 * Se autentica con el access token vigente; al reconectar toma el token
 * actual (auth como función se re-evalúa en cada intento).
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${API_URL}/realtime`, {
      transports: ['websocket'],
      withCredentials: true,
      auth: (cb) => cb({ token: getAccessToken() }),
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
