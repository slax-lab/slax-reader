package slax.fixture;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;

/** Run only with run-as in the controlled synthetic emulator installation. */
public final class OwnerProbe {
  public static void main(String[] arguments) throws Exception {
    if (arguments.length != 1) throw new IllegalArgumentException("One controlled lock path is required");
    String path = arguments[0];
    if (!path.equals("/data/data/com.slax.reader/files/.slax-data-owner.lock") && !path.equals("/data/user/0/com.slax.reader/files/.slax-data-owner.lock")) throw new IllegalArgumentException("Unrecognized synthetic application path");
    File file = new File(path);
    if (!file.isFile()) throw new IllegalStateException("The controlled app has not created its production lease");
    try (RandomAccessFile owner = new RandomAccessFile(file, "rw")) {
      FileLock lock = owner.getChannel().tryLock();
      boolean acquired = lock != null;
      if (lock != null) lock.release();
      System.out.println("{\"kind\":\"slax-native-owner-probe\",\"platform\":\"android\",\"acquired\":" + acquired + "}");
    }
  }
}
