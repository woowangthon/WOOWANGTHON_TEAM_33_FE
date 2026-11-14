param(
    [string]$LicensedDataDir = (Join-Path $PSScriptRoot '../../licensed-data'),
    [string]$AudioOutputDir = (Join-Path $PSScriptRoot '../../phone-licensed-check')
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $AudioOutputDir | Out-Null
$complaints = Get-Content -Raw -LiteralPath (Join-Path $LicensedDataDir 'licensed-complaints.json') | ConvertFrom-Json
$comments = Get-Content -Raw -LiteralPath (Join-Path $LicensedDataDir 'licensed-comments.json') | ConvertFrom-Json
$specifications = @(
    @{ name='normal'; record=($complaints.records | Where-Object id -eq 'KOEN-004'); kind='complaint'; required=@('분당','소음','방음벽','설치') },
    @{ name='attack'; record=($comments.records | Where-Object sourceLine -eq 33); kind='comment'; required=@() },
    @{ name='followup'; record=($complaints.records | Where-Object id -eq 'KOEN-009'); kind='complaint'; required=@('분당','대기','오염','조치') }
)
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speech.SelectVoice('Microsoft Heami Desktop')
    $speech.Rate = 0
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $samples = foreach ($spec in $specifications) {
        if (-not $spec.record) { throw 'Licensed source record missing' }
        $text = if ($spec.kind -eq 'complaint') { $spec.record.complaintContent } else { $spec.record.text }
        $wavePath = Join-Path $AudioOutputDir ($spec.name + '.wav')
        $speech.SetOutputToWaveFile($wavePath, $format)
        $speech.Speak($text)
        $speech.SetOutputToNull()
        @{ name=$spec.name; sourceId=$spec.record.id; sourceType=$spec.kind; text=$text; path=($spec.name+'.wav'); sha256=(Get-FileHash -LiteralPath $wavePath -Algorithm SHA256).Hash.ToLower(); required=$spec.required }
    }
    @{ createdAt=[DateTime]::UtcNow.ToString('o'); voice='Microsoft Heami Desktop'; syntheticAudio=$true; sourceTextModified=$false; originalCallRecording=$false; complaintsSource=$complaints.source; commentsSource=$comments.source; samples=@($samples) } | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $AudioOutputDir 'samples.json')
    Copy-Item -LiteralPath (Join-Path $LicensedDataDir 'LICENSE-2runo.txt') -Destination (Join-Path $AudioOutputDir 'LICENSE-2runo.txt')
    Write-Output 'Prepared 3 licensed source readings. No microphone recording.'
} finally { $speech.Dispose() }
