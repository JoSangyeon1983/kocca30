$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
$sourceExe = Join-Path $repoRoot '08_산출물/덧뵈기/옴탈잡이/옴탈잡이.exe'
$testRoot = Join-Path $repoRoot ('tmp/옴탈잡이 실행 파일/단독 실행 ' + [Guid]::NewGuid().ToString('N'))
$testExe = Join-Path $testRoot '공유용 실행 파일.exe'
$cacheRoot = Join-Path $testRoot '앱 캐시'
$reportRoot = Join-Path $PSScriptRoot '검증'
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination $testExe
if ((Get-ChildItem -LiteralPath $testRoot -File).Count -ne 1) { throw '독립 실행 폴더는 EXE 하나만 포함해야 합니다.' }
$oldDotnetRoot = $env:DOTNET_ROOT
$oldBundleRoot = $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR
$oldMultilevel = $env:DOTNET_MULTILEVEL_LOOKUP
try {
    $env:DOTNET_ROOT = Join-Path $testRoot '설치된 닷넷 없음'
    $env:DOTNET_MULTILEVEL_LOOKUP = '0'
    $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR = Join-Path $testRoot '내장 닷넷'
    foreach ($run in @('첫 실행', '재실행')) {
        $resultPath = Join-Path $reportRoot $run
        New-Item -ItemType Directory -Force -Path $resultPath | Out-Null
        $started = Get-Date
        $appProcess = Start-Process -FilePath $testExe -ArgumentList @('--verify', ('"' + $resultPath + '"'), '--data-root', ('"' + $cacheRoot + '"')) -WindowStyle Hidden -PassThru
        while (-not $appProcess.HasExited -and ((Get-Date) - $started).TotalSeconds -lt 180) { Start-Sleep -Milliseconds 250; $appProcess.Refresh() }
        if (-not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id; throw ($run + ' 시간 초과') }
        $appProcess.WaitForExit()
        if ($appProcess.ExitCode -ne 0) {
            $failure = Join-Path $resultPath 'failure.txt'
            if (Test-Path -LiteralPath $failure) { Get-Content -LiteralPath $failure -Encoding UTF8 }
            throw ($run + ' 실패: ' + $appProcess.ExitCode)
        }
        $result = Get-Content -LiteralPath (Join-Path $resultPath '실행 검증.json') -Encoding UTF8 -Raw | ConvertFrom-Json
        if (-not $result.success) { throw ($run + ' 검증 실패') }
        if ($run -eq '첫 실행' -and -not $result.extracted) { throw '첫 실행 압축 해제가 검사되지 않았습니다.' }
        if ($run -eq '재실행' -and $result.extracted) { throw '재실행 캐시 재사용이 실패했습니다.' }
        Write-Output ($run + ': PASS / 대사 ' + $result.speeches + ' / 내장 런타임 ' + $result.browserVersion)
        Start-Sleep -Milliseconds 700
    }
} finally {
    $env:DOTNET_ROOT = $oldDotnetRoot
    $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR = $oldBundleRoot
    $env:DOTNET_MULTILEVEL_LOOKUP = $oldMultilevel
}
