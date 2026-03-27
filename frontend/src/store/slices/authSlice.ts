import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as authApi from '../../services/auth';

export interface AuthUser {
  id: string;
  email: string | null;
  publicKey: string | null;
  roles: string[];
  tier: string;
  emailVerified: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  csrfToken: string | null;
  loading: boolean;
  error: string | null;
  sessionExpiresAt: string | null;
  initialized: boolean;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  csrfToken: null,
  loading: false,
  error: null,
  sessionExpiresAt: null,
  initialized: false,
};

export const loginWithEmail = createAsyncThunk(
  'auth/loginWithEmail',
  async ({ email, password }: authApi.LoginCredentials) => {
    return await authApi.loginWithEmail(email, password);
  }
);

export const loginWithWallet = createAsyncThunk(
  'auth/loginWithWallet',
  async (params: authApi.WalletLoginParams) => {
    return await authApi.loginWithWallet(params);
  }
);

export const refreshSession = createAsyncThunk(
  'auth/refresh',
  async (csrfToken: string) => {
    return await authApi.refresh(csrfToken);
  }
);

export const logout = createAsyncThunk(
  'auth/logout',
  async (csrfToken: string | null) => {
    if (csrfToken) {
      await authApi.logout(csrfToken);
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCsrfToken: (state, action: PayloadAction<string>) => {
      state.csrfToken = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    setInitialized: (state) => {
      state.initialized = true;
    }
  },
  extraReducers: (builder) => {
    builder
      // Login Email
      .addCase(loginWithEmail.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginWithEmail.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.csrfToken = action.payload.csrfToken;
        state.sessionExpiresAt = action.payload.sessionExpiresAt;
      })
      .addCase(loginWithEmail.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Login failed';
      })
      // Login Wallet
      .addCase(loginWithWallet.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginWithWallet.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.csrfToken = action.payload.csrfToken;
        state.sessionExpiresAt = action.payload.sessionExpiresAt;
      })
      .addCase(loginWithWallet.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Wallet login failed';
      })
      // Refresh
      .addCase(refreshSession.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.csrfToken = action.payload.csrfToken;
        state.sessionExpiresAt = action.payload.sessionExpiresAt;
        state.initialized = true;
      })
      .addCase(refreshSession.rejected, (state) => {
        state.user = null;
        state.accessToken = null;
        state.sessionExpiresAt = null;
        state.initialized = true;
      })
      // Logout
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.accessToken = null;
        state.sessionExpiresAt = null;
        state.error = null;
      });
  },
});

export const { setCsrfToken, clearError, setInitialized } = authSlice.actions;
export default authSlice.reducer;
