import { WebSocketService } from '../../services/websocket.service';

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];

  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
  triggerOpen() { this.onopen?.(); }
  triggerMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  triggerError() { this.onerror?.(new Event('error')); }
}

let mockWs: MockWebSocket;

(global as any).WebSocket = jest.fn().mockImplementation(() => {
  mockWs = new MockWebSocket();
  return mockWs;
});

describe('WebSocketService', () => {
  let service: WebSocketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebSocketService('wss://test.example.com/ws');
  });

  afterEach(() => {
    service.disconnect();
  });

  it('should connect and set isConnected to true', () => {
    service.connect();
    mockWs.triggerOpen();
    expect(service.getConnectionStatus()).toBe(true);
  });

  it('should set isConnected to false on close', () => {
    service.connect();
    mockWs.triggerOpen();
    mockWs.close();
    expect(service.getConnectionStatus()).toBe(false);
  });

  it('should queue messages when disconnected and flush on reconnect', () => {
    service.connect();
    // not yet open — messages should be queued
    service.subscribe('price-BTC', { eventType: 'price_feed', assetId: 'BTC' }, jest.fn());
    expect(mockWs.sent.length).toBe(0);

    mockWs.triggerOpen();
    expect(mockWs.sent.length).toBeGreaterThan(0);
  });

  it('should call the correct handler on message', () => {
    const handler = jest.fn();
    service.connect();
    mockWs.triggerOpen();
    service.subscribe('price-ETH', { eventType: 'price_feed' }, handler);

    mockWs.triggerMessage({ eventType: 'price_feed', id: 'msg1', data: { price: 3000 } });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'price_feed' }));
  });

  it('should de-duplicate messages with the same id', () => {
    const handler = jest.fn();
    service.connect();
    mockWs.triggerOpen();
    service.subscribe('alerts', { eventType: 'fraud_alert' }, handler);

    const msg = { eventType: 'fraud_alert', id: 'dup-1', data: {} };
    mockWs.triggerMessage(msg);
    mockWs.triggerMessage(msg);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should discard messages older than 60 seconds', () => {
    const handler = jest.fn();
    service.connect();
    mockWs.triggerOpen();
    service.subscribe('tx', { eventType: 'transaction' }, handler);

    const oldTimestamp = new Date(Date.now() - 70000).toISOString();
    mockWs.triggerMessage({ eventType: 'transaction', id: 'old-1', timestamp: oldTimestamp });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should unsubscribe and stop calling handler', () => {
    const handler = jest.fn();
    service.connect();
    mockWs.triggerOpen();
    service.subscribe('score', { eventType: 'credit_score' }, handler);
    service.unsubscribe('score');

    mockWs.triggerMessage({ eventType: 'credit_score', id: 'msg2' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle malformed messages without throwing', () => {
    service.connect();
    mockWs.triggerOpen();
    expect(() => mockWs.onmessage?.({ data: 'not-json{{' })).not.toThrow();
  });

  it('should start polling fallback on error', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    service.connect();
    mockWs.triggerError();
    expect(service.getConnectionStatus()).toBe(false);
    warnSpy.mockRestore();
  });

  it('should send heartbeat ping after connection', () => {
    jest.useFakeTimers();
    service.connect();
    mockWs.triggerOpen();
    jest.advanceTimersByTime(30000);
    const pings = mockWs.sent.filter((s) => s.includes('"action":"ping"'));
    expect(pings.length).toBeGreaterThanOrEqual(1);
    jest.useRealTimers();
  });
});
