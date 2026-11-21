<#
.SYNOPSIS
  Uponor Clean recorder: records the power that a Shelly measures, once a second, to a CSV file.

.DESCRIPTION
  For troubleshooting the Uponor Clean script on a plant other than the one it was built on.
  The recorder asks for the Shelly's IP address, finds the power meter and the Uponor script
  (if installed), and writes one row a second until the set time is up or Q is pressed:

    time,power_w,voltage_v,current_a,pf,freq_hz,script_phase,script_cycle,script_band,script_since

  The script_* columns come from the Uponor script's state endpoint every 10 seconds;
  script_since is the start of the current phase (Unix seconds), so phase changes can be timed exactly.

  It also saves the Shelly's own minute data for the last 7 days (EM devices), device info
  without the MAC address, and a log of connection breaks and Shelly restarts. At the end the
  files are packed into one zip file to send.

  Works in Windows PowerShell 5.1 (built into Windows 10 and 11) and PowerShell 7.
  Needs a Shelly Gen2 or newer (Plus, Pro, Mini, Gen3, Gen4).

.EXAMPLE
  Right-click the file and choose "Run with PowerShell".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\nauhuri.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\nauhuri.ps1 -Ip 192.168.1.50 -Hours 48
#>
param(
    [string]$Ip,                  # Shelly IP address or host name (asked if not given)
    [double]$Hours = -1,          # recording time in hours, 0 = until Q is pressed (asked if not given)
    [string]$OutDir,              # folder for the files (default: the script's folder)
    [string]$Password,            # device password, if set (asked if needed)
    [ValidateSet('', 'fi', 'en')][string]$Lang = '',
    [double]$IntervalS = 1,       # sampling interval in seconds
    [switch]$NoWait               # do not wait for Enter at the end
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest slow in PowerShell 5.1
$RecorderVersion = '1.0'
$Inv = [Globalization.CultureInfo]::InvariantCulture
$script:Utf8 = New-Object Text.UTF8Encoding($false)

# ---- messages ----------------------------------------------------------------------------
# The source is kept ASCII-only so that it reads the same whatever encoding a copy is saved in.
# {a} {o} {A} {O} stand for the Finnish letters a-umlaut and o-umlaut.
$Msg = @{
    fi = @{
        title         = 'Uponor Clean -nauhuri {0}'
        intro         = 'Nauhuri tallentaa Shellyn mittaaman tehon ja j{a}nnitteen kerran sekunnissa. Nauhoituksesta n{a}kee, miten puhdistamo toimii ja miksi skripti ei ehk{a} tunnista sen vaiheita.'
        ask_ip        = 'Shellyn IP-osoite (esim. 192.168.1.50)'
        no_answer     = 'Osoitteesta {0} ei saatu vastausta: {1}'
        not_shelly    = 'Osoitteessa {0} ei vastaa Shelly.'
        gen1          = 'Laite on 1. sukupolven Shelly. Nauhuri tukee vain Gen2-laitteita ja uudempia (Plus, Pro, Mini, Gen3, Gen4).'
        device        = 'Laite: {0}, firmware {1}'
        ask_pw        = 'Laitteessa on salasana. Anna se (k{a}ytt{a}j{a}tunnus on admin)'
        pw_bad        = 'Salasana ei kelpaa.'
        no_meter      = 'Laitteelta ei l{o}ytynyt tehomittaria (em1, pm1, switch tai em).'
        channels      = 'Laitteessa on useita mittauskanavia:'
        channel_row   = '  {0}) {1}: {2} W'
        ask_channel   = 'Valitse kanava [1]'
        meter         = 'Mittari: {0}, nyt {1} W, {2} V'
        script_found  = 'Uponor-skripti {0} (skripti {1}): {2} / {3}'
        script_none   = 'Uponor-skriptia ei l{o}ytynyt. Nauhoitetaan pelkk{a} teho.'
        ask_hours     = 'Kuinka monta tuntia nauhoitetaan? 0 = kunnes painat Q [48]'
        bad_number    = 'Anna luku, esim. 48.'
        minutes_ok    = 'Shellyn oma minuuttidata tallennettu ({0} rivi{a}).'
        minutes_fail  = 'Shellyn minuuttidataa ei saatu: {0}'
        start         = 'Nauhoitus alkoi {0}. Se p{a}{a}ttyy {1}.'
        start_open    = 'Nauhoitus alkoi {0}. Se jatkuu, kunnes painat Q.'
        files         = 'Tiedostot tallentuvat kansioon {0}'
        howto_stop    = 'Lopeta painamalla Q. Pid{a} tietokone p{a}{a}ll{a}, verkkovirrassa ja samassa verkossa Shellyn kanssa.'
        keep_awake    = 'Windows ei mene lepotilaan nauhoituksen aikana (n{a}ytt{o} saa sammua).'
        status        = '{0}  {1} W  {2} V  {3} rivi{a}  {4} katkoa{5}'
        status_phase  = '  {0}'
        lost          = '  EI YHTEYTT{A} {0} s'
        log_lost      = 'Yhteys katkesi: {0}'
        log_back      = 'Yhteys palasi {0} s:n katkon j{a}lkeen'
        log_restart   = 'Shelly k{a}ynnistyi uudelleen (k{a}ynniss{a} {0} s, syy {1})'
        stopped_key   = 'Lopetettu.'
        stopped_time  = 'Nauhoitusaika t{a}ynn{a}.'
        summary       = 'Nauhoitettu {0}: {1} rivi{a}, {2} yhteyskatkoa.'
        zip           = 'L{a}het{a} t{a}m{a} tiedosto vianetsij{a}lle:'
        zip_fail      = 'Zip-tiedostoa ei voitu tehd{a} ({0}). L{a}het{a} kansion {1} tiedostot {2}*.'
        press_enter   = 'Paina Enter sulkeaksesi ikkunan'
        error         = 'Virhe: {0}'
    }
    en = @{
        title         = 'Uponor Clean recorder {0}'
        intro         = 'The recorder saves the power and voltage that the Shelly measures, once a second. The recording shows how the plant works and why the script may not recognise its phases.'
        ask_ip        = 'Shelly IP address (e.g. 192.168.1.50)'
        no_answer     = 'No answer from {0}: {1}'
        not_shelly    = 'There is no Shelly at {0}.'
        gen1          = 'This is a first-generation Shelly. The recorder supports only Gen2 devices and newer (Plus, Pro, Mini, Gen3, Gen4).'
        device        = 'Device: {0}, firmware {1}'
        ask_pw        = 'The device has a password. Enter it (the user name is admin)'
        pw_bad        = 'Wrong password.'
        no_meter      = 'No power meter found on the device (em1, pm1, switch or em).'
        channels      = 'The device has several measuring channels:'
        channel_row   = '  {0}) {1}: {2} W'
        ask_channel   = 'Choose a channel [1]'
        meter         = 'Meter: {0}, now {1} W, {2} V'
        script_found  = 'Uponor script {0} (script {1}): {2} / {3}'
        script_none   = 'No Uponor script found. Recording power only.'
        ask_hours     = 'How many hours to record? 0 = until you press Q [48]'
        bad_number    = 'Enter a number, e.g. 48.'
        minutes_ok    = 'The Shelly''s own minute data saved ({0} rows).'
        minutes_fail  = 'Could not get the Shelly''s minute data: {0}'
        start         = 'Recording started at {0}. It ends at {1}.'
        start_open    = 'Recording started at {0}. It goes on until you press Q.'
        files         = 'The files are saved in {0}'
        howto_stop    = 'Press Q to stop. Keep the computer on, plugged in and on the same network as the Shelly.'
        keep_awake    = 'Windows does not go to sleep while recording (the display may turn off).'
        status        = '{0}  {1} W  {2} V  {3} rows  {4} breaks{5}'
        status_phase  = '  {0}'
        lost          = '  NO CONNECTION {0} s'
        log_lost      = 'Connection lost: {0}'
        log_back      = 'Connection back after {0} s'
        log_restart   = 'The Shelly restarted (up {0} s, reason {1})'
        stopped_key   = 'Stopped.'
        stopped_time  = 'Recording time is up.'
        summary       = 'Recorded {0}: {1} rows, {2} connection breaks.'
        zip           = 'Send this file to whoever is helping you:'
        zip_fail      = 'Could not make the zip file ({0}). Send the files {2}* in {1}.'
        press_enter   = 'Press Enter to close the window'
        error         = 'Error: {0}'
    }
}
if (-not $Lang) { if ((Get-Culture).Name -like 'fi*') { $Lang = 'fi' } else { $Lang = 'en' } }

function T([string]$key) {
    $s = $Msg[$Lang][$key]
    if ($null -eq $s) { $s = $Msg['en'][$key] }
    $s = $s.Replace('{a}', [string][char]0xE4).Replace('{o}', [string][char]0xF6).Replace('{A}', [string][char]0xC4).Replace('{O}', [string][char]0xD6)
    if ($args.Count -gt 0) { $s = [string]::Format($Inv, $s, $args) }
    return $s
}

# ---- HTTP and RPC ------------------------------------------------------------------------
$script:ShellyHost = ''
$script:Auth = $null          # digest challenge: realm, nonce, algo, nc
$script:Pw = $Password
$script:RpcId = 0
$script:UseNoProxy = $PSVersionTable.PSVersion.Major -ge 6
if (-not $script:UseNoProxy) {
    # local addresses straight to the device, not through a system proxy
    try { [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy } catch { }
}

function Get-Hex([string]$s, [string]$algo) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($s)
    if ($algo -like 'SHA-256*') { $h = [Security.Cryptography.SHA256]::Create() } else { $h = [Security.Cryptography.MD5]::Create() }
    $d = $h.ComputeHash($bytes)
    return (($d | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Read-Challenge([string]$header) {
    $c = @{ realm = ''; nonce = ''; algo = 'SHA-256'; nc = 0 }
    $h = $header -replace '^\s*[Dd]igest\s+', ''
    foreach ($m in [regex]::Matches($h, '(\w+)\s*=\s*("([^"]*)"|[^,\s]+)')) {
        $k = $m.Groups[1].Value.ToLower()
        if ($m.Groups[3].Success) { $v = $m.Groups[3].Value } else { $v = $m.Groups[2].Value }
        if ($k -eq 'realm') { $c.realm = $v }
        elseif ($k -eq 'nonce') { $c.nonce = $v }
        elseif ($k -eq 'algorithm') { $c.algo = $v }
    }
    return $c
}

# Shelly Gen2 digest authentication (user admin, SHA-256)
function New-DigestHeader([string]$method, [string]$uri) {
    $a = $script:Auth
    $a.nc = $a.nc + 1
    $nc = $a.nc.ToString('x8')
    $cnonce = [Guid]::NewGuid().ToString('N').Substring(0, 16)
    $ha1 = Get-Hex ('admin:' + $a.realm + ':' + $script:Pw) $a.algo
    $ha2 = Get-Hex ($method + ':' + $uri) $a.algo
    $resp = Get-Hex ($ha1 + ':' + $a.nonce + ':' + $nc + ':' + $cnonce + ':auth:' + $ha2) $a.algo
    return ('Digest username="admin", realm="' + $a.realm + '", nonce="' + $a.nonce + '", uri="' + $uri + '", algorithm=' + $a.algo +
        ', response="' + $resp + '", qop=auth, nc=' + $nc + ', cnonce="' + $cnonce + '"')
}

function Get-HttpStatus($err) {
    try { $r = $err.Exception.Response; if ($r) { return [int]$r.StatusCode } } catch { }
    return 0
}

function Get-AuthHeader($err) {
    $r = $err.Exception.Response
    $v = $null
    try { $v = $r.Headers['WWW-Authenticate'] } catch { }                                            # PowerShell 5.1
    if (-not $v) { try { $v = (($r.Headers.WwwAuthenticate | ForEach-Object { $_.ToString() }) -join ', ') } catch { } }   # PowerShell 7
    return $v
}

# One HTTP request to the Shelly. Returns the response body as text, throws on failure.
function Invoke-Shelly([string]$method, [string]$path, [string]$body, [int]$timeoutS) {
    if (-not $timeoutS) { $timeoutS = 3 }
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        $headers = @{}
        if ($script:Auth -and $script:Pw) { $headers['Authorization'] = New-DigestHeader $method $path }
        $p = @{ Uri = ('http://' + $script:ShellyHost + $path); Method = $method; Headers = $headers; TimeoutSec = $timeoutS; UseBasicParsing = $true }
        if ($body) { $p['Body'] = $body; $p['ContentType'] = 'application/json' }
        if ($script:UseNoProxy) { $p['NoProxy'] = $true }
        try {
            $r = Invoke-WebRequest @p
            $c = $r.Content
            if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
            return [string]$c
        } catch {
            if ((Get-HttpStatus $_) -eq 401 -and $attempt -eq 0) {
                $wa = Get-AuthHeader $_
                if (-not $wa) { throw }
                $script:Auth = Read-Challenge $wa
                if (-not $script:Pw) { throw (New-Object Exception 'AUTH') }
                continue
            }
            throw
        }
    }
    throw (New-Object Exception 'AUTH')
}

function Invoke-Rpc([string]$method, $params, [int]$timeoutS) {
    $script:RpcId++
    $req = @{ id = $script:RpcId; method = $method }
    if ($null -ne $params) { $req['params'] = $params }
    $txt = Invoke-Shelly 'POST' '/rpc' ($req | ConvertTo-Json -Compress -Depth 6) $timeoutS
    $res = $txt | ConvertFrom-Json
    if ($res.PSObject.Properties['error']) { throw (New-Object Exception ($method + ': ' + $res.error.message)) }
    return $res.result
}

function Get-Prop($o, [string]$name) {
    if ($null -eq $o) { return $null }
    $p = $o.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}

function Get-Num($o, [string[]]$names) {
    foreach ($n in $names) {
        $v = Get-Prop $o $n
        if ($null -ne $v -and ($v -is [ValueType])) { return [double]$v }
    }
    return $null
}

function Fmt($x, [string]$f) {
    if ($null -eq $x) { return '' }
    return ([double]$x).ToString($f, $Inv)
}

function Format-Duration([double]$s) {
    $s = [Math]::Round($s)
    if ($s -lt 60) { return ($s.ToString($Inv) + ' s') }
    $h = [Math]::Floor($s / 3600); $m = [Math]::Floor(($s % 3600) / 60)
    if ($h -lt 1) { return ($m.ToString($Inv) + ' min') }
    return ($h.ToString($Inv) + ' h ' + $m.ToString('00', $Inv) + ' min')
}

function Read-Number([string]$prompt, [double]$default) {
    while ($true) {
        $a = Read-Host $prompt
        if (-not $a -or -not $a.Trim()) { return $default }
        $x = 0.0
        if ([double]::TryParse($a.Trim().Replace(',', '.'), [Globalization.NumberStyles]::Float, $Inv, [ref]$x) -and $x -ge 0) { return $x }
        Write-Host (T 'bad_number')
    }
}

# ---- power meter -------------------------------------------------------------------------
# Status fields of the supported meter components, in order of preference.
$MeterTypes = @(
    @{ prefix = 'em1';    method = 'EM1.GetStatus';    p = @('act_power');       u = @('voltage');   i = @('current');       pf = @('pf');   f = @('freq') },
    @{ prefix = 'pm1';    method = 'PM1.GetStatus';    p = @('apower');          u = @('voltage');   i = @('current');       pf = @('pf');   f = @('freq') },
    @{ prefix = 'switch'; method = 'Switch.GetStatus'; p = @('apower');          u = @('voltage');   i = @('current');       pf = @('pf');   f = @('freq') },
    @{ prefix = 'em';     method = 'EM.GetStatus';     p = @('total_act_power'); u = @('a_voltage'); i = @('total_current'); pf = @('a_pf'); f = @('a_freq', 'c_freq') }
)

function Find-Meters($status) {
    $found = @()
    foreach ($t in $MeterTypes) {
        foreach ($prop in $status.PSObject.Properties) {
            if ($prop.Name -match ('^' + $t.prefix + ':(\d+)$')) {
                $p = Get-Num $prop.Value $t.p
                if ($null -eq $p) { continue }    # e.g. a switch without power metering
                $found += @{ key = $prop.Name; id = [int]$Matches[1]; type = $t; p = $p; u = (Get-Num $prop.Value $t.u) }
            }
        }
    }
    return , $found
}

# ---- Uponor script -----------------------------------------------------------------------
function Find-UponorScript {
    try { $list = Invoke-Rpc 'Script.List' $null } catch { return $null }
    $scripts = @($list.scripts | Where-Object { $_.running })
    $sorted = @($scripts | Where-Object { $_.name -match 'uponor|clean|puhdistamo' }) + @($scripts | Where-Object { $_.name -notmatch 'uponor|clean|puhdistamo' })
    foreach ($s in ($sorted | Select-Object -First 5)) {
        try {
            $st = (Invoke-Shelly 'GET' ('/script/' + $s.id + '/state') $null 3) | ConvertFrom-Json
            if ((Get-Prop $st 'version') -and (Get-Prop $st 'phase')) { return @{ id = $s.id; name = $s.name; state = $st } }
        } catch { }
    }
    return $null
}

# ---- keep Windows awake ------------------------------------------------------------------
function Set-KeepAwake([bool]$on) {
    if ($env:OS -ne 'Windows_NT') { return $false }
    try {
        if (-not ('Uc.Power' -as [type])) {
            Add-Type -Namespace Uc -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
        }
        # ES_CONTINUOUS | ES_SYSTEM_REQUIRED keeps the system awake; ES_CONTINUOUS alone releases it
        if ($on) { $flags = [uint32]2147483649 } else { $flags = [uint32]2147483648 }
        [void][Uc.Power]::SetThreadExecutionState($flags)
        return $true
    } catch { return $false }
}

function Test-StopKey {
    try {
        while ([Console]::KeyAvailable) {
            $k = [Console]::ReadKey($true)
            if ($k.Key -eq [ConsoleKey]::Q) { return $true }
            if ($k.Key -eq [ConsoleKey]::C -and ($k.Modifiers -band [ConsoleModifiers]::Control)) { return $true }
        }
    } catch { }
    return $false
}

function Add-LogLine([string]$text) {
    $line = [DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz", $Inv) + '  ' + $text
    try { [IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, $script:Utf8) } catch { }
}

# ---- start -------------------------------------------------------------------------------
Write-Host ''
Write-Host (T 'title' $RecorderVersion)
Write-Host (T 'intro')
Write-Host ''

$ctrlC = $null
$writer = $null
$awake = $false
$rows = 0
$exitCode = 0
try {
    # device
    $dev = $null
    while (-not $dev) {
        if (-not $Ip) { $Ip = Read-Host (T 'ask_ip') }
        $script:ShellyHost = ($Ip.Trim() -replace '^https?://', '' -replace '/.*$', '')
        if (-not $script:ShellyHost) { $Ip = ''; continue }
        try {
            $dev = (Invoke-Shelly 'GET' '/shelly' $null 5) | ConvertFrom-Json
            if (-not (Get-Prop $dev 'model') -and -not (Get-Prop $dev 'type')) { Write-Host (T 'not_shelly' $script:ShellyHost); $dev = $null }
        } catch {
            Write-Host (T 'no_answer' $script:ShellyHost ($_.Exception.Message))
            $dev = $null
        }
        if (-not $dev) {
            if ($PSBoundParameters.ContainsKey('Ip')) { throw (New-Object Exception (T 'not_shelly' $script:ShellyHost)) }
            $Ip = ''
        }
    }
    if (-not (Get-Prop $dev 'gen')) { throw (New-Object Exception (T 'gen1')) }
    Write-Host (T 'device' (Get-Prop $dev 'model') (Get-Prop $dev 'ver'))

    # password
    $status = $null
    for ($try = 0; $try -lt 4 -and -not $status; $try++) {
        try { $status = Invoke-Rpc 'Shelly.GetStatus' $null 8 }
        catch {
            if ($_.Exception.Message -ne 'AUTH' -and (Get-HttpStatus $_) -ne 401) { throw }
            if ($try -eq 3 -or $PSBoundParameters.ContainsKey('Password')) { throw (New-Object Exception (T 'pw_bad')) }
            if ($script:Pw) { Write-Host (T 'pw_bad') }
            $sec = Read-Host (T 'ask_pw') -AsSecureString
            $script:Pw = (New-Object System.Net.NetworkCredential('', $sec)).Password
            $script:Auth = $null
        }
    }

    # meter
    $meters = Find-Meters $status
    if ($meters.Count -eq 0) { throw (New-Object Exception (T 'no_meter')) }
    $meter = $meters[0]
    if ($meters.Count -gt 1) {
        Write-Host (T 'channels')
        for ($k = 0; $k -lt $meters.Count; $k++) { Write-Host (T 'channel_row' ($k + 1) ($meters[$k].key) (Fmt $meters[$k].p '0.0')) }
        $choice = [int](Read-Number (T 'ask_channel') 1)
        if ($choice -ge 1 -and $choice -le $meters.Count) { $meter = $meters[$choice - 1] }
    }
    Write-Host (T 'meter' ($meter.key) (Fmt $meter.p '0.0') (Fmt $meter.u '0.0'))

    # Uponor script
    $us = Find-UponorScript
    if ($us) { Write-Host (T 'script_found' ($us.state.version) ($us.id) ($us.state.cycle) ($us.state.phase)) } else { Write-Host (T 'script_none') }

    # time and files
    if ($Hours -lt 0) { $Hours = Read-Number (T 'ask_hours') 48 }
    if (-not $OutDir) { if ($PSScriptRoot) { $OutDir = $PSScriptRoot } else { $OutDir = [Environment]::GetFolderPath('MyDocuments') } }
    if (-not (Test-Path -LiteralPath $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir) }
    $OutDir = (Resolve-Path -LiteralPath $OutDir).Path
    $base = 'uponor_' + (Get-Date).ToString('yyyyMMdd_HHmm', $Inv)
    $csvPath = Join-Path $OutDir ($base + '.csv')
    $infoPath = Join-Path $OutDir ($base + '_info.json')
    $minPath = Join-Path $OutDir ($base + '_minutes.csv')
    $script:LogPath = Join-Path $OutDir ($base + '_log.txt')
    $zipPath = Join-Path $OutDir ($base + '.zip')

    # device information (without the MAC address and device id)
    $info = [ordered]@{
        recorder = $RecorderVersion
        powershell = $PSVersionTable.PSVersion.ToString()
        started = [DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", $Inv)
        interval_s = $IntervalS
        device = [ordered]@{ model = (Get-Prop $dev 'model'); gen = (Get-Prop $dev 'gen'); app = (Get-Prop $dev 'app'); fw_id = (Get-Prop $dev 'fw_id'); ver = (Get-Prop $dev 'ver'); auth_en = (Get-Prop $dev 'auth_en') }
        meter = $meter.key
        meter_status = (Get-Prop $status $meter.key)
    }
    $sys0 = Get-Prop $status 'sys'
    if ($sys0) {
        $info['sys_start'] = [ordered]@{ uptime = (Get-Prop $sys0 'uptime'); unixtime = (Get-Prop $sys0 'unixtime'); time = (Get-Prop $sys0 'time'); reset_reason = (Get-Prop $sys0 'reset_reason'); ram_free = (Get-Prop $sys0 'ram_free') }
        $ut = Get-Prop $sys0 'unixtime'
        if ($ut) { $info['clock_offset_s'] = [Math]::Round([double]$ut - [DateTimeOffset]::Now.ToUnixTimeMilliseconds() / 1000.0, 1) }
    }
    $wifi = Get-Prop $status 'wifi'
    if ($wifi) { $info['wifi_rssi'] = Get-Prop $wifi 'rssi' }
    try { $cfg = Invoke-Rpc 'Sys.GetConfig' $null; $loc = Get-Prop $cfg 'location'; if ($loc) { $info['tz'] = Get-Prop $loc 'tz' } } catch { }
    try { $info['scripts'] = @((Invoke-Rpc 'Script.List' $null).scripts | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; enable = $_.enable; running = $_.running } }) } catch { }
    if ($us) {
        $info['uponor_script'] = [ordered]@{ id = $us.id; name = $us.name; state_start = $us.state }
        try { $info['kvs'] = Invoke-Rpc 'KVS.GetMany' @{ match = 'uc_*' } } catch { }
    }
    [IO.File]::WriteAllText($infoPath, ($info | ConvertTo-Json -Depth 8), $script:Utf8)

    # the Shelly's own minute data for the last 7 days (EM devices)
    $dataKey = $null
    if ($meter.type.prefix -eq 'em1' -and (Get-Prop $status ('em1data:' + $meter.id))) { $dataKey = 'em1data' }
    if ($meter.type.prefix -eq 'em' -and (Get-Prop $status ('emdata:' + $meter.id))) { $dataKey = 'emdata' }
    if ($dataKey) {
        try {
            $ts = [DateTimeOffset]::Now.ToUnixTimeSeconds() - 7 * 86400
            $txt = Invoke-Shelly 'GET' ('/' + $dataKey + '/' + $meter.id + '/data.csv?ts=' + $ts + '&add_keys=true') $null 60
            [IO.File]::WriteAllText($minPath, $txt, $script:Utf8)
            Write-Host (T 'minutes_ok' ([Math]::Max(0, ($txt -split "`n" | Where-Object { $_.Trim() }).Count - 1)))
        } catch { Write-Host (T 'minutes_fail' ($_.Exception.Message)) }
    }

    # recording
    $writer = New-Object IO.StreamWriter($csvPath, $false, $script:Utf8)
    $writer.AutoFlush = $true
    try { while ([Console]::KeyAvailable) { [void][Console]::ReadKey($true) } } catch { }   # keys typed ahead do not stop the recording
    $writer.WriteLine('time,power_w,voltage_v,current_a,pf,freq_hz,script_phase,script_cycle,script_band,script_since')
    $awake = Set-KeepAwake $true
    try { $ctrlC = [Console]::TreatControlCAsInput; [Console]::TreatControlCAsInput = $true } catch { $ctrlC = $null }

    $t0 = Get-Date
    Write-Host ''
    if ($Hours -gt 0) { Write-Host (T 'start' ($t0.ToString('HH:mm', $Inv)) ($t0.AddHours($Hours).ToString('d.M. HH:mm', $Inv))) } else { Write-Host (T 'start_open' ($t0.ToString('HH:mm', $Inv))) }
    Write-Host (T 'files' $OutDir)
    Write-Host (T 'howto_stop')
    if ($awake) { Write-Host (T 'keep_awake') }
    Write-Host ''
    Add-LogLine ('start ' + $meter.key + ' ' + (Get-Prop $dev 'model') + ' ' + (Get-Prop $dev 'ver'))

    $intervalMs = [Math]::Max(200, [int]($IntervalS * 1000))
    $endMs = [double]::PositiveInfinity
    if ($Hours -gt 0) { $endMs = $Hours * 3600000.0 }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $nextMs = 0.0
    $ph = ''; $cy = ''; $band = ''; $since = ''
    $nextScriptMs = 0.0; $nextSysMs = 60000.0; $nextStatusMs = 0.0
    $lastUptime = $null; if ($sys0) { $lastUptime = Get-Prop $sys0 'uptime' }
    $breaks = 0; $failSince = $null
    $lastP = $null; $lastU = $null
    $stopReason = 'stopped_time'

    :rec while ($clock.ElapsedMilliseconds -lt $endMs) {
        $now = [DateTimeOffset]::Now
        try {
            $s = Invoke-Rpc $meter.type.method @{ id = $meter.id } 3
            $p = Get-Num $s $meter.type.p; $u = Get-Num $s $meter.type.u
            if ($null -ne $failSince) {
                Add-LogLine (T 'log_back' ([Math]::Round(($now - $failSince).TotalSeconds)))
                $failSince = $null
                $nextSysMs = 0.0; $nextScriptMs = 0.0   # did the Shelly restart?
            }
            if ($us -and $clock.ElapsedMilliseconds -ge $nextScriptMs) {
                $nextScriptMs = $clock.ElapsedMilliseconds + 10000
                try {
                    $st = (Invoke-Shelly 'GET' ('/script/' + $us.id + '/state') $null 3) | ConvertFrom-Json
                    $ph = [string](Get-Prop $st 'phase'); $cy = [string](Get-Prop $st 'cycle'); $band = [string](Get-Prop $st 'band'); $since = [string](Get-Prop $st 'since')
                } catch { }
            }
            if ($clock.ElapsedMilliseconds -ge $nextSysMs) {
                $nextSysMs = $clock.ElapsedMilliseconds + 60000
                try {
                    $sy = Invoke-Rpc 'Sys.GetStatus' $null 3
                    $up = Get-Prop $sy 'uptime'
                    if ($null -ne $lastUptime -and $null -ne $up -and $up -lt $lastUptime) { Add-LogLine (T 'log_restart' $up (Get-Prop $sy 'reset_reason')) }
                    $lastUptime = $up
                } catch { }
            }
            $line = $now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", $Inv) + ',' + (Fmt $p '0.0##') + ',' + (Fmt $u '0.0#') + ',' +
                (Fmt (Get-Num $s $meter.type.i) '0.0##') + ',' + (Fmt (Get-Num $s $meter.type.pf) '0.0#') + ',' + (Fmt (Get-Num $s $meter.type.f) '0.0#') + ',' +
                $ph + ',' + $cy + ',' + $band + ',' + $since
            $writer.WriteLine($line)
            $rows++
            $lastP = $p; $lastU = $u
        } catch {
            if ($null -eq $failSince) {
                $failSince = $now; $breaks++
                Add-LogLine (T 'log_lost' ($_.Exception.Message))
            }
        }

        $el = $clock.ElapsedMilliseconds
        if ($el -ge $nextStatusMs) {
            $nextStatusMs = $el + 10000
            $extra = ''
            if ($ph) { $extra = T 'status_phase' $ph }
            if ($null -ne $failSince) { $extra = T 'lost' ([Math]::Round(([DateTimeOffset]::Now - $failSince).TotalSeconds)) }
            $txt = T 'status' ((Get-Date).ToString('HH:mm:ss', $Inv)) (Fmt $lastP '0.0') (Fmt $lastU '0') $rows $breaks $extra
            Write-Host -NoNewline ("`r" + $txt.PadRight(79))
        }

        $nextMs += $intervalMs
        if ($nextMs -lt $clock.ElapsedMilliseconds) { $nextMs = [double]$clock.ElapsedMilliseconds }   # fell behind (e.g. timeouts)
        while ($clock.ElapsedMilliseconds -lt $nextMs) {
            if (Test-StopKey) { $stopReason = 'stopped_key'; break rec }
            Start-Sleep -Milliseconds ([int][Math]::Min(100, [Math]::Max(1, $nextMs - $clock.ElapsedMilliseconds)))
        }
        if (Test-StopKey) { $stopReason = 'stopped_key'; break }
    }

    Write-Host ''
    Write-Host ''
    Write-Host (T $stopReason)
    $writer.Close(); $writer = $null
    Add-LogLine ('end, ' + $rows + ' rows')

    # final state, packed with the other files
    $info['ended'] = [DateTimeOffset]::Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", $Inv)
    $info['rows'] = $rows
    $info['connection_breaks'] = $breaks
    try { $sy = Invoke-Rpc 'Sys.GetStatus' $null 3; $info['sys_end'] = [ordered]@{ uptime = (Get-Prop $sy 'uptime'); unixtime = (Get-Prop $sy 'unixtime'); reset_reason = (Get-Prop $sy 'reset_reason'); ram_free = (Get-Prop $sy 'ram_free') } } catch { }
    if ($us) { try { $info['uponor_script']['state_end'] = (Invoke-Shelly 'GET' ('/script/' + $us.id + '/state') $null 3) | ConvertFrom-Json } catch { } }
    [IO.File]::WriteAllText($infoPath, ($info | ConvertTo-Json -Depth 8), $script:Utf8)

    Write-Host (T 'summary' (Format-Duration ((Get-Date) - $t0).TotalSeconds) $rows $breaks)
    $files = @($csvPath, $infoPath, $script:LogPath, $minPath) | Where-Object { Test-Path -LiteralPath $_ }
    try {
        Compress-Archive -LiteralPath $files -DestinationPath $zipPath -Force
        Write-Host ''
        Write-Host (T 'zip')
        Write-Host ('  ' + $zipPath)
    } catch {
        Write-Host (T 'zip_fail' ($_.Exception.Message) $OutDir $base)
    }
} catch {
    Write-Host ''
    Write-Host (T 'error' ($_.Exception.Message))
    $exitCode = 1
} finally {
    if ($writer) { try { $writer.Close() } catch { } }
    if ($awake) { [void](Set-KeepAwake $false) }
    if ($null -ne $ctrlC) { try { [Console]::TreatControlCAsInput = $ctrlC } catch { } }
}

if (-not $NoWait) {
    Write-Host ''
    [void](Read-Host (T 'press_enter'))
}
exit $exitCode
