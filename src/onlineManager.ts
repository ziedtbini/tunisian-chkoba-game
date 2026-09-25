import Peer, { DataConnection } from 'peerjs';
import type { OnlineMessage as ProtocolMessage } from './online/protocol';
import { ONLINE_PROTOCOL_VERSION, RECONNECT_WINDOW_MS } from './online/protocol';
import { isLegacyOnlineMessage, parseOnlineMessage } from './online/validation';
import { recordOnlineNetworkError } from './online/telemetry';

const PEER_PREFIX = 'chkoba-tn-';
export const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECTION_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 35000;
const MAX_ROOM_RETRIES = 5;
const MAX_MESSAGE_BYTES = 64_000;
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
type PeerFactory = (idOrOptions: string | typeof PEER_OPTIONS, options?: typeof PEER_OPTIONS) => Peer;

export class OnlineManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private onProtocolMessage: ((msg: ProtocolMessage) => void) | null = null;
  private onProtocolTransportConnected: (() => void) | null = null;
  private onProtocolTransportDisconnected: (() => void) | null = null;
  private onProtocolReconnecting: ((attempt: number) => void) | null = null;
  private onProtocolError: ((message: string, reasonCode?: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPongAt = 0;
  private connectionGeneration = 0;
  private reconnectTimer: number | null = null;
  private reconnectConnectionTimer: number | null = null;
  private reconnectConnectionId = 0;
  private reconnectStartedAt = 0;
  private reconnectAttempt = 0;
  private hasConnectedOnce = false;
  public isHost = false;
  public roomCode = '';

  constructor(
    private readonly peerFactory: PeerFactory = (idOrOptions, options) =>
      typeof idOrOptions === 'string' ? new Peer(idOrOptions, options) : new Peer(idOrOptions),
  ) {}

  setProtocolCallbacks(cbs: {
    onMessage: (msg: ProtocolMessage) => void;
    onTransportConnected: () => void;
    onTransportDisconnected: () => void;
    onReconnecting?: (attempt: number) => void;
    onError?: (message: string, reasonCode?: string) => void;
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
        this.peer = this.peerFactory(PEER_PREFIX + this.roomCode, PEER_OPTIONS);
        attachPeerHandlers();
      };

      const timeout = window.setTimeout(() => {
        if (settled || this.peer?.open) return;
        settled = true;
        this.notifyError('Timeout: impossible de creer la room', 'timeout', 'room_creation');
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
          if (!this.peer?.destroyed) {
            try {
              this.peer?.reconnect();
            } catch {
              void recordOnlineNetworkError('peer_reconnect_error', { role: 'host', connectionStage: 'signalling', protocolVersion: ONLINE_PROTOCOL_VERSION });
            }
          }
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
            this.notifyError(err.message || 'Erreur de connexion', 'peer_error', 'room_creation', true);
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
        this.notifyError(`Code invalide (${ROOM_CODE_LENGTH} caracteres)`, 'invalid_message', 'join_validation');
        reject(new Error('Invalid room code'));
        return;
      }
      const targetId = PEER_PREFIX + this.roomCode;
      let settled = false;

      this.peer = this.peerFactory(PEER_OPTIONS);

      const timeout = window.setTimeout(() => {
        if (settled || this.conn?.open) return;
        settled = true;
        this.notifyError('Timeout: impossible de rejoindre la room', 'timeout', 'join_transport');
        reject(new Error('Timeout'));
      }, CONNECTION_TIMEOUT_MS);

      this.peer.on('open', () => {
        let conn: DataConnection;
        try {
          conn = this.peer!.connect(targetId, { reliable: true });
        } catch {
          settled = true;
          clearTimeout(timeout);
          this.notifyError('Impossible de rejoindre la room', 'transport_error', 'join_transport', true);
          reject(new Error('Transport error'));
          return;
        }
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
          this.notifyError(`Impossible de rejoindre: ${errMessage}`, 'transport_error', 'join_transport', true);
          reject(err);
        });
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err.type === 'peer-unavailable') {
          this.notifyError('Room introuvable. Vérifiez le code.', 'peer_unavailable', 'join_signalling');
        } else {
          this.notifyError(err.message || 'Erreur de connexion', 'peer_error', 'join_signalling', true);
        }
        reject(err);
      });
      this.peer.on('disconnected', () => {
        if (!this.peer?.destroyed) {
          try {
            this.peer?.reconnect();
          } catch {
            void recordOnlineNetworkError('peer_reconnect_error', { role: 'guest', connectionStage: 'signalling', protocolVersion: ONLINE_PROTOCOL_VERSION });
          }
        }
      });
    });
  }

  private setupConnection(conn: DataConnection) {
    const generation = ++this.connectionGeneration;
    this.clearReconnectConnectionTimer();
    this.clearReconnectTimer();
    let disconnectNotified = false;
    const notifyDisconnected = () => {
      if (disconnectNotified || generation !== this.connectionGeneration) return;
      disconnectNotified = true;
      this.onProtocolTransportDisconnected?.();
      this.stopPing();
      this.scheduleReconnect();
    };
    this.lastPongAt = Date.now();
    this.hasConnectedOnce = true;
    conn.on('data', (data) => {
      if (generation !== this.connectionGeneration) return;
      try {
        if (JSON.stringify(data).length > MAX_MESSAGE_BYTES) return;
      } catch {
        void recordOnlineNetworkError('parse_exception', { role: this.isHost ? 'host' : 'guest', connectionStage: 'message_serialization', protocolVersion: ONLINE_PROTOCOL_VERSION });
        return;
      }
      let protocolMessage: ProtocolMessage | null;
      try {
        protocolMessage = parseOnlineMessage(data);
      } catch {
        void recordOnlineNetworkError('parse_exception', { role: this.isHost ? 'host' : 'guest', connectionStage: 'message_parsing', protocolVersion: ONLINE_PROTOCOL_VERSION });
        return;
      }
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
      void recordOnlineNetworkError('transport_error', { role: this.isHost ? 'host' : 'guest', connectionStage: 'data_connection', protocolVersion: ONLINE_PROTOCOL_VERSION });
      notifyDisconnected();
    });

    this.onProtocolTransportConnected?.();
    this.startPing();
  }

  markSessionConnected(): void {
    this.clearReconnectTimer();
    this.clearReconnectConnectionTimer();
    this.reconnectStartedAt = 0;
    this.reconnectAttempt = 0;
    this.lastPongAt = Date.now();
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
    if (!this.conn?.open) return;
    try {
      this.conn.send(msg);
    } catch {
      this.notifyError('Erreur de transport', 'transport_error', 'message_send', true);
    }
  }

  isConnected(): boolean {
    return this.conn?.open === true;
  }

  reconnectSignalling(): void {
    if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
      try {
        this.peer.reconnect();
      } catch {
        void recordOnlineNetworkError('peer_reconnect_error', { role: this.isHost ? 'host' : 'guest', connectionStage: 'signalling', protocolVersion: ONLINE_PROTOCOL_VERSION });
      }
    }
  }

  resumeConnection(): void {
    this.reconnectSignalling();
    if (this.hasConnectedOnce && !this.isConnected()) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isHost || !this.roomCode || this.reconnectTimer !== null || this.reconnectConnectionTimer !== null) return;
    if (!this.reconnectStartedAt) this.reconnectStartedAt = Date.now();
    if (Date.now() - this.reconnectStartedAt >= RECONNECT_WINDOW_MS) {
      this.notifyError('La connexion avec votre adversaire a ete perdue.', 'reconnect_timeout', 'reconnect', true);
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
      const reconnectConnectionId = ++this.reconnectConnectionId;
      let conn: DataConnection;
      try {
        conn = this.peer.connect(PEER_PREFIX + this.roomCode, { reliable: true });
      } catch {
        void recordOnlineNetworkError('transport_error', {
          role: this.isHost ? 'host' : 'guest',
          connectionStage: 'reconnect',
          protocolVersion: ONLINE_PROTOCOL_VERSION,
        });
        this.scheduleReconnect();
        return;
      }
      this.conn = conn;
      conn.on('open', () => {
        if (reconnectConnectionId !== this.reconnectConnectionId) {
          conn.close();
          return;
        }
        this.setupConnection(conn);
      });
      conn.on('error', () => {
        if (reconnectConnectionId !== this.reconnectConnectionId) return;
        this.clearReconnectConnectionTimer();
        this.scheduleReconnect();
      });
      this.clearReconnectConnectionTimer();
      this.reconnectConnectionTimer = window.setTimeout(() => {
        this.reconnectConnectionTimer = null;
        if (reconnectConnectionId !== this.reconnectConnectionId) return;
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

  private clearReconnectConnectionTimer(): void {
    if (this.reconnectConnectionTimer !== null) {
      clearTimeout(this.reconnectConnectionTimer);
      this.reconnectConnectionTimer = null;
    }
  }

  private notifyError(message: string, reasonCode: string, connectionStage: string, reportNonFatal = false): void {
    this.onProtocolError?.(message, reasonCode);
    if (reportNonFatal) {
      void recordOnlineNetworkError(reasonCode, {
        role: this.isHost ? 'host' : 'guest',
        connectionStage,
        protocolVersion: ONLINE_PROTOCOL_VERSION,
      });
    }
  }

  destroy() {
    this.connectionGeneration += 1;
    this.reconnectConnectionId += 1;
    this.clearReconnectTimer();
    this.clearReconnectConnectionTimer();
    this.reconnectStartedAt = 0;
    this.reconnectAttempt = 0;
    this.hasConnectedOnce = false;
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
