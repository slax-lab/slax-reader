import Foundation

/// Article bodies and their images.
extension SlaxOfflineSession {
  typealias Access = (key: String, id: String, owner: String?)

  /// `POST /v1/bookmark/content`, retried like `SlaxApi.response` (network errors and 5xx without Retry-After).
  func requestContent(_ id: String, token: String, work: SlaxOfflineWork, attempt: Int = 0, _ done: @escaping (Result<Data, SlaxOfflineError>) -> Void) {
    guard let request = SlaxOfflineHttp.content(scope, id: id, token: token) else { done(.failure(.invalid)); return }
    engine.http.send(request, limit: SlaxFileStore.articleLimit, oversized: .oversized, timeout: 30, work: work) { result in
      self.engine.control.async {
        let outcome: Result<Data, SlaxOfflineError>
        switch result {
        case .success(let response) where [200, 204].contains(response.status): outcome = .success(response.body)
        case .success(let response): outcome = .failure(.http(response.status, retryAfter: SlaxOfflineClock.retryAfter(response.headers["Retry-After"])))
        case .failure(let error): outcome = .failure(error)
        }
        if case .failure(let error) = outcome, error.retryable, attempt < 2, !work.isCancelled {
          self.engine.control.asyncAfter(deadline: .now() + Double(1 << attempt)) {
            guard !work.isCancelled, !self.closed else { done(.failure(.cancelled)); return }
            self.requestContent(id, token: token, work: work, attempt: attempt + 1, done)
          }
          return
        }
        done(outcome)
      }
    }
  }

  func startArticle(_ task: SlaxOfflineTask) {
    guard let credential else { return }
    let job = Job(task: task, work: SlaxOfflineWork(lease: lease.child()))
    jobs[task.key] = job; explicit.remove(task.key)
    imageJobs.removeValue(forKey: task.key)?.cancel()
    report(task, "downloading")
    requestContent(task.id, token: credential.token, work: job.work) { result in
      guard self.jobs[task.key] === job, !job.work.isCancelled else { return }
      switch result {
      case .failure(let error) where error.status == 401:
        self.jobs.removeValue(forKey: task.key); job.work.cancel(); self.rejectCredential(credential.generation); self.schedulePump()
      case .failure(let error): self.fail(job, error)
      case .success(let body) where body.isEmpty: self.fail(job, SlaxOfflineError(code: "offline_integrity_invalid", integrity: true))
      case .success(let body):
        self.commitContent(body, key: task.key, id: task.id, owner: task.collectionOwner, version: task.version, work: job.work) { result in
          guard self.jobs[task.key] === job else { return }
          switch result {
          case .success(let manifest):
            self.jobs.removeValue(forKey: task.key)
            self.entries[task.key] = Entry(manifest: manifest, contentSize: manifest.size)
            self.report(task, "complete"); self.schedulePump()
          case .failure(let error): self.fail(job, error)
          }
        }
      }
    }
  }

  /// Writes the raw body and its manifest; images already recorded for the same URLs keep their state.
  func commitContent(_ body: Data, key: String, id: String, owner: String?, version: String?, work: SlaxOfflineWork, _ done: @escaping (Result<SlaxOfflineManifest, SlaxOfflineError>) -> Void) {
    engine.cpu.addOperation {
      let urls = SlaxOfflineHtml.imageUrls(Self.decode(body))
      self.engine.control.async {
        var committed: SlaxOfflineManifest?
        self.commit(key, work: work, { store in
          let previous = (try? SlaxOfflineLayout.readManifest(store, key)) ?? nil
          let known = Dictionary((previous?.images ?? []).map { ($0.url, $0) }, uniquingKeysWith: { first, _ in first })
          let manifest = SlaxOfflineManifest(id: id, owner: owner, kind: "article", version: version, size: Int64(body.count),
            images: urls.map { known[$0] ?? SlaxOfflineImage(url: $0, state: "pending", attempts: 0, retryAt: 0) }, retry: nil)
          _ = try store.write(SlaxOfflineLayout.content(key), bytes: body)
          try SlaxOfflineLayout.writeManifest(store, key, manifest)
          committed = manifest
        }) { result in done(result.flatMap { committed.map { .success($0) } ?? .failure(.unavailable) }) }
      }
    }
  }

  /// Records an automatic failure with the ported backoff; cancellation and revocation leave no record.
  func fail(_ job: Job, _ error: SlaxOfflineError) {
    let key = job.task.key
    guard jobs[key] === job else { return }
    jobs.removeValue(forKey: key); explicit.remove(key)
    if [SlaxOfflineError.cancelled.code, SlaxOfflineError.revoked.code].contains(error.code) || job.work.isCancelled { schedulePump(); return }
    var entry = entries[key] ?? Entry(manifest: nil, contentSize: nil)
    let previous = entry.manifest?.retry.flatMap { $0.version == job.task.version ? $0.attempts : nil } ?? 0
    var retry = SlaxOfflineRetry.failure(previous: previous, error: error, now: SlaxOfflineClock.now(), random: engine.environment.random())
    retry.version = job.task.version
    var manifest = entry.manifest ?? .placeholder(job.task); manifest.retry = retry
    entry.manifest = manifest; entries[key] = entry
    report(job.task, retry.denied ? "denied" : "failed", code: retry.code, retryAt: retry.denied ? nil : retry.retryAt)
    commit(key, { store in try SlaxOfflineLayout.writeManifest(store, key, manifest) })
    schedulePump()
  }

  // MARK: Images

  func startImages(_ task: SlaxOfflineTask) {
    guard let manifest = entries[task.key]?.manifest else { return }
    let work = SlaxOfflineWork(lease: lease.child()), key = task.key, scope = scope, environment = engine.environment, commits = engine.commits
    imageJobs[key] = work
    let store = store(work.lease)
    engine.images.addOperation {
      var images = manifest.images, changed = 0
      let now = SlaxOfflineClock.now()
      func merge() -> SlaxOfflineManifest? {
        var merged: SlaxOfflineManifest?
        let snapshot = images
        commits.addOperations([BlockOperation { merged = try? Self.mergeImages(store, key, snapshot) }], waitUntilFinished: true)
        return merged
      }
      for index in images.indices where images[index].eligible(now) {
        guard !work.isCancelled, let next = Self.acquireImage(images[index], key: key, scope: scope, store: store, work: work, environment: environment) else { break }
        images[index] = next; changed += 1
        if changed % 8 == 0 { _ = merge() }
      }
      let final = work.isCancelled ? nil : merge()
      self.engine.control.async {
        guard self.imageJobs[key] === work else { return }
        self.imageJobs.removeValue(forKey: key)
        if var entry = self.entries[key], var current = entry.manifest {
          if let final, final.version == current.version { current = final }
          else { let states = Dictionary(images.map { ($0.url, $0) }, uniquingKeysWith: { first, _ in first }); current.images = current.images.map { states[$0.url] ?? $0 } }
          entry.manifest = current; self.entries[key] = entry
        }
        self.schedulePump()
      }
    }
  }
  static func mergeImages(_ store: SlaxFileStore, _ key: String, _ images: [SlaxOfflineImage]) throws -> SlaxOfflineManifest? {
    guard var current = try SlaxOfflineLayout.readManifest(store, key) else { return nil }
    let states = Dictionary(images.map { ($0.url, $0) }, uniquingKeysWith: { first, _ in first })
    current.images = current.images.map { states[$0.url] ?? $0 }
    try SlaxOfflineLayout.writeManifest(store, key, current)
    return current
  }
  /// One image through the shared registry into the Reader's `bookmark/<key>/images/<md5>.<ext>` path; nil when cancelled.
  static func acquireImage(_ image: SlaxOfflineImage, key: String, scope: SlaxOfflineScope, store: SlaxFileStore, work: SlaxOfflineWork, environment: SlaxOfflineEnvironment) -> SlaxOfflineImage? {
    var next = image
    guard let url = URL(string: image.url), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil,
      let original = scope.policy.imageOriginal(url), let target = SlaxImageResources.paths(root: scope.root, key: key, original: original).first else {
      next.state = "denied"; next.retryAt = 0; return next
    }
    for file in SlaxImageResources.paths(root: scope.root, key: key, original: original) {
      if let attributes = try? FileManager.default.attributesOfItem(atPath: file.path), attributes[.type] as? FileAttributeType == .typeRegular,
        let size = attributes[.size] as? NSNumber, (1...SlaxImageRegistry.maxBytes).contains(size.int64Value) { next.state = "ready"; next.retryAt = 0; return next }
    }
    do {
      try work.check()
      let consumer = try environment.registry().acquire(owner: scope.owner, url: original, policy: scope.policy, strict: false)
      defer { consumer.close() }
      let hook = work.attach { consumer.close() }
      defer { work.detach(hook) }
      _ = try consumer.persist(root: scope.root, relative: String(target.path.dropFirst(scope.root.path.count + 1))) { try work.check() }
      next.state = "ready"; next.retryAt = 0; return next
    } catch {
      if work.isCancelled || (try? work.lease.check()) == nil { return nil }
      let failure = error as? SlaxImageFailure
      let reason = failure?.terminal == true ? SlaxOfflineError(code: "image_invalid", integrity: true)
        : SlaxOfflineError(code: "image_unavailable", status: failure?.status ?? 0, retryAfter: SlaxOfflineClock.retryAfter(failure?.retryAfter))
      let retry = SlaxOfflineRetry.failure(previous: image.attempts, error: reason, now: SlaxOfflineClock.now(), random: environment.random())
      next.state = retry.denied ? "denied" : "failed"; next.attempts = retry.attempts; next.retryAt = retry.retryAt
      return next
    }
  }

  // MARK: Foreground reads

  static func cachedArticle(_ store: SlaxFileStore, _ key: String) throws -> String? {
    guard let manifest = try SlaxOfflineLayout.readManifest(store, key), manifest.kind == "article", manifest.size > 0,
      let bytes = try store.read(SlaxOfflineLayout.content(key), limit: SlaxFileStore.articleLimit), Int64(bytes.count) == manifest.size else { return nil }
    return decode(bytes)
  }
  /// Reads the committed copy on the foreground queue, from any caller queue; the session lease is checked by the store.
  func foregroundRead(_ key: String, _ done: @escaping (Result<String?, SlaxOfflineError>) -> Void) {
    let store = store(lease)
    engine.foreground.addOperation {
      do { done(.success(try Self.cachedArticle(store, key))) } catch { done(.failure(.from(error))) }
    }
  }
  /// Callable from any queue: touches only immutable session state and replies from the foreground queue.
  func readArticle(_ key: String, reply: SlaxOfflineReply) {
    guard SlaxOfflineTask.validKey(key) else { reply.fail(.invalid); return }
    foregroundRead(key) { result in
      switch result { case .success(let text): reply.resolve(text); case .failure(let error): reply.fail(error) }
    }
  }
  /// Callable from any queue: a committed copy resolves from the foreground queue; only a miss or a forced refresh registers on the control queue.
  func fetchArticle(_ raw: [String: Any], reply: SlaxOfflineReply) {
    guard let access = try? SlaxOfflineTask.access(raw), let requestId = raw["requestId"] as? String else { reply.fail(.invalid); return }
    let remote = {
      self.engine.foregroundControl {
        guard !self.closed else { reply.fail(.revoked); return }
        guard let request = self.register(requestId, key: access.key, reply: reply) else { return }
        self.fetchRemote(access, request, rejected: nil)
      }
    }
    if raw["force"] as? Bool == true { remote(); return }
    foregroundRead(access.key) { result in
      if case .success(let text?) = result { reply.resolve(text); return }
      if case .failure(let error) = result, error.code == SlaxOfflineError.revoked.code { reply.fail(error); return }
      remote()
    }
  }
  private func fetchRemote(_ access: Access, _ request: Request, rejected: Int?) {
    awaitCredential(timeout: 20, accept: { rejected == nil || $0.generation != rejected }) { credential in
      guard self.requests[request.id] === request else { return }
      guard let credential else { self.finish(request, .failure(.credential)); return }
      self.requestContent(access.id, token: credential.token, work: request.work) { result in
        guard self.requests[request.id] === request else { return }
        switch result {
        case .failure(let error) where error.status == 401 && rejected == nil:
          self.rejectCredential(credential.generation); self.fetchRemote(access, request, rejected: credential.generation)
        case .failure(let error): self.finish(request, .failure(error))
        case .success(let body):
          self.finish(request, .success(Self.decode(body)))
          if !body.isEmpty { self.commitForeground(body, access) }
        }
      }
    }
  }
  /// A foreground body supersedes automatic work for the key; without a plan version it is stored unbound.
  private func commitForeground(_ body: Data, _ access: Access) {
    let task = tasks[access.key].flatMap { $0.kind == "article" && $0.id == access.id ? $0 : nil }
    if task != nil { cancelJobs(access.key) }
    commitContent(body, key: access.key, id: access.id, owner: access.owner, version: task?.version, work: SlaxOfflineWork(lease: lease.child())) { result in
      guard case .success(let manifest) = result, self.tasks[access.key] != nil else { self.schedulePump(); return }
      self.entries[access.key] = Entry(manifest: manifest, contentSize: manifest.size)
      self.reconcile(access.key); self.schedulePump()
    }
  }
}
