// Uses installed Windows speech voices; no network, API key or system-policy changes.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'win32') throw new Error('This fixture generator requires Windows speech synthesis.');
const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $env:SHIELD_AUDIO_OUTPUT | Out-Null
$samples = (Get-Content -LiteralPath $env:SHIELD_AUDIO_FIXTURES -Raw -Encoding UTF8 | ConvertFrom-Json).samples
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
    if (-not $voice) { throw 'A Korean Windows desktop speech voice is required.' }
    $speaker.SelectVoice($voice.VoiceInfo.Name)
    foreach ($sample in $samples) {
        if ($sample.id -notmatch '^[a-z-]+$') { throw 'Invalid fixture ID.' }
        $speaker.SetOutputToWaveFile((Join-Path $env:SHIELD_AUDIO_OUTPUT ($sample.id + '.wav')))
        $speaker.Speak($sample.text)
        $speaker.SetOutputToNull()
    }
} finally { $speaker.Dispose() }
Write-Output ('Generated {0} synthetic Korean WAV fixtures.' -f $samples.Count)
`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
  windowsHide: true, stdio: 'inherit', timeout: 30000,
  env: {
    ...process.env,
    SHIELD_AUDIO_FIXTURES: fileURLToPath(new URL('fixtures.json', import.meta.url)),
    SHIELD_AUDIO_OUTPUT: fileURLToPath(new URL('../../outputs/phone-audio-check/', import.meta.url)),
  },
});
process.exitCode = result.status ?? 1;
