(() => {
  const form = document.getElementById('feedback-form');
  const status = document.getElementById('feedback-status');
  const config = window.URDU_WRITER_SUPABASE_CONFIG;

  function showStatus(message, type = '') {
    status.textContent = message;
    status.className = `feedback-status${type ? ` ${type}` : ''}`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    if (!config || !config.url || !config.anonKey) {
      showStatus('Feedback cannot be sent or saved right now. Please use the Contact Us page for support.', 'error');
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const rating = data.get('rating');
    const projectUrl = config.url.replace(/\/+$/, '');
    submitButton.disabled = true;
    showStatus('Sending your feedback…');

    try {
      const response = await fetch(`${projectUrl}/rest/v1/website_feedback`, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          category: data.get('category'),
          rating: rating ? Number(rating) : null,
          message: String(data.get('message')).trim(),
          email: String(data.get('email')).trim() || null,
          page_url: window.location.href.slice(0, 2048)
        })
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`Feedback could not be saved (${response.status}). ${detail}`);
      }

      form.reset();
      showStatus('Thank you! Your feedback was sent successfully.', 'success');
    } catch (error) {
      console.error('Could not submit website feedback.', error);
      showStatus('We could not save your feedback. Please try again later.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById('footer-year').textContent = String(new Date().getFullYear());
})();
