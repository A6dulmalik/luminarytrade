import { analyticsMiddleware } from '../../store/middleware/analytics.middleware';

const mockStore = () => ({ getState: jest.fn(() => ({})), dispatch: jest.fn() });
const next = jest.fn((action) => action);

describe('analyticsMiddleware', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => jest.restoreAllMocks());

  it('should call next with every action', () => {
    analyticsMiddleware(mockStore() as any)(next)({ type: 'auth/login', payload: {} });
    expect(next).toHaveBeenCalled();
  });

  it('should log tracked actions in development', () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
    analyticsMiddleware(mockStore() as any)(next)({ type: 'auth/login', payload: {} });
    expect(console.log).toHaveBeenCalledWith('[Analytics] Event tracked:', expect.objectContaining({ event: 'auth/login' }));
  });

  it('should not log untracked actions', () => {
    analyticsMiddleware(mockStore() as any)(next)({ type: 'ui/closeModal' });
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should include timestamp in tracked events', () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
    analyticsMiddleware(mockStore() as any)(next)({ type: 'auth/logout' });
    expect(console.log).toHaveBeenCalledWith('[Analytics] Event tracked:', expect.objectContaining({ timestamp: expect.any(String) }));
  });
});
