(() => {
  const form = document.getElementById('reset-password-form');
  const status = document.getElementById('auth-notice');
  const submitButton = document.getElementById('reset-password-submit');
  const auth = window.URDU_WRITER_AUTH;
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));

  function showStatus(message, type = '') {
    status.textContent = message;
    status.className = `auth-notice${type ? ` ${type}` : ''}`;
  }

  function getLinkError() {
    const code = params.get('error_code') || hashParams.get('error_code') || '';
    const description = params.get('error_description') || hashParams.get('error_description') || '';
    if (!code && !description) return '';
    if (code === 'otp_expired' || code === 'access_denied') {
      return 'This password reset link is invalid or has expired. Request a new reset email and try again.';
    }
    return description.replace(/\+/g, ' ') || 'This password reset link is invalid or has expired. Request a new one and try again.';
  }

  async function initialize() {
    if (!auth || !auth.isConfigured) {
      showStatus('Password reset is unavailable because Supabase is not configured. Please contact the site operator.', 'error');
      return;
    }

    const linkError = getLinkError();
    if (linkError) {
      showStatus(linkError, 'error');
      return;
    }

    // Supabase detects and exchanges the callback code or URL tokens during client initialization.
    const session = await auth.getSession();
    if (!session || !session.user) {
      if (!status.classList.contains('error')) {
        showStatus('This password reset link is invalid or has expired. Request a new reset email and try again.', 'error');
      }
      return;
    }

    form.hidden = false;
    showStatus('Your reset link is verified. Choose a new password.', 'success');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const password = form.elements.password.value;
    const confirmation = form.elements['confirm-password'].value;
    if (password !== confirmation) {
      form.elements['confirm-password'].setCustomValidity('Passwords do not match.');
      form.reportValidity();
      form.elements['confirm-password'].setCustomValidity('');
      return;
    }

    submitButton.disabled = true;
    const user = await auth.updatePassword(password);
    if (!user) {
      if (!status.classList.contains('error')) {
        showStatus('We could not update your password. The reset link may have expired, or the password may not meet your project requirements. Request a new link and try again.', 'error');
      }
      submitButton.disabled = false;
      return;
    }

    form.hidden = true;
    showStatus('Your password has been updated. Returning to the site…', 'success');
    window.setTimeout(() => {
      window.location.replace('index.html?password-reset=success');
    }, 1400);
  });

  form.elements['confirm-password'].addEventListener('input', (event) => {
    event.target.setCustomValidity('');
  });

  initialize();
})();
