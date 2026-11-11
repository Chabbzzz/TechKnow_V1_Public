/* Store permit form and history use the same submissions as the superadmin inbox. */
window.mountStorePermits = function ({ runtime, session, subscribe, escapeHTML: escape }) {
  const { createPermitService, submissionStatus, submissionTime } = window.techKnowPermits;
  const service = createPermitService(runtime);
  const element = id => document.getElementById(id);
  const labels = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', uploading: 'Uploading', upload_failed: 'Upload failed' };
  let permits = [];
  let filter = 'all';
  let submitting = false;
  let loaded = false;
  let loadError = false;
  let selectedId = null;
  const notify = (message, failed = false) => window.showToast(failed ? 'danger' : 'info', failed ? 'fa-triangle-exclamation' : 'fa-file-shield', failed ? 'Permit unavailable' : 'Permit submission', message);
  const date = p => submissionTime(p) ? new Date(submissionTime(p)).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'Not yet submitted';
  function render() {
    element('pstat-total').textContent = permits.length;
    element('pstat-real').textContent = permits.filter(p => submissionStatus(p) === 'approved').length;
    element('pstat-fake').textContent = permits.filter(p => submissionStatus(p) === 'rejected').length;
    element('pstat-pending').textContent = permits.filter(p => submissionStatus(p) === 'pending').length;
    const list = permits.filter(p => filter === 'all' || submissionStatus(p) === filter);
    const empty = loadError ? 'Permit history could not load. Reload to try again.' : !loaded ? 'Loading permit submissions...' : 'No permit submissions in this category.';
    element('permit-grid').innerHTML = !loaded || loadError || !list.length ? `<p style="grid-column:1/-1;padding:24px">${empty}</p>` : list.map(p => {
      const status = submissionStatus(p);
      const tone = status === 'approved' ? 'success' : ['rejected', 'upload_failed'].includes(status) ? 'danger' : 'warning';
      return `<article class="permit-card"><div class="permit-card-header"><strong>${escape(p.permitType || 'Store verification')}</strong><span class="badge badge-${tone}">${escape(labels[status] || status)}</span></div><div class="permit-card-body"><p>${escape(p.permitNumber || p.id)}</p><p>${escape(p.issuingAuthority || '')}</p><p>${Array.isArray(p.documents) ? p.documents.length : 0} document(s)</p><small>${escape(date(p))}</small><div style="margin-top:12px"><button type="button" class="btn btn-outline btn-sm" data-store-permit-id="${escape(p.id)}">View details</button></div></div></article>`;
    }).join('');
  }
  window.openPermitForm = () => {
    if (submitting) return notify('Please wait for the current upload to finish.');
    ['permit-type','permit-number','permit-authority','permit-date-issued','permit-expiry','permit-business'].forEach(id => { element(id).value = ''; });
    window.clearPermitFile();
    window.openModal('modal-submit-permit');
  };
  window.clearPermitFile = () => {
    if (submitting) return;
    element('permit-file').value = '';
    element('permit-file-preview').style.display = 'none';
  };
  window.permitFileSelected = event => {
    const file = event.target.files[0];
    if (!file) return;
    element('permit-file-name').textContent = file.name;
    element('permit-file-preview').style.display = 'flex';
  };
  window.switchPermitTab = button => {
    filter = button.dataset.ptab;
    document.querySelectorAll('.permit-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    render();
  };
  window.submitPermit = async () => {
    if (submitting) return;
    const details = Object.fromEntries(Object.entries({ permitType:'permit-type', permitNumber:'permit-number', issuingAuthority:'permit-authority', issuedOn:'permit-date-issued', expiresOn:'permit-expiry', businessName:'permit-business' }).map(([key,id]) => [key,element(id).value.trim()]));
    const files = Array.from(element('permit-file').files || []);
    if (!details.permitType || !details.permitNumber || !details.issuingAuthority || !files.length) return notify('Enter the permit type, number, issuing authority, and select a document.', true);
    submitting = true;
    const button = element('permit-submit-button');
    button.disabled = true;
    button.textContent = 'Uploading document...';
    try {
      await service.submit({ files, details });
      window.closeModal('modal-submit-permit');
      notify('Your permit was sent to the superadmin and is pending review.');
    } catch (error) { notify(error.message || 'The document could not be submitted. Please try again.', true); }
    finally { submitting = false; button.disabled = false; button.textContent = 'Submit for Verification'; }
  };
  function viewPermit(id) {
    const p = permits.find(p => p.id === id);
    if (!p) { selectedId = null; window.closeModal('modal-permit-detail'); return; }
    selectedId = id;
    const values = { 'pdetail-title':p.permitType || 'Store verification', 'pd-type':p.permitType || 'Store verification', 'pd-number':p.permitNumber, 'pd-authority':p.issuingAuthority, 'pd-issued':p.issuedOn, 'pd-expiry':p.expiresOn, 'pd-submitted':date(p) };
    Object.entries(values).forEach(([id,value]) => { element(id).textContent = value || 'Not provided'; });
    element('pdetail-result-banner').textContent = labels[submissionStatus(p)] || submissionStatus(p);
    const documents = Array.isArray(p.documents) ? p.documents : [];
    element('pd-documents').innerHTML = documents.map((file,index) => `<p><button type="button" class="btn btn-outline btn-sm" data-store-permit-document="${index}">${escape(file.fileName || `Document ${index+1}`)}</button></p>`).join('') || 'No documents uploaded yet.';
    window.openModal('modal-permit-detail');
  }
  element('permit-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-store-permit-id]');
    if (button) viewPermit(button.dataset.storePermitId);
  });
  element('pd-documents').addEventListener('click', async event => {
    const button = event.target.closest('[data-store-permit-document]');
    const permit = permits.find(p => p.id === selectedId);
    if (!button || !permit) return;
    const tab = window.open('', '_blank');
    if (!tab) return notify('Allow pop-ups for this site to open the document.', true);
    tab.opener = null;
    try { tab.location.replace(await service.documentURL(permit, Number(button.dataset.storePermitDocument))); }
    catch (error) { tab.close(); notify(error.message, true); }
  });
  element('new-permit-button').disabled = false;
  document.querySelectorAll('.permit-tab').forEach(button => { button.disabled = false; });
  subscribe(runtime.db.collection('permitSubmissions').where('storeId', '==', session.storeId), snapshot => {
    permits = snapshot.docs.map(doc => ({ ...doc.data(), id:doc.id })).sort((a,b) => submissionTime(b)-submissionTime(a));
    loaded = true;
    loadError = false;
    render();
    if (selectedId && element('modal-permit-detail').classList.contains('open')) viewPermit(selectedId);
  }, error => { loadError = true; render(); notify(error.message, true); });
};
