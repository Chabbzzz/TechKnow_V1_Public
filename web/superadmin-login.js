(() => {
  const form = document.getElementById('superadmin-login-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const submit = form.querySelector('button[type="submit"]');
  const notice = document.getElementById('superadmin-login-notice');
  const toggle = document.getElementById('toggle-password');
  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(show));
    toggle.innerHTML = `<i class="fa ${show ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>`;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    notice.classList.remove('show');
    submit.disabled = true;
    try {
      await window.techKnowAdmin.signIn(window.techKnowFirebase, {
        email: email.value, password: password.value, role: 'Super Admin',
      });
      password.value = '';
      window.location.assign('superadmin.html');
    } catch (error) {
      const messages = {
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/wrong-password': 'The email or password is incorrect.',
        'auth/user-not-found': 'The email or password is incorrect.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
        'auth/network-request-failed': 'Check your connection and try again.',
        'permission-denied': 'This account is not the authorized super admin. Store accounts should use Store Admin Login.',
      };
      notice.textContent = messages[error.code] || 'Unable to sign in. Please try again.';
      notice.classList.add('show');
      submit.disabled = false;
    }
  });
})();
