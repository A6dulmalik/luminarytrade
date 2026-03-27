import { useEffect, useRef, useCallback } from 'react';
import { useRealtimeContext } from '../context/RealtimeContext';

type UseRealtimeOptions = {
  key: string;
  eventType: string;
  assetId?: string;
  onMessage: (data: unknown) => void;
};

export const useRealtime = ({ key, eventType, assetId, onMessage }: UseRealtimeOptions): void => {
  const { subscribe, unsubscribe } = useRealtimeContext();
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  const stableHandler = useCallback((data: unknown) => {
    handlerRef.current(data);
  }, []);

  useEffect(() => {
    subscribe(key, eventType, stableHandler, assetId);
    return () => unsubscribe(key);
  }, [key, eventType, assetId]);
};

export const usePriceFeed = (assetId: string, onPrice: (data: unknown) => void) =>
  useRealtime({ key: `price-${assetId}`, eventType: 'price_feed', assetId, onMessage: onPrice });

export const useFraudAlerts = (onAlert: (data: unknown) => void) =>
  useRealtime({ key: 'fraud-alerts', eventType: 'fraud_alert', onMessage: onAlert });

export const useCreditScoreUpdates = (onUpdate: (data: unknown) => void) =>
  useRealtime({ key: 'credit-score', eventType: 'credit_score', onMessage: onUpdate });

export const useTransactionNotifications = (onTransaction: (data: unknown) => void) =>
  useRealtime({ key: 'transactions', eventType: 'transaction', onMessage: onTransaction });

export const useSystemStatus = (onStatus: (data: unknown) => void) =>
  useRealtime({ key: 'system-status', eventType: 'system_status', onMessage: onStatus });
