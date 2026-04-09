# AllStars Tracker — Deployment Commands
# Replace placeholders before distributing to employees:
#   SUPABASE_URL      = your Supabase project URL
#   SUPABASE_ANON_KEY = your Supabase anon key
#   PORTAL_URL        = your HR portal URL
#   S3_BASE_URL       = public URL to your installer host

$SUPABASE_URL      = "https://YOUR_PROJECT.supabase.co"
$SUPABASE_ANON_KEY = "YOUR_ANON_KEY"
$PORTAL_URL        = "https://app.hireallstars.com"
$S3_BASE_URL       = "https://YOUR_BUCKET.s3.amazonaws.com"

# ────────────────────────────────────────────────────────────────
# ONE-LINER DEPLOY COMMANDS (share these with employees/IT)
# ────────────────────────────────────────────────────────────────

Write-Host @"
=== ONE-LINER DEPLOY COMMANDS ===

Windows (PowerShell — run as standard user, no admin needed):
  irm $S3_BASE_URL/installer.bat -OutFile "$env:TEMP\as-install.bat"; & "$env:TEMP\as-install.bat" "$SUPABASE_URL" "$SUPABASE_ANON_KEY" "$PORTAL_URL"

macOS (Terminal):
  curl -fsSL $S3_BASE_URL/install-mac.sh | bash -s -- "$SUPABASE_URL" "$SUPABASE_ANON_KEY" "$PORTAL_URL"

Linux (Terminal):
  wget -qO- $S3_BASE_URL/install-linux.sh | bash -s -- "$SUPABASE_URL" "$SUPABASE_ANON_KEY" "$PORTAL_URL"
"@

# ────────────────────────────────────────────────────────────────
# MASS DEPLOYMENT — MULTIPLE WINDOWS MACHINES
# Requires: WinRM enabled on target machines, domain credentials
# ────────────────────────────────────────────────────────────────

function Deploy-AllStars {
    param(
        [Parameter(Mandatory)][string[]] $Computers,
        [PSCredential] $Credential
    )

    $scriptBlock = {
        param($supabaseUrl, $anonKey, $portalUrl, $s3Base)
        try {
            $tmpBat = "$env:TEMP\as-install-$(Get-Random).bat"
            Invoke-WebRequest -Uri "$s3Base/installer.bat" -OutFile $tmpBat -UseBasicParsing
            & cmd.exe /c $tmpBat $supabaseUrl $anonKey $portalUrl 2>&1
            Remove-Item $tmpBat -Force -ErrorAction SilentlyContinue
            Write-Output "SUCCESS: $env:COMPUTERNAME"
        } catch {
            Write-Output "FAILED: $env:COMPUTERNAME — $_"
        }
    }

    $jobs = @()
    foreach ($computer in $Computers) {
        Write-Host "Deploying to $computer..."
        $params = @{
            ComputerName = $computer
            ScriptBlock  = $scriptBlock
            ArgumentList = $SUPABASE_URL, $SUPABASE_ANON_KEY, $PORTAL_URL, $S3_BASE_URL
            AsJob        = $true
        }
        if ($Credential) { $params['Credential'] = $Credential }
        $jobs += Invoke-Command @params
    }

    Write-Host "Waiting for deployments to complete..."
    $results = $jobs | Wait-Job | Receive-Job
    $jobs | Remove-Job

    $results | ForEach-Object { Write-Host $_ }
}

# Example usage:
# $computers = Get-Content ".\computers.txt"   # One hostname per line
# $cred = Get-Credential "DOMAIN\admin"
# Deploy-AllStars -Computers $computers -Credential $cred

# ────────────────────────────────────────────────────────────────
# UNINSTALL COMMANDS
# ────────────────────────────────────────────────────────────────

Write-Host @"

=== UNINSTALL COMMANDS ===

Windows:
  # Via Programs & Features (silent):
  $uninst = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" | Where-Object DisplayName -like '*AllStars*').UninstallString
  if ($uninst) { & cmd.exe /c "$uninst /S" }
  # Delete config:
  Remove-Item "$env:LOCALAPPDATA\allstars-tracker" -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item "HKCU:\SOFTWARE\AllStarsTracker" -Recurse -Force -ErrorAction SilentlyContinue

macOS:
  osascript -e 'tell application "AllStars Tracker" to quit' 2>/dev/null
  rm -rf "/Applications/AllStars Tracker.app"
  rm -rf "~/Library/Application Support/allstars-tracker"
  osascript -e 'tell application "System Events" to delete login item "AllStars Tracker"' 2>/dev/null

Linux:
  pkill -f "AllStars-Tracker.AppImage" 2>/dev/null
  rm -rf ~/.local/share/allstars-tracker
  rm -rf ~/.config/allstars-tracker
  rm -f ~/.config/autostart/allstars-tracker.desktop
"@
