import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

// Document access outside the app's own folder (see src/lib.rs).
//
// Every file or folder the user picks is remembered as a bookmark, keyed by
// its URL. A read or write of any URL inside a remembered folder (or of a
// remembered file) opens that root's security scope for the duration of
// the operation, coordinated with iCloud through NSFileCoordinator.

struct UrlArgs: Decodable {
  let url: String
}

struct WriteArgs: Decodable {
  let url: String
  let text: String
}

struct ShareArgs: Decodable {
  /// A plain path in the app's container or a picked file's URL.
  let path: String
}

struct PickArgs: Decodable {
  var allowedExtensions: [String]?
}

private let bookmarksKey = "textus.bookmarks"
/// The bookmark keys, least recently picked or used first - what decides
/// which bookmarks go once there are more than `maxBookmarks`.
private let bookmarkOrderKey = "textus.bookmarks.order"
/// Every bookmark is resolved on each read and write (scopeRoot), and
/// UserDefaults is loaded whole at launch, so the list can't grow forever.
/// Far more than anyone keeps open; the oldest unused ones go first.
private let maxBookmarks = 200

class TextusFilesPlugin: Plugin, UIDocumentPickerDelegate {
  private var pending: Invoke?
  private var pickingFolder = false
  private var keyboardFit: KeyboardFit?

  @objc public override func load(webview: WKWebView) {
    keyboardFit = KeyboardFit(webview: webview)
  }

  // MARK: Bookmarks

  private func loadBookmarks() -> [String: Data] {
    UserDefaults.standard.dictionary(forKey: bookmarksKey) as? [String: Data] ?? [:]
  }

  /// The keys of `marks`, oldest first. Bookmarks saved before the order
  /// was kept count as the oldest.
  private func bookmarkOrder(_ marks: [String: Data]) -> [String] {
    let saved = UserDefaults.standard.stringArray(forKey: bookmarkOrderKey) ?? []
    let known = Set(saved)
    let unordered = marks.keys.filter { !known.contains($0) }.sorted()
    return unordered + saved.filter { marks[$0] != nil }
  }

  /// Saves `marks`, moving `used` (when given) to the recent end and
  /// dropping the oldest beyond `maxBookmarks`.
  private func saveBookmarks(_ marks: [String: Data], used: String? = nil) {
    var marks = marks
    var order = bookmarkOrder(marks)
    if let used, marks[used] != nil {
      order.removeAll { $0 == used }
      order.append(used)
    }
    while order.count > maxBookmarks {
      marks[order.removeFirst()] = nil
    }
    UserDefaults.standard.set(marks, forKey: bookmarksKey)
    UserDefaults.standard.set(order, forKey: bookmarkOrderKey)
  }

  private func remember(_ url: URL) {
    guard let data = try? url.bookmarkData(
      options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    else { return }
    var marks = loadBookmarks()
    marks[url.absoluteString] = data
    saveBookmarks(marks, used: url.absoluteString)
  }

  /// Whether a bookmark failed to resolve because its item is gone for
  /// good (deleted), rather than for now - a file provider that is offline
  /// or not yet running also fails, and forgetting those bookmarks would
  /// cost the user access to folders that come back.
  private func isGone(_ error: Error) -> Bool {
    guard let code = (error as? CocoaError)?.code else { return false }
    return code == .fileNoSuchFile || code == .fileReadNoSuchFile
  }

  /// The remembered root (file or folder) that grants access to `target`,
  /// resolved fresh - a bookmark can go stale when the item moves.
  private func scopeRoot(for target: URL) -> URL? {
    let path = target.standardizedFileURL.path
    var marks = loadBookmarks()
    var best: (key: String, url: URL)?
    // Iterates a copy: `marks` itself may change underneath.
    for (key, data) in marks {
      var stale = false
      let url: URL
      do {
        url = try URL(
          resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      } catch {
        // A deleted item's bookmark can never grant anything again.
        if isGone(error) { marks[key] = nil }
        continue
      }
      if stale, let fresh = try? url.bookmarkData(
        options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      {
        marks[key] = fresh
      }
      let root = url.standardizedFileURL.path
      if path == root || path.hasPrefix(root.hasSuffix("/") ? root : root + "/") {
        if best == nil || root.count > best!.url.standardizedFileURL.path.count {
          best = (key, url)
        }
      }
    }
    saveBookmarks(marks, used: best?.key)
    return best?.url
  }

  /// Runs `body` with the security scope of whatever grants `url` open.
  private func withAccess<T>(to url: URL, _ body: () throws -> T) throws -> T {
    let root = scopeRoot(for: url) ?? url
    let opened = root.startAccessingSecurityScopedResource()
    defer { if opened { root.stopAccessingSecurityScopedResource() } }
    return try body()
  }

  // MARK: Pickers

  private func present(_ picker: UIDocumentPickerViewController, _ invoke: Invoke) {
    pending = invoke
    picker.delegate = self
    DispatchQueue.main.async {
      self.manager.viewController?.present(picker, animated: true)
    }
  }

  @objc public func pickDocument(_ invoke: Invoke) throws {
    let args = (try? invoke.parseArgs(PickArgs.self)) ?? PickArgs()
    let types = (args.allowedExtensions ?? ["md", "markdown", "txt"])
      .compactMap { UTType(filenameExtension: $0) }
    pickingFolder = false
    present(UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false), invoke)
  }

  @objc public func pickFolder(_ invoke: Invoke) throws {
    pickingFolder = true
    present(UIDocumentPickerViewController(forOpeningContentTypes: [.folder]), invoke)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending, let url = urls.first else { return }
    pending = nil
    // Picker URLs are already open for this session; the bookmark is what
    // lets a later launch reopen them.
    let opened = url.startAccessingSecurityScopedResource()
    remember(url)
    if opened { url.stopAccessingSecurityScopedResource() }
    invoke.resolve(["url": url.absoluteString, "name": url.lastPathComponent, "folder": pickingFolder])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pending?.resolve(["url": NSNull()])
    pending = nil
  }

  // MARK: Reading and writing

  @objc public func readText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      let text: String = try withAccess(to: url) {
        var result: Result<String, Error> = .failure(CocoaError(.fileReadUnknown))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
          result = Result { try String(contentsOf: u, encoding: .utf8) }
        }
        if let coordError = coordError { throw coordError }
        return try result.get()
      }
      invoke.resolve(["text": text])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  /// A file's bytes as base64 - an image beside a picked document, which
  /// the webview can't load from a security-scoped URL itself.
  @objc public func readData(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      let data: Data = try withAccess(to: url) {
        var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
          result = Result { try Data(contentsOf: u) }
        }
        if let coordError = coordError { throw coordError }
        return try result.get()
      }
      invoke.resolve(["data": data.base64EncodedString()])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  /// The system share sheet (AirDrop, Mail, Messages, Save to Files...) for
  /// a document. It gets a copy in the temporary folder, not the file
  /// itself: a picked file's security scope would have to stay open for as
  /// long as the sheet and whatever app receives it take to read it.
  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    let source = args.path.hasPrefix("file://")
      ? URL(string: args.path) : URL(fileURLWithPath: args.path)
    guard let source = source else { return invoke.reject("Invalid path") }
    let folder = FileManager.default.temporaryDirectory
      .appendingPathComponent("share-\(UUID().uuidString)", isDirectory: true)
    let copy = folder.appendingPathComponent(source.lastPathComponent)
    do {
      let data: Data = try withAccess(to: source) {
        var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordError) { u in
          result = Result { try Data(contentsOf: u) }
        }
        if let coordError = coordError { throw coordError }
        return try result.get()
      }
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: copy)
    } catch {
      return invoke.reject(error.localizedDescription)
    }
    DispatchQueue.main.async {
      guard let host = self.manager.viewController else {
        return invoke.reject("No view to present from")
      }
      let sheet = UIActivityViewController(activityItems: [copy], applicationActivities: nil)
      // iPad shows the sheet as a popover, which needs an anchor: the top
      // edge, under the title row's menu button.
      if let popover = sheet.popoverPresentationController {
        popover.sourceView = host.view
        popover.sourceRect = CGRect(x: 24, y: host.view.safeAreaInsets.top + 44, width: 1, height: 1)
      }
      sheet.completionWithItemsHandler = { _, completed, _, _ in
        try? FileManager.default.removeItem(at: folder)
        invoke.resolve(["completed": completed])
      }
      host.present(sheet, animated: true)
    }
  }

  /// The tap a finger feels as something lifts under it (a tab held to
  /// drag). Not about files, but the app's one native plugin.
  @objc public func haptic(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      invoke.resolve()
    }
  }

  @objc public func writeText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      try withAccess(to: url) {
        var writeError: Error?
        var coordError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
          do { try args.text.write(to: u, atomically: true, encoding: .utf8) } catch { writeError = error }
        }
        if let error = coordError ?? writeError { throw error }
      }
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func listFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      let entries: [[String: Any]] = try withAccess(to: url) {
        let items = try FileManager.default.contentsOfDirectory(
          at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        return items.map { item in
          let dir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
          return ["url": item.absoluteString, "name": item.lastPathComponent, "folder": dir == true]
        }
      }
      invoke.resolve(["entries": entries])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  // MARK: A folder for the whole session

  private var openScopes: [String: URL] = [:]

  /// Opens a remembered folder's scope until the app quits and returns its
  /// plain path. A scope covers the whole process, so the Rust side (the
  /// project folder the AI reads, .textus/style.md and library/) then reads
  /// it with ordinary file calls.
  @objc public func beginAccess(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    let root = scopeRoot(for: url) ?? url
    if openScopes[root.absoluteString] == nil {
      guard root.startAccessingSecurityScopedResource() else {
        return invoke.reject("Access to this folder has expired. Choose it again.")
      }
      openScopes[root.absoluteString] = root
    }
    invoke.resolve(["path": url.path])
  }

  // MARK: Remembered items

  @objc public func remembered(_ invoke: Invoke) throws {
    let items = loadBookmarks().compactMap { (_, data) -> [String: Any]? in
      var stale = false
      guard let url = try? URL(
        resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      else { return nil }
      return ["url": url.absoluteString, "name": url.lastPathComponent, "folder": url.hasDirectoryPath]
    }
    invoke.resolve(["items": items])
  }

}

@_cdecl("init_plugin_textus_files")
func initPlugin() -> Plugin {
  return TextusFilesPlugin()
}
