// Demo D1: read the text in every frame (macOS Vision), so the privacy check greps real text instead of squinting.
//   swiftc -O video/demo/ocr.swift -o video/out/demo/work/ocr && video/out/demo/work/ocr frame1.png frame2.png …
import AppKit
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    for observation in request.results ?? [] {
        if let line = observation.topCandidates(1).first {
            print("\(URL(fileURLWithPath: path).lastPathComponent)\t\(line.string)")
        }
    }
}
