import { Middleware } from '@reduxjs/toolkit';

const PERSISTED_KEYS = ['user', 'auth'];
const STORAGE_KEY = 'luminarytrade_state';

export const persistenceMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  try {
    const state = store.getState();
    const stateToPersist = PERSISTED_KEYS.reduce((acc, key) => {
      if (state[key] !== undefined) acc[key] = state[key];
      return acc;
    }, {} as Record<string, unknown>);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToPersist));
  } catch (err) {
    console.warn('[Persistence] Failed to save state to localStorage:', err);
  }
  return result;
};

export const loadPersistedState = (): Partial<Record<string, unknown>> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Persistence] Failed to load state from localStorage:', err);
    return {};
  }
};
