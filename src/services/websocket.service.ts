type MessageHandler = (data: unknown) => void;
type Subscription = { assetId?: string; eventType: string };

const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;
const MAX_MESSAGES_PER_SEC = 10;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: unknown[] = [];
  private subscriptions: Map<string, MessageHandler> = new Map();
  private messageTimestamps: number[] = [];
  private isConnected = false;
  private isManuallyClosed = false;
  private lastMessageIds: Set<string> = new Set();
  private pollingFallback: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.isManuallyClosed = false;
    this._initWebSocket();
  }

  private _initWebSocket(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectDelay = 1000;
        this._stopPollingFallback();
        this._startHeartbeat();
        this._flushQueue();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this._stopHeartbeat();
        if (!this.isManuallyClosed) this._reconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this._startPollingFallback();
      };
    } catch {
      this._reconnect();
    }
  }

  private _handleMessage(event: MessageEvent): void {
    try {
      const now = Date.now();
      this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 1000);
      if (this.messageTimestamps.length >= MAX_MESSAGES_PER_SEC) return;
      this.messageTimestamps.push(now);

      const raw = typeof event.data === 'string' ? event.data : '';
      const data = JSON.parse(raw);

      // De-duplicate
      if (data.id && this.lastMessageIds.has(data.id)) return;
      if (data.id) {
        this.lastMessageIds.add(data.id);
        if (this.lastMessageIds.size > 500) {
          const first = this.lastMessageIds.values().next().value;
          this.lastMessageIds.delete(first);
        }
      }

      // Timestamp check
      if (data.timestamp) {
        const msgTime = new Date(data.timestamp).getTime();
        if (Date.now() - msgTime > 60000) return; // discard messages older than 1 min
      }

      const handler = this.subscriptions.get(data.eventType);
      if (handler) handler(data);
    } catch {
      // silently ignore malformed messages
    }
  }

  subscribe(key: string, subscription: Subscription, handler: MessageHandler): void {
    this.subscriptions.set(key, handler);
    const msg = { action: 'subscribe', ...subscription };
    this._send(msg);
  }

  unsubscribe(key: string): void {
    this.subscriptions.delete(key);
    this._send({ action: 'unsubscribe', key });
  }

  private _send(data: unknown): void {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.messageQueue.push(data);
    }
  }

  private _flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this._send(msg);
    }
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _reconnect(): void {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
      this._initWebSocket();
    }, this.reconnectDelay);
  }

  private _startPollingFallback(): void {
    if (this.pollingFallback) return;
    this.pollingFallback = setInterval(() => {
      // Polling fallback: fetch latest data via REST
      console.warn('[WebSocket] Falling back to polling...');
    }, 5000);
  }

  private _stopPollingFallback(): void {
    if (this.pollingFallback) {
      clearInterval(this.pollingFallback);
      this.pollingFallback = null;
    }
  }

  disconnect(): void {
    this.isManuallyClosed = true;
    this._stopHeartbeat();
    this._stopPollingFallback();
    this.ws?.close();
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

export const websocketService = new WebSocketService(
  process.env.REACT_APP_WS_URL || 'wss://api.luminarytrade.com/ws'
);
