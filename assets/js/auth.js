(() => {
  const config = window.URDU_WRITER_SUPABASE_CONFIG;
  const SUPABASE_URL = config && config.url;
  const SUPABASE_ANON_KEY = config && config.anonKey;
  const notice = document.getElementById('auth-notice');
  const loginButton = document.getElementById('login-button');
  const profile = document.getElementById('user-profile');
  const avatar = document.getElementById('user-avatar');
  const avatarFallback = document.getElementById('user-avatar-fallback');
  const profileName = document.getElementById('user-profile-name');
  const profileEmail = document.getElementById('user-profile-email');
  const clientFactory = window.supabase && window.supabase.createClient;
  let client = null;
  let initializationError = null;

  if (SUPABASE_URL && SUPABASE_ANON_KEY && clientFactory) {
    try {
      client = clientFactory(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true
        }
      });
    } catch (error) {
      initializationError = error;
      console.error('Supabase Auth could not initialize with the configured project settings.', error);
    }
  } else if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    initializationError = new Error('The Supabase client library did not load.');
    console.error('Supabase Auth could not initialize because the Supabase client library did not load.');
  }

  function setNotice(message, type = '') {
    if (!notice) return;
    notice.textContent = message;
    notice.className = `auth-notice${type ? ` ${type}` : ''}`;
  }

  function getRedirectUrl() {
    return new URL(window.location.pathname, window.location.origin).href;
  }

  function updateProfile(user) {
    if (!loginButton || !profile) return;
    if (!user) {
      loginButton.hidden = false;
      profile.hidden = true;
      avatar.removeAttribute('src');
      avatar.hidden = true;
      avatarFallback.hidden = false;
      profileName.textContent = '';
      profileEmail.textContent = '';
      return;
    }

    const metadata = user.user_metadata || {};
    const fullName = String(metadata.full_name || metadata.name || user.email || 'User');
    const avatarUrl = String(metadata.avatar_url || metadata.picture || '');
    loginButton.hidden = true;
    profile.hidden = false;
    profileName.textContent = fullName;
    profileEmail.textContent = user.email || '';
    avatarFallback.textContent = fullName.trim().charAt(0).toUpperCase() || 'U';
    avatar.hidden = !avatarUrl;
    avatarFallback.hidden = Boolean(avatarUrl);
    if (avatarUrl) avatar.src = avatarUrl;
  }

  function getClient() {
    if (!client) {
      throw new Error('Authentication is unavailable. Configure the Supabase project URL and public anon key, and make sure the Supabase client library is reachable.');
    }
    return client;
  }

  async function runAuthRequest(fallbackMessage, request) {
    try {
      const result = await request(getClient());
      setNotice('');
      return result;
    } catch (error) {
      console.error(fallbackMessage, error);
      setNotice(error instanceof Error ? error.message : fallbackMessage, 'error');
      return null;
    }
  }

  async function signInWithGoogle() {
    console.info('Starting Google sign-in with Supabase Auth.');
    return runAuthRequest('Google sign-in failed.', async (supabaseClient) => {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
      console.info('Supabase accepted the Google sign-in request.');
      return data;
    });
  }

  async function signInWithEmail(email, password) {
    return runAuthRequest('Email sign-in failed.', async (supabaseClient) => {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      if (error) throw error;
      return data;
    });
  }

  async function signUpWithEmail(email, password, fullName) {
    return runAuthRequest('Account creation failed.', async (supabaseClient) => {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: getRedirectUrl()
        }
      });
      if (error) throw error;
      return data;
    });
  }

  async function requestPasswordReset(email) {
    return runAuthRequest('Could not send the password reset email.', async (supabaseClient) => {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password.html`
      });
      if (error) throw error;
      return true;
    });
  }

  async function getSession() {
    return runAuthRequest('Could not verify the password reset session.', async (supabaseClient) => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      return data.session;
    });
  }

  async function updatePassword(password) {
    return runAuthRequest('Could not update your password.', async (supabaseClient) => {
      const { data, error } = await supabaseClient.auth.updateUser({ password });
      if (error) throw error;
      return data.user;
    });
  }

  async function checkUserSession() {
    if (!client) {
      updateProfile(null);
      setNotice(initializationError
        ? `Authentication could not be initialized: ${initializationError.message}`
        : 'Authentication is not configured yet. Add the Supabase project URL and public anon key to enable sign-in.', 'error');
      return null;
    }

    const result = await getSession();
    updateProfile(result && result.user ? result.user : null);
    return result && result.user ? result.user : null;
  }

  async function signOut() {
    const result = await runAuthRequest('Sign-out failed.', async (supabaseClient) => {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      return true;
    });
    if (result) {
      updateProfile(null);
      setNotice('You have signed out.', 'success');
    }
    return Boolean(result);
  }

  window.signInWithGoogle = signInWithGoogle;
  window.checkUserSession = checkUserSession;
  window.signOut = signOut;
  window.URDU_WRITER_AUTH = {
    isConfigured: Boolean(client),
    signInWithEmail,
    signUpWithEmail,
    requestPasswordReset,
    getSession,
    updatePassword
  };

  if (client) {
    client.auth.onAuthStateChange((_event, session) => {
      updateProfile(session ? session.user : null);
    });
  }
  checkUserSession();
})();
