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
  function renderAppointments(rows) {
    const box = $('#appointmentList');
    box.replaceChildren();
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><strong>Yaklaşan randevu yok</strong>Yeni randevular burada görünecek.</div>';
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
      info.innerHTML = `<div class="appt-title">${displayTimestamp(appointment.starts_at)} · ${statusLabel}</div><div class="appt-meta"><strong>${escapeHtml(appointment.client_name)}</strong> · ${escapeHtml(serviceName)} · ${escapeHtml(staffName)}<br>${escapeHtml(details || '')}</div>`;
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
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  async function loadDashboard() {
    if (!currentAdmin) return;
    hideNotice('#dashboardNotice');
    const now = new Date();
    const today = localDateString(now);
    const month = today.slice(0, 7);
    const startOfMonth = new Date(`${month}-01T00:00:00`).toISOString();
    const [appointmentsResult, staffResult] = await Promise.all([
      supabase.from('appointments').select('id,client_name,phone,note,starts_at,duration_minutes,price,status,staff(name),services(name)').gte('starts_at', startOfMonth).order('starts_at').limit(100),
      supabase.from('staff').select('id').eq('active', true)
    ]);
    if (appointmentsResult.error || staffResult.error) {
      const error = appointmentsResult.error || staffResult.error;
      console.error(error);
      setNotice('#dashboardNotice', 'Randevular yüklenemedi. Oturum/yetki durumunu kontrol et ve tekrar dene.');
      return;
    }
    const appointments = appointmentsResult.data || [];
    const active = appointments.filter((item) => item.status !== 'cancelled');
    const todayCount = active.filter((item) => localDateString(new Date(item.starts_at)) === today).length;
    const monthRows = active.filter((item) => localDateString(new Date(item.starts_at)).slice(0, 7) === month);
    $('#todayCount').textContent = String(todayCount);
    $('#monthCount').textContent = String(monthRows.length);
    $('#monthRevenue').textContent = money(monthRows.reduce((sum, item) => sum + Number(item.price), 0));
    $('#staffCount').textContent = String((staffResult.data || []).length);
    renderAppointments(appointments);
  }
  async function updateStatus(id, status) {
    const label = status === 'completed' ? 'tamamlandı' : 'iptal edildi';
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) {
      console.error(error);
      setNotice('#dashboardNotice', 'Durum kaydedilemedi. Yetkini ve bağlantını kontrol et.');
      return;
    }
    setNotice('#dashboardNotice', `Randevu ${label}.`, true);
    await loadDashboard();
  }

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
