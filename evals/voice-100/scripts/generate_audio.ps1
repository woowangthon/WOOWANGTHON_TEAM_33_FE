param([string]$DatasetRoot = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
$DatasetRoot = (Resolve-Path -LiteralPath $DatasetRoot).Path
$records = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $DatasetRoot 'data/dataset.json') | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = 'Microsoft Heami Desktop'
$manifest = @()
try {
    $speech.SelectVoice($voice)
    $speech.Rate = 0
    $speech.Volume = 100
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    foreach ($record in $records) {
        $wav = Join-Path $DatasetRoot $record.audio_path
        $speech.SetOutputToWaveFile($wav, $format)
        $speech.Speak($record.text)
        $speech.SetOutputToNull()
        $manifest += [ordered]@{id=$record.id; audio_path=$record.audio_path; engine='Windows System.Speech'; voice=$voice; rate=0; sample_rate_hz=16000; channels=1; bits_per_sample=16; synthetic=$true; transcript_source='TTS input, not manually verified audio transcription'; sha256=(Get-FileHash -LiteralPath $wav -Algorithm SHA256).Hash.ToLower()}
        if ($manifest.Count % 10 -eq 0) { Write-Output "Generated $($manifest.Count)/$($records.Count)" }
    }
} finally { $speech.Dispose() }
[ordered]@{created_at=[DateTime]::UtcNow.ToString('o'); records=$manifest} | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $DatasetRoot 'data/audio_manifest.json')
