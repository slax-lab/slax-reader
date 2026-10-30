import Foundation

/// Plan diffs, scheduling, coalesced status, eviction and usage.
extension SlaxOfflineSession {
  func apply(_ raw: [String: Any]) {
    guard let revision = (raw["revision"] as? NSNumber)?.doubleValue, revision.isFinite, revision > self.revision else { return }
    self.revision = revision
    for key in raw["remove"] as? [String] ?? [] {
      guard let task = tasks.removeValue(forKey: key) else { continue }
      let wasRunning = jobs[key] != nil
      cancelJobs(key); entries.removeValue(forKey: key); explicit.remove(key)
      if wasRunning || reported[key]?.hasPrefix("downloading:") == true { report(task, "invalidated") }
      reported.removeValue(forKey: key)
    }
    var load: [String] = []
    for value in raw["upsert"] as? [Any] ?? [] {
      guard let dictionary = value as? [String: Any], let task = try? SlaxOfflineTask(dictionary) else { continue }
      if let previous = tasks[task.key] {
        tasks[task.key] = task
        if previous.version != task.version || previous.kind != task.kind {
          cancelJobs(task.key); entries.removeValue(forKey: task.key); load.append(task.key)
        } else if entries[task.key] != nil { reconcile(task.key) }
      } else {
        tasks[task.key] = task; order.append(task.key)
        if entries[task.key] == nil { load.append(task.key) } else { reconcile(task.key) }
      }
    }
    if order.count > tasks.count * 2 + 64 { order = order.filter { tasks[$0] != nil } }
    if opened { loadEntries(load) }
    schedulePump()
  }
  func cancelJobs(_ key: String) {
    jobs.removeValue(forKey: key)?.work.cancel()
    imageJobs.removeValue(forKey: key)?.cancel()
  }
  func loadEntries(_ keys: [String]) {
    let wanted = keys.filter { tasks[$0] != nil && !loading.contains($0) }
    guard !wanted.isEmpty, opened, !closed else { return }
    wanted.forEach { loading.insert($0) }
    let kinds = wanted.map { ($0, tasks[$0]!.kind) }, layout = layout
    io({ store -> [(String, String, Entry)] in
      try kinds.map { key, kind in
        let manifest = try? SlaxOfflineLayout.readManifest(store, key)
        let size = (try? layout.contentSize(store, key, kind: manifest?.kind ?? kind)) ?? nil
        try store.lease.check()
        return (key, kind, Entry(manifest: manifest ?? nil, contentSize: size))
      }
    }) { result in
      wanted.forEach { self.loading.remove($0) }
      guard case .success(let values) = result else { return }
      var retry: [String] = []
      for (key, kind, entry) in values {
        guard let task = self.tasks[key] else { continue }
        if task.kind != kind { retry.append(key); continue }
        self.entries[key] = entry; self.reconcile(key)
      }
      self.loadEntries(retry); self.schedulePump()
    }
  }
  func complete(_ entry: Entry, _ task: SlaxOfflineTask) -> Bool {
    guard let manifest = entry.manifest else { return false }
    return manifest.kind == task.kind && manifest.version == task.version && manifest.size > 0 && entry.contentSize == manifest.size && (manifest.id.isEmpty || manifest.id == task.id)
  }
  /// Binds adopted content to its plan version and reports terminal states known from disk.
  func reconcile(_ key: String) {
    guard let task = tasks[key], var entry = entries[key] else { return }
    if var manifest = entry.manifest, manifest.version == nil, manifest.kind == task.kind, manifest.size > 0, entry.contentSize == manifest.size, jobs[key] == nil {
      manifest.version = task.version; manifest.id = task.id; manifest.owner = task.collectionOwner
      entry.manifest = manifest; entries[key] = entry
      commit(key, { store in try SlaxOfflineLayout.writeManifest(store, key, manifest) })
    }
    if complete(entry, task) { report(task, "complete"); return }
    if let retry = entry.manifest?.retry, retry.version == task.version, jobs[key] == nil {
      report(task, retry.denied ? "denied" : "failed", code: retry.code, retryAt: retry.denied ? nil : retry.retryAt)
    }
  }

  func schedulePump() {
    guard !pumpScheduled else { return }
    pumpScheduled = true
    engine.control.async { self.pumpScheduled = false; self.pump() }
  }
  func pump() {
    guard opened, !suspended, !closed else { return }
    let now = SlaxOfflineClock.now()
    var deadline = Int64.max
    if online, credential != nil {
      var running = ["personal": 0, "collection": 0]
      for job in jobs.values { running[job.task.domain, default: 0] += 1 }
      for key in order {
        guard let task = tasks[key], jobs[key] == nil, let entry = entries[key], running[task.domain, default: 0] < 3, !complete(entry, task) else { continue }
        if let retry = entry.manifest?.retry, retry.version == task.version {
          if retry.denied { continue }
          if retry.retryAt > now && !explicit.contains(key) { deadline = min(deadline, retry.retryAt); continue }
        }
        running[task.domain, default: 0] += 1
        if task.kind == "pdf" { startPdf(task) } else { startArticle(task) }
      }
    }
    if online, downloadImages {
      var active = Set(imageJobs.keys.compactMap { tasks[$0]?.domain })
      for key in order {
        guard let task = tasks[key], task.kind == "article", !active.contains(task.domain), imageJobs[key] == nil, jobs[key] == nil,
          let entry = entries[key], complete(entry, task), let images = entry.manifest?.images else { continue }
        if images.contains(where: { $0.eligible(now) }) { active.insert(task.domain); startImages(task); continue }
        for image in images where image.state == "failed" { deadline = min(deadline, image.retryAt) }
      }
    }
    if deadline != wakeAt {
      wake?.cancel(); wake = nil; wakeAt = deadline
      if deadline < .max {
        let item = DispatchWorkItem { [weak self] in self?.wakeAt = .max; self?.wake = nil; self?.pump() }
        wake = item
        engine.control.asyncAfter(deadline: .now() + .milliseconds(Int(max(1, min(2_000_000_000, deadline - now)))), execute: item)
      }
    }
  }

  // MARK: Status

  func report(_ task: SlaxOfflineTask, _ state: String, code: String? = nil, retryAt: Int64? = nil) {
    let signature = state + ":" + task.version + ":" + String(retryAt ?? 0)
    if ["downloading", "complete", "denied", "failed"].contains(state) {
      if reported[task.key] == signature { return }
      reported[task.key] = signature
    } else { reported.removeValue(forKey: task.key) }
    var item: [String: Any] = ["key": task.key, "state": state, "manual": task.manual]
    if let code { item["code"] = code }
    if let retryAt, retryAt > 0 { item["retryAt"] = retryAt }
    enqueue(item)
  }
  func reportEvicted(_ key: String) {
    reported.removeValue(forKey: key)
    enqueue(["key": key, "state": "evicted", "manual": tasks[key]?.manual ?? false])
  }
  func enqueue(_ item: [String: Any]) {
    guard !closed, let key = item["key"] as? String else { return }
    if pending[key] == nil { pendingOrder.append(key) }
    pending[key] = item
    guard !flushScheduled else { return }
    flushScheduled = true
    let elapsed = lastEmit.map { Double(DispatchTime.now().uptimeNanoseconds - $0.uptimeNanoseconds) / 1_000_000_000 } ?? .infinity
    engine.control.asyncAfter(deadline: .now() + max(0, 0.25 - elapsed)) { self.flushStatus() }
  }
  func flushStatus() {
    flushScheduled = false
    guard !closed, !pendingOrder.isEmpty else { return }
    let items = pendingOrder.compactMap { pending[$0] }
    pending.removeAll(); pendingOrder.removeAll(); lastEmit = .now()
    engine.emit("onStatus", ["owner": scope.owner, "items": items])
  }

  // MARK: Eviction, clearing, usage

  private func detachKeys(_ keys: [String], skipProtected: Bool) -> [String] {
    var selected: [String] = []
    for key in keys where SlaxOfflineTask.validKey(key) && !selected.contains(key) {
      if skipProtected && protected(key) { continue }
      cancelJobs(key)
      writers.removeValue(forKey: key)?.values.forEach { $0.cancel() }
      for request in requests.values where request.key == key { cancelRequest(request.id, .cancelled) }
      entries.removeValue(forKey: key); explicit.remove(key)
      selected.append(key)
    }
    return selected
  }
  func evict(_ keys: [String], reply: SlaxOfflineReply) {
    let selected = detachKeys(keys, skipProtected: true), layout = layout
    guard !selected.isEmpty else { reply.resolve([String]()); return }
    let work = SlaxOfflineWork(lease: lease.child())
    commit("", work: work, { store in
      for key in selected { try store.remove(SlaxOfflineLayout.bookmark(key)); try store.remove(layout.pdf(key)) }
    }) { result in
      switch result {
      case .success: reply.resolve(selected); selected.forEach { self.reportEvicted($0) }
      case .failure(let error): reply.fail(error)
      }
      self.loadEntries(selected)
    }
  }
  func clear(_ keys: [String], _ categories: [String], reply: SlaxOfflineReply) {
    let article = categories.contains("article"), images = categories.contains("images")
    let selected = detachKeys(keys, skipProtected: false), layout = layout
    guard !selected.isEmpty, article || images else { reply.resolve([String]()); return }
    var removed: [String] = []
    commit("", { store in
      for key in selected {
        if article {
          let html = try store.remove(SlaxOfflineLayout.content(key)), pdf = try store.remove(layout.pdf(key))
          try store.remove(SlaxOfflineLayout.manifest(key))
          if html || pdf { removed.append(key) }
        }
        if images { try store.remove(SlaxOfflineLayout.images(key)) }
      }
    }) { result in
      switch result {
      case .success: reply.resolve(removed); removed.forEach { self.reportEvicted($0) }
      case .failure(let error): reply.fail(error)
      }
      self.loadEntries(selected)
    }
  }
  func usage(_ keys: [String], reply: SlaxOfflineReply) {
    let selected = Array(Set(keys.filter(SlaxOfflineTask.validKey))), layout = layout
    io({ store -> [String: Any] in
      var article: Int64 = 0, images: Int64 = 0
      for key in selected {
        article += (try store.size(SlaxOfflineLayout.content(key)) ?? 0) + (try store.measure(layout.pdf(key)))
        images += try store.measure(SlaxOfflineLayout.images(key))
      }
      return ["article": article, "images": images]
    }) { result in
      switch result { case .success(let value): reply.resolve(value); case .failure(let error): reply.fail(error) }
    }
  }
}
