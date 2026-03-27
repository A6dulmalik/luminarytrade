import { loggerMiddleware } from '../../store/middleware/logger.middleware';

const mockStore = (state = {}) => ({
  getState: jest.fn(() => state),
  dispatch: jest.fn(),
});

const next = jest.fn((action) => action);

describe('loggerMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'group').mockImplementation(() => {});
    jest.spyOn(console, 'groupEnd').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('should call next with the action', () => {
    const store = mockStore({ auth: { user: null } });
    const action = { type: 'auth/login', payload: { user: 'test' } };
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
    loggerMiddleware(store as any)(next)(action);
    expect(next).toHaveBeenCalledWith(action);
  });

  it('should log action group in development', () => {
    const store = mockStore({ auth: {} });
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
    loggerMiddleware(store as any)(next)({ type: 'auth/logout' });
    expect(console.group).toHaveBeenCalledWith('[Action] auth/logout');
    expect(console.groupEnd).toHaveBeenCalled();
  });

  it('should not log in production', () => {
    const store = mockStore({});
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });
    loggerMiddleware(store as any)(next)({ type: 'ui/toggleModal' });
    expect(console.group).not.toHaveBeenCalled();
  });
});
