// Independent macOS decoder. Reads explicit local test inputs, never executes them.
import Foundation
import CoreGraphics
import ImageIO

struct DecodedImage: Encodable {
    let name: String
    let width: Int
    let height: Int
    let nonOpaquePixels: Int
    let rgbaBase64: String
}

do {
    var results: [DecodedImage] = []
    for file in CommandLine.arguments.dropFirst() {
        let url = URL(fileURLWithPath: file)
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 20 * 1024 * 1024,
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 2_000_000 / height,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width * image.height <= 2_000_000 else {
            throw NSError(domain: "PSDOracle", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported or oversized image: \(url.lastPathComponent)"])
        }
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try pixels.withUnsafeMutableBytes { memory in
            guard let context = CGContext(data: memory.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
                throw NSError(domain: "PSDOracle", code: 2)
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let count = stride(from: 3, to: pixels.count, by: 4).filter { pixels[$0] < 255 }.count
        results.append(DecodedImage(name: url.lastPathComponent, width: image.width, height: image.height,
            nonOpaquePixels: count, rgbaBase64: Data(pixels).base64EncodedString()))
    }
    let json = try JSONEncoder().encode(results)
    FileHandle.standardOutput.write(json)
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
