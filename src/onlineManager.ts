import Peer, { DataConnection } from 'peerjs';
import { OnlineMessage } from './types';

const PEER_PREFIX = 'chkoba-tn-';
export const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECTION_TIMEOUT_MS = 15000;
type IceServer = { urls: string | string[]; username?: string; credential?: string };

function buildIceServers(): IceServer[] {
  const servers: IceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUser = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnPass = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  if (turnUrl && turnUser && turnPass) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
  }
  return servers;
}

const PEER_OPTIONS = {
  debug: 0 as const,
  config: {
    iceServers: buildIceServers(),
  },
};

export class OnlineManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private onMessage: ((msg: OnlineMessage) => void) | null = null;
  private onConnected: (() => void) | null = null;
  private onDisconnected: (() => void) | null = null;
  private onError: ((err: string) => void) | null = null;
  private pingInterval: number | null = null;
  public isHost = false;
  public roomCode = '';

  setCallbacks(cbs: {
    onMessage: (msg: OnlineMessage) => void;
    onConnected: () => void;
    onDisconnected: () => void;
    onError: (err: string) => void;
  }) {
    this.onMessage = cbs.onMessage;
    this.onConnected = cbs.onConnected;
    this.onDisconnected = cbs.onDisconnected;
    this.onError = cbs.onError;
  }

  generateRoomCode(): string {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
    }
    return code;
  }

  normalizeRoomCode(code: string): string {
    return code
      .toUpperCase()
      .trim()
      .replace(/[^A-Z2-9]/g, '')
      .slice(0, ROOM_CODE_LENGTH);
  }

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      this.roomCode = this.generateRoomCode();
      const peerId = PEER_PREFIX + this.roomCode;
      let settled = false;

      this.destroy();

      this.peer = new Peer(peerId, PEER_OPTIONS);

      const timeout = window.setTimeout(() => {
        if (settled || this.peer?.open) return;
        settled = true;
        this.onError?.('Timeout: impossible de creer la room');
        reject(new Error('Timeout'));
      }, CONNECTION_TIMEOUT_MS);

      this.peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(this.roomCode);
      });

      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Room code already in use, try a new one
          this.roomCode = this.generateRoomCode();
          const newPeerId = PEER_PREFIX + this.roomCode;
          this.peer?.destroy();
          this.peer = new Peer(newPeerId, PEER_OPTIONS);
          this.peer.on('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(this.roomCode);
          });
          this.peer.on('connection', (c) => {
            this.conn = c;
            this.setupConnection(c);
          });
          this.peer.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            this.onError?.(e.message || 'Erreur de connexion');
            reject(e);
          });
        } else {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.onError?.(err.message || 'Erreur de connexion');
          reject(err);
        }
      });
    });
  }

  joinRoom(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.roomCode = this.normalizeRoomCode(code);
      if (this.roomCode.length !== ROOM_CODE_LENGTH) {
        this.onError?.(`Code invalide (${ROOM_CODE_LENGTH} caracteres)`);
        reject(new Error('Invalid room code'));
        return;
      }
      const targetId = PEER_PREFIX + this.roomCode;
      let settled = false;

      this.destroy();

      this.peer = new Peer(undefined as any, PEER_OPTIONS);

      const timeout = window.setTimeout(() => {
        if (settled || this.conn?.open) return;
        settled = true;
        this.onError?.('Timeout: impossible de rejoindre la room');
        reject(new Error('Timeout'));
      }, CONNECTION_TIMEOUT_MS);

      this.peer.on('open', () => {
        const conn = this.peer!.connect(targetId, { reliable: true });
        this.conn = conn;

        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.setupConnection(conn);
          resolve();
        });

        conn.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const errMessage = (err as any)?.message || 'erreur';
          this.onError?.(`Impossible de rejoindre: ${errMessage}`);
          reject(err);
        });
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err.type === 'peer-unavailable') {
          this.onError?.('Room introuvable. Vérifiez le code.');
        } else {
          this.onError?.(err.message || 'Erreur de connexion');
        }
        reject(err);
      });
    });
  }

  private setupConnection(conn: DataConnection) {
    conn.on('data', (data) => {
      const msg = data as OnlineMessage;
      if (msg.type === 'ping') {
        this.send({ type: 'pong' });
        return;
      }
      if (msg.type === 'pong') return;
      this.onMessage?.(msg);
    });

    conn.on('close', () => {
      this.onDisconnected?.();
      this.stopPing();
    });

    conn.on('error', () => {
      this.onDisconnected?.();
      this.stopPing();
    });

    this.onConnected?.();
    this.startPing();
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.conn?.open) {
        this.send({ type: 'ping' });
      }
    }, 10000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(msg: OnlineMessage) {
    if (this.conn?.open) {
      this.conn.send(msg);
    }
  }

  isConnected(): boolean {
    return this.conn?.open === true;
  }

  destroy() {
    this.stopPing();
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

// Singleton
export const onlineManager = new OnlineManager();
