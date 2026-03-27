import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { websocketService } from '../services/websocket.service';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

type RealtimeContextType = {
  status: ConnectionStatus;
  subscribe: (key: string, eventType: string, handler: (data: unknown) => void, assetId?: string) => void;
  unsubscribe: (key: string) => void;
};

const RealtimeContext = createContext<RealtimeContextType | null>(null);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const serviceRef = useRef(websocketService);

  useEffect(() => {
    serviceRef.current.connect();
    const interval = setInterval(() => {
      setStatus(serviceRef.current.getConnectionStatus() ? 'connected' : 'reconnecting');
    }, 2000);

    return () => {
      clearInterval(interval);
      serviceRef.current.disconnect();
    };
  }, []);

  const subscribe = (key: string, eventType: string, handler: (data: unknown) => void, assetId?: string) => {
    serviceRef.current.subscribe(key, { eventType, assetId }, handler);
  };

  const unsubscribe = (key: string) => {
    serviceRef.current.unsubscribe(key);
  };

  return (
    <RealtimeContext.Provider value={{ status, subscribe, unsubscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
};

export const useRealtimeContext = (): RealtimeContextType => {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtimeContext must be used within RealtimeProvider');
  return ctx;
};
