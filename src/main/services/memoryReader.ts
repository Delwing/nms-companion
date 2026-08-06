/**
 * Experimental, opt-in: recover procedural system and planet names by
 * reading the running game's memory (read-only). Procedural names are never
 * written to save files — they exist only inside the game process, where
 * the discovery store keeps them resolved per record.
 *
 * Record layout (verified against NMS 6.45 Game Pass, and guarded by the
 * calibration check below rather than trusted blindly): packed universal
 * address at record+0x40, discovery-type byte at +0x70 (1 = solar system,
 * 2 = planet), display name at +0x80 — i.e. relative to the UA hit: type
 * at +0x30, name at +0x40.
 *
 * The scan self-calibrates: entries whose names we already know (station
 * teleporters, custom renames) are scanned too, and if the memory names
 * disagree with them the harvest is discarded — a game update that moved
 * the layout fails closed instead of writing garbage.
 */
import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { HarvestResult } from '../../shared/types'
import { systemBaseName } from './systemMatcher'

export interface HarvestTarget {
  kind: 'system' | 'planet'
  /** Canonical address of the system (for planets: the owning system). */
  universalAddress: string
  /** Planet digit within the system; only set for planet targets. */
  planetIndex?: number
  /** 16-hex-digit little-endian packed UA to scan for. */
  ua: string
  /** Catalogued name for calibration; null when the entry is unnamed. */
  knownName: string | null
}

/** Discovery-type byte the record carries for each target kind. */
const DISCOVERY_TYPE: Record<HarvestTarget['kind'], number> = { system: 1, planet: 2 }

/**
 * Little-endian packed GcUniverseAddressData as hex, from a canonical
 * "R{reality}:{x}:{y}:{z}:{ssi}" address. Same 56-bit packing the save's
 * discovery records use (see decodeHexAddress in saveParser). System
 * records carry planet digit 0; planet records their planet digit.
 */
export function packedUaHexFromAddress(
  universalAddress: string,
  planetIndex = 0
): string | null {
  const m = /^R(\d+):(-?\d+):(-?\d+):(-?\d+):(\d+)$/.exec(universalAddress)
  if (!m) return null
  const [, reality, x, y, z, ssi] = m.map(Number)
  const value =
    (BigInt(planetIndex & 0xf) << 52n) |
    (BigInt(ssi) << 40n) |
    (BigInt(reality & 0xff) << 32n) |
    (BigInt(y & 0xff) << 24n) |
    (BigInt(z & 0xfff) << 12n) |
    BigInt(x & 0xfff)
  let hex = ''
  for (let i = 0n; i < 8n; i++) {
    hex += ((value >> (8n * i)) & 0xffn).toString(16).padStart(2, '0')
  }
  return hex
}

/** Minimum known-name agreements before a harvest is trusted. */
const CALIBRATION_MIN = 3
/** Required agreement rate among known-named entries that produced a hit. */
const CALIBRATION_RATE = 0.6

/**
 * Does a scanned string look like a name the game could have generated
 * (or a player typed)? Stray UA copies sometimes land in front of other
 * printable data — ID-like strings full of digit runs or repeated
 * characters (e.g. "-orj0000000000000001") are scan noise, not names.
 */
export function plausibleSystemName(name: string): boolean {
  return (
    name.length >= 2 &&
    name.length <= 40 &&
    /[a-zA-Z]/.test(name) &&
    !/\d{6,}/.test(name) &&
    !/(.)\1{4,}/.test(name)
  )
}

function calibrationFailed(cal: { matched: number; compared: number }): boolean {
  return cal.compared >= CALIBRATION_MIN && cal.matched / cal.compared < CALIBRATION_RATE
}

/**
 * Turn the scanner's "HIT <ua> <name>" lines into per-entry names. A name
 * is accepted only when every validated hit for its address agrees. The
 * two kinds calibrate independently: a system-calibration failure discards
 * everything (the layout itself is suspect); a planet-calibration failure
 * discards only the planet names (planet knowns include OCR-typed names,
 * which are noisier).
 */
export function aggregateHarvest(lines: string[], targets: HarvestTarget[]): HarvestResult {
  const hitsByUa = new Map<string, Set<string>>()
  for (const line of lines) {
    const m = /^HIT\t([0-9a-f]{16})\t(.+)$/.exec(line.trim())
    if (!m || !plausibleSystemName(m[2])) continue
    if (!hitsByUa.has(m[1])) hitsByUa.set(m[1], new Set())
    hitsByUa.get(m[1])!.add(m[2])
  }

  const calibration = { matched: 0, compared: 0 }
  const planetCalibration = { matched: 0, compared: 0 }
  const named: { universalAddress: string; name: string }[] = []
  const namedPlanets: { systemAddress: string; planetIndex: number; name: string }[] = []
  for (const target of targets) {
    const names = hitsByUa.get(target.ua)
    if (!names || names.size !== 1) continue // no hit, or conflicting reads
    const name = [...names][0]
    if (target.knownName) {
      const cal = target.kind === 'system' ? calibration : planetCalibration
      cal.compared++
      // Station labels wrap the system name ("Leuz Station Tau" -> "Leuz");
      // planet knowns are compared verbatim.
      const expected =
        target.kind === 'system' ? systemBaseName(target.knownName) : target.knownName
      if (name.toLowerCase() === expected.toLowerCase()) cal.matched++
    } else if (target.kind === 'system') {
      named.push({ universalAddress: target.universalAddress, name })
    } else if (target.planetIndex !== undefined) {
      namedPlanets.push({
        systemAddress: target.universalAddress,
        planetIndex: target.planetIndex,
        name
      })
    }
  }

  if (calibrationFailed(calibration)) {
    return {
      ok: false,
      error: 'calibration-failed',
      named: [],
      namedPlanets: [],
      calibration,
      planetCalibration
    }
  }
  return {
    ok: true,
    named,
    namedPlanets: calibrationFailed(planetCalibration) ? [] : namedPlanets,
    calibration,
    planetCalibration
  }
}

/** PowerShell/C# scanner: read-only pass over the game's private memory,
 *  emitting one "HIT <ua-hex> <name>" line per validated discovery record. */
const SCANNER_PS1 = String.raw`
param([int]$ProcessId, [string]$TargetsPath)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class NmsNameScanner {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
    [DllImport("kernel32.dll")]
    static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr size);

    [StructLayout(LayoutKind.Sequential)]
    public struct MBI {
        public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
        public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
    }

    public static List<string> Lines = new List<string>();

    static bool Readable(uint p) {
        return p == 0x02 || p == 0x04 || p == 0x08 || p == 0x20 || p == 0x40 || p == 0x80;
    }

    // Discovery-record shape around a UA at offset i (measured empirically):
    // a small value at +0x10, zeros to +0x2F, then two copies of the quad
    // [discovery-type, 0, 0, 0, 01, 02, 0, 0] at +0x30 and +0x38.
    static bool LooksLikeRecord(byte[] buf, int i, int bufLen, byte dt) {
        if (i + 0x40 > bufLen) return false;
        for (int k = 0x11; k < 0x30; k++) if (buf[i + k] != 0) return false;
        for (int r = 0x30; r <= 0x38; r += 8) {
            if (buf[i + r] != dt) return false;
            if (buf[i + r + 1] != 0 || buf[i + r + 2] != 0 || buf[i + r + 3] != 0) return false;
            if (buf[i + r + 4] != 1 || buf[i + r + 5] != 2) return false;
            if (buf[i + r + 6] != 0 || buf[i + r + 7] != 0) return false;
        }
        return true;
    }

    // Display name lives in a name box right after the packed UA (+0x40):
    // printable ASCII, null-terminated. The box is NOT reliably zero-padded —
    // the game reuses boxes and leaves residue from longer previous strings
    // after the terminator (seen live: "Logangjum\0S\0…"), so only the part
    // up to the first NUL is meaningful.
    static string NameAt(byte[] buf, int pos, int bufLen) {
        int max = Math.Min(pos + 0x40, bufLen);
        int end = pos;
        while (end < max && buf[end] != 0) {
            byte c = buf[end];
            if (c < 0x20 || c >= 0x7F) return null;
            end++;
        }
        if (end == pos || end == max) return null;
        string s = Encoding.ASCII.GetString(buf, pos, end - pos).Trim();
        return s.Length >= 2 ? s : null;
    }

    public static int Scan(int pid, byte[][] uas, string[] uaHex, byte[] types) {
        IntPtr h = OpenProcess(0x0410, false, pid);
        if (h == IntPtr.Zero) return Marshal.GetLastWin32Error();

        Dictionary<byte, List<int>> byFirst = new Dictionary<byte, List<int>>();
        for (int i = 0; i < uas.Length; i++) {
            byte f = uas[i][0];
            if (!byFirst.ContainsKey(f)) byFirst[f] = new List<int>();
            byFirst[f].Add(i);
        }

        long addr = 0;
        while (addr < 0x00007FFFFFFF0000L) {
            MBI mbi;
            if (VirtualQueryEx(h, (IntPtr)addr, out mbi, (IntPtr)Marshal.SizeOf(typeof(MBI))) == 0) break;
            long size = mbi.RegionSize.ToInt64();
            if (size <= 0) break;
            if (mbi.State == 0x1000 && mbi.Type == 0x20000 && Readable(mbi.Protect) && size <= 0x40000000L) {
                long b = mbi.BaseAddress.ToInt64();
                int chunk = 0x100000;
                byte[] buf = new byte[chunk + 0x90];
                for (long off = 0; off < size; off += chunk) {
                    int want = (int)Math.Min((long)chunk + 0x90, size - off);
                    IntPtr got;
                    if (!ReadProcessMemory(h, (IntPtr)(b + off), buf, (IntPtr)want, out got)) continue;
                    int len = (int)got.ToInt64();
                    int limit = len - 8 - 0x80;
                    for (int i = 0; i <= limit; i++) {
                        List<int> cands;
                        if (!byFirst.TryGetValue(buf[i], out cands)) continue;
                        foreach (int t in cands) {
                            byte[] pat = uas[t];
                            bool ok = true;
                            for (int j = 1; j < 8; j++) { if (buf[i + j] != pat[j]) { ok = false; break; } }
                            if (!ok || !LooksLikeRecord(buf, i, len, types[t])) continue;
                            string name = NameAt(buf, i + 0x40, len);
                            if (name != null) Lines.Add("HIT" + "\t" + uaHex[t] + "\t" + name);
                        }
                    }
                }
            }
            addr = mbi.BaseAddress.ToInt64() + size;
        }
        return 0;
    }
}
"@

$targets = Get-Content $TargetsPath -Raw | ConvertFrom-Json
$uas = @(); $uaHex = @(); $types = @()
foreach ($t in $targets) {
    $bytes = New-Object byte[] 8
    for ($i = 0; $i -lt 8; $i++) { $bytes[$i] = [Convert]::ToByte($t.u.Substring($i * 2, 2), 16) }
    $uas += ,$bytes
    $uaHex += $t.u
    $types += [byte]$t.t
}
$err = [NmsNameScanner]::Scan($ProcessId, $uas, [string[]]$uaHex, [byte[]]$types)
if ($err -ne 0) { Write-Output ("OPEN_FAILED" + [char]9 + $err); exit 2 }
[NmsNameScanner]::Lines | ForEach-Object { $_ }
Write-Output "SCAN_DONE"
`

function run(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve({ code: error ? ((error as any).code ?? 1) : 0, stdout: stdout ?? '' })
      }
    )
  })
}

/** PID of the running game, or null. Both Steam and Game Pass run NMS.exe. */
export async function findGameProcess(): Promise<number | null> {
  const { stdout } = await run(
    'tasklist',
    ['/FI', 'IMAGENAME eq NMS.exe', '/FO', 'CSV', '/NH'],
    15000
  )
  const m = /^"NMS\.exe","(\d+)"/m.exec(stdout)
  return m ? Number(m[1]) : null
}

export interface HarvestSystemInput {
  universalAddress: string
  name: string
}

export interface HarvestPlanetInput {
  systemAddress: string | null
  planetIndex: number | null
  name: string
}

/** The save-import placeholder a planet keeps until it gets a real name. */
function isPlaceholderPlanetName(planet: HarvestPlanetInput): boolean {
  return planet.name === `Planet ${planet.planetIndex}`
}

export function buildTargets(
  systems: HarvestSystemInput[],
  planets: HarvestPlanetInput[]
): HarvestTarget[] {
  const targets: HarvestTarget[] = []
  for (const s of systems) {
    const ua = packedUaHexFromAddress(s.universalAddress)
    if (ua) {
      targets.push({
        kind: 'system',
        universalAddress: s.universalAddress,
        ua,
        knownName: s.name === 'Unknown System' ? null : s.name
      })
    }
  }
  for (const p of planets) {
    // The system record carries planet digit 0, so a real planet 0 would
    // collide with its own system's UA — skip that ambiguous case.
    if (!p.systemAddress || p.planetIndex === null || p.planetIndex === 0) continue
    const ua = packedUaHexFromAddress(p.systemAddress, p.planetIndex)
    if (ua) {
      targets.push({
        kind: 'planet',
        universalAddress: p.systemAddress,
        planetIndex: p.planetIndex,
        ua,
        knownName: isPlaceholderPlanetName(p) ? null : p.name
      })
    }
  }
  return targets
}

/**
 * Scan the running game for names of the given systems and planets.
 * Already-named entries serve as the calibration set; only unnamed ones
 * can receive names. The caller persists `named` / `namedPlanets`.
 */
export async function harvestDiscoveryNames(
  systems: HarvestSystemInput[],
  planets: HarvestPlanetInput[]
): Promise<HarvestResult> {
  const empty = { matched: 0, compared: 0 }
  const fail = (error: string): HarvestResult => ({
    ok: false,
    error,
    named: [],
    namedPlanets: [],
    calibration: empty,
    planetCalibration: empty
  })
  if (process.platform !== 'win32') return fail('unsupported-platform')

  const targets = buildTargets(systems, planets)
  if (!targets.some((t) => t.knownName === null)) {
    return { ok: true, named: [], namedPlanets: [], calibration: empty, planetCalibration: empty }
  }

  const pid = await findGameProcess()
  if (!pid) return fail('game-not-running')

  const workDir = mkdtempSync(join(tmpdir(), 'nms-namescan-'))
  try {
    const scriptPath = join(workDir, 'scan.ps1')
    const targetsPath = join(workDir, 'targets.json')
    writeFileSync(scriptPath, SCANNER_PS1, 'utf8')
    writeFileSync(
      targetsPath,
      JSON.stringify(targets.map((t) => ({ u: t.ua, t: DISCOVERY_TYPE[t.kind] }))),
      'utf8'
    )

    const { code, stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ProcessId', String(pid), '-TargetsPath', targetsPath],
      180000
    )
    const lines = stdout.split(/\r?\n/)
    if (lines.some((l) => l.startsWith('OPEN_FAILED'))) return fail('open-failed')
    if (code !== 0 || !lines.includes('SCAN_DONE')) return fail('scan-failed')
    return aggregateHarvest(lines, targets)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
