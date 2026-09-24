import Peer, { DataConnection } from 'peerjs';
import type { OnlineMessage as ProtocolMessage } from './online/protocol';
import { ONLINE_PROTOCOL_VERSION } from './online/protocol';
import { isLegacyOnlineMessage, parseOnlineMessage } from './online/validation';

const PEER_PREFIX = 'chkoba-tn-';
export const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECTION_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 35000;
const MAX_ROOM_RETRIES = 5;
const MAX_MESSAGE_BYTES = 64_000;
const RECONNECT_WINDOW_MS = 60_000;
const RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 6000, 8000, 10000];
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
  private onProtocolMessage: ((msg: ProtocolMessage) => void) | null = null;
  private onProtocolTransportConnected: (() => void) | null = null;
  private onProtocolTransportDisconnected: (() => void) | null = null;
  private onProtocolReconnecting: ((attempt: number) => void) | null = null;
  private onProtocolError: ((message: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPongAt = 0;
  private connectionGeneration = 0;
  private reconnectTimer: number | null = null;
  private reconnectStartedAt = 0;
  private reconnectAttempt = 0;
  public isHost = false;
  public roomCode = '';

  setProtocolCallbacks(cbs: {
    onMessage: (msg: ProtocolMessage) => void;
    onTransportConnected: () => void;
    onTransportDisconnected: () => void;
    onReconnecting?: (attempt: number) => void;
    onError?: (message: string) => void;
  }): void {
    this.onProtocolMessage = cbs.onMessage;
    this.onProtocolTransportConnected = cbs.onTransportConnected;
    this.onProtocolTransportDisconnected = cbs.onTransportDisconnected;
    this.onProtocolReconnecting = cbs.onReconnecting ?? null;
    this.onProtocolError = cbs.onError ?? null;
  }

  generateRoomCode(): string {
    const random = new Uint32Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(random);
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS.charAt(random[i] % ROOM_CODE_CHARS.length);
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

  createRoom(protocol: 'v2' = 'v2'): Promise<string> {
    return new Promise((resolve, reject) => {
      this.destroy();
      this.isHost = true;
      void protocol;
      let settled = false;
      let retries = 0;

      const createPeer = () => {
        this.roomCode = this.generateRoomCode();
        this.peer = new Peer(PEER_PREFIX + this.roomCode, PEER_OPTIONS);
        attachPeerHandlers();
      };

      const timeout = window.setTimeout(() => {
        if (settled || this.peer?.open) return;
        settled = true;
        this.onProtocolError?.('Timeout: impossible de creer la room');
        reject(new Error('Timeout'));
      }, CONNECTION_TIMEOUT_MS);

      const attachPeerHandlers = () => {
        this.peer?.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(this.roomCode);
        });
        this.peer?.on('connection', (conn) => {
          if (this.conn?.open) {
            conn.on('open', () => {
              conn.send({ type: 'ROOM_FULL', protocolVersion: ONLINE_PROTOCOL_VERSION });
              conn.close();
            });
            return;
          }
          this.conn = conn;
          if (conn.open) this.setupConnection(conn);
          else conn.once('open', () => this.setupConnection(conn));
        });
        this.peer?.on('disconnected', () => {
          if (!this.peer?.destroyed) this.peer?.reconnect();
        });
        this.peer?.on('error', (err) => {
          if (err.type === 'unavailable-id' && retries < MAX_ROOM_RETRIES && !settled) {
            retries += 1;
            this.peer?.destroy();
            createPeer();
            return;
          }
          if (!settled) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            this.onProtocolError?.(err.message || 'Erreur de connexion');
            reject(err);
          }
        });
      };
      createPeer();
    });
  }

  joinRoom(code: string, protocol: 'v2' = 'v2'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.destroy();
      this.isHost = false;
      void protocol;
      this.roomCode = this.normalizeRoomCode(code);
      if (this.roomCode.length !== ROOM_CODE_LENGTH) {
        this.onProtocolError?.(`Code invalide (${ROOM_CODE_LENGTH} caracteres)`);
        reject(new Error('Invalid room code'));
        return;
      }
      const targetId = PEER_PREFIX + this.roomCode;
      let settled = false;

      this.peer = new Peer(PEER_OPTIONS);

      const timeout = window.setTimeout(() => {
        if (settled || this.conn?.open) return;
        settled = true;
        this.onProtocolError?.('Timeout: impossible de rejoindre la room');
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
          const errMessage = err instanceof Error ? err.message : 'erreur';
          this.onProtocolError?.(`Impossible de rejoindre: ${errMessage}`);
          reject(err);
        });
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err.type === 'peer-unavailable') {
          this.onProtocolError?.('Room introuvable. Vérifiez le code.');
        } else {
          this.onProtocolError?.(err.message || 'Erreur de connexion');
        }
        reject(err);
      });
      this.peer.on('disconnected', () => {
        if (!this.peer?.destroyed) this.peer?.reconnect();
      });
    });
  }

  private setupConnection(conn: DataConnection) {
    const generation = ++this.connectionGeneration;
    let disconnectNotified = false;
    const notifyDisconnected = () => {
      if (disconnectNotified || generation !== this.connectionGeneration) return;
      disconnectNotified = true;
      this.onProtocolTransportDisconnected?.();
      this.stopPing();
      this.scheduleReconnect();
    };
    this.lastPongAt = Date.now();
    conn.on('data', (data) => {
      if (generation !== this.connectionGeneration) return;
      try {
        if (JSON.stringify(data).length > MAX_MESSAGE_BYTES) return;
      } catch {
        return;
      }
      const protocolMessage = parseOnlineMessage(data);
      if (!protocolMessage) {
        if (this.isHost && isLegacyOnlineMessage(data)) {
          this.sendProtocolMessage({ type: 'VERSION_MISMATCH', protocolVersion: ONLINE_PROTOCOL_VERSION, expectedVersion: ONLINE_PROTOCOL_VERSION });
        }
        return;
      }
      if (protocolMessage.type === 'PING') {
        this.sendProtocolMessage({ type: 'PONG', protocolVersion: ONLINE_PROTOCOL_VERSION, timestamp: protocolMessage.timestamp });
      } else if (protocolMessage.type === 'PONG') {
        this.lastPongAt = Date.now();
      } else {
        this.onProtocolMessage?.(protocolMessage);
      }
    });

    conn.on('close', () => {
      notifyDisconnected();
    });

    conn.on('error', () => {
      notifyDisconnected();
    });

    this.onProtocolTransportConnected?.();
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.startPing();
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.conn?.open && Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        this.conn.close();
        return;
      }
      if (this.conn?.open) {
        this.sendProtocolMessage({ type: 'PING', protocolVersion: ONLINE_PROTOCOL_VERSION, timestamp: Date.now() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  sendProtocolMessage(msg: ProtocolMessage): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  isConnected(): boolean {
    return this.conn?.open === true;
  }

  reconnectSignalling(): void {
    if (this.peer && !this.peer.destroyed && this.peer.disconnected) this.peer.reconnect();
  }

  private scheduleReconnect(): void {
    if (this.isHost || !this.roomCode || this.reconnectTimer !== null) return;
    if (!this.reconnectStartedAt) this.reconnectStartedAt = Date.now();
    if (Date.now() - this.reconnectStartedAt >= RECONNECT_WINDOW_MS) {
      this.onProtocolError?.('La connexion avec votre adversaire a ete perdue.');
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.onProtocolReconnecting?.(this.reconnectAttempt + 1);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt += 1;
      if (!this.peer || this.peer.destroyed) return;
      if (this.peer.disconnected) this.peer.reconnect();
      if (!this.peer.open) {
        this.scheduleReconnect();
        return;
      }
      const conn = this.peer.connect(PEER_PREFIX + this.roomCode, { reliable: true });
      this.conn = conn;
      conn.on('open', () => this.setupConnection(conn));
      conn.on('error', () => this.scheduleReconnect());
      window.setTimeout(() => {
        if (!conn.open) {
          conn.close();
          this.scheduleReconnect();
        }
      }, CONNECTION_TIMEOUT_MS);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroy() {
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.reconnectStartedAt = 0;
    this.reconnectAttempt = 0;
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
