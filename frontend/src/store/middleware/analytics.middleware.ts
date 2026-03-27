import { Middleware } from '@reduxjs/toolkit';

const TRACKED_ACTIONS = [
  'auth/login',
  'auth/logout',
  'transactions/fetchTransactions',
  'fraudAlerts/flagAlert',
  'agents/selectAgent',
  'scores/fetchCreditScore',
];

type AnalyticsEvent = {
  event: string;
  timestamp: string;
  payload?: unknown;
};

const sendToAnalytics = (event: AnalyticsEvent) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics] Event tracked:', event);
  }
};

export const analyticsMiddleware: Middleware = () => (next) => (action) => {
  const actionType = (action as any).type as string;
  if (TRACKED_ACTIONS.includes(actionType)) {
    sendToAnalytics({
      event: actionType,
      timestamp: new Date().toISOString(),
      payload: (action as any).payload,
    });
  }
  return next(action);
};
