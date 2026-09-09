// SpotifyTap — captures Spotify's audio output on macOS 14.2+ using a Core Audio
// process tap (no virtual audio driver needed) and writes raw Float32 PCM to stdout.
//
// stderr line 1: JSON header {"sampleRate":48000,"channels":1}
// stdout: interleaved Float32 little-endian samples, streamed continuously.
//
// Build: swiftc -O -framework CoreAudio -framework AppKit SpotifyTap.swift -o spotifytap

import Foundation
import AppKit
import CoreAudio
import AudioToolbox

let bundleID = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "com.spotify.client"

func log(_ msg: String) {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
}

func fail(_ msg: String, code: Int32 = 1) -> Never {
    log("ERROR: " + msg)
    exit(code)
}

func findPID(bundleID: String) -> pid_t? {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first?.processIdentifier
}

func processObject(for pid: pid_t) -> AudioObjectID {
    var pid = pid
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var obj = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let st = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr,
                                        UInt32(MemoryLayout<pid_t>.size), &pid, &size, &obj)
    if st != noErr { fail("TranslatePIDToProcessObject failed: \(st)") }
    return obj
}

func defaultOutputUID() -> String? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var dev = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == noErr else { return nil }
    var uidAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    size = UInt32(MemoryLayout<CFString>.size)
    guard AudioObjectGetPropertyData(dev, &uidAddr, 0, nil, &size, &uid) == noErr else { return nil }
    return uid as String
}

guard let pid = findPID(bundleID: bundleID) else {
    fail("\(bundleID) is not running", code: 2)
}
let procObj = processObject(for: pid)

// --- Create the tap -------------------------------------------------------
let tapDesc = CATapDescription(monoMixdownOfProcesses: [procObj])
tapDesc.uuid = UUID()
tapDesc.name = "SpotifyTap"
tapDesc.muteBehavior = .unmuted
tapDesc.isPrivate = true

var tapID = AudioObjectID(kAudioObjectUnknown)
var st = AudioHardwareCreateProcessTap(tapDesc, &tapID)
if st != noErr { fail("AudioHardwareCreateProcessTap failed: \(st) (missing System Audio Recording permission?)", code: 3) }

// --- Read the tap's stream format ----------------------------------------
var asbd = AudioStreamBasicDescription()
var fmtAddr = AudioObjectPropertyAddress(
    mSelector: kAudioTapPropertyFormat,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
var fmtSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
st = AudioObjectGetPropertyData(tapID, &fmtAddr, 0, nil, &fmtSize, &asbd)
if st != noErr { fail("kAudioTapPropertyFormat failed: \(st)") }

// --- Aggregate device wrapping the tap ------------------------------------
var subDevices: [[String: Any]] = []
// Tap-only aggregates run on the tap clock and proved more reliable; set TAP_SUBDEV=1 to clock off the output device.
if ProcessInfo.processInfo.environment["TAP_SUBDEV"] != nil, let outUID = defaultOutputUID() {
    subDevices.append([kAudioSubDeviceUIDKey: outUID])
}
let aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "SpotifyTap Aggregate",
    kAudioAggregateDeviceUIDKey: "spotifytap-" + UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: subDevices,
    kAudioAggregateDeviceTapListKey: [[
        kAudioSubTapDriftCompensationKey: true,
        kAudioSubTapUIDKey: tapDesc.uuid.uuidString,
    ]],
]
var aggID = AudioObjectID(kAudioObjectUnknown)
st = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
if st != noErr { fail("AudioHardwareCreateAggregateDevice failed: \(st)") }

let channels = Int(asbd.mChannelsPerFrame)
log("{\"sampleRate\":\(Int(asbd.mSampleRate)),\"channels\":\(channels),\"pid\":\(pid)}")

// --- IO proc: forward tap input buffers to stdout -------------------------
var procID: AudioDeviceIOProcID?
var callbacks = 0
var bytesOut = 0
var bufDesc = ""
st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inInputData, _, _, _ in
    let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
    callbacks += 1
    if callbacks == 1 { bufDesc = abl.map { "ch\($0.mNumberChannels):\($0.mDataByteSize)B" }.joined(separator: ",") }
    // The tap is the only input source with `channels` channels; write the first matching buffer.
    for buf in abl where Int(buf.mNumberChannels) == channels {
        if let data = buf.mData, buf.mDataByteSize > 0 {
            var off = 0
            let total = Int(buf.mDataByteSize)
            while off < total {
                let n = write(STDOUT_FILENO, data.advanced(by: off), total - off)
                if n <= 0 { exit(0) } // pipe closed → parent went away
                off += n
            }
            bytesOut += total
        }
        break
    }
}
if st != noErr { fail("AudioDeviceCreateIOProcIDWithBlock failed: \(st)") }

st = AudioDeviceStart(aggID, procID)
if st != noErr { fail("AudioDeviceStart failed: \(st)") }

func cleanup() {
    if let p = procID {
        AudioDeviceStop(aggID, p)
        AudioDeviceDestroyIOProcID(aggID, p)
    }
    AudioHardwareDestroyAggregateDevice(aggID)
    AudioHardwareDestroyProcessTap(tapID)
}

signal(SIGINT) { _ in cleanup(); exit(0) }
signal(SIGTERM) { _ in cleanup(); exit(0) }
signal(SIGPIPE) { _ in cleanup(); exit(0) }

// Exit when Spotify quits so the supervisor can restart us later.
// NSRunningApplication occasionally reports nothing for a process that is still alive, which made the
// tap exit and restart every few minutes; check the tapped pid directly with kill(pid, 0) instead and
// only give up after consecutive misses.
var missCount = 0
let watchdog = Timer(timeInterval: 1.0, repeats: true) { _ in
    if ProcessInfo.processInfo.environment["TAP_DEBUG"] != nil { log("callbacks=\(callbacks) bytes=\(bytesOut) bufs=[\(bufDesc)]") }
    if kill(pid, 0) == 0 || errno == EPERM { missCount = 0; return }
    missCount += 1
    if missCount >= 2 {
        log("target process exited")
        cleanup()
        exit(2)
    }
}
RunLoop.main.add(watchdog, forMode: .common)
RunLoop.main.run()
