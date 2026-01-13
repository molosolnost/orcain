import { io, Socket } from 'socket.io-client';
import type {
  MatchFoundPayload,
  PrepStartPayload,
  StepRevealPayload,
  RoundEndPayload,
  MatchEndPayload,
  HelloOkPayload,
} from './types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE || 'https://orcain-server.onrender.com';

class SocketManager {
  private socket: Socket | null = null;

  connect() {
    // Если socket уже существует -> вернуть его, НЕ создавая новую
    if (this.socket) {
      return this.socket;
    }
    // Если this.socket == null -> создать подключение к серверу
    this.socket = io(SOCKET_URL, { 
      autoConnect: true,
      transports: ['websocket']
    });
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    return this.socket;
  }

  // Outgoing events
  hello(sessionId: string, authToken: string) {
    this.socket?.emit('hello', { sessionId, authToken });
  }

  queueJoin() {
    this.socket?.emit('queue_join');
  }

  layoutConfirm(layout: string[]) {
    this.socket?.emit('layout_confirm', { layout });
  }

  // Incoming events
  onHelloOk(callback: (payload: HelloOkPayload) => void) {
    this.socket?.on('hello_ok', callback);
  }

  onConnected(callback: (payload?: { tokens: number }) => void) {
    this.socket?.on('connected', callback);
  }

  onErrorMsg(callback: (payload: { message: string }) => void) {
    this.socket?.on('error_msg', callback);
  }

  onQueueOk(callback: (payload?: { tokens: number }) => void) {
    this.socket?.on('queue_ok', callback);
  }

  onMatchFound(callback: (payload: MatchFoundPayload) => void) {
    this.socket?.on('match_found', callback);
  }

  onPrepStart(callback: (payload: PrepStartPayload) => void) {
    this.socket?.on('prep_start', callback);
  }

  onConfirmOk(callback: () => void) {
    this.socket?.on('confirm_ok', callback);
  }

  onStepReveal(callback: (payload: StepRevealPayload) => void) {
    this.socket?.on('step_reveal', callback);
  }

  onRoundEnd(callback: (payload: RoundEndPayload) => void) {
    this.socket?.on('round_end', callback);
  }

  onMatchEnd(callback: (payload: MatchEndPayload) => void) {
    this.socket?.on('match_end', (payload: MatchEndPayload) => {
      console.log("[MATCH_END_PAYLOAD]", payload);
      callback(payload);
    });
  }

  onSyncState(callback: (payload: { inMatch: boolean; matchId?: string; phase?: string; roundIndex?: number; suddenDeath?: boolean; yourHp?: number; oppHp?: number; deadlineTs?: number }) => void) {
    this.socket?.on('sync_state', callback);
  }

  // Remove listeners
  off(event: string) {
    this.socket?.off(event);
  }
}

export const socketManager = new SocketManager();
