(() => {
  const supabase = window.supabase.createClient(
    window.BERBER_SUPABASE_URL,
    window.BERBER_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
  const $ = (selector) => document.querySelector(selector);
  const loginView = $('#loginView');
  const dashboardView = $('#dashboardView');
  const logoutButton = $('#logoutButton');
  let currentAdmin = null;
  let currentBusinessSettings = null;
  let previewObjectUrl = null;

  function setNotice(target, message, success = false) {
    const box = $(target);
    box.textContent = message;
    box.classList.toggle('success', success);
    box.classList.add('show');
  }
  function hideNotice(target) { $(target).classList.remove('show', 'success'); }
  function money(value) { return `₺${Number(value).toLocaleString('tr-TR')}`; }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toLocaleUpperCase('tr-TR'); }
  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function showLogin(message = '') {
    loginView.hidden = false;
    dashboardView.hidden = true;
    logoutButton.hidden = true;
    if (message) setNotice('#loginNotice', message);
  }
  function showDashboard(user) {
    currentAdmin = user;
    loginView.hidden = true;
    dashboardView.hidden = false;
    logoutButton.hidden = false;
    $('#adminEmail').textContent = user.email || 'Yetkili yönetici';
    hideNotice('#loginNotice');
    loadDashboard();
  }
  function displayTimestamp(value) {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }
  function displayDate(value) {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`));
  }
  function applyBusinessIdentity(settings) {
    const name = String(settings.business_name || 'Berber Studio').trim() || 'Berber Studio';
    const logo = $('#businessLogo');
    const mark = $('#brandMark');
    $('#businessName').textContent = name;
    document.title = `${name} — Yönetim`;
    document.querySelector('.brand').setAttribute('aria-label', `${name} yönetim paneli`);
    if (settings.logo_url) {
      logo.src = settings.logo_url;
      logo.alt = `${name} logosu`;
      logo.hidden = false;
      mark.hidden = true;
      logo.onerror = () => { logo.hidden = true; mark.hidden = false; };
    } else {
      logo.removeAttribute('src');
      logo.hidden = true;
      mark.hidden = false;
    }
  }
  function setLogoPreview(url) {
    const preview = $('#logoPreview');
    const hint = $('#logoPreviewHint');
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = url?.startsWith('blob:') ? url : null;
    if (url) {
      preview.src = url;
      preview.hidden = false;
      hint.hidden = true;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
      hint.hidden = false;
    }
  }
  function businessLogoPath(url) {
    if (!url) return null;
    try {
      const pathname = new URL(url).pathname;
      const marker = '/storage/v1/object/public/business-branding/';
      const markerIndex = pathname.indexOf(marker);
      return markerIndex < 0 ? null : decodeURIComponent(pathname.slice(markerIndex + marker.length));
    } catch {
      return null;
    }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function renderAppointments(rows) {
    const box = $('#appointmentList');
    box.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const title = document.createElement('strong');
      title.textContent = 'Yaklaşan randevu yok';
      empty.append(title, document.createTextNode('Yeni randevular burada görünecek.'));
      box.append(empty);
      return;
    }
    rows.forEach((appointment) => {
      const card = document.createElement('article');
      card.className = 'appt';
      const info = document.createElement('div');
      info.className = 'appt-info';
      const serviceName = appointment.services?.name || 'Hizmet';
      const staffName = appointment.staff?.name || 'Berber';
      const statusLabel = appointment.status === 'completed' ? 'Tamamlandı' : appointment.status === 'cancelled' ? 'İptal edildi' : 'Onaylı';
      const details = appointment.note ? `${appointment.phone} · Not: ${appointment.note}` : appointment.phone;
      const title = document.createElement('div');
      title.className = 'appt-title';
      title.textContent = `${displayTimestamp(appointment.starts_at)} · ${statusLabel}`;
      const meta = document.createElement('div');
      meta.className = 'appt-meta';
      const clientName = document.createElement('strong');
      clientName.textContent = appointment.client_name;
      meta.append(
        clientName,
        document.createTextNode(` · ${serviceName} · ${staffName}`),
        document.createElement('br'),
        document.createTextNode(details || '')
      );
      info.append(title, meta);
      const price = document.createElement('div');
      price.className = 'appt-price';
      price.textContent = money(appointment.price);
      card.append(info, price);
      if (appointment.status === 'booked') {
        const actions = document.createElement('div');
        actions.className = 'appt-actions';
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'small-button';
        done.textContent = 'Tamamlandı';
        done.addEventListener('click', () => updateStatus(appointment.id, 'completed'));
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'small-button danger';
        cancel.textContent = 'İptal et';
        cancel.addEventListener('click', () => updateStatus(appointment.id, 'cancelled'));
        actions.append(done, cancel);
        info.append(actions);
      }
      box.append(card);
    });
  }
  function renderStaff(rows) {
    const box = $('#staffList');
    box.replaceChildren();
    if (!rows.length) {
      box.innerHTML = '<div class="empty">Henüz çalışan eklenmemiş.</div>';
      return;
    }
    rows.forEach((person) => {
      const card = document.createElement('article');
      card.className = 'management-item';
      const info = document.createElement('div');
      info.className = 'management-main';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = initials(person.name);
      const name = document.createElement('input');
      name.className = 'field staff-name-field';
      name.type = 'text';
      name.value = person.name;
      name.maxLength = 60;
      name.setAttribute('aria-label', `${person.name} çalışan adı`);
      info.append(avatar, name);
      const actions = document.createElement('div');
      actions.className = 'management-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'small-button';
      save.textContent = 'İsmi kaydet';
      save.addEventListener('click', () => updateStaffName(person.id, name, save));
      const active = document.createElement('button');
      active.type = 'button';
      active.className = `small-button${person.active ? ' danger' : ''}`;
      active.textContent = person.active ? 'Pasifleştir' : 'Aktifleştir';
      active.addEventListener('click', () => toggleStaff(person.id, !person.active, active));
      actions.append(save, active);
      const status = document.createElement('span');
      status.className = `staff-status${person.active ? ' is-active' : ''}`;
      status.textContent = person.active ? 'Aktif' : 'Pasif';
      card.append(info, status, actions);
      box.append(card);
    });
  }
  function renderServices(rows) {
    const box = $('#serviceList');
    box.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Henüz hizmet eklenmemiş.';
      box.append(empty);
      return;
    }
    rows.forEach((service) => {
      const card = document.createElement('article');
      card.className = 'management-item service-item';
      const fields = document.createElement('div');
      fields.className = 'service-edit-grid';
      const makeField = (labelText, type, value, options = {}) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'service-edit-field';
        const caption = document.createElement('span');
        caption.className = 'service-edit-label';
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.className = 'field';
        input.type = type;
        input.value = value ?? '';
        Object.entries(options).forEach(([key, optionValue]) => input.setAttribute(key, String(optionValue)));
        wrapper.append(caption, input);
        return { wrapper, input };
      };
      const name = makeField('Hizmet adı', 'text', service.name, { maxlength: 80 });
      const price = makeField('Ücret (₺)', 'number', service.price, { min: 0, max: 999999.99, step: 0.01, inputmode: 'decimal' });
      const duration = makeField('Süre (dk)', 'number', service.duration_minutes, { min: 15, max: 240, step: 15, inputmode: 'numeric' });
      const description = makeField('Açıklama', 'text', service.description, { maxlength: 120 });
      const icon = makeField('Simge', 'text', service.icon, { maxlength: 8 });
      fields.append(name.wrapper, price.wrapper, duration.wrapper, description.wrapper, icon.wrapper);
      const status = document.createElement('span');
      status.className = `staff-status${service.active ? ' is-active' : ''}`;
      status.textContent = service.active ? 'Aktif' : 'Pasif';
      const actions = document.createElement('div');
      actions.className = 'management-actions service-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'small-button';
      save.textContent = 'Değişiklikleri kaydet';
      save.addEventListener('click', () => updateService(service.id, { name: name.input, price: price.input, duration: duration.input, description: description.input, icon: icon.input }, save));
      const active = document.createElement('button');
      active.type = 'button';
      active.className = `small-button${service.active ? ' danger' : ''}`;
      active.textContent = service.active ? 'Pasifleştir' : 'Aktifleştir';
      active.addEventListener('click', () => toggleService(service.id, !service.active, active));
      actions.append(save, active);
      card.append(fields, status, actions);
      box.append(card);
    });
  }
  function renderClosures(rows) {
    const box = $('#closureList');
    box.replaceChildren();
    if (!rows.length) {
      box.innerHTML = '<div class="empty">Kapalı tarih eklenmemiş.</div>';
      return;
    }
    rows.forEach((closure) => {
      const card = document.createElement('article');
      card.className = 'management-item closure-item';
      const info = document.createElement('div');
      info.className = 'management-main closure-info';
      const date = document.createElement('strong');
      date.textContent = displayDate(closure.closed_on);
      const reason = document.createElement('span');
      reason.className = 'muted';
      reason.textContent = closure.reason || 'Açıklama yok';
      info.append(date, reason);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button danger';
      remove.textContent = 'Açık yap';
      remove.addEventListener('click', () => removeClosure(closure.closed_on, remove));
      card.append(info, remove);
      box.append(card);
    });
  }
  function showSaveError(error, fallback) {
    console.error(error);
    setNotice('#managementNotice', error?.message ? `Kaydedilemedi: ${error.message}` : fallback);
  }
  async function loadDashboard() {
    if (!currentAdmin) return;
    hideNotice('#dashboardNotice');
    hideNotice('#managementNotice');
    const now = new Date();
    const today = localDateString(now);
    const month = today.slice(0, 7);
    const startOfMonth = new Date(`${month}-01T00:00:00`).toISOString();
    const [appointmentsResult, staffResult, settingsResult, closuresResult, servicesResult] = await Promise.all([
      supabase.from('appointments').select('id,client_name,phone,note,starts_at,duration_minutes,price,status,staff(name),services(name)').gte('starts_at', startOfMonth).order('starts_at').limit(100),
      supabase.from('staff').select('id,name,active').order('created_at').limit(100),
      supabase.from('business_settings').select('opening_time,closing_time,open_days,business_name,logo_url').eq('id', 1).single(),
      supabase.from('business_closures').select('closed_on,reason').gte('closed_on', today).order('closed_on').limit(1000),
      supabase.from('services').select('id,name,description,price,duration_minutes,icon,active').order('name').limit(100)
    ]);
    if (appointmentsResult.error) {
      console.error(appointmentsResult.error);
      setNotice('#dashboardNotice', 'Randevular yüklenemedi. Oturum/yetki durumunu kontrol et ve tekrar dene.');
    } else {
      const appointments = appointmentsResult.data || [];
      const active = appointments.filter((item) => item.status !== 'cancelled');
      const todayCount = active.filter((item) => localDateString(new Date(item.starts_at)) === today).length;
      const monthRows = active.filter((item) => localDateString(new Date(item.starts_at)).slice(0, 7) === month);
      $('#todayCount').textContent = String(todayCount);
      $('#monthCount').textContent = String(monthRows.length);
      $('#monthRevenue').textContent = money(monthRows.reduce((sum, item) => sum + Number(item.price), 0));
      renderAppointments(appointments);
    }
    if (staffResult.error || settingsResult.error || closuresResult.error || servicesResult.error) {
      const error = staffResult.error || settingsResult.error || closuresResult.error || servicesResult.error;
      console.error(error);
      setNotice('#managementNotice', 'Ekip, hizmetler ve işletme ayarları yüklenemedi. Yetkiyi ve bağlantıyı kontrol et.');
      return;
    }
    const staff = staffResult.data || [];
    currentBusinessSettings = settingsResult.data;
    applyBusinessIdentity(currentBusinessSettings);
    $('#businessNameInput').value = currentBusinessSettings.business_name || 'Berber Studio';
    $('#businessLogoFile').value = '';
    $('#removeBusinessLogo').checked = false;
    setLogoPreview(currentBusinessSettings.logo_url || '');
    $('#staffCount').textContent = String(staff.filter((person) => person.active).length);
    renderStaff(staff);
    renderServices(servicesResult.data || []);
    renderClosures(closuresResult.data || []);
    $('#openingTime').value = String(settingsResult.data.opening_time).slice(0, 5);
    $('#closingTime').value = String(settingsResult.data.closing_time).slice(0, 5);
    const openDays = new Set((settingsResult.data.open_days || []).map(Number));
    document.querySelectorAll('#openDays input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = openDays.has(Number(checkbox.value));
    });
    $('#closureDate').min = today;
  }
  async function updateStatus(id, status) {
    const label = status === 'completed' ? 'tamamlandı' : 'iptal edildi';
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) {
      console.error(error);
      setNotice('#dashboardNotice', 'Durum kaydedilemedi. Yetkini ve bağlantını kontrol et.');
      return;
    }
    await loadDashboard();
    setNotice('#dashboardNotice', `Randevu ${label}.`, true);
  }
  async function updateStaffName(id, input, button) {
    const name = input.value.trim();
    if (!name || name.length > 60) {
      setNotice('#managementNotice', 'Çalışan adı 1–60 karakter olmalı.');
      return;
    }
    button.disabled = true;
    const { error } = await supabase.from('staff').update({ name }).eq('id', id);
    button.disabled = false;
    if (error) return showSaveError(error, 'Çalışan adı kaydedilemedi.');
    await loadDashboard();
    setNotice('#managementNotice', 'Çalışan adı güncellendi.', true);
  }
  function serviceDraft(fields) {
    const name = fields.name.value.trim();
    const description = fields.description.value.trim();
    const icon = fields.icon.value.trim() || '✂';
    const price = Number(fields.price.value);
    const duration = Number(fields.duration.value);
    if (!name || name.length > 80) {
      setNotice('#managementNotice', 'Hizmet adı 1–80 karakter olmalı.');
      return null;
    }
    if (description.length > 120 || icon.length > 8) {
      setNotice('#managementNotice', 'Açıklama en fazla 120, simge en fazla 8 karakter olabilir.');
      return null;
    }
    if (!fields.price.value.trim() || !Number.isFinite(price) || price < 0 || price > 999999.99 || Math.abs(price * 100 - Math.round(price * 100)) > 0.0000001) {
      setNotice('#managementNotice', 'Ücret 0–999.999,99 ₺ arasında ve en fazla iki ondalık basamaklı olmalı.');
      return null;
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 240 || duration % 15 !== 0) {
      setNotice('#managementNotice', 'Hizmet süresi 15–240 dakika arasında, 15 dakikanın katı olmalı.');
      return null;
    }
    return { name, description, price, duration_minutes: duration, icon };
  }
  async function updateService(id, fields, button) {
    const draft = serviceDraft(fields);
    if (!draft) return;
    button.disabled = true;
    const { error } = await supabase.from('services').update(draft).eq('id', id);
    button.disabled = false;
    if (error) return showSaveError(error, 'Hizmet güncellenemedi.');
    await loadDashboard();
    setNotice('#managementNotice', 'Hizmet bilgileri ve ücreti güncellendi. Yeni ücret gelecekteki randevulara uygulanır.', true);
  }
  async function toggleService(id, active, button) {
    button.disabled = true;
    const { error } = await supabase.from('services').update({ active }).eq('id', id);
    button.disabled = false;
    if (error) return showSaveError(error, 'Hizmet durumu güncellenemedi.');
    await loadDashboard();
    setNotice('#managementNotice', active ? 'Hizmet yeniden randevuya açıldı.' : 'Hizmet pasife alındı; geçmiş randevular korundu.', true);
  }
  async function toggleStaff(id, active, button) {
    button.disabled = true;
    const { error } = await supabase.from('staff').update({ active }).eq('id', id);
    button.disabled = false;
    if (error) return showSaveError(error, 'Çalışan durumu güncellenemedi.');
    await loadDashboard();
    setNotice('#managementNotice', active ? 'Çalışan yeniden randevuya açıldı.' : 'Çalışan pasife alındı.', true);
  }
  async function removeClosure(date, button) {
    button.disabled = true;
    const { error } = await supabase.from('business_closures').delete().eq('closed_on', date);
    button.disabled = false;
    if (error) return showSaveError(error, 'Kapalı tarih kaldırılamadı.');
    await loadDashboard();
    setNotice('#managementNotice', 'Tarih yeniden randevuya açıldı.', true);
  }

  $('#businessLogoFile').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type) || file.size > 2 * 1024 * 1024) {
      event.target.value = '';
      setLogoPreview(currentBusinessSettings?.logo_url || '');
      setNotice('#managementNotice', 'Logo PNG, JPG veya WebP olmalı ve 2 MB boyutunu aşmamalı.');
      return;
    }
    $('#removeBusinessLogo').checked = false;
    setLogoPreview(URL.createObjectURL(file));
  });

  $('#removeBusinessLogo').addEventListener('change', (event) => {
    if (event.target.checked) {
      $('#businessLogoFile').value = '';
      setLogoPreview('');
    } else {
      setLogoPreview(currentBusinessSettings?.logo_url || '');
    }
  });

  $('#identityForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#managementNotice');
    const name = $('#businessNameInput').value.trim();
    const file = $('#businessLogoFile').files?.[0] || null;
    const removeLogo = $('#removeBusinessLogo').checked && !file;
    if (!name || name.length > 80) {
      setNotice('#managementNotice', 'İşletme adı 1–80 karakter olmalı.');
      return;
    }
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      setNotice('#managementNotice', 'Logo PNG, JPG veya WebP olmalı ve 2 MB boyutunu aşmamalı.');
      return;
    }

    const button = $('#saveIdentityButton');
    button.disabled = true;
    button.textContent = 'Kaydediliyor…';
    let uploadedPath = null;
    let logoUrl = currentBusinessSettings?.logo_url || null;
    try {
      if (file) {
        const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
        uploadedPath = `logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('business-branding').upload(uploadedPath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false
        });
        if (uploadError) return showSaveError(uploadError, 'Logo yüklenemedi. Bağlantıyı kontrol edip tekrar dene.');
        logoUrl = supabase.storage.from('business-branding').getPublicUrl(uploadedPath).data.publicUrl;
      } else if (removeLogo) {
        logoUrl = null;
      }

      const { error } = await supabase.from('business_settings').update({ business_name: name, logo_url: logoUrl }).eq('id', 1);
      if (error) {
        if (uploadedPath) await supabase.storage.from('business-branding').remove([uploadedPath]);
        return showSaveError(error, 'İşletme bilgileri kaydedilemedi.');
      }

      const previousPath = businessLogoPath(currentBusinessSettings?.logo_url);
      if (previousPath && previousPath !== uploadedPath && (file || removeLogo)) {
        const { error: cleanupError } = await supabase.storage.from('business-branding').remove([previousPath]);
        if (cleanupError) console.warn('Eski logo temizlenemedi.', cleanupError);
      }
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('business-branding').remove([uploadedPath]);
      return showSaveError(error, 'İşletme bilgileri kaydedilemedi.');
    } finally {
      button.disabled = false;
      button.textContent = 'İşletme kimliğini kaydet';
    }
    await loadDashboard();
    setNotice('#managementNotice', 'İşletme adı ve logosu güncellendi.', true);
  });

  $('#hoursForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#managementNotice');
    const openingTime = $('#openingTime').value;
    const closingTime = $('#closingTime').value;
    const openDays = [...document.querySelectorAll('#openDays input[type="checkbox"]:checked')].map((checkbox) => Number(checkbox.value));
    if (!openingTime || !closingTime || openingTime >= closingTime) {
      setNotice('#managementNotice', 'Kapanış saati açılış saatinden sonra olmalı.');
      return;
    }
    if (!openDays.length) {
      setNotice('#managementNotice', 'En az bir açık gün seçmelisin.');
      return;
    }
    const button = $('#saveHoursButton');
    button.disabled = true;
    const { error } = await supabase.from('business_settings').update({ opening_time: openingTime, closing_time: closingTime, open_days: openDays }).eq('id', 1);
    button.disabled = false;
    if (error) return showSaveError(error, 'Çalışma düzeni kaydedilemedi.');
    await loadDashboard();
    setNotice('#managementNotice', 'Çalışma saatleri ve açık günler güncellendi.', true);
  });

  $('#staffForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#managementNotice');
    const name = $('#newStaffName').value.trim();
    if (!name || name.length > 60) {
      setNotice('#managementNotice', 'Çalışan adı 1–60 karakter olmalı.');
      return;
    }
    const button = $('#addStaffButton');
    button.disabled = true;
    const { error } = await supabase.from('staff').insert({ name, active: true });
    button.disabled = false;
    if (error) return showSaveError(error, 'Çalışan eklenemedi.');
    $('#newStaffName').value = '';
    await loadDashboard();
    setNotice('#managementNotice', 'Yeni çalışan eklendi.', true);
  });

  $('#serviceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#managementNotice');
    const fields = {
      name: $('#newServiceName'),
      description: $('#newServiceDescription'),
      price: $('#newServicePrice'),
      duration: $('#newServiceDuration'),
      icon: $('#newServiceIcon')
    };
    const draft = serviceDraft(fields);
    if (!draft) return;
    const button = $('#addServiceButton');
    button.disabled = true;
    const id = `srv-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const { error } = await supabase.from('services').insert({ id, ...draft, active: true });
    button.disabled = false;
    if (error) return showSaveError(error, 'Hizmet eklenemedi. Yetkiyi ve bağlantıyı kontrol et.');
    $('#newServiceName').value = '';
    $('#newServiceDescription').value = '';
    $('#newServicePrice').value = '';
    $('#newServiceDuration').value = '30';
    $('#newServiceIcon').value = '✂';
    await loadDashboard();
    setNotice('#managementNotice', 'Yeni hizmet eklendi ve randevuya açıldı.', true);
  });

  $('#closureForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#managementNotice');
    const closedOn = $('#closureDate').value;
    if (!closedOn) {
      setNotice('#managementNotice', 'Lütfen kapatılacak tarihi seç.');
      return;
    }
    const button = $('#addClosureButton');
    button.disabled = true;
    const { error } = await supabase.from('business_closures').insert({ closed_on: closedOn, reason: $('#closureReason').value.trim() });
    button.disabled = false;
    if (error) return showSaveError(error, 'Kapalı tarih eklenemedi. Aynı tarih zaten eklenmiş olabilir.');
    $('#closureDate').value = '';
    $('#closureReason').value = '';
    await loadDashboard();
    setNotice('#managementNotice', 'Seçilen tarih kapalı olarak kaydedildi.', true);
  });

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice('#loginNotice');
    const button = $('#loginButton');
    button.disabled = true;
    button.textContent = 'Giriş yapılıyor…';
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $('#email').value.trim(),
      password: $('#password').value
    });
    button.disabled = false;
    button.textContent = 'Giriş yap';
    if (error) {
      setNotice('#loginNotice', 'Giriş başarısız. E-posta/şifreyi ve Supabase kullanıcı hesabını kontrol et.');
      return;
    }
    if (data.user?.app_metadata?.role !== 'admin') {
      await supabase.auth.signOut();
      showLogin('Bu hesapta yönetici yetkisi yok. Supabase Auth kullanıcısına admin rolü atanmalı.');
      return;
    }
    showDashboard(data.user);
  });

  logoutButton.addEventListener('click', async () => {
    await supabase.auth.signOut();
    currentAdmin = null;
    showLogin('Oturum kapatıldı.');
  });
  $('#refreshButton').addEventListener('click', loadDashboard);

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user;
    if (user?.app_metadata?.role === 'admin') showDashboard(user);
    else if (user) {
      supabase.auth.signOut().then(() => showLogin('Bu hesapta yönetici yetkisi yok.'));
    } else showLogin();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      currentAdmin = null;
      showLogin();
    }
  });
})();
