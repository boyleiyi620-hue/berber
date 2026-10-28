(() => {
  const supabase = window.supabase.createClient(
    window.BERBER_SUPABASE_URL,
    window.BERBER_SUPABASE_PUBLISHABLE_KEY
  );
  const $ = (selector) => document.querySelector(selector);
  const state = { services: [], staff: [], settings: null, closedDates: new Map(), serviceId: null, staffId: null, time: null, busy: false, requestId: 0 };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toLocaleUpperCase('tr-TR'); }
  function showNotice(message, success = false) {
    const box = $('#pageNotice');
    box.textContent = message;
    box.classList.toggle('success', success);
    box.classList.add('show');
  }
  function clearNotice() { $('#pageNotice').classList.remove('show', 'success'); }
  function showError(error, fallback) {
    console.error(error);
    const message = String(error?.message || '');
    showNotice(message && !/fetch|network|failed/i.test(message) ? message : fallback);
  }
  function money(value) { return `₺${Number(value).toLocaleString('tr-TR')}`; }
  function applyBusinessIdentity(settings) {
    const name = String(settings.business_name || 'Berber Studio').trim() || 'Berber Studio';
    const nameElement = $('#businessName');
    const logo = $('#businessLogo');
    const mark = $('#brandMark');
    nameElement.textContent = name;
    document.title = `${name} — Randevu al`;
    document.querySelector('.brand').setAttribute('aria-label', `${name} ana sayfa`);
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
  function minutes(time) { const [hours, mins] = String(time).slice(0, 5).split(':').map(Number); return hours * 60 + mins; }
  function weekdayIso(dateValue) {
    const [year, month, day] = dateValue.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    return dayOfWeek === 0 ? 7 : dayOfWeek;
  }
  function slotInstant(dateValue, time) {
    const [year, month, day] = dateValue.split('-').map(Number);
    const [hours, mins] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hours, mins, 0, 0);
  }

  function renderServices() {
    const box = $('#serviceList');
    box.replaceChildren();
    state.services.forEach((service) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `service${service.id === state.serviceId ? ' selected' : ''}`;
      button.innerHTML = `<span class="service-icon">${escapeHtml(service.icon || '✂')}</span><span class="service-info"><span class="service-name">${escapeHtml(service.name)}</span><span class="service-meta">${escapeHtml(service.description || `${service.duration_minutes} dakika`)}</span></span><span class="service-price">${money(service.price)}</span><span class="check"></span>`;
      button.addEventListener('click', () => {
        state.serviceId = service.id;
        state.time = null;
        renderServices();
        renderSlots();
      });
      box.append(button);
    });
  }

  function renderStaff() {
    const box = $('#staffPicker');
    box.replaceChildren();
    state.staff.forEach((person) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `person${person.id === state.staffId ? ' selected' : ''}`;
      button.innerHTML = `<span class="avatar">${escapeHtml(initials(person.name))}</span><span>${escapeHtml(person.name)}</span>`;
      button.addEventListener('click', () => {
        state.staffId = person.id;
        state.time = null;
        renderStaff();
        renderSlots();
      });
      box.append(button);
    });
  }

  async function renderSlots() {
    const box = $('#slotGrid');
    const dateValue = $('#bookingDate').value;
    const service = state.services.find((item) => item.id === state.serviceId);
    const staffId = state.staffId;
    const requestId = ++state.requestId;
    state.time = null;
    $('#bookButton').disabled = true;
    box.replaceChildren();
    if (!dateValue || !service || !staffId || !state.settings) return;
    if (state.closedDates.has(dateValue)) {
      $('#slotHint').textContent = '';
      const reason = state.closedDates.get(dateValue);
      const message = reason ? `Bu tarihte işletme kapalı: ${reason}` : 'Bu tarihte işletme kapalı. Lütfen başka bir gün seç.';
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.style.gridColumn = '1 / -1';
      hint.textContent = message;
      box.append(hint);
      return;
    }
    if (!state.settings.open_days.includes(weekdayIso(dateValue))) {
      $('#slotHint').textContent = '';
      box.innerHTML = '<div class="hint" style="grid-column:1/-1">Bu gün işletme kapalı. Lütfen açık bir gün seç.</div>';
      return;
    }
    const { data: busySlots, error } = await supabase.rpc('get_busy_slots', {
      p_date: dateValue,
      p_staff_id: staffId,
      p_timezone: timezone
    });
    if (requestId !== state.requestId) return;
    if (error) {
      showError(error, 'Müsait saatler yüklenemedi. Lütfen bağlantını kontrol edip tekrar dene.');
      box.innerHTML = '<div class="hint" style="grid-column:1/-1">Saatler şu anda yüklenemiyor.</div>';
      return;
    }
    const start = minutes(state.settings.opening_time);
    const close = minutes(state.settings.closing_time);
    const duration = Number(service.duration_minutes);
    const intervals = [];
    for (let value = start; value + duration <= close; value += 30) {
      const time = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      const candidateStart = value;
      const candidateEnd = value + duration;
      const overlapping = (busySlots || []).some((slot) => {
        const busyStart = minutes(slot.start_time);
        return candidateStart < busyStart + Number(slot.duration_minutes) && candidateEnd > busyStart;
      });
      const inPast = slotInstant(dateValue, time) <= new Date();
      intervals.push({ time, unavailable: overlapping || inPast });
    }
    const availableCount = intervals.filter((slot) => !slot.unavailable).length;
    $('#slotHint').textContent = availableCount ? `· ${availableCount} saat uygun` : '· uygun saat yok';
    if (!intervals.length) {
      box.innerHTML = '<div class="hint" style="grid-column:1/-1">Bu hizmet için uygun çalışma saati yok.</div>';
      return;
    }
    intervals.forEach(({ time, unavailable }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.textContent = time;
      button.disabled = unavailable;
      if (!unavailable) button.addEventListener('click', () => {
        state.time = time;
        box.querySelectorAll('.slot').forEach((slot) => slot.classList.toggle('selected', slot === button));
        $('#bookButton').disabled = false;
      });
      box.append(button);
    });
  }

  async function loadPage() {
    const date = $('#bookingDate');
    date.min = localDateString();
    date.value = localDateString();
    const [servicesResult, staffResult, settingsResult, closuresResult] = await Promise.all([
      supabase.from('services').select('id,name,description,price,duration_minutes,icon').eq('active', true).order('price'),
      supabase.from('staff').select('id,name').eq('active', true).order('name'),
      supabase.from('business_settings').select('opening_time,closing_time,open_days,business_name,logo_url').eq('id', 1).single(),
      supabase.from('business_closures').select('closed_on,reason').gte('closed_on', localDateString()).order('closed_on').limit(1000)
    ]);
    if (servicesResult.error || staffResult.error || settingsResult.error || closuresResult.error) {
      const error = servicesResult.error || staffResult.error || settingsResult.error || closuresResult.error;
      showError(error, 'Randevu bilgileri şu anda alınamıyor. Lütfen daha sonra tekrar dene.');
      return;
    }
    state.services = servicesResult.data || [];
    state.staff = staffResult.data || [];
    state.settings = settingsResult.data;
    applyBusinessIdentity(state.settings);
    state.closedDates = new Map((closuresResult.data || []).map((closure) => [closure.closed_on, closure.reason || '']));
    if (!state.services.length || !state.staff.length) {
      showNotice('Şu anda randevu alınabilecek hizmet veya berber bulunmuyor.');
      return;
    }
    state.serviceId = state.services[0].id;
    state.staffId = state.staff[0].id;
    $('#openStatus').textContent = 'Randevuya açık';
    renderServices();
    renderStaff();
    await renderSlots();
  }

  $('#bookingDate').addEventListener('change', () => { state.time = null; renderSlots(); });
  $('#bookButton').addEventListener('click', async () => {
    clearNotice();
    const clientName = $('#clientName').value.trim();
    const phone = $('#clientPhone').value.trim();
    const note = $('#clientNote').value.trim();
    const dateValue = $('#bookingDate').value;
    if (!clientName) return showNotice('Lütfen adını yaz.');
    if (phone.length < 5) return showNotice('Lütfen geçerli bir telefon numarası yaz.');
    if (!state.time) return showNotice('Lütfen müsait saatlerden birini seç.');
    if (state.busy) return;
    state.busy = true;
    const button = $('#bookButton');
    button.disabled = true;
    button.textContent = 'Randevu kaydediliyor…';
    const startsAt = slotInstant(dateValue, state.time).toISOString();
    const { error } = await supabase.rpc('create_booking', {
      p_client_name: clientName,
      p_phone: phone,
      p_note: note,
      p_service_id: state.serviceId,
      p_staff_id: state.staffId,
      p_starts_at: startsAt,
      p_timezone: timezone
    });
    state.busy = false;
    button.textContent = 'Randevuyu onayla';
    if (error) {
      showError(error, 'Randevu kaydedilemedi. Lütfen tekrar dene.');
      await renderSlots();
      return;
    }
    $('#clientName').value = '';
    $('#clientPhone').value = '';
    $('#clientNote').value = '';
    state.time = null;
    showNotice('Randevun oluşturuldu. Teşekkürler!', true);
    await renderSlots();
  });

  loadPage().catch((error) => showError(error, 'Sayfa yüklenemedi. Lütfen bağlantını kontrol et.'));
})();
