# Deploy signup notification to k12strategies@perkinseastman.com
# Run in PowerShell from this project folder:
#   .\deploy-notify.ps1

$ErrorActionPreference = "Stop"
$ProjectRef = "jmmrsetieidkwycnfvkm"
$NotifySecret = "pe-notify-8f3k2m9x7q1w5n4r6t"

Write-Host ""
Write-Host "=== PE Dashboard — Email notification deploy ===" -ForegroundColor Cyan
Write-Host ""

# 1. Supabase login
Write-Host "Step 1: Supabase login..." -ForegroundColor Yellow
$loggedIn = $false
try {
  npx supabase@latest projects list --output json 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $loggedIn = $true }
} catch {}

if (-not $loggedIn) {
  Write-Host ""
  Write-Host "Windows may open OneNote instead of your browser — use a token instead:" -ForegroundColor Yellow
  Write-Host "  1. Open in Chrome or Edge: https://supabase.com/dashboard/account/tokens"
  Write-Host "  2. Generate new token → copy it (starts with sbp_)"
  Write-Host ""
  $token = Read-Host "Paste Supabase access token here"
  if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host ""
    Write-Host "No token entered. Trying --no-browser (copy the URL into Edge/Chrome manually)..." -ForegroundColor Yellow
    npx supabase@latest login --no-browser
  } else {
    npx supabase@latest login --token $token
  }
  if ($LASTEXITCODE -ne 0) { throw "Supabase login failed" }
} else {
  Write-Host "Already logged in to Supabase." -ForegroundColor Green
}

# 2. Link project
Write-Host "Step 2: Linking project $ProjectRef..." -ForegroundColor Yellow
npx supabase@latest link --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Project link failed" }

# 3. Microsoft app password (only secret you must provide)
Write-Host ""
Write-Host "Step 3: Microsoft 365 app password" -ForegroundColor Yellow
Write-Host "Create one at: https://mysignins.microsoft.com/security-info"
Write-Host "Use k12strategies@ mailbox, or d.wieberdink@ if you cannot access k12strategies@"
Write-Host ""
$smtpUser = Read-Host "SMTP_USER (default: k12strategies@perkinseastman.com)"
if ([string]::IsNullOrWhiteSpace($smtpUser)) {
  $smtpUser = "k12strategies@perkinseastman.com"
}
$smtpPass = Read-Host "SMTP_PASS (Microsoft app password)" -AsSecureString
$smtpPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPass)
)

$adminPageUrl = Read-Host "ADMIN_PAGE_URL — full URL to admin.html (optional, press Enter to skip)"

# 4. Deploy Edge Function
Write-Host ""
Write-Host "Step 4: Deploying notify-admin-signup function..." -ForegroundColor Yellow
npx supabase@latest functions deploy notify-admin-signup --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Function deploy failed" }

# 5. Set secrets
Write-Host "Step 5: Setting Edge Function secrets..." -ForegroundColor Yellow
npx supabase@latest functions secrets set `
  "NOTIFY_SECRET=$NotifySecret" `
  "SMTP_HOST=smtp.office365.com" `
  "SMTP_PORT=587" `
  "SMTP_USER=$smtpUser" `
  "SMTP_PASS=$smtpPassPlain" `
  "SMTP_FROM=k12strategies@perkinseastman.com" `
  $(if ($adminPageUrl) { "ADMIN_PAGE_URL=$adminPageUrl" }) `
  --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Setting secrets failed" }

# 6. Deploy role-update notification function
Write-Host "Step 6: Deploying notify-user-update function..." -ForegroundColor Yellow
npx supabase@latest functions deploy notify-user-update --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "notify-user-update deploy failed" }

# 7. Run SQL for database triggers
Write-Host ""
Write-Host "Step 7: Running database trigger SQL..." -ForegroundColor Yellow
$sqlPath = Join-Path $PSScriptRoot "sql\notify-admin-signup.sql"
npx supabase@latest db query --linked -f $sqlPath
if ($LASTEXITCODE -ne 0) {
  Write-Host "signup SQL failed — run sql/notify-admin-signup.sql manually." -ForegroundColor Red
}

$roleSqlPath = Join-Path $PSScriptRoot "sql\notify-user-update.sql"
npx supabase@latest db query --linked -f $roleSqlPath
if ($LASTEXITCODE -ne 0) {
  Write-Host "role-update SQL failed — run sql/notify-user-update.sql manually." -ForegroundColor Red
} else {
  Write-Host "Database triggers installed." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Notifications will go to: k12strategies@perkinseastman.com"
Write-Host "Test: sign up on index.html, then check that inbox."
Write-Host ""
