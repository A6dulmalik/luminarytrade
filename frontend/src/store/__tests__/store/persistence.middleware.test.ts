import { persistenceMiddleware, loadPersistedState } from '../../store/middleware/persistence.middleware';

const mockStore = (state = {}) => ({
  getState: jest.fn(() => state),
  dispatch: jest.fn(),
});

const next = jest.fn((action) => action);

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('persistenceMiddleware', () => {
  beforeEach(() => { jest.clearAllMocks(); localStorageMock.clear(); });

  it('should persist user and auth state to localStorage', () => {
    const state = { auth: { token: 'abc123' }, user: { preferences: { theme: 'dark' } }, transactions: { list: [] } };
    persistenceMiddleware(mockStore(state) as any)(next)({ type: 'auth/login' });
    expect(localStorageMock.setItem).toHaveBeenCalledWith('luminarytrade_state', JSON.stringify({ auth: state.auth, user: state.user }));
  });

  it('should call next with the action', () => {
    persistenceMiddleware(mockStore({}) as any)(next)({ type: 'user/updatePreferences' });
    expect(next).toHaveBeenCalled();
  });

  it('should handle localStorage write errors gracefully', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceeded'); });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => persistenceMiddleware(mockStore({ auth: {}, user: {} }) as any)(next)({ type: 'test' })).not.toThrow();
    warnSpy.mockRestore();
  });
});

describe('loadPersistedState', () => {
  beforeEach(() => { jest.clearAllMocks(); localStorageMock.clear(); });

  it('should return parsed state from localStorage', () => {
    const saved = { auth: { token: 'xyz' } };
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(saved));
    expect(loadPersistedState()).toEqual(saved);
  });

  it('should return empty object if nothing saved', () => {
    localStorageMock.getItem.mockReturnValueOnce(null);
    expect(loadPersistedState()).toEqual({});
  });

  it('should return empty object on JSON parse error', () => {
    localStorageMock.getItem.mockReturnValueOnce('invalid{{');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadPersistedState()).toEqual({});
    warnSpy.mockRestore();
  });
});
