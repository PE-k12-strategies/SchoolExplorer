// Supabase Dashboard → Project Settings → API
window.SUPABASE_URL = 'https://jmmrsetieidkwycnfvkm.supabase.co';

// Publishable key (safe for browser use). Do NOT use the secret key here.
window.SUPABASE_ANON_KEY = 'sb_publishable_OIFAs4Cp_OaIVlQxyw89Lg_cPwIxpMD';

// Only this email can approve sign-ups
window.ADMIN_EMAIL = 'k12strategies@perkinseastman.com';

// Allowed job titles (must match sql/title-constraint.sql)
window.TITLE_OPTIONS = [
  { value: 'untitled', label: 'Untitled' },
  { value: 'associate', label: 'Associate' },
  { value: 'senior associate', label: 'Senior Associate' },
  { value: 'associate principal', label: 'Associate Principal' },
  { value: 'principal', label: 'Principal' },
];

window.ROLE_OPTIONS = ['Viewer', 'Editor', 'Admin'];

window.titleOptionsHtml = function (selected) {
  const blank = `<option value="">Select a title</option>`;
  const opts = window.TITLE_OPTIONS.map(
    (t) =>
      `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${t.label}</option>`
  ).join('');
  return blank + opts;
};

window.roleOptionsHtml = function (selected, includeBlank) {
  const blank = includeBlank ? '<option value="">Select a role</option>' : '';
  const opts = window.ROLE_OPTIONS.map(
    (r) => `<option value="${r}"${r === selected ? ' selected' : ''}>${r}</option>`
  ).join('');
  return blank + opts;
};

// Public hosted origin for auth emails (signup confirm + password reset).
// CRITICAL: Supabase → Authentication → URL Configuration must use this as
// Site URL. If Site URL is still http://localhost:3000, confirmation emails
// will send outsiders to localhost even when emailRedirectTo is correct.
window.APP_BASE_URL = 'https://pe-k12-strategies.github.io/SchoolExplorer';

window.getAppUrl = function (page) {
  const file = (page && String(page).trim()) || 'index.html';
  // Always prefer the hosted base for auth links — never the current tab origin
  // (localhost) or file://, or email recipients outside the org cannot open them.
  const base = (window.APP_BASE_URL || '').replace(/\/$/, '');
  if (base) return `${base}/${file.replace(/^\//, '')}`;
  if (window.location.protocol === 'file:') {
    return `http://localhost:5500/${file}`;
  }
  const originBase = window.location.href.replace(/[^/]*$/, '');
  return originBase + file;
};

/** Absolute redirect used for signup / reset emails (GitHub Pages). */
window.getAuthRedirectUrl = function (page) {
  return window.getAppUrl(page || 'index.html');
};

window.isSupabaseConfigured = function () {
  return (
    window.SUPABASE_URL &&
    window.SUPABASE_ANON_KEY &&
    window.SUPABASE_ANON_KEY !== 'YOUR_ANON_KEY_HERE' &&
    (window.SUPABASE_ANON_KEY.startsWith('eyJ') ||
      window.SUPABASE_ANON_KEY.startsWith('sb_publishable_'))
  );
};
