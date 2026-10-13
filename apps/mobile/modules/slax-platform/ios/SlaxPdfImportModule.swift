import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

public final class SlaxPdfImportModule: Module {
  private var activePicker: SlaxPdfPickerSession?

  public func definition() -> ModuleDefinition {
    Name("SlaxPdfImport")

    AsyncFunction("pick") { (promise: Promise) in
      guard self.activePicker == nil else {
        promise.reject("ERR_PDF_IMPORT", "A PDF picker is already open")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController(),
        presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed,
        !presenter.isBeingPresented, presenter.presentedViewController == nil,
        presenter.view.window?.windowScene?.activationState == .foregroundActive else {
        promise.reject("ERR_PDF_IMPORT", "Active screen unavailable")
        return
      }
      let session = SlaxPdfPickerSession(promise: promise) { [weak self] in self?.activePicker = nil }
      self.activePicker = session
      session.present(from: presenter)
    }.runOnQueue(.main)

    AsyncFunction("remove") { (raw: String, promise: Promise) in
      SlaxPdfImportStorage.queue.async {
        do {
          try SlaxPdfImportStorage.remove(raw)
          promise.resolve(nil)
        } catch {
          promise.reject("ERR_PDF_IMPORT", (error as? SlaxPdfImportFailure)?.message ?? "Unable to remove temporary PDF")
        }
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.activePicker?.invalidate()
      }
    }
  }
}

private final class SlaxPdfPickerSession: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private let promise: Promise
  private let onFinish: () -> Void
  private var picker: UIDocumentPickerViewController?
  private var selected = false
  private var finished = false

  init(promise: Promise, onFinish: @escaping () -> Void) {
    self.promise = promise
    self.onFinish = onFinish
  }

  func present(from presenter: UIViewController) {
    let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: true)
    controller.allowsMultipleSelection = false
    controller.delegate = self
    picker = controller
    presenter.present(controller, animated: true)
    controller.presentationController?.delegate = self
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard !selected, !finished else { return }
    selected = true
    guard urls.count == 1, let source = urls.first, source.isFileURL else {
      finish(.failure(SlaxPdfImportFailure("Choose one PDF file")))
      return
    }
    SlaxPdfImportStorage.queue.async {
      let result: Result<SlaxImportedPdf?, Error>
      do { result = .success(try SlaxPdfImportStorage.copy(source)) }
      catch { result = .failure(error) }
      DispatchQueue.main.async { self.finish(result) }
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard !selected else { return }
    finish(.success(nil))
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard !selected else { return }
    finish(.success(nil))
  }

  func invalidate() {
    guard !finished else { return }
    finished = true
    picker?.dismiss(animated: false)
    picker = nil
    promise.reject("ERR_PDF_IMPORT", "PDF import interrupted")
    onFinish()
  }

  private func finish(_ result: Result<SlaxImportedPdf?, Error>) {
    guard !finished else {
      if case .success(let imported?) = result {
        SlaxPdfImportStorage.queue.async { SlaxPdfImportStorage.discard(imported.file) }
      }
      return
    }
    finished = true
    let complete = {
      self.picker = nil
      self.onFinish()
      switch result {
      case .success(let imported):
        if let imported {
          self.promise.resolve(["uri": imported.file.absoluteString, "name": imported.name, "size": imported.size] as [String: Any])
        } else {
          self.promise.resolve(nil)
        }
      case .failure(let error):
        self.promise.reject("ERR_PDF_IMPORT", (error as? SlaxPdfImportFailure)?.message ?? "Unable to import PDF")
      }
    }
    guard let controller = picker else { complete(); return }
    if controller.isBeingDismissed, let transition = controller.transitionCoordinator {
      if transition.animate(alongsideTransition: nil, completion: { _ in complete() }) { return }
    }
    if controller.presentingViewController != nil {
      controller.dismiss(animated: true, completion: complete)
    } else {
      complete()
    }
  }
}

private struct SlaxImportedPdf {
  let file: URL
  let name: String
  let size: Int
}

private struct SlaxPdfImportFailure: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

private enum SlaxPdfImportStorage {
  static let queue = DispatchQueue(label: "com.slax.reader.pdf-import", qos: .userInitiated)
  private static let maxBytes = 50 * 1024 * 1024
  private static let signature = Data([0x25, 0x50, 0x44, 0x46])

  static func copy(_ source: URL) throws -> SlaxImportedPdf {
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    var coordinationError: NSError?
    var result: Result<SlaxImportedPdf, Error>?
    NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
      result = Result { try copyCoordinated(url) }
    }
    if coordinationError != nil {
      if case .success(let imported)? = result { discard(imported.file) }
      throw SlaxPdfImportFailure("Unable to read PDF")
    }
    guard let result else { throw SlaxPdfImportFailure("Unable to read PDF") }
    return try result.get()
  }

  private static func copyCoordinated(_ source: URL) throws -> SlaxImportedPdf {
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else { throw SlaxPdfImportFailure("Invalid PDF file") }
    guard (values.fileSize ?? 0) <= maxBytes else { throw SlaxPdfImportFailure("PDF must not exceed 50 MiB") }
    let manager = FileManager.default
    let root = try importRoot()
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    let directory = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    try manager.createDirectory(at: directory, withIntermediateDirectories: false)
    let file = directory.appendingPathComponent("document.pdf")
    var complete = false
    defer { if !complete { discard(file) } }
    guard manager.createFile(atPath: file.path, contents: nil) else { throw SlaxPdfImportFailure("Unable to create temporary PDF") }
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    let output = try FileHandle(forWritingTo: file)
    defer { try? output.close() }
    var total = 0
    var header = Data()
    while let chunk = try input.read(upToCount: min(64 * 1024, maxBytes - total + 1)), !chunk.isEmpty {
      total += chunk.count
      guard total <= maxBytes else { throw SlaxPdfImportFailure("PDF must not exceed 50 MiB") }
      if header.count < 1024 {
        header.append(chunk.prefix(1024 - header.count))
        if header.count == 1024, header.range(of: signature) == nil { throw SlaxPdfImportFailure("Invalid PDF file") }
      }
      try output.write(contentsOf: chunk)
    }
    guard total > 0, header.range(of: signature) != nil else { throw SlaxPdfImportFailure("Invalid PDF file") }
    try output.close()
    complete = true
    return SlaxImportedPdf(file: file, name: safeName(source.lastPathComponent), size: total)
  }

  static func remove(_ raw: String) throws {
    guard let file = URL(string: raw), file.isFileURL, file.host?.isEmpty != false,
      file.query == nil, file.fragment == nil else { throw SlaxPdfImportFailure("Invalid temporary PDF") }
    let root = try importRoot()
    let normalized = file.standardizedFileURL
    let directory = normalized.deletingLastPathComponent()
    guard normalized.path == file.path, normalized.lastPathComponent == "document.pdf",
      directory.deletingLastPathComponent().path == root.path,
      UUID(uuidString: directory.lastPathComponent)?.uuidString.lowercased() == directory.lastPathComponent,
      directory.resolvingSymlinksInPath().path == directory.path,
      normalized.resolvingSymlinksInPath().path == normalized.path else { throw SlaxPdfImportFailure("Invalid temporary PDF") }
    let manager = FileManager.default
    if manager.fileExists(atPath: normalized.path) {
      let values = try normalized.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      guard values.isRegularFile == true, values.isSymbolicLink != true else { throw SlaxPdfImportFailure("Invalid temporary PDF") }
      try manager.removeItem(at: normalized)
    }
    if (try? manager.contentsOfDirectory(atPath: directory.path).isEmpty) == true {
      try manager.removeItem(at: directory)
    }
  }

  static func discard(_ file: URL) {
    let manager = FileManager.default
    try? manager.removeItem(at: file)
    let directory = file.deletingLastPathComponent()
    if (try? manager.contentsOfDirectory(atPath: directory.path).isEmpty) == true {
      try? manager.removeItem(at: directory)
    }
  }

  private static func importRoot() throws -> URL {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw SlaxPdfImportFailure("Temporary storage unavailable")
    }
    let root = caches.resolvingSymlinksInPath().appendingPathComponent("slax-pdf-import", isDirectory: true)
    guard root.resolvingSymlinksInPath().path == root.path else { throw SlaxPdfImportFailure("Invalid temporary PDF storage") }
    return root
  }

  private static func safeName(_ raw: String) -> String {
    let leaf = raw.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? ""
    let scalars = leaf.unicodeScalars.prefix(156).filter {
      !CharacterSet.controlCharacters.contains($0) && $0.properties.generalCategory != .format &&
        $0.properties.generalCategory != .lineSeparator && $0.properties.generalCategory != .paragraphSeparator
    }.map { CharacterSet(charactersIn: "<>:\"|?*").contains($0) ? "_" : String($0) }.joined()
    let name = scalars.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
    if name.isEmpty { return "Document.pdf" }
    return name.lowercased().hasSuffix(".pdf") ? name : "\(name).pdf"
  }
}
