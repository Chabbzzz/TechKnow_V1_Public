/* Account confirmation UI. The caller supplies the authorized server operation. */
(() => {
  const dialog = document.getElementById('platform-account-modal');
  const form = document.getElementById('account-action-form');
  const title = document.getElementById('account-modal-title');
  const description = document.getElementById('account-modal-description');
  const icon = document.getElementById('account-modal-icon');
  const name = document.getElementById('account-modal-name');
  const email = document.getElementById('account-modal-email');
  const fields = document.getElementById('account-modal-fields');
  const reason = document.getElementById('account-modal-reason');
  const error = document.getElementById('account-modal-error');
  const status = document.getElementById('account-modal-status');
  const submit = document.getElementById('account-modal-submit');
  const cancel = document.getElementById('account-modal-cancel');
  const close = document.getElementById('account-modal-close');
  const done = document.getElementById('account-modal-done');
  let action = null;
  let busy = false;
  let completed = false;

  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    [submit, cancel, close, reason].forEach(control => { control.disabled = value; });
  }

  function dismiss() {
    if (!busy && dialog.open) dialog.close();
  }

  window.openPlatformAccountModal = options => {
    if (dialog.open || busy) return;
    action = options;
    completed = false;
    form.reset();
    setBusy(false);
    const suspending = options.action === 'Suspend';
    title.textContent = suspending ? 'Suspend account?' : 'Restore account?';
    description.textContent = suspending
      ? (options.isStore ? 'Disable sign-in for this store admin and suspend their shop.' : 'Disable sign-in for this account. You can restore it later.')
      : 'Return this account and its shop, if any, to their previous status. Other existing restrictions will remain.';
    name.textContent = options.name;
    email.textContent = options.email || '';
    email.hidden = !options.email;
    icon.className = `account-modal-icon ${suspending ? 'is-danger' : 'is-restore'}`;
    icon.innerHTML = `<i class="fa ${suspending ? 'fa-user-lock' : 'fa-user-check'}" aria-hidden="true"></i>`;
    fields.hidden = false;
    error.hidden = true;
    error.textContent = '';
    status.textContent = '';
    reason.removeAttribute('aria-invalid');
    cancel.hidden = false;
    submit.hidden = false;
    done.hidden = true;
    submit.textContent = suspending ? 'Suspend account' : 'Restore account';
    submit.className = `btn ${suspending ? 'btn-danger' : 'btn-primary'}`;
    document.body.classList.add('account-modal-open');
    dialog.showModal();
    reason.focus();
  };

  [cancel, close, done].forEach(button => button.addEventListener('click', dismiss));
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  });
  dialog.addEventListener('close', () => {
    const previousAction = action;
    action = null;
    document.body.classList.remove('account-modal-open');
    previousAction?.restoreFocus?.();
  });
  reason.addEventListener('input', () => {
    reason.removeAttribute('aria-invalid');
    error.hidden = true;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!action || busy || completed) return;
    const explanation = reason.value.trim();
    if (!explanation || reason.value.length > 1000) {
      error.textContent = 'Enter a reason between 1 and 1,000 characters.';
      error.hidden = false;
      reason.setAttribute('aria-invalid', 'true');
      reason.focus();
      return;
    }
    const suspending = action.action === 'Suspend';
    setBusy(true);
    error.hidden = true;
    submit.textContent = suspending ? 'Suspending…' : 'Restoring…';
    status.textContent = 'Saving the account action…';
    try {
      await action.onConfirm(explanation);
      completed = true;
      title.textContent = suspending ? 'Account suspended' : 'Account restored';
      description.textContent = suspending
        ? 'Sign-in has been disabled for this account.'
        : 'The suspension has been removed and the previous account status restored.';
      icon.className = 'account-modal-icon is-success';
      icon.innerHTML = '<i class="fa fa-check" aria-hidden="true"></i>';
      fields.hidden = true;
      cancel.hidden = true;
      submit.hidden = true;
      done.hidden = false;
      status.textContent = 'The action and your reason have been saved in the audit trail.';
      done.focus();
    } catch (failure) {
      error.textContent = failure.message || 'The action could not be completed. Please try again.';
      error.hidden = false;
      status.textContent = '';
      submit.textContent = suspending ? 'Suspend account' : 'Restore account';
    } finally {
      setBusy(false);
    }
  });
})();
