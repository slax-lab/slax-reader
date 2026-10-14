package slax.fixture

import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.json.JSONObject

// Only directory resolution and the Expo callback wrapper are replaced.
// Lock, decoder, JSON mapping and CAS bodies are copied verbatim at build time.
class ProductionPreferences(private val storageDirectory: File) {
  private val preferenceFile get() = File(storageDirectory, "slax.preferences.v1.json")
@@LOCKING_AND_SNAPSHOT@@
@@JSON_MAP@@
  fun read() = withPreferenceLock { readSnapshot() }
  fun values(snapshot: JSONObject) = jsonMap(snapshot.getJSONObject("values"))
  fun compareAndSwap(revision: Long, values: Map<String, Any?>): Boolean = run {
@@COMPARE_AND_SWAP@@
  }
  fun hold(action: () -> Unit) = withPreferenceLock(action)
}

object PreferenceProbe {
  private fun check(value: Boolean) { require(value) { "Controlled native preference probe rejected" } }
  private fun read(file: File): JSONObject {
    check(file.isFile && file.canonicalFile == file.absoluteFile)
    return JSONObject(file.readText())
  }
  private fun publish(file: File, value: JSONObject) {
    val temporary = File.createTempFile("slax-cas-probe-", ".tmp", file.parentFile)
    try { temporary.writeText(value.toString()); Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING) } finally { temporary.delete() }
  }
  @JvmStatic fun main(args: Array<String>) {
    check(args.size == 2 && Regex("emulator-\\d+").matches(args[0]))
    val root = File(args[1]).canonicalFile
    check(root.path in setOf("/data/data/com.slax.reader/files", "/data/user/0/com.slax.reader/files"))
    val source = read(File(root, "legacy-fixture-report.json"))
    check(source.optBoolean("controlledFixture") && source.optInt("fixtureVersion") == 1 && source.optString("androidBundleId") == "com.slax.reader" && source.optString("producer") == "powersync-kotlin-1.14.1")
    val service = read(File(root, "native-service-report.json"))
    check(service.optString("status") == "passed" && service.optString("platform") == "android" && service.optBoolean("originalLegacyFirstQueueUpload") && service.optString("coreVersion") == "0.5.3/2ba6b280")
    val request = read(File(root, "native-preference-cas-request.json"))
    check(request.optString("kind") == "slax-native-preference-cas-request" && request.optInt("version") == 1 && request.optString("device") == args[0] && request.optString("platform") == "android" && request.optString("serviceRunId") == service.getString("runId") && request.optString("sourceSHA256") == "@@SOURCE_SHA256@@")
    val nonce = request.getString("nonce")
    check(Regex("[0-9a-f-]{36}").matches(nonce))
    val state = read(File(root, "native-preference-cas-state.json"))
    check(state.optString("kind") == "slax-native-preference-cas-state" && state.optString("nonce") == nonce && state.optString("phase") == "waiting-probe" && state.getLong("requestedAt") == request.getLong("requestedAt"))
    val target = File(root, "native-preference-cas-probe.json")
    check(!target.exists() || target.canonicalFile == target.absoluteFile)
    val store = ProductionPreferences(root)
    val event = JSONObject().put("kind", "slax-native-preference-cas-probe").put("version", 1).put("nonce", nonce).put("requestedAt", request.getLong("requestedAt")).put("platform", "android").put("pid", android.os.Process.myPid()).put("sourceSHA256", "@@SOURCE_SHA256@@")
    when (request.getString("mode")) {
      "stale-cas" -> {
        val before = store.read()
        check(before.getLong("revision") == state.getLong("revision"))
        val applied = store.compareAndSwap(before.getLong("revision"), store.values(before) + ("native_cas_probe" to nonce))
        check(applied)
        val after = store.read()
        check(after.getLong("revision") == before.getLong("revision") + 1)
        publish(target, event.put("phase", "committed").put("revisionBefore", before.getLong("revision")).put("revisionAfter", after.getLong("revision")).put("applied", applied))
      }
      "lock-read" -> {
        store.hold {
          publish(target, event.put("phase", "lock-held").put("heldAt", System.currentTimeMillis()))
          Thread.sleep(8000)
        }
        publish(target, event.put("phase", "lock-released").put("releasedAt", System.currentTimeMillis()))
      }
      else -> error("Unrecognized controlled CAS mode")
    }
    println(JSONObject().put("kind", "slax-native-preference-cas-probe-result").put("nonce", nonce).put("status", "passed"))
  }
}
