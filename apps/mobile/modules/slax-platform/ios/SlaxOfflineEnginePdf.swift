import Foundation

/// PDF metadata, range reads and resumable acquisition under `pdf/v2/<scopeId>/<key>/`.
extension SlaxOfflineSession {
  enum PdfBody { case range(Data), full }
  static let pdfWindow: Int64 = 1024 * 1024

  static func pause(_ seconds: Double, _ work: SlaxOfflineWork) -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end { if work.isCancelled { return false }; Thread.sleep(forTimeInterval: 0.05) }
    return !work.isCancelled
  }

  /// `GET /v1/bookmark/metadata` with `SlaxApi.pdfRequest` attempts; blocks a PDF worker.
  static func downloadDescriptor(_ scope: SlaxOfflineScope, http: SlaxOfflineHttp, id: String, token: String, work: SlaxOfflineWork) throws -> SlaxPdfDescriptor {
    guard let request = SlaxOfflineHttp.metadata(scope, id: id, token: token) else { throw SlaxOfflineError.invalid }
    let started = Date()
    for attempt in 0..<3 {
      let remaining = 120 - Date().timeIntervalSince(started)
      guard remaining > 0 else { throw SlaxOfflineError.timeout }
      let signal = DispatchSemaphore(value: 0)
      var result: Result<SlaxOfflineResponse, SlaxOfflineError> = .failure(.network)
      http.send(request, limit: 1024 * 1024, oversized: .pdf("pdf_body_invalid"), timeout: remaining, work: work) { result = $0; signal.signal() }
      signal.wait()
      var failure: SlaxOfflineError
      switch result {
      case .success(let response) where response.status == 200:
        guard let envelope = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any], let code = SlaxOfflineJson.int(envelope["code"]) else { throw SlaxOfflineError.pdf("pdf_body_invalid") }
        guard code == 200 else { throw SlaxOfflineError(code: "pdf_metadata_failed", status: Int(code)) }
        guard let descriptor = SlaxPdfDescriptor((envelope["data"] as? [String: Any])?["pdf"]) else { throw SlaxOfflineError.pdf("pdf_metadata_invalid") }
        return descriptor
      case .success(let response): failure = .http(response.status, retryAfter: SlaxOfflineClock.retryAfter(response.headers["Retry-After"]))
      case .failure(let error): failure = error
      }
      guard failure.retryable, attempt < 2, pause(Double(attempt + 1), work) else { throw failure }
    }
    throw SlaxOfflineError.network
  }

  /// `GET /v1/bookmark/pdf` through `SlaxPdfTransfer`, validated like `SlaxApi.transferPdf`. Full 200 bodies are streamed to `sink`.
  static func transfer(_ scope: SlaxOfflineScope, token: String, id: String, documentId: String, size: Int64, begin: Int64, end: Int64, work: SlaxOfflineWork,
    allowHTTP: Bool, sink: (Data, Int64) throws -> Void) throws -> PdfBody {
    guard id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw SlaxOfflineError.invalid }
    let url = scope.origin + "/v1/bookmark/pdf?bookmark_uid=" + id
    let headers = ["Authorization": "Bearer " + token, "Accept": "application/pdf", "Range": "bytes=\(begin)-\(end - 1)", "X-CLIENT-TYPE": scope.clientType, "X-CLIENT-VERSION": scope.clientVersion]
    for attempt in 0..<3 {
      try work.check()
      var handle: String?
      do {
        let transferId = try SlaxPdfTransfers.begin(owner: scope.owner, origin: scope.origin, allowHTTP: allowHTTP); handle = transferId
        let hook = work.attach { SlaxPdfTransfers.end(owner: scope.owner, id: transferId) }
        defer { work.detach(hook); SlaxPdfTransfers.end(owner: scope.owner, id: transferId) }
        let transfer = try SlaxPdfTransfers.get(owner: scope.owner, id: transferId)
        let head = try transfer.open(url, headers: headers)
        guard let status = head["status"] as? Int, let fields = head["headers"] as? [String: String] else { throw SlaxOfflineError.pdf("pdf_body_invalid") }
        guard [200, 206].contains(status) else { throw SlaxOfflineError.http(status, retryAfter: SlaxOfflineClock.retryAfter(fields["Retry-After"])) }
        guard fields["Content-Type"]?.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() == "application/pdf" else { throw SlaxOfflineError.pdf("pdf_body_invalid") }
        if let etag = fields["ETag"], etag.range(of: "^\"[a-f0-9]{64}\"$", options: .regularExpression) != nil, etag != "\"\(documentId)\"" { throw SlaxOfflineError.pdf("pdf_identity_mismatch", status: 412) }
        let full = status == 200
        let expected: Int64
        if full {
          guard fields["Content-Range"] == nil else { throw SlaxOfflineError.pdf("pdf_range_invalid") }
          guard let length = fields["Content-Length"].flatMap({ Int64($0) }), length == size else { throw SlaxOfflineError.pdf("pdf_length_invalid") }
          expected = length
        } else {
          let parts = fields["Content-Range"].flatMap { value -> [Int64]? in
            guard value.range(of: "^bytes [0-9]+-[0-9]+/[0-9]+$", options: .regularExpression) != nil else { return nil }
            return value.dropFirst(6).split(whereSeparator: { $0 == "-" || $0 == "/" }).compactMap { Int64($0) }
          }
          guard let parts, parts.count == 3, parts[0] == begin, parts[1] == end - 1, parts[2] == size, parts[2] <= SlaxPdfDescriptor.maxBytes else { throw SlaxOfflineError.pdf("pdf_range_invalid") }
          expected = end - begin
          if let length = fields["Content-Length"] { guard Int64(length) == expected else { throw SlaxOfflineError.pdf("pdf_length_invalid") } }
        }
        var received: Int64 = 0, body = Data()
        while let chunk = try transfer.read() {
          try work.check()
          guard received + Int64(chunk.count) <= expected else { throw SlaxOfflineError.pdf("pdf_length_invalid") }
          if full { try sink(chunk, received) } else { body.append(chunk) }
          received += Int64(chunk.count)
        }
        guard received == expected else { throw SlaxOfflineError.pdf("pdf_length_invalid") }
        return full ? .full : .range(body)
      } catch {
        if let handle { SlaxPdfTransfers.end(owner: scope.owner, id: handle) }
        let failure: SlaxOfflineError
        if let error = error as? SlaxOfflineError { failure = error }
        else if let error = error as? SlaxPdfTransferError {
          switch error.code {
          case "cancelled": failure = work.isCancelled ? .cancelled : .network
          case "busy": failure = .busy
          case "network": failure = .network
          default: failure = .pdf(error.code == "limit" ? "pdf_length_invalid" : "pdf_body_invalid")
          }
        } else { failure = .from(error) }
        guard failure.retryable, attempt < 2, pause(Double(attempt + 1), work) else { throw failure }
      }
    }
    throw SlaxOfflineError.network
  }

  // MARK: Metadata

  /// Fetches and stores the descriptor; a changed identity removes the old document first.
  private func fetchDescriptor(_ access: Access, token: String, work: SlaxOfflineWork) throws -> (SlaxPdfDescriptor, Bool) {
    let descriptor = try Self.downloadDescriptor(scope, http: engine.http, id: access.id, token: token, work: work)
    let store = store(work.lease), layout = layout
    return try locked(access.key) {
      try work.check()
      let previous = try layout.readDescriptor(store, access.key)
      let changed = previous != nil && !descriptor.same(previous)
      if changed {
        try store.remove(layout.document(access.key)); try store.remove(layout.partial(access.key)); try store.remove(layout.part(access.key))
        if let manifest = try SlaxOfflineLayout.readManifest(store, access.key), manifest.kind == "pdf" { try store.remove(SlaxOfflineLayout.manifest(access.key)) }
      }
      _ = try store.write(layout.descriptor(access.key), bytes: try JSONSerialization.data(withJSONObject: descriptor.json))
      return (descriptor, changed)
    }
  }
  func pdfIdentityChanged(_ key: String, foreground: Bool) {
    if foreground { cancelJobs(key) }
    entries.removeValue(forKey: key)
    if let task = tasks[key] { report(task, "invalidated"); loadEntries([key]) }
    else { reported.removeValue(forKey: key); enqueue(["key": key, "state": "invalidated", "manual": false]) }
  }
  /// 403/404/412 and identity conflicts: drop the cached PDF so it can no longer be read offline.
  func pdfDenied(_ key: String, _ error: SlaxOfflineError, foreground: Bool) {
    if foreground { cancelJobs(key) }
    let task = tasks[key], layout = layout
    var manifest: SlaxOfflineManifest?
    if let task {
      var retry = SlaxOfflineRetry(attempts: 1, retryAt: 0, denied: true, code: error.code); retry.version = task.version
      manifest = .placeholder(task); manifest!.retry = retry
      entries[key] = Entry(manifest: manifest, contentSize: nil)
      report(task, "denied", code: error.code)
    } else { reported.removeValue(forKey: key); enqueue(["key": key, "state": "invalidated", "manual": false, "code": error.code]) }
    commit(key, { store in
      try store.remove(layout.pdf(key)); try store.remove(SlaxOfflineLayout.manifest(key))
      if let manifest { try SlaxOfflineLayout.writeManifest(store, key, manifest) }
    })
  }
  private func cachedDescriptor(_ key: String, _ request: Request, _ id: String) {
    io({ [layout] store in try layout.readDescriptor(store, key) }) { result in
      guard self.requests[request.id] === request else { return }
      if case .success(let descriptor?) = result { self.finish(request, .success(descriptor.result(id: id))) } else { self.finish(request, .failure(.network)) }
    }
  }
  func pdfMetadata(_ raw: [String: Any], reply: SlaxOfflineReply) {
    guard let access = try? SlaxOfflineTask.access(raw), let requestId = raw["requestId"] as? String else { reply.fail(.invalid); return }
    guard let request = register(requestId, key: access.key, reply: reply) else { return }
    if raw["allowNetwork"] as? Bool == false { cachedDescriptor(access.key, request, access.id); return }
    remoteMetadata(access, request, rejected: nil)
  }
  private func remoteMetadata(_ access: Access, _ request: Request, rejected: Int?) {
    awaitCredential(timeout: 20, accept: { rejected == nil || $0.generation != rejected }) { credential in
      guard self.requests[request.id] === request else { return }
      guard let credential else { self.cachedDescriptor(access.key, request, access.id); return }
      self.engine.pdf.addOperation(self.foreground {
        let result = Result { try self.fetchDescriptor(access, token: credential.token, work: request.work) }.mapError(SlaxOfflineError.from)
        self.engine.control.async {
          guard self.requests[request.id] === request else { return }
          switch result {
          case .success(let (descriptor, changed)):
            if changed { self.pdfIdentityChanged(access.key, foreground: true) }
            self.finish(request, .success(descriptor.result(id: access.id)))
          case .failure(let error) where error.status == 401 && rejected == nil:
            self.rejectCredential(credential.generation); self.remoteMetadata(access, request, rejected: credential.generation)
          case .failure(let error) where error.denied && [403, 404, 412].contains(error.status):
            self.pdfDenied(access.key, error, foreground: true); self.finish(request, .failure(error))
          case .failure(let error) where [SlaxOfflineError.network.code, SlaxOfflineError.credential.code].contains(error.code):
            self.cachedDescriptor(access.key, request, access.id)
          case .failure(let error): self.finish(request, .failure(error))
          }
        }
      })
    }
  }
  private func foreground(_ block: @escaping () -> Void) -> Operation {
    let operation = BlockOperation(block: block); operation.queuePriority = .high; operation.qualityOfService = .userInitiated; return operation
  }

  // MARK: Range reads

  /// Bytes from the complete document or the committed prefix of the resumable part.
  static func localRange(_ store: SlaxFileStore, _ layout: SlaxOfflineLayout, key: String, documentId: String, size: Int64, begin: Int64, end: Int64) throws -> Data? {
    guard let part = try layout.readPart(store, key), part.documentId == documentId, part.size == size, part.committed >= end else { return nil }
    let length = Int(end - begin)
    if part.committed < part.size, let bytes = try store.readRange(layout.partial(key), offset: begin, length: length) {
      return try layout.readPart(store, key).map { $0.documentId == documentId && $0.size == size && $0.committed >= end } == true ? bytes : nil
    }
    guard try store.size(layout.document(key)) == size else { return nil }
    return try store.readRange(layout.document(key), offset: begin, length: length)
  }
  func readPdfRange(_ raw: [String: Any], reply: SlaxOfflineReply) {
    guard let access = try? SlaxOfflineTask.access(raw), let documentId = SlaxOfflineJson.text(raw["documentId"], limit: 256), let size = SlaxOfflineJson.int(raw["size"]),
      let begin = SlaxOfflineJson.int(raw["begin"]), let end = SlaxOfflineJson.int(raw["end"]), let requestId = raw["requestId"] as? String,
      (1...SlaxPdfDescriptor.maxBytes).contains(size), begin >= 0, end > begin, end <= size, end - begin <= Self.pdfWindow else { reply.fail(.invalid); return }
    guard let request = register(requestId, key: access.key, reply: reply) else { return }
    let store = store(request.work.lease), layout = layout
    engine.pdf.addOperation(foreground {
      let local = Result { try Self.localRange(store, layout, key: access.key, documentId: documentId, size: size, begin: begin, end: end) }.mapError(SlaxOfflineError.from)
      self.engine.control.async {
        guard self.requests[request.id] === request else { return }
        switch local {
        case .success(let bytes?): self.finish(request, .success(bytes))
        case .failure(let error) where [SlaxOfflineError.revoked.code, SlaxOfflineError.cancelled.code].contains(error.code): self.finish(request, .failure(error))
        default: self.remoteRange(access, request, documentId: documentId, size: size, begin: begin, end: end, rejected: nil)
        }
      }
    })
  }
  private func remoteRange(_ access: Access, _ request: Request, documentId: String, size: Int64, begin: Int64, end: Int64, rejected: Int?) {
    awaitCredential(timeout: 20, accept: { rejected == nil || $0.generation != rejected }) { credential in
      guard self.requests[request.id] === request else { return }
      guard let credential else { self.finish(request, .failure(.credential)); return }
      let scope = self.scope, allowHTTP = self.engine.environment.allowHTTP
      self.engine.pdf.addOperation(self.foreground {
        var slice = Data(count: Int(end - begin))
        let result = Result { () -> Data in
          let body = try Self.transfer(scope, token: credential.token, id: access.id, documentId: documentId, size: size, begin: begin, end: end, work: request.work, allowHTTP: allowHTTP) { chunk, offset in
            let left = max(begin, offset), right = min(end, offset + Int64(chunk.count))
            if right > left { slice.replaceSubrange(Int(left - begin)..<Int(right - begin), with: chunk[chunk.startIndex + Int(left - offset)..<chunk.startIndex + Int(right - offset)]) }
          }
          if case .range(let bytes) = body { return bytes }
          return slice
        }.mapError(SlaxOfflineError.from)
        self.engine.control.async {
          guard self.requests[request.id] === request else { return }
          switch result {
          case .success(let bytes): self.finish(request, .success(bytes))
          case .failure(let error) where error.status == 401 && rejected == nil:
            self.rejectCredential(credential.generation)
            self.remoteRange(access, request, documentId: documentId, size: size, begin: begin, end: end, rejected: credential.generation)
          case .failure(let error) where [403, 404, 412].contains(error.status):
            self.pdfDenied(access.key, error, foreground: true); self.finish(request, .failure(error))
          case .failure(let error): self.finish(request, .failure(error))
          }
        }
      })
    }
  }
  func pdfStatus(_ key: String, reply: SlaxOfflineReply) {
    guard SlaxOfflineTask.validKey(key) else { reply.fail(.invalid); return }
    let layout = layout
    io({ store -> [String: Any] in
      guard let descriptor = try layout.readDescriptor(store, key) else { return ["downloadedBytes": 0, "totalBytes": 0, "complete": false] }
      guard let part = try layout.readPart(store, key), part.matches(descriptor) else { return ["downloadedBytes": 0, "totalBytes": descriptor.size, "complete": false] }
      let complete = try layout.completeDocument(store, key) != nil
      return ["downloadedBytes": complete ? descriptor.size : part.committed, "totalBytes": descriptor.size, "complete": complete]
    }) { result in
      switch result { case .success(let value): reply.resolve(value); case .failure(let error): reply.fail(error) }
    }
  }

  // MARK: Background acquisition

  func startPdf(_ task: SlaxOfflineTask) {
    guard let credential else { return }
    let job = Job(task: task, work: SlaxOfflineWork(lease: lease.child()))
    jobs[task.key] = job; explicit.remove(task.key)
    let access: Access = (task.key, task.id, task.collectionOwner)
    engine.pdf.addOperation {
      let result = Result { try self.fetchDescriptor(access, token: credential.token, work: job.work) }.mapError(SlaxOfflineError.from)
      self.engine.control.async {
        guard self.jobs[task.key] === job, !job.work.isCancelled else { return }
        switch result {
        case .success(let (descriptor, changed)):
          if changed { self.pdfIdentityChanged(task.key, foreground: false) }
          self.pdfWindow(job, descriptor)
        case .failure(let error): self.pdfFailed(job, error, generation: credential.generation)
        }
      }
    }
  }
  private func pdfFailed(_ job: Job, _ error: SlaxOfflineError, generation: Int) {
    let key = job.task.key
    guard jobs[key] === job else { return }
    if error.status == 401 { jobs.removeValue(forKey: key); job.work.cancel(); rejectCredential(generation); schedulePump(); return }
    if [403, 404, 412].contains(error.status) { jobs.removeValue(forKey: key); job.work.cancel(); pdfDenied(key, error, foreground: false); schedulePump(); return }
    fail(job, error)
  }
  private func pdfWindow(_ job: Job, _ descriptor: SlaxPdfDescriptor) {
    let task = job.task
    guard jobs[task.key] === job, !job.work.isCancelled, !suspended else { return }
    guard let credential else { jobs.removeValue(forKey: task.key); job.work.cancel(); return }
    let scope = scope, layout = layout, store = store(job.work.lease), allowHTTP = engine.environment.allowHTTP
    let report: () -> Void = { [weak job] in
      self.engine.control.async { guard let job, self.jobs[task.key] === job, !job.reported else { return }; job.reported = true; self.report(task, "downloading") }
    }
    engine.pdf.addOperation {
      let result = Result { try self.pdfStep(task, descriptor, scope: scope, layout: layout, store: store, token: credential.token, work: job.work, allowHTTP: allowHTTP, started: report) }.mapError(SlaxOfflineError.from)
      self.engine.control.async {
        guard self.jobs[task.key] === job, !job.work.isCancelled else { return }
        switch result {
        case .success(false): self.pdfWindow(job, descriptor)
        case .success(true): self.pdfCompleted(job, descriptor)
        case .failure(let error): self.pdfFailed(job, error, generation: credential.generation)
        }
      }
    }
  }
  /// One resumable window: append the next committed range, or commit a full response. Returns true when complete.
  private func pdfStep(_ task: SlaxOfflineTask, _ descriptor: SlaxPdfDescriptor, scope: SlaxOfflineScope, layout: SlaxOfflineLayout, store: SlaxFileStore,
    token: String, work: SlaxOfflineWork, allowHTTP: Bool, started: () -> Void) throws -> Bool {
    let key = task.key
    let snapshot: SlaxPdfPart = try locked(key) {
      try work.check()
      guard let current = try layout.readDescriptor(store, key), descriptor.same(current) else { throw SlaxOfflineError.cancelled }
      if let part = try layout.readPart(store, key), part.matches(descriptor) {
        if part.committed == part.size { try finalize(key, layout: layout, store: store, size: part.size); return part }
        if (try store.size(layout.partial(key)) ?? 0) >= part.committed { return part }
      }
      try store.remove(layout.document(key)); try store.remove(layout.partial(key))
      let part = SlaxPdfPart(documentId: descriptor.documentId, size: descriptor.size, committed: 0)
      try layout.writePart(store, key, part); return part
    }
    if snapshot.committed == snapshot.size { return true }
    started()
    let begin = snapshot.committed, end = min(snapshot.size, begin + Self.pdfWindow)
    var stream: SlaxFileStream?
    defer { stream?.abort() }
    let body = try Self.transfer(scope, token: token, id: task.id, documentId: descriptor.documentId, size: descriptor.size, begin: begin, end: end, work: work, allowHTTP: allowHTTP) { chunk, _ in
      if stream == nil { stream = try store.stream(layout.document(key)) }
      try stream!.write(chunk)
    }
    return try locked(key) {
      try work.check()
      guard let part = try layout.readPart(store, key), part == snapshot else { throw SlaxOfflineError.cancelled }
      switch body {
      case .range(let bytes):
        try store.append(layout.partial(key), at: begin, bytes: bytes)
        var next = part; next.committed = end
        try layout.writePart(store, key, next)
        if next.committed == next.size { try finalize(key, layout: layout, store: store, size: next.size); return true }
        return false
      case .full:
        guard let output = stream, output.written == descriptor.size else { throw SlaxOfflineError.pdf("pdf_length_invalid") }
        try store.remove(layout.partial(key))
        _ = try output.commit()
        var next = part; next.committed = next.size
        try layout.writePart(store, key, next)
        return true
      }
    }
  }
  private func finalize(_ key: String, layout: SlaxOfflineLayout, store: SlaxFileStore, size: Int64) throws {
    if try store.size(layout.document(key)) == size { return }
    guard try store.size(layout.partial(key)) == size else { throw SlaxOfflineError.pdf("pdf_length_invalid") }
    try store.move(layout.partial(key), to: layout.document(key))
  }
  private func pdfCompleted(_ job: Job, _ descriptor: SlaxPdfDescriptor) {
    let task = job.task
    let manifest = SlaxOfflineManifest(id: task.id, owner: task.collectionOwner, kind: "pdf", version: task.version, size: descriptor.size, images: [], retry: nil)
    commit(task.key, work: job.work, { store in try SlaxOfflineLayout.writeManifest(store, task.key, manifest) }) { result in
      guard self.jobs[task.key] === job else { return }
      switch result {
      case .success:
        self.jobs.removeValue(forKey: task.key)
        self.entries[task.key] = Entry(manifest: manifest, contentSize: descriptor.size)
        self.report(task, "complete"); self.schedulePump()
      case .failure(let error): self.fail(job, error)
      }
    }
  }
}
