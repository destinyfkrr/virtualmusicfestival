# Now-playing for Windows.
#
# Primary source is the system media transport controls (the panel that pops up when you press a
# media key) via WinRT, which gives title, artist, album, playback state and position for Spotify
# and any other player. If that projection is unavailable, we fall back to Spotify's window title,
# which is "Artist - Title" while playing and just "Spotify" when it is not.
#
# Output: one tab-separated line - state, title, artist, album, position, duration, albumArtist
#         or the single word "stopped".
# Run with Windows PowerShell 5.1 (powershell.exe); PowerShell 7 drops the WinRT projection.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Clean([string]$s) {
  if ($null -eq $s) { return '' }
  return ($s -replace "[`t`r`n]", ' ').Trim()
}

function Get-FromTransportControls {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                   $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

  function Await($op, $type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { throw 'WinRT call timed out' }
    return $task.Result
  }

  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType

  # prefer Spotify (desktop or Microsoft Store build) over whatever else is making noise
  $sessions = $mgr.GetSessions()
  $session = $sessions | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
  if (-not $session) { $session = $mgr.GetCurrentSession() }
  if (-not $session) { return 'stopped' }

  $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
  $state = switch ($status) { 'Playing' { 'playing' } 'Paused' { 'paused' } default { 'stopped' } }
  if ($state -eq 'stopped') { return 'stopped' }

  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $p = Await ($session.TryGetMediaPropertiesAsync()) $propsType
  if (-not $p -or -not $p.Title) { return 'stopped' }

  $position = 0.0; $duration = 0.0
  try {
    $tl = $session.GetTimelineProperties()
    $position = [math]::Max(0, ($tl.Position - $tl.StartTime).TotalSeconds)
    $duration = [math]::Max(0, ($tl.EndTime - $tl.StartTime).TotalSeconds)
  } catch {}

  return @(
    $state, (Clean $p.Title), (Clean $p.Artist), (Clean $p.AlbumTitle),
    ('{0:0.###}' -f $position), ('{0:0.###}' -f $duration), (Clean $p.AlbumArtist)
  ) -join "`t"
}

function Get-FromWindowTitle {
  $proc = Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if (-not $proc) { return 'stopped' }
  $title = $proc.MainWindowTitle
  # "Spotify" / "Spotify Premium" / "Spotify Free" means paused or idle - no track in the title
  if ($title -match '^Spotify(\s|$)') { return 'stopped' }
  $parts = $title -split ' - ', 2
  if ($parts.Count -lt 2) { return 'stopped' }
  return @('playing', (Clean $parts[1]), (Clean $parts[0]), '', '0', '0', '') -join "`t"
}

try { Write-Output (Get-FromTransportControls) }
catch {
  try { Write-Output (Get-FromWindowTitle) } catch { Write-Output 'stopped' }
}
