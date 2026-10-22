[CmdletBinding()]
param()
# Local-only. Intentionally accepts no URL, account, remote target or restore option.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupDir = Join-Path $workspace '.maintenance-backups\staging-pre-upgrade'
$encryptedFile = Join-Path $backupDir 'staging-envelope.dpapi'
$receiptFile = Join-Path $backupDir 'receipt.json'
$originalFile = Join-Path $backupDir 'staging-envelope.json'
$sources = @($encryptedFile, $receiptFile, $originalFile)
$sourceHashes = @{}
$decryptedFile = $null
$locationPushed = $false
try {
    foreach ($source in $sources) {
        $item = Get-Item -LiteralPath $source
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point input forbidden' }
        $sourceHashes[$source] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    }
    $dirItem = Get-Item -LiteralPath $backupDir
    if ($dirItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point directory forbidden' }
    $runDir = Join-Path $backupDir ('recovery-run-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $runDir | Out-Null
    $acl = Get-Acl -LiteralPath $runDir
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $runDir -AclObject $acl
    Add-Type -AssemblyName System.Security
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($encryptedFile), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    # Compare the encrypted copy with the original before parsing or running SQL.
    $sha = [Security.Cryptography.SHA256]::Create()
    $decryptedHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    if ($decryptedHash -ne $sourceHashes[$originalFile]) { throw 'Encrypted copy differs from original' }
    $decryptedFile = Join-Path $runDir 'temporary-envelope.json'
    [IO.File]::WriteAllBytes($decryptedFile, $bytes)
    [Array]::Clear($bytes, 0, $bytes.Length)
    Push-Location -LiteralPath $workspace
    $locationPushed = $true
    & node scripts/rehearse-staging-recovery.mjs $decryptedFile $receiptFile (Join-Path $runDir 'recovery-report.json')
    if ($LASTEXITCODE -ne 0) { throw 'Local recovery validation failed' }
    Write-Output ('Protected report: ' + (Join-Path $runDir 'recovery-report.json'))
} catch {
    # Never include SQL, decrypted data, customer records or cryptographic material.
    Write-Output 'LOCAL_RECOVERY_FAILED: check local prerequisites and protected backup files.'
    throw 'Local recovery did not pass; no remote operation was attempted.'
} finally {
    if ($locationPushed) { Pop-Location }
    if ($decryptedFile -and (Test-Path -LiteralPath $decryptedFile)) { Remove-Item -LiteralPath $decryptedFile -Force }
    foreach ($source in $sources) {
        if ($sourceHashes.ContainsKey($source) -and (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $sourceHashes[$source]) {
            throw 'Original backup artifacts changed; stop and investigate.'
        }
    }
}
