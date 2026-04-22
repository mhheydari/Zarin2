// ===== GOLDTRADER PLATFORM - Main Application =====
'use strict';

// ===== API CONFIGURATION =====
const API_BASE = '/api';
let authToken = localStorage.getItem('auth_token');
let currentUser = null;
let currentAssets = [];
let currentPrices = [];
let selectedAsset = null;
let tradeType = 'buy';
let tradeMode = 'quantity';
let walletData = null;
let priceRefreshInterval = null;

// ===== UTILITY FUNCTIONS =====
function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '---';
  return parseFloat(n).toLocaleString('fa-IR');
}

function formatPrice(n) {
  if (n === null || n === undefined || isNaN(n)) return '---';
  return parseFloat(n).toLocaleString('fa-IR') + ' ریال';
}

function formatDate(dateStr) {
  if (!dateStr) return '---';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

function toPersianDigits(str) {
  if (!str) return '';
  return str.toString().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

// ===== API REQUEST HELPER =====
async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(API_BASE + endpoint, options);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('API Error:', err);
    return { ok: false, data: { message: 'خطای شبکه. لطفاً دوباره تلاش کنید.' } };
  }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== MODAL =====
function showModal(title, body, footer = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

// ===== AUTH FUNCTIONS =====
function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('auth-otp').style.display = tab === 'otp' ? 'block' : 'none';
  document.getElementById('auth-password').style.display = tab === 'password' ? 'block' : 'none';
  clearAuthMessage();
}

function showAuthMessage(message, type = 'error') {
  const el = document.getElementById('auth-message');
  el.textContent = message;
  el.className = `auth-message ${type}`;
  el.style.display = 'block';
}
function clearAuthMessage() {
  document.getElementById('auth-message').style.display = 'none';
}

async function sendOTP() {
  const phone = document.getElementById('otp-phone').value.trim();
  if (!/^09\d{9}$/.test(phone)) {
    showAuthMessage('شماره موبایل باید با 09 شروع شده و ۱۱ رقم باشد');
    return;
  }
  clearAuthMessage();
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await apiRequest('/auth/send-otp', 'POST', {
    phone,
    referral_code: document.getElementById('otp-referral').value.trim() || null
  });

  btn.disabled = false;
  btn.innerHTML = '<span>ارسال کد تأیید</span><i class="fas fa-arrow-left"></i>';

  if (res.ok) {
    document.getElementById('otp-phone-display').textContent = phone;
    document.getElementById('otp-step1').style.display = 'none';
    document.getElementById('otp-step2').style.display = 'block';
    document.querySelectorAll('.otp-digit')[0].focus();
    showAuthMessage(`کد تأیید ارسال شد${res.data.otp ? ' (کد توسعه: ' + res.data.otp + ')' : ''}`, 'success');
  } else {
    showAuthMessage(res.data.message || 'خطا در ارسال کد');
  }
}

function moveOTP(input, index) {
  const digits = document.querySelectorAll('.otp-digit');
  input.value = input.value.replace(/\D/g, '');
  if (input.value && index < 6) digits[index].focus();
  if (input.value.length > 1) input.value = input.value[0];
}

function backToStep1() {
  document.getElementById('otp-step1').style.display = 'block';
  document.getElementById('otp-step2').style.display = 'none';
  document.querySelectorAll('.otp-digit').forEach(d => d.value = '');
  clearAuthMessage();
}

async function verifyOTP() {
  const phone = document.getElementById('otp-phone').value.trim();
  const digits = document.querySelectorAll('.otp-digit');
  const otp = Array.from(digits).map(d => d.value).join('');

  if (otp.length !== 6) {
    showAuthMessage('کد ۶ رقمی را کامل وارد کنید');
    return;
  }

  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await apiRequest('/auth/verify-otp', 'POST', {
    phone, otp,
    referral_code: document.getElementById('otp-referral').value.trim() || null
  });

  btn.disabled = false;
  btn.innerHTML = '<span>تأیید و ورود</span><i class="fas fa-check"></i>';

  if (res.ok && res.data.token) {
    authToken = res.data.token;
    localStorage.setItem('auth_token', authToken);
    currentUser = res.data.user;
    initApp();
  } else {
    showAuthMessage(res.data.message || 'خطا در تأیید کد');
  }
}

async function loginWithPassword() {
  const phone = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;

  if (!phone || !password) {
    showAuthMessage('شماره موبایل و رمز عبور را وارد کنید');
    return;
  }

  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await apiRequest('/auth/login', 'POST', { phone, password });

  btn.disabled = false;
  btn.innerHTML = '<span>ورود</span><i class="fas fa-sign-in-alt"></i>';

  if (res.ok && res.data.token) {
    authToken = res.data.token;
    localStorage.setItem('auth_token', authToken);
    currentUser = res.data.user;
    initApp();
  } else {
    showAuthMessage(res.data.message || 'اطلاعات ورود اشتباه است');
  }
}

function togglePassword(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function logout() {
  if (!confirm('آیا از خروج اطمینان دارید؟')) return;
  authToken = null;
  currentUser = null;
  localStorage.removeItem('auth_token');
  if (priceRefreshInterval) clearInterval(priceRefreshInterval);
  showAuthPage();
}

// ===== APP INITIALIZATION =====
async function initApp() {
  const meRes = await apiRequest('/auth/me');
  if (!meRes.ok) {
    authToken = null;
    localStorage.removeItem('auth_token');
    showAuthPage();
    return;
  }
  currentUser = meRes.data.user;
  showAppPage();
}

function showAuthPage() {
  document.getElementById('page-auth').style.display = 'block';
  document.getElementById('page-app').style.display = 'none';
}

function showAppPage() {
  document.getElementById('page-auth').style.display = 'none';
  document.getElementById('page-app').style.display = 'flex';

  // Update sidebar user info
  document.getElementById('sidebar-user-name').textContent = currentUser.full_name || 'کاربر';
  document.getElementById('sidebar-user-phone').textContent = currentUser.phone;

  // Show admin nav if admin
  if (currentUser.is_admin) {
    document.getElementById('admin-nav-item').style.display = 'block';
  }

  // Load initial data
  loadPrices();
  loadNotificationCount();
  showSection('trade');

  // Start price refresh
  priceRefreshInterval = setInterval(() => {
    loadPrices();
    loadNotificationCount();
  }, 30000);
}

// ===== NAVIGATION =====
function showSection(section) {
  // Hide all sections
  document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show selected section
  const sectionEl = document.getElementById(`section-${section}`);
  if (sectionEl) sectionEl.style.display = 'block';

  // Activate nav item
  const navItem = document.querySelector(`[data-section="${section}"]`);
  if (navItem) navItem.classList.add('active');

  // Update header title
  const titles = {
    trade: 'معاملات دارایی', wallet: 'کیف پول', orders: 'سفارشات',
    withdrawal: 'برداشت وجه', referral: 'معرفی دوستان', profile: 'پروفایل',
    admin: 'پنل مدیریت', notifications: 'اطلاعیه‌ها'
  };
  document.getElementById('header-title').textContent = titles[section] || section;

  // Load section data
  if (section === 'wallet') loadWallet();
  else if (section === 'orders') loadOrders();
  else if (section === 'withdrawal') { loadWithdrawals(); loadWithdrawBalance(); }
  else if (section === 'referral') loadReferrals();
  else if (section === 'profile') loadProfile();
  else if (section === 'admin') { loadAdminDashboard(); loadAdminPrices(); }
  else if (section === 'notifications') loadNotifications();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) closeSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ===== PRICES =====
async function loadPrices() {
  const res = await apiRequest('/prices');
  if (!res.ok) return;

  currentPrices = res.data.data || [];
  const mode = res.data.price_mode;

  // Update price mode badge
  const badge = document.getElementById('price-mode-badge');
  badge.innerHTML = mode === 'api'
    ? '<i class="fas fa-circle"></i><span>قیمت زنده (API)</span>'
    : '<i class="fas fa-circle"></i><span>قیمت دستی</span>';
  badge.className = `price-mode-badge ${mode === 'api' ? 'api' : ''}`;

  // Update price ticker
  const gold18 = currentPrices.find(p => p.symbol === 'GOLD18');
  if (gold18) {
    document.getElementById('ticker-gold18').textContent = formatPrice(gold18.buy_price);
  }

  // Load assets for first time
  if (currentAssets.length === 0) await loadAssets();
  else renderAssetCards();
}

async function loadAssets() {
  const res = await apiRequest('/admin/assets');
  if (res.ok) {
    currentAssets = res.data.data || [];
    renderAssetCards();
  }
}

function getAssetIcon(symbol) {
  const icons = {
    'GOLD18': '🥇', 'GOLD24': '✨', 'COIN_BAHAR': '🪙',
    'COIN_HALF': '💰', 'COIN_QUARTER': '💎'
  };
  return icons[symbol] || '🪙';
}

function renderAssetCards() {
  const container = document.getElementById('asset-cards');
  if (!container) return;

  container.innerHTML = currentAssets.map(asset => {
    const price = currentPrices.find(p => p.asset_id === asset.id);
    return `
      <div class="asset-card ${selectedAsset?.id === asset.id ? 'selected' : ''}" onclick="selectAsset(${asset.id})">
        <div class="asset-icon">${getAssetIcon(asset.symbol)}</div>
        <div class="asset-name">${asset.name}</div>
        <div class="asset-buy-price">خرید: ${price ? formatPrice(price.buy_price) : '---'}</div>
        <div class="asset-sell-price">فروش: ${price ? formatPrice(price.sell_price) : '---'}</div>
        <div class="asset-unit">${asset.unit}</div>
      </div>
    `;
  }).join('');
}

function selectAsset(assetId) {
  selectedAsset = currentAssets.find(a => a.id === assetId);
  if (!selectedAsset) return;

  renderAssetCards();
  openTradePanel();
}

function openTradePanel() {
  if (!selectedAsset) return;
  const panel = document.getElementById('trade-panel');
  const price = currentPrices.find(p => p.asset_id === selectedAsset.id);

  document.getElementById('trade-asset-name').textContent = selectedAsset.name;
  document.getElementById('trade-asset-price').textContent = price ? `${formatPrice(price.buy_price)}` : '---';
  document.getElementById('trade-unit').textContent = selectedAsset.unit;
  panel.style.display = 'block';

  // Load wallet balance
  updateTradeBalances();
  calculateTrade();
}

function closeTradePanel() {
  document.getElementById('trade-panel').style.display = 'none';
  selectedAsset = null;
  renderAssetCards();
  document.getElementById('trade-quantity').value = '';
  document.getElementById('trade-amount').value = '';
}

function setTradeType(type) {
  tradeType = type;
  document.getElementById('btn-buy').classList.toggle('active', type === 'buy');
  document.getElementById('btn-sell').classList.toggle('active', type === 'sell');
  const btn = document.getElementById('btn-submit-trade');
  btn.className = `btn btn-primary btn-full btn-trade${type === 'sell' ? ' btn-sell-mode' : ''}`;
  document.getElementById('trade-btn-text').textContent = type === 'buy' ? 'ثبت سفارش خرید' : 'ثبت سفارش فروش';
  calculateTrade();
}

function setTradeMode(mode) {
  tradeMode = mode;
  document.getElementById('mode-quantity').classList.toggle('active', mode === 'quantity');
  document.getElementById('mode-amount').classList.toggle('active', mode === 'amount');
  document.getElementById('quantity-input-group').style.display = mode === 'quantity' ? 'block' : 'none';
  document.getElementById('amount-input-group').style.display = mode === 'amount' ? 'block' : 'none';
  document.getElementById('trade-quantity').value = '';
  document.getElementById('trade-amount').value = '';
  calculateTrade();
}

function calculateTrade() {
  if (!selectedAsset) return;
  const price = currentPrices.find(p => p.asset_id === selectedAsset.id);
  if (!price) return;

  const pricePerUnit = tradeType === 'buy' ? price.buy_price : price.sell_price;
  let quantity = 0, total = 0;

  if (tradeMode === 'quantity') {
    quantity = parseFloat(document.getElementById('trade-quantity').value) || 0;
    total = quantity * pricePerUnit;
  } else {
    total = parseFloat(document.getElementById('trade-amount').value) || 0;
    quantity = total / pricePerUnit;
  }

  document.getElementById('summary-price').textContent = formatPrice(pricePerUnit);
  document.getElementById('summary-quantity').textContent = `${quantity.toFixed(4)} ${selectedAsset.unit}`;
  document.getElementById('summary-total').textContent = formatPrice(total);
}

async function updateTradeBalances() {
  const res = await apiRequest('/wallet');
  if (!res.ok) return;
  walletData = res.data.data;

  document.getElementById('trade-cash-balance').textContent = formatPrice(walletData.cash_balance);

  if (selectedAsset) {
    const assetWallet = walletData.assets.find(a => a.asset_id === selectedAsset.id);
    document.getElementById('trade-asset-balance').textContent = `${(assetWallet?.balance || 0).toFixed(4)} ${selectedAsset.unit}`;
  }
}

async function submitOrder() {
  if (!selectedAsset) return;
  if (!authToken) { showToast('لطفاً ابتدا وارد شوید', 'error'); return; }

  const price = currentPrices.find(p => p.asset_id === selectedAsset.id);
  if (!price) { showToast('قیمت دارایی موجود نیست', 'error'); return; }

  let quantity = null, amount_toman = null;
  if (tradeMode === 'quantity') {
    quantity = parseFloat(document.getElementById('trade-quantity').value);
    if (!quantity || quantity <= 0) { showToast('مقدار را وارد کنید', 'warning'); return; }
  } else {
    amount_toman = parseFloat(document.getElementById('trade-amount').value);
    if (!amount_toman || amount_toman <= 0) { showToast('مبلغ را وارد کنید', 'warning'); return; }
  }

  const btn = document.getElementById('btn-submit-trade');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const payload = {
    asset_id: selectedAsset.id,
    order_type: tradeType,
    ...(quantity ? { quantity } : { amount_toman })
  };

  const res = await apiRequest('/orders', 'POST', payload);
  btn.disabled = false;
  btn.innerHTML = `<span>${tradeType === 'buy' ? 'ثبت سفارش خرید' : 'ثبت سفارش فروش'}</span><i class="fas fa-check-circle"></i>`;

  if (res.ok) {
    showToast(res.data.message, 'success');
    closeTradePanel();
    await loadPrices();
    updateTradeBalances();
  } else {
    showToast(res.data.message || 'خطا در ثبت سفارش', 'error');
  }
}

// ===== WALLET =====
async function loadWallet() {
  const res = await apiRequest('/wallet');
  if (!res.ok) return;
  walletData = res.data.data;

  document.getElementById('cash-balance-display').textContent = formatPrice(walletData.cash_balance);
  document.getElementById('asset-value-display').textContent = formatPrice(walletData.total_asset_value);
  document.getElementById('total-portfolio-display').textContent = formatPrice(walletData.total_portfolio_value);

  const container = document.getElementById('asset-wallets-list');
  container.innerHTML = walletData.assets.map(a => `
    <div class="asset-wallet-item">
      <div class="asset-wallet-icon">${getAssetIcon(a.symbol)}</div>
      <div class="asset-wallet-info">
        <div class="asset-wallet-name">${a.asset_name}</div>
        <div class="asset-wallet-symbol">${a.symbol}</div>
      </div>
      <div class="asset-wallet-balance">
        <div class="asset-wallet-amount">${parseFloat(a.balance || 0).toFixed(4)} ${a.unit}</div>
        <div class="asset-wallet-value">${formatPrice((a.balance || 0) * (a.sell_price || a.current_price || 0))}</div>
      </div>
    </div>
  `).join('') || '<div class="empty-state"><i class="fas fa-wallet"></i><p>موجودی دارایی ندارید</p></div>';
}

// ===== ORDERS =====
let currentOrderFilter = '';
async function loadOrders(status = currentOrderFilter) {
  currentOrderFilter = status;
  const res = await apiRequest(`/orders?status=${status}&limit=50`);
  if (!res.ok) return;

  const orders = res.data.data || [];
  const container = document.getElementById('orders-list');
  
  if (!orders.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-list-alt"></i><p>سفارشی یافت نشد</p></div>';
    return;
  }

  container.innerHTML = orders.map(o => `
    <div class="order-item">
      <div class="order-type-badge ${o.order_type}">
        <i class="fas fa-arrow-${o.order_type === 'buy' ? 'down' : 'up'}"></i>
      </div>
      <div class="order-info">
        <div class="order-title">${o.order_type === 'buy' ? 'خرید' : 'فروش'} ${o.asset_name}</div>
        <div class="order-meta">${parseFloat(o.quantity).toFixed(4)} ${o.unit} - ${formatDate(o.created_at)}</div>
      </div>
      <div class="order-right">
        <div class="order-amount">${formatPrice(o.total_amount)}</div>
        <div class="order-status">${getStatusBadge(o.status)}</div>
      </div>
    </div>
  `).join('');
}

function filterOrders(status) {
  document.querySelectorAll('#section-orders .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  loadOrders(status);
}

function getStatusBadge(status) {
  const map = {
    pending: ['status-pending', 'در انتظار'],
    completed: ['status-completed', 'تکمیل شده'],
    rejected: ['status-rejected', 'رد شده'],
    approved: ['status-approved', 'تأیید شده'],
    cancelled: ['status-cancelled', 'لغو شده']
  };
  const [cls, text] = map[status] || ['status-pending', status];
  return `<span class="status-badge ${cls}">${text}</span>`;
}

// ===== WITHDRAWAL =====
async function loadWithdrawBalance() {
  const res = await apiRequest('/wallet');
  if (!res.ok) return;
  document.getElementById('withdraw-available').textContent = formatPrice(res.data.data.cash_balance);
}

async function loadWithdrawals() {
  const res = await apiRequest('/withdrawals?limit=20');
  if (!res.ok) return;
  const withdrawals = res.data.data || [];
  const container = document.getElementById('withdrawals-list');

  if (!withdrawals.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-money-bill-wave"></i><p>درخواست برداشتی ندارید</p></div>';
    return;
  }

  container.innerHTML = withdrawals.map(w => `
    <div class="order-item">
      <div class="order-type-badge buy">
        <i class="fas fa-university"></i>
      </div>
      <div class="order-info">
        <div class="order-title">برداشت وجه</div>
        <div class="order-meta">شبا: ${w.sheba_number} - ${formatDate(w.created_at)}</div>
      </div>
      <div class="order-right">
        <div class="order-amount">${formatPrice(w.amount)}</div>
        <div class="order-status">${getStatusBadge(w.status)}</div>
      </div>
    </div>
  `).join('');
}

async function submitWithdrawal() {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const sheba = document.getElementById('withdraw-sheba').value.trim();
  const holder = document.getElementById('withdraw-holder').value.trim();
  const bank = document.getElementById('withdraw-bank').value.trim();

  if (!amount || amount <= 0) { showToast('مبلغ برداشت را وارد کنید', 'warning'); return; }
  if (!sheba) { showToast('شماره شبا را وارد کنید', 'warning'); return; }
  if (!holder) { showToast('نام صاحب حساب را وارد کنید', 'warning'); return; }

  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await apiRequest('/withdrawals', 'POST', {
    amount, sheba_number: sheba, account_holder: holder, bank_name: bank
  });

  btn.disabled = false;
  btn.innerHTML = '<span>ثبت درخواست برداشت</span><i class="fas fa-paper-plane"></i>';

  if (res.ok) {
    showToast(res.data.message, 'success');
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-sheba').value = '';
    document.getElementById('withdraw-holder').value = '';
    document.getElementById('withdraw-bank').value = '';
    loadWithdrawals();
    loadWithdrawBalance();
  } else {
    showToast(res.data.message || 'خطا در ثبت درخواست', 'error');
  }
}

// ===== REFERRAL =====
async function loadReferrals() {
  if (currentUser) {
    document.getElementById('my-referral-code').textContent = currentUser.referral_code || '---';
  }

  const res = await apiRequest('/wallet/referrals');
  if (!res.ok) return;
  const referrals = res.data.data || [];

  document.getElementById('referral-count').textContent = toPersianDigits(referrals.length);

  const container = document.getElementById('referrals-list');
  if (!referrals.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>هنوز کسی با کد معرف شما ثبت‌نام نکرده</p></div>';
    return;
  }

  container.innerHTML = referrals.map(r => `
    <div class="referral-user-item">
      <div class="referral-user-avatar"><i class="fas fa-user"></i></div>
      <div class="referral-user-info">
        <div class="name">${r.full_name || r.phone}</div>
        <div class="date">${formatDate(r.created_at)}</div>
      </div>
    </div>
  `).join('');
}

function copyReferralCode() {
  const code = document.getElementById('my-referral-code').textContent;
  if (code === '---') return;
  navigator.clipboard.writeText(code).then(() => showToast('کد معرف کپی شد!', 'success'));
}

// ===== PROFILE =====
async function loadProfile() {
  const res = await apiRequest('/auth/me');
  if (!res.ok) return;
  const user = res.data.user;
  currentUser = user;

  document.getElementById('profile-phone').textContent = user.phone;
  document.getElementById('profile-name').value = user.full_name || '';
  document.getElementById('profile-national-id').value = user.national_id || '';
  document.getElementById('profile-email').value = user.email || '';
}

async function updateProfile() {
  const full_name = document.getElementById('profile-name').value.trim();
  const national_id = document.getElementById('profile-national-id').value.trim();
  const email = document.getElementById('profile-email').value.trim();

  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await apiRequest('/auth/profile', 'PUT', { full_name, national_id, email });
  btn.disabled = false;
  btn.innerHTML = '<span>ذخیره تغییرات</span><i class="fas fa-save"></i>';

  if (res.ok) {
    showToast('پروفایل بروزرسانی شد', 'success');
    currentUser.full_name = full_name;
    document.getElementById('sidebar-user-name').textContent = full_name || 'کاربر';
  } else {
    showToast(res.data.message || 'خطا', 'error');
  }
}

// ===== NOTIFICATIONS =====
async function loadNotificationCount() {
  const res = await apiRequest('/wallet/notifications?unread_only=true&limit=5');
  if (!res.ok) return;
  const count = res.data.unread_count || 0;
  const badge = document.getElementById('notif-badge');
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count > 9 ? '۹+' : toPersianDigits(count);
  } else {
    badge.style.display = 'none';
  }
}

async function loadNotifications() {
  const res = await apiRequest('/wallet/notifications?limit=30');
  if (!res.ok) return;
  const notifs = res.data.data || [];
  const container = document.getElementById('notifications-list');

  if (!notifs.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>اطلاعیه‌ای ندارید</p></div>';
    return;
  }

  const iconMap = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
  container.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}">
      <div class="notif-icon ${n.type || 'info'}">
        <i class="fas ${iconMap[n.type] || iconMap.info}"></i>
      </div>
      <div class="notif-content">
        <div class="title">${n.title}</div>
        <div class="message">${n.message}</div>
        <div class="time">${formatDate(n.created_at)}</div>
      </div>
    </div>
  `).join('');
}

async function markAllRead() {
  await apiRequest('/wallet/notifications/read', 'PUT');
  loadNotifications();
  document.getElementById('notif-badge').style.display = 'none';
}

// ===== ADMIN PANEL =====
async function loadAdminDashboard() {
  const res = await apiRequest('/admin/dashboard');
  if (!res.ok) return;
  const { stats, recent_orders, recent_withdrawals } = res.data.data;

  const statsGrid = document.getElementById('admin-stats-grid');
  statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-users"></i> کاربران</div><div class="stat-card-value">${toPersianDigits(stats.total_users)}</div></div>
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-list-alt"></i> کل سفارشات</div><div class="stat-card-value">${toPersianDigits(stats.total_orders)}</div></div>
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-clock"></i> در انتظار</div><div class="stat-card-value text-gold">${toPersianDigits(stats.pending_orders)}</div></div>
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-money-bill"></i> درخواست برداشت</div><div class="stat-card-value">${toPersianDigits(stats.pending_withdrawals)}</div></div>
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-chart-bar"></i> حجم معاملات</div><div class="stat-card-value" style="font-size:14px">${formatPrice(stats.total_volume)}</div><div class="stat-card-sub">کل</div></div>
    <div class="stat-card"><div class="stat-card-label"><i class="fas fa-calendar-day"></i> سفارشات امروز</div><div class="stat-card-value">${toPersianDigits(stats.today_orders)}</div></div>
  `;

  // Recent orders
  const recentOrdersEl = document.getElementById('admin-recent-orders');
  recentOrdersEl.innerHTML = recent_orders.slice(0, 5).map(o => `
    <div class="admin-order-item">
      <div>
        <div style="font-weight:600;font-size:13px">${o.user_phone}</div>
        <div style="color:var(--text-secondary);font-size:11px">${o.order_type === 'buy' ? 'خرید' : 'فروش'} ${o.asset_name}</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:12px;direction:ltr">${formatPrice(o.total_amount)}</div>
        ${getStatusBadge(o.status)}
      </div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:20px"><p>سفارشی ندارید</p></div>';

  // Recent withdrawals
  const recentWithdrawalsEl = document.getElementById('admin-recent-withdrawals');
  recentWithdrawalsEl.innerHTML = recent_withdrawals.map(w => `
    <div class="admin-order-item">
      <div>
        <div style="font-weight:600;font-size:13px">${w.user_phone}</div>
        <div style="color:var(--text-secondary);font-size:11px">${w.account_holder}</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:12px;direction:ltr">${formatPrice(w.amount)}</div>
        ${getStatusBadge(w.status)}
      </div>
    </div>
  `).join('') || '<div class="empty-state" style="padding:20px"><p>درخواستی ندارید</p></div>';
}

async function loadAdminOrders(status = '') {
  document.querySelectorAll('#admin-orders .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  const res = await apiRequest(`/orders/admin/all?status=${status}&limit=50`);
  if (!res.ok) return;

  const orders = res.data.data || [];
  const container = document.getElementById('admin-orders-list');

  if (!orders.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>سفارشی یافت نشد</p></div>';
    return;
  }

  container.innerHTML = orders.map(o => `
    <div class="order-item">
      <div class="order-type-badge ${o.order_type}">
        <i class="fas fa-arrow-${o.order_type === 'buy' ? 'down' : 'up'}"></i>
      </div>
      <div class="order-info">
        <div class="order-title">${o.order_type === 'buy' ? 'خرید' : 'فروش'} ${o.asset_name}</div>
        <div class="order-meta">${o.user_phone} (${o.user_name || 'ناشناس'}) - ${parseFloat(o.quantity).toFixed(4)} ${o.unit}</div>
        <div class="order-meta">${formatDate(o.created_at)}</div>
      </div>
      <div class="order-right">
        <div class="order-amount">${formatPrice(o.total_amount)}</div>
        <div>${getStatusBadge(o.status)}</div>
        ${o.status === 'pending' ? `
          <div class="order-actions mt-10">
            <button class="btn btn-sm btn-success" onclick="adminApproveOrder('${o.id}')"><i class="fas fa-check"></i></button>
            <button class="btn btn-sm btn-danger" onclick="adminRejectOrder('${o.id}')"><i class="fas fa-times"></i></button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function adminApproveOrder(orderId) {
  if (!confirm('تأیید این سفارش؟')) return;
  const res = await apiRequest(`/orders/${orderId}/approve`, 'PUT');
  if (res.ok) {
    showToast('سفارش تأیید شد', 'success');
    loadAdminOrders(currentOrderFilter);
    loadAdminDashboard();
  } else {
    showToast(res.data.message, 'error');
  }
}

async function adminRejectOrder(orderId) {
  const notes = prompt('دلیل رد کردن (اختیاری):') || '';
  const res = await apiRequest(`/orders/${orderId}/reject`, 'PUT', { admin_notes: notes });
  if (res.ok) {
    showToast('سفارش رد شد', 'info');
    loadAdminOrders(currentOrderFilter);
  } else {
    showToast(res.data.message, 'error');
  }
}

async function loadAdminWithdrawals(status = '') {
  document.querySelectorAll('#admin-withdrawals .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  const res = await apiRequest(`/withdrawals/admin/all?status=${status}&limit=50`);
  if (!res.ok) return;

  const withdrawals = res.data.data || [];
  const container = document.getElementById('admin-withdrawals-list');

  if (!withdrawals.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>درخواستی یافت نشد</p></div>';
    return;
  }

  container.innerHTML = withdrawals.map(w => `
    <div class="order-item">
      <div class="order-type-badge buy">
        <i class="fas fa-university"></i>
      </div>
      <div class="order-info">
        <div class="order-title">${w.user_phone} - ${w.account_holder}</div>
        <div class="order-meta">شبا: ${w.sheba_number}</div>
        <div class="order-meta">${w.bank_name || ''} - ${formatDate(w.created_at)}</div>
      </div>
      <div class="order-right">
        <div class="order-amount">${formatPrice(w.amount)}</div>
        <div>${getStatusBadge(w.status)}</div>
        ${w.status === 'pending' ? `
          <div class="order-actions mt-10">
            <button class="btn btn-sm btn-success" onclick="adminApproveWithdrawal('${w.id}')"><i class="fas fa-check"></i> تأیید</button>
            <button class="btn btn-sm btn-danger" onclick="adminRejectWithdrawal('${w.id}')"><i class="fas fa-times"></i> رد</button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function adminApproveWithdrawal(id) {
  if (!confirm('تأیید این درخواست برداشت؟')) return;
  const notes = prompt('یادداشت (اختیاری):') || '';
  const res = await apiRequest(`/withdrawals/${id}/approve`, 'PUT', { admin_notes: notes });
  if (res.ok) {
    showToast('درخواست برداشت تأیید شد', 'success');
    loadAdminWithdrawals();
  } else {
    showToast(res.data.message, 'error');
  }
}

async function adminRejectWithdrawal(id) {
  const notes = prompt('دلیل رد کردن:') || '';
  const res = await apiRequest(`/withdrawals/${id}/reject`, 'PUT', { admin_notes: notes });
  if (res.ok) {
    showToast('درخواست رد شد و مبلغ برگشت', 'info');
    loadAdminWithdrawals();
  } else {
    showToast(res.data.message, 'error');
  }
}

async function loadAdminUsers() {
  const search = document.getElementById('user-search')?.value || '';
  const res = await apiRequest(`/admin/users?search=${encodeURIComponent(search)}&limit=50`);
  if (!res.ok) return;

  const users = res.data.data || [];
  const container = document.getElementById('admin-users-list');

  if (!users.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>کاربری یافت نشد</p></div>';
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="user-row">
      <div class="user-avatar" style="width:38px;height:38px;font-size:14px"><i class="fas fa-user"></i></div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${u.full_name || 'بدون نام'}</div>
        <div style="color:var(--text-secondary);font-size:12px;direction:ltr">${u.phone}</div>
      </div>
      <div style="text-align:left;font-size:12px">
        <div style="color:var(--gold)">${formatPrice(u.cash_balance)}</div>
        <div style="color:var(--text-muted)">${toPersianDigits(u.order_count)} سفارش</div>
      </div>
      <div style="margin-right:10px">
        <button class="btn btn-sm btn-outline" onclick="viewUserDetails('${u.id}')"><i class="fas fa-eye"></i></button>
      </div>
    </div>
  `).join('');
}

let searchTimeout;
function searchUsers() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadAdminUsers, 400);
}

async function viewUserDetails(userId) {
  const res = await apiRequest(`/admin/users/${userId}`);
  if (!res.ok) { showToast('خطا در بارگذاری', 'error'); return; }
  const { user, asset_wallets, orders } = res.data.data;

  showModal(`جزئیات کاربر: ${user.full_name || user.phone}`, `
    <div style="display:grid;gap:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="glass-card" style="padding:12px">
          <div style="color:var(--text-secondary);font-size:11px">موبایل</div>
          <div style="font-weight:600;direction:ltr">${user.phone}</div>
        </div>
        <div class="glass-card" style="padding:12px">
          <div style="color:var(--text-secondary);font-size:11px">موجودی ریالی</div>
          <div style="font-weight:600;color:var(--gold)">${formatPrice(user.cash_balance)}</div>
        </div>
      </div>
      <div style="font-weight:600;margin-top:8px">دارایی‌ها:</div>
      ${asset_wallets.map(a => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text-secondary)">${a.asset_name}</span>
          <span style="font-weight:600">${parseFloat(a.balance).toFixed(4)} ${a.unit}</span>
        </div>
      `).join('')}
    </div>
  `, `<button class="btn btn-primary" onclick="closeModal()">بستن</button>`);
}

async function loadAdminPrices() {
  const settingsRes = await apiRequest('/prices/settings/all');
  if (settingsRes.ok) {
    const s = settingsRes.data.data;
    const modeEl = document.getElementById('price-mode-select');
    if (modeEl) modeEl.value = s.price_mode || 'manual';
    const buyEl = document.getElementById('buy-markup');
    if (buyEl) buyEl.value = s.buy_markup || '2';
    const sellEl = document.getElementById('sell-markdown');
    if (sellEl) sellEl.value = s.sell_markdown || '2';
  }

  const assetsRes = await apiRequest('/admin/assets');
  if (!assetsRes.ok) return;
  const assets = assetsRes.data.data || [];

  const container = document.getElementById('admin-price-list');
  if (!container) return;

  container.innerHTML = assets.map(a => `
    <div class="price-edit-card">
      <div class="price-edit-info">
        <div style="font-weight:600;font-size:14px">${getAssetIcon(a.symbol)} ${a.name}</div>
        <div style="color:var(--text-secondary);font-size:12px">قیمت فعلی: ${formatPrice(a.current_price)}</div>
      </div>
      <div class="price-edit-inputs">
        <input type="number" id="price-${a.id}" placeholder="قیمت پایه" value="${a.current_price || ''}" class="form-input" style="width:150px;padding:8px" dir="ltr">
        <button class="btn btn-sm btn-primary" onclick="updateAssetPrice(${a.id})">بروزرسانی</button>
      </div>
    </div>
  `).join('');
}

async function updateAssetPrice(assetId) {
  const price = parseFloat(document.getElementById(`price-${assetId}`).value);
  if (!price || price <= 0) { showToast('قیمت را وارد کنید', 'warning'); return; }

  const res = await apiRequest('/prices', 'POST', { asset_id: assetId, price });
  if (res.ok) {
    showToast('قیمت بروزرسانی شد', 'success');
    loadPrices();
    loadAdminPrices();
  } else {
    showToast(res.data.message, 'error');
  }
}

async function savePriceSettings() {
  const price_mode = document.getElementById('price-mode-select')?.value;
  const buy_markup = document.getElementById('buy-markup')?.value;
  const sell_markdown = document.getElementById('sell-markdown')?.value;

  const res = await apiRequest('/prices/settings/markup', 'PUT', { price_mode, buy_markup: parseFloat(buy_markup), sell_markdown: parseFloat(sell_markdown) });
  if (res.ok) {
    showToast('تنظیمات ذخیره شد', 'success');
    loadPrices();
  } else {
    showToast(res.data.message, 'error');
  }
}

async function loadReports(period = 'daily') {
  document.querySelectorAll('#admin-reports .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  const res = await apiRequest(`/admin/reports?period=${period}`);
  if (!res.ok) return;
  const { order_stats, asset_stats, withdrawal_stats, new_users } = res.data.data;

  const container = document.getElementById('reports-content');
  const periodName = { daily: 'امروز', weekly: 'هفته جاری', monthly: 'ماه جاری' }[period];

  const totalOrders = order_stats.reduce((s, o) => s + o.count, 0);
  const totalVolume = order_stats.reduce((s, o) => s + (o.total_amount || 0), 0);

  container.innerHTML = `
    <div class="report-grid">
      <div class="report-card"><div class="report-card-title">کاربران جدید ${periodName}</div><div class="report-card-value">${toPersianDigits(new_users)}</div></div>
      <div class="report-card"><div class="report-card-title">تعداد معاملات ${periodName}</div><div class="report-card-value">${toPersianDigits(totalOrders)}</div></div>
      <div class="report-card"><div class="report-card-title">حجم معاملات ${periodName}</div><div class="report-card-value" style="font-size:14px">${formatPrice(totalVolume)}</div></div>
      ${order_stats.map(o => `
        <div class="report-card">
          <div class="report-card-title">${o.order_type === 'buy' ? 'خرید' : 'فروش'} - ${periodName}</div>
          <div class="report-card-value">${toPersianDigits(o.count)}</div>
          <div class="report-card-type">${formatPrice(o.total_amount)}</div>
        </div>
      `).join('')}
      ${withdrawal_stats.map(w => `
        <div class="report-card">
          <div class="report-card-title">برداشت ${getStatusText(w.status)} - ${periodName}</div>
          <div class="report-card-value">${toPersianDigits(w.count)}</div>
          <div class="report-card-type">${formatPrice(w.total_amount)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function getStatusText(status) {
  const map = { pending: 'در انتظار', approved: 'تأیید شده', rejected: 'رد شده', completed: 'تکمیل', paid: 'پرداخت شده' };
  return map[status] || status;
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.admin-content').forEach(c => c.style.display = 'none');
  document.getElementById(`admin-${tab}`).style.display = 'block';

  if (tab === 'dashboard') loadAdminDashboard();
  else if (tab === 'orders') loadAdminOrders('pending');
  else if (tab === 'withdrawals') loadAdminWithdrawals('pending');
  else if (tab === 'users') loadAdminUsers();
  else if (tab === 'prices') loadAdminPrices();
  else if (tab === 'reports') loadReports('daily');
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeSidebar();
  }
});

// Handle OTP backspace
document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && e.target.classList.contains('otp-digit')) {
    if (!e.target.value) {
      const digits = document.querySelectorAll('.otp-digit');
      const index = Array.from(digits).indexOf(e.target);
      if (index > 0) digits[index - 1].focus();
    }
  }
});

// ===== APP STARTUP =====
window.addEventListener('load', async () => {
  // Hide loading screen after animation
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.style.opacity = '0';
    loadingScreen.style.transition = 'opacity 0.5s ease';
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      document.getElementById('app').style.display = 'block';
    }, 500);
  }, 1800);

  if (authToken) {
    await initApp();
  } else {
    setTimeout(() => showAuthPage(), 2000);
  }
});
